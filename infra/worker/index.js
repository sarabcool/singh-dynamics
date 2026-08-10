const JSON_HEADERS = { 'content-type': 'application/json' };
const PUBLIC_ORIGINS = new Set([
  'https://singhdynamics.com',
  'https://www.singhdynamics.com',
]);

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if (cron === '0 7 * * *') {
      ctx.waitUntil(dispatch(env, 'discover-leads', { reason: 'nightly', at: new Date().toISOString() }));
    }
    if (cron === '0 12 * * *') {
      ctx.waitUntil(dispatch(env, 'daily-digest', { reason: 'morning' }));
    }
    if (cron === '15 * * * *') {
      ctx.waitUntil(checkUptime(env));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/unsubscribe') return handleUnsubscribe(request, url, env);
    if (url.pathname === '/health') return json({ ok: true, ts: Date.now() });

    if (url.pathname === '/intake') {
      if (request.method === 'OPTIONS') return corsPreflight(request);
      if (request.method === 'POST') return handleIntake(request, env);
      return new Response('method not allowed', { status: 405 });
    }

    // Resend signs every webhook. The raw body must be verified before JSON
    // parsing; re-stringifying parsed JSON changes the signature bytes.
    if (url.pathname === '/webhooks/resend' && request.method === 'POST') {
      return handleResendWebhook(request, env);
    }

    if (!authorized(request, env)) return new Response('unauthorized', { status: 401 });

    if (url.pathname === '/digest') return renderDigest(env);
    if (url.pathname === '/approve' && request.method === 'POST') return handleApproval(request, env);
    if (url.pathname === '/trigger' && request.method === 'POST') {
      const { job } = await request.json();
      await dispatch(env, job, { reason: 'manual' });
      return json({ dispatched: job });
    }

    return new Response('not found', { status: 404 });
  },
};

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  if (!PUBLIC_ORIGINS.has(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function corsPreflight(request) {
  const headers = corsHeaders(request);
  if (!headers) return new Response('forbidden', { status: 403 });
  return new Response(null, { status: 204, headers });
}

function clean(value, max) {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/\s+/g, ' ');
  return v ? v.slice(0, max) : null;
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleIntake(request, env) {
  const cors = corsHeaders(request);
  if (!cors) return new Response('forbidden', { status: 403 });

  let body;
  try {
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'content-type must be application/json' }, { status: 415, headers: cors });
    }
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors });
  }

  if (clean(body.company_website, 200)) {
    return json({ ok: true }, { status: 202, headers: cors });
  }

  const shopName = clean(body.shop_name, 120);
  const contactName = clean(body.contact_name, 120);
  const email = clean(body.email, 254)?.toLowerCase() || null;
  const phone = clean(body.phone, 40);
  const city = clean(body.city, 100);
  const notes = clean(body.notes, 1000);

  if (!shopName) return json({ ok: false, error: 'shop_name is required' }, { status: 400, headers: cors });
  if (!email && !phone) return json({ ok: false, error: 'email or phone is required' }, { status: 400, headers: cors });
  if (!validEmail(email)) return json({ ok: false, error: 'invalid email' }, { status: 400, headers: cors });

  await env.DB.prepare(
    `INSERT INTO inquiries (shop_name, contact_name, email, phone, city, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, 'singhdynamics.com')`
  ).bind(shopName, contactName, email, phone, city, notes).run();

  await dispatch(env, 'inquiry-received', { reason: 'website-intake' });
  return json({ ok: true }, { status: 201, headers: cors });
}

async function handleResendWebhook(request, env) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    console.error('RESEND_WEBHOOK_SECRET missing');
    return new Response('webhook unavailable', { status: 503 });
  }

  const raw = await request.text();
  const id = request.headers.get('svix-id') || request.headers.get('webhook-id');
  const timestamp = request.headers.get('svix-timestamp') || request.headers.get('webhook-timestamp');
  const signature = request.headers.get('svix-signature') || request.headers.get('webhook-signature');

  const verified = await verifySvix({ raw, id, timestamp, signature, secret: env.RESEND_WEBHOOK_SECRET });
  if (!verified) return new Response('invalid webhook', { status: 400 });

  let event;
  try { event = JSON.parse(raw); } catch { return new Response('invalid json', { status: 400 }); }
  if (event.type !== 'email.received') return json({ ok: true, ignored: event.type || 'unknown' });

  const data = event.data || {};
  if (!data.email_id || !data.from) return new Response('missing email metadata', { status: 400 });

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO inbound_emails
       (svix_id, resend_email_id, from_email, to_json, subject, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    data.email_id,
    String(data.from).toLowerCase(),
    JSON.stringify(data.to || []),
    data.subject || null,
    data.created_at || event.created_at || new Date().toISOString(),
  ).run();

  // Resend retries webhooks. Only the first delivery should schedule work.
  if ((inserted.meta?.changes || 0) > 0) {
    await dispatch(env, 'email-received', {
      reason: 'resend-inbound',
      email_id: data.email_id,
      svix_id: id,
    });
  }

  return json({ ok: true });
}

async function verifySvix({ raw, id, timestamp, signature, secret }) {
  if (!id || !timestamp || !signature || !secret?.startsWith('whsec_')) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  let keyBytes;
  try { keyBytes = base64ToBytes(secret.slice('whsec_'.length)); } catch { return false; }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${raw}`);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));

  for (const candidate of signature.split(/\s+/)) {
    const [version, encoded] = candidate.split(',', 2);
    if (version !== 'v1' || !encoded) continue;
    let provided;
    try { provided = base64ToBytes(encoded); } catch { continue; }
    if (constantTimeBytesEqual(digest, provided)) return true;
  }
  return false;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function constantTimeBytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function authorized(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!env.OPERATOR_TOKEN || token.length !== env.OPERATOR_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ env.OPERATOR_TOKEN.charCodeAt(i);
  return diff === 0;
}

async function dispatch(env, job, payload) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'singh-dynamics-worker',
    },
    body: JSON.stringify({ event_type: job, client_payload: payload }),
  });

  await env.DB.prepare(`INSERT INTO runs (job, trigger, ok, summary) VALUES (?, ?, ?, ?)`)
    .bind(job, payload.reason || 'cron', res.ok ? 1 : 0, res.ok ? 'dispatched' : `dispatch failed: ${res.status}`)
    .run();
  return res.ok;
}

async function checkUptime(env) {
  const { results } = await env.DB.prepare(`SELECT id, slug, live_url FROM sites WHERE live_url IS NOT NULL`).all();
  await Promise.all(results.map(async (site) => {
    const started = Date.now();
    let code = 0, ok = 0;
    try {
      const res = await fetch(site.live_url, { method: 'GET', cf: { cacheTtl: 0 } });
      code = res.status;
      ok = res.ok ? 1 : 0;
    } catch { ok = 0; }
    const ms = Date.now() - started;
    await env.DB.prepare(`INSERT INTO uptime_checks (site_id, status_code, ms, ok) VALUES (?, ?, ?, ?)`)
      .bind(site.id, code, ms, ok).run();
    if (!ok) {
      const { results: recent } = await env.DB.prepare(`SELECT ok FROM uptime_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 2`)
        .bind(site.id).all();
      if (recent.length === 2 && recent.every((r) => !r.ok)) {
        await dispatch(env, 'site-down', { slug: site.slug, url: site.live_url });
      }
    }
  }));
}

// Unsubscribe tokens are HMACs of the lead id, not slugs.
//
// The previous version looked the lead up by `slug`, which is guessable
// ("khalsa-computers"), on a GET that mutated state. Two consequences, the
// second far worse: anyone could opt out any lead by typing a business name
// into a URL, and every link scanner that fetches URLs before a human sees
// them (Outlook Safe Links, Gmail's proxy) would silently opt out every
// prospect we mailed. The result would be zero replies with no visible cause.
//
// So: unguessable token, and GET never writes. Resend's one-click unsubscribe
// already sends POST, so List-Unsubscribe-Post keeps working unchanged.
const UNSUB_CONTEXT = 'unsub:v1:';

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Keyed on OPERATOR_TOKEN rather than a fourth secret. HMAC is one-way, so a
// leaked unsubscribe link does not expose the operator token, and this avoids
// another secret to rotate and keep in sync with the deploy workflow.
async function unsubSignature(leadId, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${UNSUB_CONTEXT}${leadId}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

async function verifyUnsubToken(token, env) {
  if (!env.OPERATOR_TOKEN || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const idPart = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^[0-9]{1,15}$/.test(idPart)) return null;

  const expected = await unsubSignature(idPart, env.OPERATOR_TOKEN);
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0 ? Number(idPart) : null;
}

function unsubPage(heading, body, status = 200) {
  const html = '<!doctype html><meta charset=utf-8>'
    + '<meta name=viewport content="width=device-width,initial-scale=1">'
    + '<title>Singh Dynamics</title>'
    + '<style>body{font:16px/1.6 system-ui;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1a1a1a}'
    + 'button{font:inherit;padding:.6rem 1.2rem;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:6px;cursor:pointer}</style>'
    + `<h1>${heading}</h1>${body}`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html;charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function handleUnsubscribe(request, url, env) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const leadId = await verifyUnsubToken(url.searchParams.get('t') || '', env);

  // Same response whether the token is malformed or simply unknown, so this
  // endpoint cannot be used to test which lead ids exist.
  if (leadId === null) {
    return unsubPage(
      'This link is not valid.',
      '<p>If you got here from one of our emails, reply to it and we will remove you by hand.</p>',
      400,
    );
  }

  if (request.method === 'GET') {
    return unsubPage(
      'Unsubscribe',
      '<p>Confirm and Singh Dynamics will not contact you again.</p>'
        + '<form method="post"><button type="submit">Confirm unsubscribe</button></form>',
    );
  }

  const lead = await env.DB.prepare(
    `SELECT id, email, phone FROM leads WHERE id = ?`,
  ).bind(leadId).first();

  if (lead) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE leads SET opted_out=1, opted_out_at=datetime('now'), status='do_not_contact' WHERE id=?`).bind(lead.id),
      env.DB.prepare(`INSERT OR IGNORE INTO suppression (email, phone, reason) VALUES (?, ?, 'user opt-out')`).bind(lead.email, lead.phone),
      env.DB.prepare(`UPDATE approval_queue SET status='expired' WHERE lead_id=? AND status='pending'`).bind(lead.id),
    ]);
  }

  return unsubPage(
    "You're unsubscribed.",
    '<p>You will not receive further email from Singh Dynamics.</p>',
  );
}

async function renderDigest(env) {
  const { results } = await env.DB.prepare(`SELECT q.id,q.action_type,q.summary,q.rationale,q.created_at,l.name AS lead_name,l.city FROM approval_queue q LEFT JOIN leads l ON l.id=q.lead_id WHERE q.status='pending' AND q.expires_at>datetime('now') ORDER BY q.created_at`).all();
  return json({ pending: results.length, items: results });
}

async function handleApproval(request, env) {
  const { ids, decision, note } = await request.json();
  if (!['approved', 'rejected'].includes(decision)) return new Response('bad decision', { status: 400 });
  if (!Array.isArray(ids) || ids.length === 0) return new Response('no ids', { status: 400 });
  const placeholders = ids.map(() => '?').join(',');
  await env.DB.prepare(`UPDATE approval_queue SET status=?, decided_at=datetime('now'), decided_note=? WHERE id IN (${placeholders}) AND status='pending'`)
    .bind(decision, note || null, ...ids).run();
  if (decision === 'approved') await dispatch(env, 'execute-approved', { ids });
  return json({ updated: ids.length, decision });
}
