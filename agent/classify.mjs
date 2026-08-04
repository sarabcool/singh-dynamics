/**
 * Storefront judgement pass. The only part of the pipeline that costs AI money.
 *
 * sweep.mjs has already thrown away everything decidable by rule: businesses
 * with a website, without a phone, closed, chains, and the service-area
 * listings Google flags itself. What survives is the genuinely ambiguous case,
 * which is the one thing worth paying a model for:
 *
 *   Is "1042 Maple Ct, Novi" a shop, or is it a guy's house?
 *
 * Google will not answer this. A licensed business can register its home
 * address and appear on Maps with a pin on a driveway, indistinguishable in the
 * API response from a unit in a strip mall.
 *
 * ECONOMY, deliberately
 * ---------------------
 * Leads are batched, not looped. discover.mjs opens a full agent session per
 * lead with WebSearch enabled, which is right for deep research and wrong here:
 * this is a classification over data we already hold. One message, twenty
 * leads, no tools, structured JSON back. It is roughly two orders of magnitude
 * cheaper per lead and the answers are more consistent because every lead in a
 * batch is judged against the same visible context.
 *
 * ---------------------------------------------------------------------------
 * FIXED 4 Aug 2026, and it is worth understanding what went wrong.
 *
 * This script had run green in CI since 31 Jul and classified exactly zero
 * leads. It was not erroring. Its lead query filters on `vertical = ?`, which
 * defaults to 'local'. Every one of the 821 rows in the table is tagged
 * 'powersports', left over from the earlier sweep. So the query matched nothing,
 * the script printed "nothing to classify", and exited 0.
 *
 * Exit 0 is a green tick in the Actions tab. Nothing anywhere distinguished
 * "there was nothing to do" from "the filter is wrong and there are 182 leads
 * sitting right there". It also returned before the `runs` INSERT, so the
 * audit table had no row either, and the absence of evidence looked exactly
 * like the absence of work.
 *
 * Three changes below, in order of importance:
 *
 *   1. A zero-row result now COUNTS WHAT IT SKIPPED. If other verticals hold
 *      unclassified leads, it names them and the counts, and emits a CI warning
 *      annotation. A filter excluding the entire table is now impossible to
 *      miss.
 *   2. The `runs` row is written on EVERY path, including the zero path.
 *      Silence is now recorded rather than merely happening.
 *   3. --vertical / VERTICAL accepts 'all' to ignore the filter entirely.
 *
 * The lesson generalises past this file: a filtered query that returns nothing
 * is ambiguous between an empty queue and a wrong filter, and code that treats
 * those two the same will hide the second one indefinitely.
 * ---------------------------------------------------------------------------
 *
 *   node agent/classify.mjs                          # VERTICAL, default 'local'
 *   node agent/classify.mjs --vertical powersports   # the existing 821 rows
 *   node agent/classify.mjs --vertical all           # ignore the filter
 *   node agent/classify.mjs --dry-run                # print the prompt, call nothing
 *   node agent/classify.mjs --limit 200
 */

import { d1, assertD1Env, logRun } from './lib/d1.mjs';

const { ANTHROPIC_API_KEY, MAX_COST_CENTS = '100' } = process.env;

const DRY = process.argv.includes('--dry-run');

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const LIMIT = Number(argOf('--limit', 120));
const VERTICAL = argOf('--vertical', process.env.VERTICAL || 'local');
const ALL_VERTICALS = VERTICAL === 'all';
const BATCH = 20;

assertD1Env();

if (!ANTHROPIC_API_KEY && !DRY) {
  console.error('ANTHROPIC_API_KEY missing');
  process.exit(1);
}

// Sonnet's per-token price. Used for the spend ceiling, which is a safety rail
// and not an accounting record: the real number is on the Anthropic dashboard.
const IN_PER_MTOK = 3.0;
const OUT_PER_MTOK = 15.0;

// Imported lazily rather than at the top of the file so that --dry-run works on
// a machine with nothing installed. Checking the prompt should never require a
// dependency tree, and a dry run you cannot execute is a dry run nobody uses.
let anthropic = null;
if (!DRY) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
}

const SYSTEM = `
You classify Michigan small businesses for a web-design outreach list. You run
unattended. Every business you see has already been confirmed to have no website
and a working phone number.

Your ONLY judgement is whether the business operates from commercial premises a
customer can walk into, or from a residence.

Read the street address first. It carries most of the signal.

Commercial, almost always:
  - Numbered units, suites, or bays: "Suite 4", "Unit B", "#12"
  - Highways, main roads, business corridors: Grand River, Telegraph, Woodward,
    Michigan Ave, Gratiot, Van Dyke, numbered M- and US- routes
  - Address types that dominate commercial strips: Ave, Blvd, Hwy, Pkwy, Rd, St
  - Industrial and business park names: Industrial, Commerce, Enterprise,
    Technology, Research

Residential, usually:
  - Subdivision street types: Ct, Cir, Ln, Ter, Pl, Way, Trail, Glen, Hollow
  - Apartment numbers, "Apt", or a lot number
  - A tree, bird, or first-name street in a clearly suburban town

Signals that are NOT proof either way, and must not be treated as proof:
  - A low review count. Small does not mean home-based.
  - Any business type. Barbers work from spare rooms; detailers rent bays.
  - A missing website. Every business in this list is missing one.

Confidence rules you do not break:
  - If the address genuinely does not settle it, answer "unclear". An unclear
    verdict is useful; a confident wrong one sends Sarab to a stranger's door.
  - Never invent a detail about a business that is not in the data given.
  - Reason must cite the actual evidence you used, not a restatement of the
    verdict. "Suite number on a main road" is a reason. "Looks commercial" is not.

Set disqualify=true only for a business that cannot buy a website from a local
web shop at all: a franchise of a national chain, a dealership tied to a
manufacturer's corporate site, or a listing whose name shows it is not a real
independent business. Being small, rural, or unimpressive is not grounds.

fit_score, 0-100, for a paid website build. Higher when the business plainly
serves walk-in customers, has enough reviews to be real and established, and
sells a service where a website changes whether a stranger picks them.
`.trim();

function buildPrompt(rows) {
  const lines = rows.map((r) =>
    [
      `id: ${r.id}`,
      `name: ${r.name}`,
      `type: ${r.primary_type ?? 'unknown'}`,
      `address: ${r.address_street ?? '?'}, ${r.city}, MI ${r.address_zip ?? ''}`.trim(),
      `reviews: ${r.review_count ?? 'unknown'}  rating: ${r.rating ?? 'unknown'}`,
    ].join('\n  ')
  );

  return `
Classify each business below.

Return ONLY a JSON array, no prose and no code fence, one object per business,
in the same order, with exactly these keys:

  {"id": number, "storefront": "yes"|"no"|"unclear", "reason": string,
   "fit_score": 0-100, "disqualify": boolean, "disqualify_reason": string|null}

Businesses:

  ${lines.join('\n\n  ')}
`.trim();
}

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

const where = [
  ALL_VERTICALS ? null : 'vertical = ?',
  'storefront IS NULL',
  'disqualified = 0',
  'website IS NULL',
  'phone IS NOT NULL',
].filter(Boolean).join('\n      AND ');

const leads = await d1(
  `SELECT id, name, city, address_street, address_zip, review_count, rating,
          primary_type
     FROM leads
    WHERE ${where}
    ORDER BY review_count DESC NULLS LAST
    LIMIT ?`,
  ALL_VERTICALS ? [LIMIT] : [VERTICAL, LIMIT]
);

console.log(
  `classify: vertical=${VERTICAL} -> ${leads.length} lead(s), ` +
  `batches of ${BATCH}${DRY ? '  (DRY RUN)' : ''}`
);

// ---------------------------------------------------------------------------
// the zero case, which used to be silent
// ---------------------------------------------------------------------------

if (!leads.length) {
  // Ask the table what it actually holds before concluding there is no work.
  // This query is the entire fix: it is the difference between "queue empty"
  // and "your filter excludes every row in the database".
  const elsewhere = await d1(
    `SELECT vertical, COUNT(*) AS n
       FROM leads
      WHERE storefront IS NULL AND disqualified = 0
        AND website IS NULL AND phone IS NOT NULL
      GROUP BY vertical
      ORDER BY n DESC`
  );

  const stranded = elsewhere.filter((r) => r.vertical !== VERTICAL);
  const total = stranded.reduce((a, r) => a + r.n, 0);

  if (total > 0) {
    const detail = stranded.map((r) => `${r.vertical}=${r.n}`).join(', ');
    const msg =
      `${total} unclassified lead(s) exist, but none are tagged '${VERTICAL}'. ` +
      `Found: ${detail}. Re-run with --vertical <name> or --vertical all.`;
    // GitHub renders this as a yellow annotation on the run summary, so it is
    // visible from the Actions list without opening the log.
    console.log(`::warning title=classify matched nothing::${msg}`);
    console.error(msg);
    await logRun({
      job: 'classify', ok: 0, itemsIn: 0, itemsOut: 0,
      summary: `no rows for vertical '${VERTICAL}'`,
      error: msg,
    });
    // Exit 0 anyway. This is a misconfiguration, not a crash, and failing the
    // job would also fail the sweep step that legitimately succeeded before it.
    process.exit(0);
  }

  console.log('nothing to classify. Every callable lead already has a verdict.');
  await logRun({
    job: 'classify', itemsIn: 0, itemsOut: 0,
    summary: `queue genuinely empty for vertical '${VERTICAL}'`,
  });
  process.exit(0);
}

if (DRY) {
  console.log('\n--- system ---\n' + SYSTEM);
  console.log('\n--- first batch prompt ---\n' + buildPrompt(leads.slice(0, BATCH)));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

let costCents = 0;
let classified = 0;
let batchErrors = 0;
const tally = { yes: 0, no: 0, unclear: 0, disqualified: 0 };

for (let i = 0; i < leads.length; i += BATCH) {
  if (costCents >= Number(MAX_COST_CENTS)) {
    console.log(`cost ceiling ${MAX_COST_CENTS}c reached, stopping early`);
    break;
  }

  const batch = leads.slice(i, i + BATCH);
  const n = i / BATCH + 1;

  let msg;
  try {
    msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
    });
  } catch (err) {
    console.error(`batch ${n} api error: ${err.message}`);
    batchErrors++;
    continue;
  }

  costCents +=
    (msg.usage.input_tokens / 1e6) * IN_PER_MTOK * 100 +
    (msg.usage.output_tokens / 1e6) * OUT_PER_MTOK * 100;

  const raw = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let verdicts;
  try {
    verdicts = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
  } catch {
    // Print the head of the response. A parse failure with no sight of what was
    // returned is the second-most annoying class of bug in this whole pipeline,
    // right behind the silent-zero one this file was just fixed for.
    console.error(`batch ${n} unparseable, skipping ${batch.length} leads`);
    console.error(`  response began: ${raw.slice(0, 200)}`);
    batchErrors++;
    continue;
  }

  if (!Array.isArray(verdicts)) {
    console.error(`batch ${n} returned ${typeof verdicts}, expected array, skipping`);
    batchErrors++;
    continue;
  }

  // Match on the id the model echoed rather than on array position. If it drops
  // or reorders a row, position-matching would write one business's verdict onto
  // another's record, which is worse than skipping it.
  const byId = new Map(batch.map((b) => [b.id, b]));

  for (const v of verdicts) {
    if (!byId.has(v.id)) {
      console.error(`  unknown id ${v.id} in response, ignoring`);
      continue;
    }
    const verdict = ['yes', 'no', 'unclear'].includes(v.storefront)
      ? v.storefront
      : 'unclear';

    await d1(
      `UPDATE leads
          SET storefront = ?, storefront_reason = ?,
              score = ?, score_reason = ?,
              priority = ?,
              disqualified = ?, disqualify_reason = ?,
              last_seen_at = datetime('now')
        WHERE id = ?`,
      [
        verdict,
        v.reason ?? null,
        v.fit_score ?? null,
        v.reason ?? null,
        v.fit_score >= 70 ? 'HIGH' : v.fit_score >= 45 ? 'MEDIUM' : 'LOW',
        v.disqualify ? 1 : 0,
        v.disqualify_reason ?? null,
        v.id,
      ]
    );

    classified++;
    tally[verdict]++;
    if (v.disqualify) tally.disqualified++;
  }

  console.log(`batch ${n}: ${verdicts.length} classified, ${Math.round(costCents)}c so far`);
}

const summary =
  `storefront yes:${tally.yes} no:${tally.no} unclear:${tally.unclear}, ` +
  `disqualified:${tally.disqualified}`;

await logRun({
  job: 'classify',
  ok: batchErrors === 0 ? 1 : 0,
  itemsIn: leads.length,
  itemsOut: classified,
  costCents: Math.round(costCents),
  summary: `vertical=${VERTICAL} ${summary}`,
  error: batchErrors ? `${batchErrors} batch(es) failed` : null,
});

console.log(
  `\ndone. ${classified} of ${leads.length} classified. ${summary}. ` +
  `~$${(costCents / 100).toFixed(2)}`
);

// A run where every batch failed should not be green. A run where one of six
// failed should not be red. This splits the difference at "any failure is red",
// which errs toward being noticed.
if (batchErrors > 0) {
  console.log(`::warning::${batchErrors} batch(es) failed, ${leads.length - classified} lead(s) still unclassified`);
  process.exit(1);
}
