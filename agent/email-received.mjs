import Anthropic from '@anthropic-ai/sdk';
import { d1, d1First, assertD1Env, logRun } from './lib/d1.mjs';

const {
  RESEND_API_KEY,
  ANTHROPIC_API_KEY,
  MAX_INBOUND = '20',
  MAX_COST_CENTS = '100',
} = process.env;

assertD1Env();
if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const rows = await d1(
  `SELECT id, resend_email_id, from_email, subject
     FROM inbound_emails
    WHERE status = 'received'
    ORDER BY created_at
    LIMIT ?`,
  [Number(MAX_INBOUND)]
);

let processed = 0;
let unmatched = 0;
let failed = 0;
let queued = 0;
let costCents = 0;

for (const row of rows) {
  if (costCents >= Number(MAX_COST_CENTS)) {
    console.log(`cost ceiling ${MAX_COST_CENTS}c reached, stopping`);
    break;
  }

  try {
    const email = await getReceivedEmail(row.resend_email_id);
    const from = normalizeAddress(email.from || row.from_email);
    const text = cleanBody(email.text || stripHtml(email.html || '')).slice(0, 12000);
    const headers = email.headers || {};

    const lead = await d1First(
      `SELECT id, slug, name, city, email, phone, status, opted_out
         FROM leads
        WHERE lower(email) = lower(?)
        ORDER BY CASE WHEN status IN ('contacted','replied','meeting') THEN 0 ELSE 1 END,
                 id DESC
        LIMIT 1`,
      [from]
    );

    if (!lead) {
      await d1(
        `UPDATE inbound_emails
            SET body_text = ?, headers_json = ?, status = 'unmatched',
                processed_at = datetime('now'), error = 'no lead matched sender'
          WHERE id = ?`,
        [text, JSON.stringify(headers), row.id]
      );
      unmatched++;
      continue;
    }

    await d1(`UPDATE inbound_emails SET lead_id = ? WHERE id = ?`, [lead.id, row.id]);

    if (isExplicitOptOut(text, row.subject || email.subject || '')) {
      await suppressLead(lead, from);
      await d1(
        `UPDATE inbound_emails
            SET body_text = ?, headers_json = ?, intent = 'opt_out',
                status = 'processed', processed_at = datetime('now')
          WHERE id = ?`,
        [text, JSON.stringify(headers), row.id]
      );
      processed++;
      console.log(`[${lead.slug}] explicit opt-out honored`);
      continue;
    }

    const classification = await classifyReply({
      lead,
      subject: row.subject || email.subject || '',
      text,
    });
    costCents += classification.costCents;

    await d1(
      `UPDATE leads
          SET status = CASE
              WHEN status IN ('contacted','new','queued') THEN 'replied'
              ELSE status
            END,
            last_seen_at = datetime('now')
        WHERE id = ?`,
      [lead.id]
    );

    await d1(
      `UPDATE inbound_emails
          SET body_text = ?, headers_json = ?, intent = ?,
              status = 'processed', processed_at = datetime('now')
        WHERE id = ?`,
      [text, JSON.stringify(headers), classification.intent, row.id]
    );

    if (classification.intent === 'not_interested') {
      await d1(`UPDATE leads SET status = 'lost' WHERE id = ?`, [lead.id]);
      processed++;
      continue;
    }

    const draftText = classification.draft?.trim();
    if (draftText) {
      const subject = replySubject(row.subject || email.subject || 'Website');
      const payload = {
        mail_kind: 'inbound_reply',
        to: from,
        subject,
        html: paragraphsToHtml(draftText),
        reply_to: 'sarab@singhdynamics.com',
        in_reply_to: getHeader(headers, 'message-id'),
        references: getHeader(headers, 'references'),
      };

      await d1(
        `INSERT INTO approval_queue (action_type, lead_id, summary, payload, rationale)
         VALUES ('outreach_email', ?, ?, ?, ?)`,
        [
          lead.id,
          `Reply to ${lead.name}: ${classification.intent}`,
          JSON.stringify(payload),
          `Inbound reply classified as ${classification.intent}. Draft only; sending remains approval-gated. ${classification.reason}`.slice(0, 1000),
        ]
      );
      queued++;
    }

    processed++;
  } catch (err) {
    failed++;
    console.error(`inbound ${row.id} failed: ${err.message}`);
    await d1(
      `UPDATE inbound_emails
          SET status = 'failed', processed_at = datetime('now'), error = ?
        WHERE id = ?`,
      [String(err.message || err).slice(0, 500), row.id]
    ).catch(() => {});
  }
}

await logRun({
  job: 'email-received',
  ok: failed === 0 ? 1 : 0,
  itemsIn: rows.length,
  itemsOut: processed,
  costCents: Math.round(costCents),
  summary: `${processed} processed, ${queued} reply draft(s) queued, ${unmatched} unmatched`,
  error: failed ? `${failed} inbound email(s) failed` : null,
});

console.log(`done. ${processed} processed, ${queued} queued, ${unmatched} unmatched, ${failed} failed, ~${Math.round(costCents)}c`);
if (failed) process.exit(1);

async function getReceivedEmail(id) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend receiving ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function getHeader(headers, name) {
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.map(String).join(' ').trim();
    return String(value || '').trim();
  }
  return '';
}

function normalizeAddress(value) {
  const s = String(value || '').trim();
  const match = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (match?.[1] || s).toLowerCase();
}

function cleanBody(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function isExplicitOptOut(text, subject) {
  const sample = `${subject}\n${text}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const exact = [
    'unsubscribe',
    'remove me from your list',
    'remove me from your email list',
    'do not contact me',
    "don't contact me",
    'stop emailing me',
    'stop sending me emails',
    'please stop emailing',
  ];
  return exact.some((phrase) => sample.includes(phrase));
}

async function suppressLead(lead, email) {
  await d1(
    `UPDATE leads
        SET opted_out = 1, opted_out_at = datetime('now'), status = 'do_not_contact'
      WHERE id = ?`,
    [lead.id]
  );
  await d1(
    `INSERT OR IGNORE INTO suppression (email, phone, reason)
     VALUES (?, ?, 'email opt-out')`,
    [email || lead.email || null, lead.phone || null]
  );
  await d1(
    `UPDATE approval_queue SET status = 'expired'
      WHERE lead_id = ? AND status = 'pending'`,
    [lead.id]
  );
}

async function classifyReply({ lead, subject, text }) {
  const system = `
You triage inbound replies for Singh Dynamics, a small web-design business.
This is INTERNAL classification and drafting only. You never send anything.

Return JSON only with exactly:
{"intent":"interested"|"question"|"price_or_scope"|"meeting"|"not_interested"|"other","reason":string,"draft":string|null}

Rules:
- Do not invent business facts, prices, dates, deliverables, testimonials, discounts, or commitments.
- If they ask about price, scope, deadline, contract, payment, or a specific promise, intent is price_or_scope and the draft should acknowledge the question without making up an answer.
- If they want a call/meeting, intent is meeting. The draft may ask what time works but may not promise a time.
- If they clearly decline, intent is not_interested and draft is null.
- Keep drafts short, plain, professional, and written as Sarab from Singh Dynamics.
- No em dashes.
`.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1200,
    system,
    messages: [{
      role: 'user',
      content: `Lead: ${lead.name} (${lead.city || 'unknown city'})\nSubject: ${subject || '(none)'}\nReply:\n${text || '(no text body)'}`,
    }],
  });

  const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!raw) throw new Error(`classifier returned no text; stop_reason=${response.stop_reason}`);
  const parsed = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
  const allowed = new Set(['interested', 'question', 'price_or_scope', 'meeting', 'not_interested', 'other']);
  const intent = allowed.has(parsed.intent) ? parsed.intent : 'other';

  const usage = response.usage || {};
  const costCents = ((usage.input_tokens || 0) / 1e6) * 3 * 100 +
                    ((usage.output_tokens || 0) / 1e6) * 15 * 100;

  return {
    intent,
    reason: String(parsed.reason || '').slice(0, 700),
    draft: typeof parsed.draft === 'string' ? parsed.draft.slice(0, 5000) : null,
    costCents,
  };
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  return /^re:/i.test(s) ? s : `Re: ${s || 'Website'}`;
}

function paragraphsToHtml(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
