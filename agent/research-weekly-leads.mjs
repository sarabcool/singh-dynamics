/**
 * Weekly contact research for newly qualified auto-shop leads.
 *
 * Re-check that a lead still has no functioning owned website and try to find
 * a public business email. Never builds previews and never contacts prospects.
 *
 * ---------------------------------------------------------------------------
 * Why this file was rewritten
 * ---------------------------------------------------------------------------
 * Live runs returned `no structured research result` for every lead while still
 * spending the Claude budget. Three separate defects produced that one line:
 *
 *   1. `permissionMode: 'bypassPermissions'` was set without
 *      `allowDangerouslySkipPermissions: true`. The SDK only passes
 *      `--allow-dangerously-skip-permissions` to the CLI when that second
 *      option is present, so the bypass was not actually enabled and the
 *      research tools could be denied.
 *   2. On any non-success result the SDK returns `{ subtype, errors[] }` and no
 *      `result` string and no `structured_output`. The old code read neither
 *      `subtype` nor `errors`, so `error_max_turns`, `error_max_budget_usd` and
 *      `error_max_structured_output_retries` all printed the same sentence and
 *      the actual cause was unknowable from the logs.
 *   3. The JSON contract lived only in the output schema. When structured
 *      output failed there was nothing in the prompt telling the model to emit
 *      JSON, so the text fallback had no JSON to find and also failed.
 *
 * All three are fixed below, and every failure now names its own cause.
 *
 * Flags and env, for narrow and cheap testing:
 *   --dry-run          select leads and print the plan and prompt, call nothing
 *   --lead <id>        research exactly one lead by `leads.id`
 *   --limit <n>        override MAX_LEADS for this run
 *   MAX_COST_CENTS     hard ceiling on Claude spend, capped at 150 in code
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { d1, assertD1Env, logRun } from './lib/d1.mjs';
import { OFFER, offerContext } from './config/offer.mjs';

const DRY = process.argv.includes('--dry-run');

function argOf(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ONLY_LEAD_ID = argOf('--lead', process.env.LEAD_ID || null);
const MAX_LEADS = Math.min(
  Math.max(Number(argOf('--limit', process.env.MAX_LEADS)) || 12, 0),
  25
);
const MAX_COST_CENTS = Math.min(Math.max(Number(process.env.MAX_COST_CENTS) || 75, 0), 150);
const MAX_TURNS = Math.min(Math.max(Number(process.env.RESEARCH_MAX_TURNS) || 12, 1), 20);
const PER_LEAD_CAP_USD = Math.min(Math.max(Number(process.env.RESEARCH_PER_LEAD_USD) || 0.25, 0.02), 0.5);
const MODEL = process.env.RESEARCH_MODEL || 'claude-haiku-4-5';
// A lead that has already been researched is not researched again until this
// many days have passed. See migration 009: without it, shops whose email is
// not published anywhere came back to the front of the queue every week.
const RECHECK_DAYS = Math.min(Math.max(Number(process.env.RESEARCH_RECHECK_DAYS) || 90, 7), 365);

if (OFFER.id !== 'metro-detroit-auto-repair') {
  throw new Error(`weekly research only supports metro-detroit-auto-repair; got ${OFFER.id}`);
}
assertD1Env();

const INCLUDE_BACKLOG = String(process.env.INCLUDE_BACKLOG || '').toLowerCase() === 'true';

const leads = ONLY_LEAD_ID
  ? await d1(
    `SELECT id, slug, name, city, state, phone, maps_url, review_count, score,
            primary_type, first_seen_at
       FROM leads WHERE id=?`,
    [Number(ONLY_LEAD_ID)]
  )
  : await d1(`SELECT id, slug, name, city, state, phone, maps_url,
      review_count, score, primary_type, first_seen_at
    FROM leads
    WHERE vertical=? AND disqualified=0 AND website IS NULL AND phone IS NOT NULL
      AND storefront='yes' AND COALESCE(score,0) >= ?
      AND (researched_at IS NULL OR researched_at < datetime('now','-${RECHECK_DAYS} days'))
      ${INCLUDE_BACKLOG ? '' : "AND first_seen_at >= datetime('now','-8 days')"}
    ORDER BY COALESCE(score,0) DESC, COALESCE(review_count,0) DESC, first_seen_at DESC
    LIMIT ?`, [OFFER.vertical, OFFER.scoring.high, MAX_LEADS]);

if (!leads.length) {
  if (!DRY) {
    await logRun({
      job: 'weekly-lead-research',
      itemsIn: 0,
      itemsOut: 0,
      summary: 'no qualified auto-shop leads needed research',
    });
  }
  console.log('no qualified auto-shop leads needed research');
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY && !DRY) {
  throw new Error('ANTHROPIC_API_KEY missing');
}

// The JSON contract is stated in the prompt as well as in the output schema.
// Belt and braces on purpose: if structured output fails for any reason, the
// text fallback then has real JSON to parse instead of prose.
const SYSTEM = `
You research sales leads for Singh Dynamics.
${offerContext()}

Research only. Never contact anyone. Never invent facts.
The lead already passed Google Places checks for no website and a listed phone number.
Re-check whether a functioning owned website exists and, if possible, find a public
business email address from a reliable public source.
A Facebook, Instagram, Yelp or other directory/social page is NOT a functioning owned website.
If a field cannot be verified, return null. Do not guess an email from the business name.

Your final message must be a single JSON object and nothing else. No prose before
or after it, no code fence. Shape:
{
  "still_operating": true|false,
  "website": string|null,
  "email": string|null,
  "phone": string|null,
  "facebook_url": string|null,
  "address_street": string|null,
  "address_zip": string|null,
  "score": number|null,
  "score_reason": string|null
}
Use no more than four web lookups for one business. If you cannot verify a field
after that, return null for it and finish. Finishing with nulls is a correct
answer; running out of turns is not.
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

const EXPECTED_KEYS = new Set(Object.keys(OUTPUT_SCHEMA.properties));

function parseFallbackJson(raw) {
  const cleaned = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch { /* try substring below */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Accept a structured payload only if it actually looks like our schema. */
function usable(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (Object.keys(data).some((k) => EXPECTED_KEYS.has(k))) return data;
  // Some transports nest the payload one level down.
  for (const key of ['output', 'result', 'data']) {
    const inner = data[key];
    if (inner && typeof inner === 'object' && Object.keys(inner).some((k) => EXPECTED_KEYS.has(k))) {
      return inner;
    }
  }
  return null;
}

function buildPrompt(lead) {
  return `Research this business. Use public web sources and return the requested JSON object.\n` +
    `name: ${lead.name}\ncity: ${lead.city}, ${lead.state}\n` +
    `type: ${lead.primary_type ?? 'unknown'}\nmaps: ${lead.maps_url ?? 'unknown'}\n` +
    `phone: ${lead.phone}\nreviews: ${lead.review_count ?? 'unknown'}`;
}

if (DRY) {
  console.log(`dry run: ${leads.length} lead(s) selected, model=${MODEL}, ` +
    `maxTurns=${MAX_TURNS}, per-lead cap $${PER_LEAD_CAP_USD}, run cap ${MAX_COST_CENTS}c`);
  for (const lead of leads) console.log(`  #${lead.id} ${lead.name} (${lead.city}) score=${lead.score ?? '-'}`);
  console.log(`\n--- system ---\n${SYSTEM}\n\n--- prompt for first lead ---\n${buildPrompt(leads[0])}`);
  process.exit(0);
}

let costCents = 0;
let researched = 0;
let emailsFound = 0;
let websitesFound = 0;
let failures = 0;
const failureReasons = new Map();

function noteFailure(slug, reason) {
  failures++;
  failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
  console.error(`[${slug}] research failed: ${reason}`);
}

for (const lead of leads) {
  const remainingCents = MAX_COST_CENTS - costCents;
  if (remainingCents < 5) {
    console.log(`research cost ceiling reached after ${researched} lead(s); ${leads.length - researched - failures} not attempted`);
    break;
  }

  let raw = '';
  let structured = null;
  let resultSubtype = null;
  let resultErrors = [];
  let turns = 0;
  const stderrChunks = [];

  try {
    for await (const msg of query({
      prompt: buildPrompt(lead),
      options: {
        model: MODEL,
        systemPrompt: SYSTEM,
        allowedTools: ['WebSearch', 'WebFetch'],
        permissionMode: 'bypassPermissions',
        // Required by the SDK. Without it the bypass flag is never passed to
        // the CLI and the research tools can be denied at runtime.
        allowDangerouslySkipPermissions: true,
        // No repo context needed for a web research task, and loading settings
        // in CI is a source of surprise behaviour.
        settingSources: [],
        maxTurns: MAX_TURNS,
        maxBudgetUsd: Math.min(PER_LEAD_CAP_USD, remainingCents / 100),
        outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        stderr: (chunk) => { if (stderrChunks.length < 20) stderrChunks.push(String(chunk)); },
      },
    })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content ?? []) {
          if (block.type === 'text') raw += block.text;
        }
      }
      if (msg.type === 'result') {
        resultSubtype = msg.subtype ?? null;
        resultErrors = Array.isArray(msg.errors) ? msg.errors : [];
        turns = msg.num_turns ?? 0;
        // Claude's own reported cost. Not a token estimate.
        costCents += Math.round((msg.total_cost_usd ?? 0) * 100);
        if (msg.structured_output && typeof msg.structured_output === 'object') {
          structured = msg.structured_output;
        }
        if (typeof msg.result === 'string') raw += `\n${msg.result}`;
      }
    }
  } catch (err) {
    noteFailure(lead.slug, `sdk threw: ${err.message}`);
    if (stderrChunks.length) console.error(`  stderr: ${stderrChunks.join('').slice(0, 800)}`);
    continue;
  }

  const data = usable(structured) ?? usable(parseFallbackJson(raw));
  if (!data) {
    // Name the actual cause. This is the line that used to say nothing useful.
    const reason = resultSubtype && resultSubtype !== 'success'
      ? `${resultSubtype}${resultErrors.length ? `: ${resultErrors.join('; ').slice(0, 200)}` : ''}`
      : raw.trim()
        ? 'model returned text that was not parseable JSON'
        : 'model returned no text and no structured output';
    noteFailure(lead.slug, `${reason} (turns=${turns})`);
    if (raw.trim()) console.error(`  last text: ${raw.trim().slice(-400)}`);
    if (stderrChunks.length) console.error(`  stderr: ${stderrChunks.join('').slice(0, 800)}`);
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
      score_reason=COALESCE(?,score_reason), last_seen_at=datetime('now'),
      researched_at=datetime('now')
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
  console.log(
    `[${lead.slug}] ok: ${email ? `email ${email}` : 'no email'}` +
    `${website ? `, website ${website} (disqualified)` : ''}${closed ? ', appears closed (disqualified)' : ''}` +
    ` (${costCents}c spent so far)`
  );
}

const failureSummary = [...failureReasons.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([reason, n]) => `${n}x ${reason}`)
  .join('; ');

await logRun({
  job: 'weekly-lead-research',
  ok: failures === 0 ? 1 : 0,
  itemsIn: leads.length,
  itemsOut: researched,
  claudeCostCents: costCents,
  claudeCostSource: 'reported',
  summary: `researched ${researched}/${leads.length}; ${emailsFound} email(s); ` +
    `${websitesFound} website disqualification(s); claude ${costCents}c of ${MAX_COST_CENTS}c cap`,
  error: failures ? `${failures} lead research failure(s): ${failureSummary}` : null,
});

console.log(
  `done. researched ${researched}/${leads.length}, ${emailsFound} email(s), ` +
  `${websitesFound} website(s) found, claude cost ${costCents}c (cap ${MAX_COST_CENTS}c)` +
  (failures ? `\nfailures: ${failureSummary}` : '')
);
