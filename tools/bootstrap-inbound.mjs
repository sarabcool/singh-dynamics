import { writeFile, chmod, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const {
  RESEND_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  WORKER_URL,
  RUNNER_TEMP = '/tmp',
  GITHUB_OUTPUT,
  ROOT_DOMAIN = 'singhdynamics.com',
  INBOUND_DOMAIN = 'reply.singhdynamics.com',
} = process.env;

for (const [name, value] of Object.entries({
  RESEND_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  WORKER_URL,
})) {
  if (!value) throw new Error(`${name} missing`);
}

const workerUrl = WORKER_URL.replace(/\/$/, '');
const webhookEndpoint = `${workerUrl}/webhooks/resend`;

console.log(`inbound bootstrap: domain=${INBOUND_DOMAIN}`);
console.log(`webhook endpoint: ${webhookEndpoint}`);

const domain = await ensureResendReceivingDomain();
let domainDetails = await resend(`/domains/${domain.id}`);
const receivingMx = (domainDetails.records || []).find(
  (record) => record.type === 'MX' && /inbound-smtp/i.test(String(record.value || ''))
);
if (!receivingMx) {
  throw new Error('Resend did not return a receiving MX record. Refusing to guess DNS.');
}

await ensureCloudflareMx({
  name: INBOUND_DOMAIN,
  content: receivingMx.value,
  priority: Number(receivingMx.priority || 10),
});

// Verification is asynchronous. Request it on every run, then re-fetch the
// domain. The workflow may safely be rerun after DNS propagates.
await resend(`/domains/${domain.id}/verify`, { method: 'POST' });
domainDetails = await resend(`/domains/${domain.id}`);
const receivingVerified = domainDetails.status === 'verified';
console.log(`Resend receiving status for ${INBOUND_DOMAIN}: ${domainDetails.status || 'unknown'}`);
await setOutput('receiving_verified', receivingVerified ? 'true' : 'false');

const webhook = await ensureWebhook();
const secret = webhook.signing_secret;
if (!secret || !secret.startsWith('whsec_')) {
  throw new Error('Resend webhook exists but no signing_secret was returned');
}

const secretPath = join(RUNNER_TEMP, 'resend-webhook-secret');
await writeFile(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
await chmod(secretPath, 0o600);
console.log(`signing secret written to protected runner temp file: ${secretPath}`);
console.log(`webhook ${webhook.id} ready for email.received`);

if (!receivingVerified) {
  console.log('DNS is configured but Resend has not verified the receiving domain yet.');
  console.log('Safe state: webhook secret can be installed, but outbound Reply-To routing must remain disabled.');
  console.log('Rerun bootstrap-inbound after DNS propagation; it is idempotent.');
}

async function setOutput(name, value) {
  if (!GITHUB_OUTPUT) return;
  await appendFile(GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

async function ensureResendReceivingDomain() {
  const list = await resend('/domains');
  let domain = (list.data || []).find((item) => item.name === INBOUND_DOMAIN);

  if (!domain) {
    domain = await resend('/domains', {
      method: 'POST',
      body: {
        name: INBOUND_DOMAIN,
        capabilities: { sending: 'disabled', receiving: 'enabled' },
      },
    });
    console.log(`created Resend receiving domain ${INBOUND_DOMAIN}`);
    return domain;
  }

  if (domain.capabilities?.receiving !== 'enabled') {
    await resend(`/domains/${domain.id}`, {
      method: 'PATCH',
      body: { capabilities: { receiving: 'enabled' } },
    });
    console.log(`enabled receiving on existing Resend domain ${INBOUND_DOMAIN}`);
  } else {
    console.log(`Resend receiving domain already exists: ${INBOUND_DOMAIN}`);
  }

  return domain;
}

async function ensureWebhook() {
  const list = await resend('/webhooks');
  let item = (list.data || []).find((hook) => hook.endpoint === webhookEndpoint);

  if (!item) {
    const created = await resend('/webhooks', {
      method: 'POST',
      body: { endpoint: webhookEndpoint, events: ['email.received'] },
      sensitive: true,
    });
    console.log(`created Resend webhook ${created.id}`);
    return created;
  }

  const wanted = new Set([...(item.events || []), 'email.received']);
  if (!(item.events || []).includes('email.received') || item.status === 'disabled') {
    await resend(`/webhooks/${item.id}`, {
      method: 'PATCH',
      body: { events: [...wanted], status: 'enabled' },
    });
    console.log(`updated existing Resend webhook ${item.id}`);
  } else {
    console.log(`Resend webhook already exists: ${item.id}`);
  }

  return resend(`/webhooks/${item.id}`, { sensitive: true });
}

async function ensureCloudflareMx({ name, content, priority }) {
  const zones = await cloudflare(
    `/zones?name=${encodeURIComponent(ROOT_DOMAIN)}&account.id=${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}`
  );
  if (zones.length !== 1) {
    throw new Error(`expected exactly one Cloudflare zone for ${ROOT_DOMAIN}, got ${zones.length}`);
  }
  const zoneId = zones[0].id;
  const records = await cloudflare(
    `/zones/${zoneId}/dns_records?type=MX&name=${encodeURIComponent(name)}`
  );

  const same = records.find(
    (record) => normalizeDns(record.content) === normalizeDns(content) && Number(record.priority || 0) === priority
  );
  if (same) {
    console.log(`Cloudflare MX already correct: ${name} -> ${content}`);
    return;
  }

  if (records.length > 0) {
    const existing = records.map((r) => `${r.content} priority=${r.priority}`).join(', ');
    throw new Error(
      `conflicting MX record(s) already exist on ${name}: ${existing}. Refusing to overwrite mail routing.`
    );
  }

  await cloudflare(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: {
      type: 'MX',
      name,
      content,
      priority,
      ttl: 1,
    },
  });
  console.log(`created Cloudflare MX: ${name} -> ${content} priority=${priority}`);
}

function normalizeDns(value) {
  return String(value || '').replace(/\.$/, '').toLowerCase();
}

async function resend(path, { method = 'GET', body, sensitive = false } = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${method} ${path} failed with ${res.status}${sensitive ? '' : `: ${JSON.stringify(payload)}`}`);
  }
  return payload;
}

async function cloudflare(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.success === false) {
    throw new Error(`Cloudflare ${method} ${path} failed with ${res.status}: ${JSON.stringify(payload.errors || [])}`);
  }
  return payload.result;
}
