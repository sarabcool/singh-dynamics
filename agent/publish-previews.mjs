import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { d1, d1First, assertD1Env, logRun } from './lib/d1.mjs';

assertD1Env();

const PREVIEW_BASE_URL = (process.env.PREVIEW_BASE_URL || '').replace(/\/$/, '');
if (!PREVIEW_BASE_URL) {
  console.error('PREVIEW_BASE_URL missing');
  process.exit(1);
}

const SHOP_DIR = 'sites/shops';
const files = readdirSync(SHOP_DIR)
  .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
  .sort();

let processed = 0;
let queued = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  const path = join(SHOP_DIR, file);
  let raw;
  let config;
  try {
    raw = readFileSync(path, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    console.error(`[${file}] invalid config: ${err.message}`);
    failed++;
    continue;
  }

  if (!config._generated || !config.slug) continue;

  try {
    const lead = await d1First(
      `SELECT id, slug, name, email, phone, website, disqualified, opted_out, status
         FROM leads WHERE slug = ? LIMIT 1`,
      [config.slug]
    );

    if (!lead || lead.disqualified || lead.website) {
      skipped++;
      continue;
    }

    const configSha = createHash('sha256').update(raw).digest('hex');
    const previewUrl = `${PREVIEW_BASE_URL}/${encodeURIComponent(config.slug)}/`;

    await d1(
      `INSERT INTO lead_previews (lead_id, preview_url, config_sha, built_at, last_verified_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(lead_id) DO UPDATE SET
         preview_url = excluded.preview_url,
         config_sha = excluded.config_sha,
         built_at = datetime('now'),
         last_verified_at = datetime('now')`,
      [lead.id, previewUrl, configSha]
    );
    processed++;

    if (!lead.email || lead.opted_out || lead.status === 'do_not_contact') continue;

    const suppressed = await d1First(
      `SELECT id FROM suppression WHERE email IS NOT NULL AND email = ? LIMIT 1`,
      [lead.email]
    );
    if (suppressed) continue;

    const existing = await d1First(
      `SELECT id FROM approval_queue
        WHERE lead_id = ?
          AND action_type = 'outreach_email'
          AND status IN ('pending','approved','executed')
        ORDER BY id DESC LIMIT 1`,
      [lead.id]
    );
    if (existing) continue;

    const subject = `Website preview for ${lead.name}`;
    const html = [
      `<p>Hi,</p>`,
      `<p>I came across ${escapeHtml(lead.name)} and put together a simple website preview using the public information I could verify.</p>`,
      `<p><a href="${escapeHtml(previewUrl)}">View the preview</a></p>`,
      `<p>If you want anything changed, reply and tell me what you would want different.</p>`,
      `<p>Sarab<br>Singh Dynamics</p>`,
    ].join('');

    await d1(
      `INSERT INTO approval_queue (action_type, lead_id, summary, payload, rationale)
       VALUES ('outreach_email', ?, ?, ?, ?)`,
      [
        lead.id,
        `Review preview and first-contact draft for ${lead.name}`,
        JSON.stringify({
          to: lead.email,
          subject,
          html,
          reply_to: 'sarab@singhdynamics.com',
          preview_url: previewUrl,
        }),
        'A deterministic noindex preview exists. First contact remains human-approved and makes no price, scope, or deadline commitment.',
      ]
    );
    await d1(`UPDATE leads SET status = 'queued' WHERE id = ? AND status = 'new'`, [lead.id]);
    queued++;
  } catch (err) {
    console.error(`[${config.slug}] publish record failed: ${err.message}`);
    failed++;
  }
}

await logRun({
  job: 'publish-previews',
  ok: failed === 0 ? 1 : 0,
  itemsIn: files.length,
  itemsOut: processed,
  summary: `${processed} preview(s) tracked, ${queued} outreach draft(s) queued, ${skipped} skipped`,
  error: failed ? `${failed} preview record(s) failed` : null,
});

console.log(`done. ${processed} tracked, ${queued} queued, ${skipped} skipped, ${failed} failed`);
if (failed) process.exit(1);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\"', '&quot;')
    .replaceAll("'", '&#39;');
}
