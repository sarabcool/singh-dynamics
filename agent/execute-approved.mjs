/**
 * Execute approved actions.
 *
 * This is the only script in the repo that contacts a stranger. Everything
 * upstream is research, drafting or internal state. Human approval is required
 * before this script may send prospect email.
 */

import { createHmac } from 'node:crypto';
import { d1, d1First, assertD1Env, logRun } from './lib/d1.mjs';
import { sendInboundReply, sendProspect } from './lib/mail.mjs';

const DRY = process.argv.includes('--dry-run');
const MAX_SENDS = Number(process.env.MAX_SENDS || '25');
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const INBOUND_REPLY_DOMAIN = (process.env.INBOUND_REPLY_DOMAIN || '')
  .trim()
  .toLowerCase()
  .replace(/^@/, '');

assertD1Env();

if (!WORKER_URL && !DRY) {
  console.error('WORKER_URL not set. Cannot build unsubscribe links, refusing to send.');
  process.exit(1);
}

// Must match verifyUnsubToken() in infra/worker/index.js. The token is an HMAC
// of the lead id so it cannot be guessed from the business name, which the old
// slug-based link could be.
const UNSUB_SECRET = process.env.OPERATOR_TOKEN || '';
if (!UNSUB_SECRET && !DRY) {
  console.error('OPERATOR_TOKEN not set. Cannot sign unsubscribe links, refusing to send.');
  process.exit(1);
}

function unsubscribeUrlFor(leadId) {
  const sig = createHmac('sha256', UNSUB_SECRET)
    .update(`unsub:v1:${leadId}`)
    .digest('base64url');
  return `${WORKER_URL}/unsubscribe?t=${encodeURIComponent(`${leadId}.${sig}`)}`;
}

let ids;
try {
  ids = JSON.parse(process.env.APPROVED_IDS || '[]');
} catch {
  console.error(`APPROVED_IDS is not valid JSON: ${process.env.APPROVED_IDS}`);
  process.exit(1);
}
if (!Array.isArray(ids) || ids.length === 0) {
  console.log('no ids in payload, nothing to do');
  process.exit(0);
}
ids = ids.map(Number).filter(Number.isInteger).slice(0, MAX_SENDS);
const ph = ids.map(() => '?').join(',');

if (DRY) {
  const preview = await d1(
    `SELECT id, action_type, status, summary FROM approval_queue WHERE id IN (${ph})`,
    ids
  );
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const claimed = await d1(
  `UPDATE approval_queue
      SET executed_at = datetime('now')
    WHERE id IN (${ph})
      AND status = 'approved'
      AND executed_at IS NULL
      AND expires_at > datetime('now')
    RETURNING id, action_type, lead_id, payload, summary`,
  ids
);

if (claimed.length === 0) {
  console.log('claimed 0 rows. Already executed, expired, or never approved.');
  await logRun({ job: 'execute-approved', itemsIn: ids.length, itemsOut: 0, summary: 'nothing claimable' });
  process.exit(0);
}

console.log(`claimed ${claimed.length} of ${ids.length} requested`);
let sent = 0, skipped = 0, failed = 0, humanActions = 0, released = 0;

for (const row of claimed) {
  try {
    const lead = row.lead_id
      ? await d1First(
          `SELECT id, slug, name, email, phone, city, opted_out, status
             FROM leads WHERE id = ?`, [row.lead_id])
      : null;

    // A call script is a human action. Approving one means "yes, make this
    // call", not "send something". It used to be marked failed with
    // "no executor", which turned the whole workflow run red for a phone lead
    // behaving exactly as designed.
    if (row.action_type === 'outreach_call_script') {
      await finish(row.id, 'executed', null);
      console.log(`  #${row.id} -> executed: call script approved, no send (human action)`);
      humanActions++;
      continue;
    }

    if (row.action_type !== 'outreach_email') {
      await finish(row.id, 'failed', `no executor for action_type '${row.action_type}'`);
      failed++;
      continue;
    }
    if (!lead) { await finish(row.id, 'failed', 'no lead attached'); failed++; continue; }
    if (lead.opted_out) { await finish(row.id, 'expired', 'lead opted out'); skipped++; continue; }
    if (lead.status === 'do_not_contact') { await finish(row.id, 'expired', 'lead is do_not_contact'); skipped++; continue; }

    const supp = await d1First(
      `SELECT id, reason FROM suppression
        WHERE (email IS NOT NULL AND email = ?)
           OR (phone IS NOT NULL AND phone = ?)`,
      [lead.email, lead.phone]
    );
    if (supp) {
      await finish(row.id, 'expired', `suppressed: ${supp.reason}`);
      skipped++;
      continue;
    }

    const body = JSON.parse(row.payload);
    const to = body.to || lead.email;
    if (!to) { await finish(row.id, 'failed', 'no email address'); failed++; continue; }
    if (!body.subject || !body.html) {
      await finish(row.id, 'failed', 'payload missing subject or html');
      failed++;
      continue;
    }

    // Once reply.singhdynamics.com is live, each lead gets a deterministic
    // receiving address. Until then, preserve the existing normal inbox.
    const automatedReplyTo = INBOUND_REPLY_DOMAIN
      ? `r-${lead.slug}@${INBOUND_REPLY_DOMAIN}`
      : null;

    const replyTo = automatedReplyTo || body.reply_to || 'sarab@singhdynamics.com';
    if (body.mail_kind === 'inbound_reply') {
      await sendInboundReply({
        to,
        subject: body.subject,
        html: body.html,
        replyTo,
        inReplyTo: body.in_reply_to,
        references: body.references,
        idempotencyKey: `approval-${row.id}`,
      });
    } else {
      await sendProspect({
        to,
        subject: body.subject,
        html: body.html,
        replyTo,
        unsubscribeUrl: unsubscribeUrlFor(lead.id),
        // Stable per queue row, so a retry of this exact approved action cannot
        // become a second email to the same stranger.
        idempotencyKey: `approval-${row.id}`,
      });
    }

    await d1(
      `UPDATE leads SET status = 'contacted' WHERE id = ? AND status IN ('new','queued')`,
      [lead.id]
    );

    await finish(row.id, 'executed', null);
    sent++;
    console.log(`sent #${row.id} to ${lead.name} <${to}>`);
    await new Promise((r) => setTimeout(r, 600));
  } catch (e) {
    // A rate limit or a 5xx from Resend used to be fatal: the claim had already
    // stamped executed_at, and the claim query requires executed_at IS NULL, so
    // the row could never be picked up again and re-approving did nothing.
    // Release it instead and let the next run retry. The idempotency key above
    // is what makes that safe.
    if (e?.transient) {
      await d1(
        `UPDATE approval_queue SET executed_at = NULL, error = ? WHERE id = ?`,
        [`released for retry: ${String(e.message || e).slice(0, 400)}`, row.id]
      );
      console.error(`#${row.id} transient failure, released for retry: ${e.message}`);
      released++;
      continue;
    }
    console.error(`#${row.id} failed: ${e.message}`);
    await finish(row.id, 'failed', String(e.message || e).slice(0, 500));
    failed++;
  }
}

async function finish(id, status, error) {
  await d1(`UPDATE approval_queue SET status = ?, error = ? WHERE id = ?`, [status, error, id]);
  if (error) console.log(`  #${id} -> ${status}: ${error}`);
}

const summary = `${sent} sent, ${skipped} skipped, ${humanActions} human action(s), ${released} released for retry, ${failed} failed`;
console.log(`\n${summary}`);
await logRun({
  job: 'execute-approved',
  ok: failed === 0 ? 1 : 0,
  itemsIn: claimed.length,
  itemsOut: sent,
  summary,
  error: failed ? `${failed} action(s) failed, see approval_queue.error` : null,
});
if (failed > 0) process.exit(1);
