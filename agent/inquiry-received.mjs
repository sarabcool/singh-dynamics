import { d1, d1First, assertD1Env, logRun } from './lib/d1.mjs';
import { OFFER } from './config/offer.mjs';

assertD1Env();

const MAX_INQUIRIES = Number(process.env.MAX_INQUIRIES || '20');
const rows = await d1(
  `SELECT id, shop_name, contact_name, email, phone, city, notes
     FROM inquiries
    WHERE status = 'new'
    ORDER BY created_at
    LIMIT ?`,
  [MAX_INQUIRIES]
);

let queued = 0;
let linked = 0;
let failed = 0;

for (const inquiry of rows) {
  try {
    let lead = null;
    if (inquiry.email || inquiry.phone) {
      lead = await d1First(
        `SELECT id, slug, name, status FROM leads
          WHERE (? IS NOT NULL AND email = ?)
             OR (? IS NOT NULL AND phone = ?)
          ORDER BY id DESC LIMIT 1`,
        [inquiry.email, inquiry.email, inquiry.phone, inquiry.phone]
      );
    }

    if (!lead) {
      const slugBase = `${inquiry.shop_name}-${inquiry.city || 'metro-detroit'}-${inquiry.id}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 72);
      const inserted = await d1(
        `INSERT INTO leads (slug, name, city, state, phone, email, vertical, source, status, notes)
         VALUES (?, ?, ?, 'MI', ?, ?, ?, 'website-inquiry', 'new', ?)
         RETURNING id, slug, name, status`,
        [slugBase, inquiry.shop_name, inquiry.city || 'Metro Detroit', inquiry.phone, inquiry.email,
         OFFER.vertical, inquiry.notes || null]
      );
      lead = inserted[0];
    }

    linked++;

    if (inquiry.email) {
      const first = inquiry.contact_name ? ` ${escapeText(inquiry.contact_name.split(/\s+/)[0])}` : '';
      const subject = `Re: ${inquiry.shop_name} website`;
      const html = [
        `<p>Hi${first},</p>`,
        `<p>Thanks for reaching out about ${escapeText(inquiry.shop_name)}.</p>`,
        `<p>Send me your current hours, the main services you want customers to see, and any shop photos you want used. I can build the first version from there.</p>`,
        `<p>Sarab<br>Singh Dynamics</p>`,
      ].join('');

      await d1(
        `INSERT INTO approval_queue (action_type, lead_id, summary, payload, rationale)
         VALUES ('outreach_email', ?, ?, ?, ?)`,
        [
          lead.id,
          `Reply to inbound website inquiry from ${inquiry.shop_name}`,
          JSON.stringify({ to: inquiry.email, subject, html, reply_to: 'sarab@singhdynamics.com' }),
          'The prospect initiated contact on singhdynamics.com. Draft requests only the factual inputs needed to build a preview and quotes no price, scope, or deadline.',
        ]
      );
      queued++;
    } else {
      await d1(
        `INSERT INTO approval_queue (action_type, lead_id, summary, payload, rationale)
         VALUES ('outreach_call_script', ?, ?, ?, ?)`,
        [
          lead.id,
          `Call inbound website inquiry from ${inquiry.shop_name}`,
          JSON.stringify({ phone: inquiry.phone, script: `Hi, this is Sarab from Singh Dynamics. You sent in a website request for ${inquiry.shop_name}. I wanted to get your hours, main services, and any photos you want on the preview.` }),
          'The prospect initiated contact but supplied only a phone number. Calls remain human-executed and approval-gated.',
        ]
      );
      queued++;
    }

    await d1(`UPDATE inquiries SET status = 'reviewed' WHERE id = ? AND status = 'new'`, [inquiry.id]);
  } catch (err) {
    failed++;
    console.error(`inquiry ${inquiry.id} failed: ${err.message}`);
  }
}

await logRun({
  job: 'inquiry-received',
  ok: failed === 0 ? 1 : 0,
  itemsIn: rows.length,
  itemsOut: queued,
  summary: `${linked} linked to leads, ${queued} approval action(s) queued`,
  error: failed ? `${failed} inquiry(s) failed` : null,
});

console.log(`done. ${rows.length} read, ${linked} linked, ${queued} queued, ${failed} failed`);
if (failed) process.exit(1);

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
