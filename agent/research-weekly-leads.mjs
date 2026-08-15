/**
 * Weekly contact research for newly qualified auto-shop leads.
 *
 * Re-check that a lead still has no functioning owned website and try to find
 * a public business email. Never builds previews and never contacts prospects.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { OFFER, offerContext } from './config/offer.mjs';

const MAX_LEADS = Math.min(Math.max(Number(process.env.MAX_LEADS) || 12, 0), 25);
const MAX_COST_CENTS = Math.min(Math.max(Number(process.env.MAX_COST_CENTS) || 75, 0), 150);
const INCLUDE_BACKLOG = String(process.env.INCLUDE_BACKLOG || '').toLowerCase() === 'true';

if (OFFER.id !== 'metro-detroit-auto-repair') {
  throw new Error(`weekly research only supports metro-detroit-auto-repair; got ${OFFER.id}`);
}
assertD1Env();

const leads = await d1(`SELECT id, slug, name, city, state, phone, maps_url,
    review_count, score, primary_type, first_seen_at
  FROM leads
  WHERE vertical=? AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
    AND storefront='yes' AND COALESCE(score,0) >= ?
    ${INCLUDE_BACKLOG ? '' : "AND first_seen_at >= datetime('now','-8 days')"}
  ORDER BY COALESCE(score,0) DESC, COALESCE(review_count,0) DESC, first_seen_at DESC
  LIMIT ?`, [OFFER.vertical, OFFER.scoring.high, MAX_LEADS]);

if (!leads.length) {
  await logRun({
    job: 'weekly-lead-research',
    itemsIn: 0,
    itemsOut: 0,
    summary: 'no qualified auto-shop leads needed research',
  });
  console.log('no qualified auto-shop leads needed research');
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY missing');
}

const SYSTEM = `
You research sales leads for Singh Dynamics.
${offerContext()}

Research only. Never contact anyone. Never invent facts.
The lead already passed Google Places checks for no website and a listed phone number.
Re-check whether a functioning owned website exists and, if possible, find a public
business email address from a reliable public source.
A Facebook, Instagram, Yelp or other directory/social page is NOT a functioning owned website.
If a field cannot be verified, return null.
`.trim();

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    still_operating: { type: 'boolean' },
    website: nullableString,
    email: nullableString,
    phone: nullableString,
    facebook_url: nullableString,
    address_street: nullableString,
    address_zip: nullableString,
    score: nullableNumber,
    score_reason: nullableString,
  },
  required: [
    'still_operating', 'website', 'email', 'phone', 'facebook_url',
    'address_street', 'address_zip', 'score', 'score_reason',
  ],
  additionalProperties: false,
};

function parseFallbackJson(raw) {
  const cleaned = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

let costCents = 0;
let researched = 0;
let emailsFound = 0;
let websitesFound = 0;
let failures = 0;

for (const lead of leads) {
  const remainingCents = MAX_COST_CENTS - costCents;
  if (remainingCents < 5) {
    console.log('research cost ceiling reached');
    break;
  }

  const prompt = `Research this business. Use public web sources and return the requested structured result.\n` +
    `name: ${lead.name}\ncity: ${lead.city}, ${lead.state}\n` +
    `type: ${lead.primary_type ?? 'unknown'}\nmaps: ${lead.maps_url ?? 'unknown'}\n` +
    `phone: ${lead.phone}\nreviews: ${lead.review_count ?? 'unknown'}`;

  let raw = '';
  let structured = null;
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: SYSTEM,
        allowedTools: ['WebSearch', 'WebFetch'],
        permissionMode: 'bypassPermissions',
        maxTurns: 6,
        maxBudgetUsd: Math.min(0.20, remainingCents / 100),
        outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
    })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content ?? []) {
          if (block.type === 'text') raw += block.text;
        }
      }
      if (msg.type === 'result') {
        costCents += Math.round((msg.total_cost_usd ?? 0) * 100);
        if (msg.structured_output && typeof msg.structured_output === 'object') {
          structured = msg.structured_output;
        }
        if (typeof msg.result === 'string') raw += `\n${msg.result}`;
      }
    }
  } catch (err) {
    failures++;
    console.error(`[${lead.slug}] research error: ${err.message}`);
    continue;
  }

  const data = structured ?? parseFallbackJson(raw);
  if (!data || typeof data !== 'object') {
    failures++;
    console.error(`[${lead.slug}] no structured research result`);
    continue;
  }

  const website = typeof data.website === 'string' && data.website.trim() ? data.website.trim() : null;
  const email = typeof data.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
    ? data.email.trim().toLowerCase()
    : null;
  const closed = data.still_operating === false;
  const disqualified = Boolean(website || closed);
  const disqualifyReason = website
    ? 'functioning website found during weekly research'
    : closed ? 'business appears closed during weekly research' : null;

  await d1(`UPDATE leads SET
      disqualified=?, disqualify_reason=?,
      phone=COALESCE(?,phone), email=COALESCE(?,email), website=COALESCE(?,website),
      facebook_url=COALESCE(?,facebook_url), address_street=COALESCE(?,address_street),
      address_zip=COALESCE(?,address_zip), score=COALESCE(?,score),
      score_reason=COALESCE(?,score_reason), last_seen_at=datetime('now')
    WHERE id=?`, [
      disqualified ? 1 : 0,
      disqualifyReason,
      data.phone ?? null,
      email,
      website,
      data.facebook_url ?? null,
      data.address_street ?? null,
      data.address_zip ?? null,
      Number.isFinite(data.score) ? Math.max(0, Math.min(100, Math.round(data.score))) : null,
      data.score_reason ?? null,
      lead.id,
    ]);

  researched++;
  if (email) emailsFound++;
  if (website) websitesFound++;
}

await logRun({
  job: 'weekly-lead-research',
  ok: failures === 0 ? 1 : 0,
  itemsIn: leads.length,
  itemsOut: researched,
  costCents,
  summary: `researched ${researched}/${leads.length}; ${emailsFound} email(s); ${websitesFound} website disqualification(s)`,
  error: failures ? `${failures} lead research failure(s)` : null,
});

console.log(`done. researched ${researched}/${leads.length}, ${emailsFound} email(s), ${websitesFound} website(s) found, ${costCents}c`);
