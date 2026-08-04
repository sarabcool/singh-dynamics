/**
 * Execute approved actions.
 *
 * This is the only script in the repo that contacts a stranger. Everything
 * upstream of it, sweep, classify, discover, is read-only against the outside
 * world. Treat every line here as load-bearing.
 *
 * Dispatched by the Worker when POST /approve flips rows to 'approved'.
 * Payload: { ids: [1,2,3] }
 *
 * FIVE SAFETY PROPERTIES, none optional:
 *
 * 1. CLAIM BEFORE SEND. Each row is moved 'approved' -> 'executing' with a
 *    conditional UPDATE before anything is sent. If two runs race, the second
 *    claims zero rows and sends nothing. Sending the same cold email twice is
 *    worse than not sending it at all.
 * 2. SUPPRESSION IS CHECKED AT SEND TIME, not at approval time. Someone can opt
 *    out in the window between the digest and the approval, and the whole point
 *    of the suppression table is that it wins.
 * 3. EXPIRY IS RECHECKED. An approval sitting in a failed run for a week does
 *    not get to execute against stale facts.
 * 4. HARD CAP. MAX_SENDS bounds the blast radius of a bug that approves the
 *    whole table. Default 25.
 * 5. UNKNOWN ACTION TYPES FAIL LOUDLY. A row this script cannot execute is
 *    marked 'failed' with a reason. It is never marked 'executed', and the
 *    digest surfaces it the next morning.
 *
 *   node agent/execute-approved.mjs                # reads IDS from env
 *   node agent/execute-approved.mjs --dry-run      # claims nothing, sends nothing
 */

import { d1, d1First, assertD1Env, logRun } from './lib/d1.mjs';
import { sendProspect, escapeHtml } from './lib/mail.mjs';

const DRY = process.argv.includes('--dry-run');
const MAX_SENDS = Number(process.env.MAX_SENDS || '25');
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');

assertD1Env();

if (!WORKER_URL && !DRY) {
  // Without this we cannot build an unsubscribe link, and sendProspect will
  // refuse. Fail here with a clear reason rather than 25 identical throws.
  console.error('WORKER_URL not set. Cannot build unsubscribe links, refusing to send.');
  process.exit(1);
}

// ids arrive as a JSON array string from the workflow, e.g. "[1,2,3]"
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

// ---------------------------------------------------------------------------
// 1. claim
// ---------------------------------------------------------------------------

if (DRY) {
  const preview = await d1(
    `SELECT id, action_type, status, summary FROM approval_queue WHERE id IN (${ph})`,
    ids
  );
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

// The claim marker is executed_at, not status. It would read better as
// status='executing', but the schema's CHECK constraint does not allow that
// value and adding it means a full SQLite table rebuild for no real gain.
// Stamping executed_at under `AND executed_at IS NULL` is the same mutual
// exclusion in a column that already exists.
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
  await logRun({ job: 'execute-approved', itemsIn: ids.length, itemsOut: 0,
                 summary: 'nothing claimable' });
  process.exit(0);
}

console.log(`claimed ${claimed.length} of ${ids.length} requested`);

// ---------------------------------------------------------------------------
// 2. execute
// ---------------------------------------------------------------------------

let sent = 0;
let skipped = 0;
let failed = 0;

for (const row of claimed) {
  try {
    const lead = row.lead_id
      ? await d1First(
          `SELECT id, slug, name, email, phone, city, opted_out, status
             FROM leads WHERE id = ?`, [row.lead_id])
      : null;

    if (row.action_type !== 'outreach_email') {
      // Everything else in the CHECK constraint (quote, contract, payment,
      // publish, data_delete, pricing_change) has no executor yet. Marking
      // these 'executed' would be a lie the runs table then repeats forever.
      await finish(row.id, 'failed', `no executor for action_type '${row.action_type}'`);
      failed++;
      continue;
    }

    if (!lead) { await finish(row.id, 'failed', 'no lead attached'); failed++; continue; }
    if (lead.opted_out) { await finish(row.id, 'expired', 'lead opted out'); skipped++; continue; }
    if (lead.status === 'do_not_contact') {
      await finish(row.id, 'expired', 'lead is do_not_contact'); skipped++; continue;
    }

    // Suppression is global, permanent, and keyed independently of the lead row.
    // Checked here, at send time, not at approval time.
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

    await sendProspect({
      to,
      subject: body.subject,
      html: body.html,
      replyTo: body.reply_to || 'sarab@singhdynamics.com',
      unsubscribeUrl: `${WORKER_URL}/unsubscribe?t=${encodeURIComponent(lead.slug)}`,
    });

    // Only an actual send may move a lead to 'contacted'. This is the line the
    // discovery agent is explicitly forbidden from crossing on its own.
    await d1(
      `UPDATE leads SET status = 'contacted' WHERE id = ? AND status IN ('new','queued')`,
      [lead.id]
    );

    await finish(row.id, 'executed', null);
    sent++;
    console.log(`sent #${row.id} to ${lead.name} <${to}>`);

    // Resend's default rate limit is 2 req/s. Nothing here is urgent enough to
    // be worth arguing with it.
    await new Promise((r) => setTimeout(r, 600));
  } catch (e) {
    console.error(`#${row.id} failed: ${e.message}`);
    await finish(row.id, 'failed', e.message.slice(0, 500));
    failed++;
  }
}

// executed_at was already stamped by the claim, so it is not touched again here.
// Its value is "when execution was attempted," which is what you want when
// debugging a row that failed.
async function finish(id, status, error) {
  await d1(
    `UPDATE approval_queue SET status = ?, error = ? WHERE id = ?`,
    [status, error, id]
  );
  if (error) console.log(`  #${id} -> ${status}: ${error}`);
}

const summary = `${sent} sent, ${skipped} skipped, ${failed} failed`;
console.log(`\n${summary}`);

await logRun({
  job: 'execute-approved',
  ok: failed === 0 ? 1 : 0,
  itemsIn: claimed.length,
  itemsOut: sent,
  summary,
  error: failed ? `${failed} action(s) failed, see approval_queue.error` : null,
});

// Non-zero exit on any failure so the run is red in the Actions tab. A partially
// failed outreach batch should be visible without opening the database.
if (failed > 0) process.exit(1);
