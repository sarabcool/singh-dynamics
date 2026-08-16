// CI checks for the Website Sales customer entry path.
//
// These are static assertions over source, not a running-server test. They exist
// because every bug they cover was silent: a form that 403s, a bounce webhook
// that returns 200 and discards the event, a placeholder host shipped to
// production. None of those fail loudly on their own.
//
//   node tools/ci-intake-tests.mjs --local

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.env.CI !== 'true' && !process.argv.includes('--local')) process.exit(0);

// Resolve from this file, not the working directory. agent/package.json runs
// this on postinstall with cwd=agent/, so cwd-relative paths break in CI while
// passing locally, which is exactly how this file failed its first CI run.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const worker = read('infra/worker/index.js');
const sales = read('site/sales/index.html');
const deploy = read('.github/workflows/deploy-marketing-sites.yml');
const executor = read('agent/execute-approved.mjs');
const mail = read('agent/lib/mail.mjs');
const inquiry = read('agent/inquiry-received.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) {
    console.error(`FAIL: ${name}\n  ${err.message}`);
    process.exit(1);
  }
}

test('every marketing origin that can host the form is allowed by CORS', () => {
  for (const origin of [
    'https://singhdynamics.com',
    'https://www.singhdynamics.com',
    'https://sales.singhdynamics.com',
  ]) {
    assert.ok(worker.includes(`'${origin}'`), `${origin} missing from PUBLIC_ORIGINS`);
  }
});

test('the sales page has a real intake form, not just a mailto', () => {
  assert.match(sales, /<form[^>]+id="start-form"/, 'no intake form on the sales page');
  for (const field of ['shop_name', 'contact_name', 'email', 'phone', 'city', 'notes']) {
    assert.match(sales, new RegExp(`name="${field}"`), `form is missing the ${field} field`);
  }
  assert.match(sales, /name="company_website"/, 'honeypot field missing');
  assert.match(sales, /class="trap"/, 'honeypot is not hidden');
});

test('the form posts to the Worker intake endpoint', () => {
  assert.match(sales, /data-endpoint="https:\/\/[^"]*\/intake"/, 'form endpoint is not an /intake URL');
});

test('the form hides itself rather than shipping a dead button', () => {
  assert.match(sales, /REPLACE_WITH_WORKER_HOST/, 'placeholder host is gone from source');
  assert.match(sales, /form\.hidden = true/, 'no fallback when the host was not substituted');
  assert.match(sales, /mailto:sarab@singhdynamics\.com/, 'mailto fallback removed');
});

test('deploy substitutes the Worker host and fails if the placeholder survives', () => {
  assert.match(deploy, /REPLACE_WITH_WORKER_HOST/, 'deploy never substitutes the placeholder');
  assert.match(deploy, /placeholder host survived substitution/, 'no guard against shipping the placeholder');
});

test('marketing deploys do not cancel sibling sites on one failure', () => {
  assert.match(deploy, /fail-fast:\s*false/, 'matrix will half-deploy on a single failure');
});

test('bounces and complaints are handled, not acknowledged and dropped', () => {
  assert.match(worker, /email\.bounced/, 'bounce events are not handled');
  assert.match(worker, /email\.complained/, 'complaint events are not handled');
  assert.match(worker, /INSERT OR IGNORE INTO suppression/, 'nothing writes to the suppression list');
  assert.match(worker, /SET opted_out=1/, 'a bounced lead is never opted out');
});

test('only permanent bounces suppress', () => {
  assert.match(worker, /bounceType !== 'permanent'/, 'transient bounces would suppress a good lead');
});

test('intake is rate limited', () => {
  assert.match(worker, /INTAKE_PER_IP_PER_HOUR/, 'no per-IP intake limit');
  assert.match(worker, /INTAKE_GLOBAL_PER_HOUR/, 'no global intake limit');
  assert.ok(!worker.includes('cf-connecting-ip\')\n'), 'sanity');
  assert.match(worker, /crypto\.subtle\.digest\('SHA-256'/, 'IPs should be hashed, not stored raw');
});

test('approving an expired item does not silently no-op', () => {
  assert.match(
    worker,
    /status='pending' AND expires_at > datetime\('now'\)/,
    'handleApproval still approves rows the executor will refuse to claim'
  );
  assert.match(worker, /SET status='expired'/, 'expired items are never settled');
});

test('a call script is a human action, not a failed send', () => {
  assert.match(executor, /action_type === 'outreach_call_script'/, 'call scripts still hit the no-executor path');
  assert.ok(
    executor.indexOf("action_type === 'outreach_call_script'") <
      executor.indexOf("no executor for action_type"),
    'the call-script branch must come before the generic no-executor failure'
  );
});

test('transient Resend failures retry instead of dying', () => {
  assert.match(mail, /class TransientMailError/, 'no transient error type');
  assert.match(mail, /RETRY_STATUSES/, 'no retry on 429/5xx');
  assert.match(executor, /e\?\.transient/, 'executor does not distinguish transient failures');
  assert.match(executor, /SET executed_at = NULL/, 'a released row can never be reclaimed');
});

test('sends carry an idempotency key so a retry cannot double-send', () => {
  assert.match(mail, /'Idempotency-Key'/, 'no idempotency header on the Resend call');
  assert.match(executor, /idempotencyKey: `approval-\$\{row\.id\}`/, 'key is not stable per queue row');
});

test('inbound inquiries do not stack duplicate approval items', () => {
  assert.match(inquiry, /already has a queued or sent outreach item/, 'no duplicate guard on inquiry intake');
});

console.log(`intake and customer-flow tests passed (${passed})`);
