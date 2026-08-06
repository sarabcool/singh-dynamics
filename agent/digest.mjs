/**
 * Daily approval digest, 08:00 ET.
 *
 * The Worker has fired `daily-digest` at this time since it was written. Nothing
 * has ever been listening. This is the listener.
 *
 * Contains no AI. It is a SELECT and an email. The whole point of the digest is
 * that it costs nothing and arrives before Sarab is awake, so the three minutes
 * spent on it are the first thing available in the day.
 *
 *   node agent/digest.mjs             # send if there is something to say
 *   node agent/digest.mjs --dry-run   # print the HTML, send nothing
 *   node agent/digest.mjs --always    # send even when there is nothing pending
 */

import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { sendOperator, escapeHtml } from './lib/mail.mjs';

const DRY = process.argv.includes('--dry-run');
const ALWAYS = process.argv.includes('--always') || process.env.ALWAYS_SEND === '1';

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');

assertD1Env();

// ---------------------------------------------------------------------------
// gather
// ---------------------------------------------------------------------------

// Pending and not stale. A proposal written against three-week-old facts should
// not be sitting in an inbox looking actionable, which is why expires_at exists.
const pending = await d1(
  `SELECT q.id, q.action_type, q.summary, q.rationale, q.created_at, q.expires_at,
          l.name AS lead_name, l.city, l.phone, l.score, l.priority,
          p.preview_url
     FROM approval_queue q
     LEFT JOIN leads l ON l.id = q.lead_id
     LEFT JOIN lead_previews p ON p.lead_id = q.lead_id
    WHERE q.status = 'pending' AND q.expires_at > datetime('now')
    ORDER BY l.score DESC NULLS LAST, q.created_at`
);

// Anything that expired unread since yesterday. Worth surfacing once: a queue
// that silently expires items is a queue you stop trusting.
const expired = await d1(
  `SELECT COUNT(*) AS n FROM approval_queue
    WHERE status = 'pending' AND expires_at <= datetime('now')`
);

const newLeads = await d1(
  `SELECT COUNT(*) AS n FROM leads
    WHERE first_seen_at > datetime('now','-1 day') AND disqualified = 0`
);

const readyToCall = await d1(
  `SELECT l.name, l.city, l.phone, l.score, p.preview_url
     FROM leads l
     LEFT JOIN lead_previews p ON p.lead_id = l.id
    WHERE status = 'new' AND disqualified = 0 AND opted_out = 0
      AND website IS NULL AND phone IS NOT NULL AND score >= 70
    ORDER BY score DESC LIMIT 10`
);

// As of 4 Aug 2026 this returns 821 unscored against 0 scored: the sweep has run
// three times and classify.mjs has never completed. Without this block the
// digest would show an empty "ready to call" list every morning and read as
// "no leads," when the truth is "182 callable leads, none triaged." Those are
// opposite problems and only one of them is fixable before breakfast.
const backlog = await d1(
  `SELECT COUNT(*) AS unscored,
          SUM(website IS NULL AND phone IS NOT NULL) AS callable
     FROM leads
    WHERE score IS NULL AND disqualified = 0`
);

// Sites that failed their most recent check. Retainer-threatening, so it goes
// at the top of the email, not the bottom.
const down = await d1(
  `SELECT s.slug, s.live_url, u.status_code, u.checked_at
     FROM sites s
     JOIN uptime_checks u ON u.id = (
       SELECT id FROM uptime_checks WHERE site_id = s.id
        ORDER BY checked_at DESC LIMIT 1
     )
    WHERE u.ok = 0`
);

const failedRuns = await d1(
  `SELECT job, summary, error, started_at FROM runs
    WHERE ok = 0 AND started_at > datetime('now','-1 day')
    ORDER BY started_at DESC LIMIT 10`
);

const unscored = backlog[0]?.unscored ?? 0;
const callable = backlog[0]?.callable ?? 0;

// A large unscored pile is itself news worth an email, once. Threshold rather
// than boolean so it stops nagging when the backlog is a normal night's intake.
const backlogIsNews = unscored >= 50 && readyToCall.length === 0;

const nothingToSay =
  pending.length === 0 && down.length === 0 && failedRuns.length === 0 &&
  !backlogIsNews;

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const S = {
  wrap: 'font:15px/1.6 -apple-system,system-ui,sans-serif;color:#1a1a1a;max-width:40rem',
  h2: 'font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#767676;margin:2rem 0 .5rem',
  card: 'border:1px solid #e5e5e5;border-radius:8px;padding:.9rem 1rem;margin:.5rem 0',
  meta: 'font-size:13px;color:#767676;margin:.25rem 0 0',
  alert: 'border-left:3px solid #c62828;background:#fdf3f3;padding:.75rem 1rem;margin:.5rem 0',
};

function section(title, inner) {
  return inner ? `<h2 style="${S.h2}">${title}</h2>${inner}` : '';
}

const downHtml = down.map((s) => `
  <div style="${S.alert}">
    <strong>${escapeHtml(s.slug)} is down</strong>
    <div style="${S.meta}">
      HTTP ${s.status_code || 'no response'} at ${escapeHtml(s.checked_at)}
      &middot; ${escapeHtml(s.live_url)}
    </div>
  </div>`).join('');

const pendingHtml = pending.map((q) => `
  <div style="${S.card}">
    <div><strong>#${q.id}</strong> &middot; ${escapeHtml(q.action_type)}
      ${q.lead_name ? `&middot; ${escapeHtml(q.lead_name)}, ${escapeHtml(q.city ?? '')}` : ''}
      ${q.score != null ? `&middot; score ${q.score}` : ''}
    </div>
    <div style="margin:.4rem 0 0">${escapeHtml(q.summary)}</div>
    <div style="${S.meta}">${escapeHtml(q.rationale)}</div>
    ${q.preview_url ? `<div style="${S.meta}"><a href="${escapeHtml(q.preview_url)}">review preview</a></div>` : ''}
    <div style="${S.meta}">expires ${escapeHtml(q.expires_at)}</div>
  </div>`).join('');

const callHtml = readyToCall.map((l) => `
  <div style="${S.card}">
    <strong>${escapeHtml(l.name)}</strong> &middot; ${escapeHtml(l.city)}
    &middot; score ${l.score}
    <div style="${S.meta}"><a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>
      ${l.preview_url ? `&middot; <a href="${escapeHtml(l.preview_url)}">preview</a>` : ''}
    </div>
  </div>`).join('');

const failedHtml = failedRuns.map((r) => `
  <div style="${S.alert}">
    <strong>${escapeHtml(r.job)}</strong> failed at ${escapeHtml(r.started_at)}
    <div style="${S.meta}">${escapeHtml(r.error || r.summary || 'no detail recorded')}</div>
  </div>`).join('');

// How to actually act on the queue. Without this the email is a notification,
// not a tool, and you end up opening a dashboard to do a two-item approval.
const howTo = pending.length ? `
  <h2 style="${S.h2}">Approve</h2>
  <pre style="background:#f6f6f6;padding:.9rem 1rem;border-radius:8px;font:13px/1.5 ui-monospace,monospace;overflow-x:auto">curl -X POST ${escapeHtml(WORKER_URL || 'https://&lt;worker&gt;.workers.dev')}/approve \\
  -H "authorization: Bearer $OPERATOR_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"ids":[${pending.map((q) => q.id).join(',')}],"decision":"approved"}'</pre>
  <p style="${S.meta}">Swap "approved" for "rejected", or trim the ids array to
  approve a subset. Approving queues execute-approved. It does not send anything
  itself.</p>` : '';

const html = `<div style="${S.wrap}">
  <p style="${S.meta}">Singh Dynamics &middot; ${new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Detroit',
  })}</p>

  ${section('Sites down', downHtml)}
  ${backlogIsNews ? `
    <div style="${S.alert}">
      <strong>${unscored} leads are unscored</strong>
      <div style="${S.meta}">
        ${callable} of them have no website and a phone number, which is the
        qualifying signal. None have been through classify.mjs, so nothing can
        be prioritised and "ready to call" below is empty for that reason and
        not for lack of leads. Run the classify step.
      </div>
    </div>` : ''}
  ${section(`Awaiting approval (${pending.length})`, pendingHtml ||
    '<p style="color:#767676">Nothing pending.</p>')}
  ${section(`Ready to call (${readyToCall.length})`, callHtml)}
  ${section('Failed runs, last 24h', failedHtml)}
  ${howTo}

  <hr style="border:none;border-top:1px solid #e5e5e5;margin:2rem 0 1rem">
  <p style="${S.meta}">
    ${newLeads[0]?.n ?? 0} new leads in the last 24h
    &middot; ${expired[0]?.n ?? 0} queue items expired unread
  </p>
</div>`;

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

if (DRY) {
  console.log(html);
  console.log(`\n[dry run] pending=${pending.length} down=${down.length} failed=${failedRuns.length}`);
  process.exit(0);
}

// A daily email that says "nothing happened" every day gets filtered within a
// fortnight, and then the one that matters gets filtered with it. Silence is
// the correct output when there is nothing to act on.
if (nothingToSay && !ALWAYS) {
  console.log('nothing pending, nothing down, nothing failed. no email sent.');
  await logRun({
    job: 'daily-digest', itemsIn: 0, itemsOut: 0,
    summary: 'quiet day, digest suppressed',
  });
  process.exit(0);
}

try {
  const subject = down.length
    ? `[DOWN] ${down.length} site${down.length > 1 ? 's' : ''} + ${pending.length} to approve`
    : backlogIsNews && pending.length === 0
      ? `Digest: ${unscored} leads unscored, nothing triaged`
      : `Digest: ${pending.length} awaiting approval`;

  const id = await sendOperator({ subject, html });
  console.log(`sent ${id}: ${subject}`);

  await logRun({
    job: 'daily-digest',
    itemsIn: pending.length,
    itemsOut: 1,
    summary: `${pending.length} pending, ${down.length} down, ${failedRuns.length} failed runs`,
  });
} catch (e) {
  console.error(`digest send failed: ${e.message}`);
  await logRun({ job: 'daily-digest', ok: 0, error: e.message });
  process.exit(1);
}
