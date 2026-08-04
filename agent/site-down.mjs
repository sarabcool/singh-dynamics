/**
 * Client site is down. Alert immediately.
 *
 * Dispatched by the Worker's hourly uptime sweep, and only after TWO consecutive
 * failed checks. That debounce lives in the Worker on purpose, so this script
 * can assume the failure is real and does not need to re-litigate it.
 *
 * A client's site being down is the single failure mode that loses a retainer.
 * The pitch is "we look after it," and the whole value of that promise is
 * knowing before they do.
 *
 * Payload: { slug, url }
 */

import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { sendOperator, escapeHtml } from './lib/mail.mjs';

assertD1Env();

const slug = process.env.SITE_SLUG;
const url = process.env.SITE_URL;

if (!slug) {
  console.error('SITE_SLUG missing. Nothing to alert on.');
  process.exit(1);
}

// Re-probe before emailing. The Worker checked up to an hour ago and the site
// may already be back. An alert for a site that is currently fine is how you
// train yourself to ignore alerts.
let live = false;
let code = 0;
try {
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  code = res.status;
  live = res.ok;
} catch (e) {
  code = 0;
}

const history = await d1(
  `SELECT u.status_code, u.ms, u.ok, u.checked_at
     FROM uptime_checks u
     JOIN sites s ON s.id = u.site_id
    WHERE s.slug = ?
    ORDER BY u.checked_at DESC LIMIT 12`,
  [slug]
);

const client = await d1(
  `SELECT c.name, c.contact_name, c.contact_phone, c.retainer_active
     FROM sites s LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.slug = ?`,
  [slug]
);
const c = client[0] ?? {};

if (live) {
  console.log(`${slug} recovered on re-probe (HTTP ${code}). No alert sent.`);
  await logRun({
    job: 'site-down', itemsIn: 1, itemsOut: 0,
    summary: `${slug} recovered before alert, HTTP ${code}`,
  });
  process.exit(0);
}

const rows = history.map((h) => `
  <tr>
    <td style="padding:.3rem .8rem .3rem 0;color:#767676">${escapeHtml(h.checked_at)}</td>
    <td style="padding:.3rem .8rem .3rem 0">${h.ok ? 'ok' : 'FAIL'}</td>
    <td style="padding:.3rem .8rem .3rem 0">${h.status_code || '-'}</td>
    <td style="padding:.3rem 0;color:#767676">${h.ms ?? '-'}ms</td>
  </tr>`).join('');

const html = `<div style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#1a1a1a;max-width:40rem">
  <div style="border-left:3px solid #c62828;background:#fdf3f3;padding:1rem 1.2rem">
    <strong style="font-size:17px">${escapeHtml(slug)} is down</strong>
    <div style="margin:.4rem 0 0">
      ${escapeHtml(url)} returned ${code ? `HTTP ${code}` : 'no response'} on re-probe.
    </div>
  </div>

  ${c.name ? `<p><strong>Client:</strong> ${escapeHtml(c.name)}
    ${c.contact_name ? `&middot; ${escapeHtml(c.contact_name)}` : ''}
    ${c.contact_phone ? `&middot; <a href="tel:${escapeHtml(c.contact_phone)}">${escapeHtml(c.contact_phone)}</a>` : ''}
    ${c.retainer_active ? '&middot; <strong>paying retainer</strong>' : ''}</p>` : ''}

  <h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#767676;margin:1.5rem 0 .5rem">
    Last 12 checks</h2>
  <table style="font:13px/1.5 ui-monospace,monospace;border-collapse:collapse">${rows}</table>

  <p style="font-size:13px;color:#767676;margin-top:1.5rem">
    Checked hourly. Alert fires on two consecutive failures, then re-probes
    before sending, so this is the third confirmation.
  </p>
</div>`;

try {
  await sendOperator({ subject: `[DOWN] ${slug}`, html });
  console.log(`alert sent for ${slug}`);
  await logRun({
    job: 'site-down', itemsIn: 1, itemsOut: 1,
    summary: `${slug} down, HTTP ${code || 'no response'}, alert sent`,
  });
} catch (e) {
  console.error(`alert send failed: ${e.message}`);
  await logRun({ job: 'site-down', ok: 0, error: `${slug}: ${e.message}` });
  process.exit(1);
}
