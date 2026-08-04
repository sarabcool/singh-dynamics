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
 *   node agent/classify.mjs                # default batch
 *   node agent/classify.mjs --dry-run      # print the prompt, call nothing
 *   node agent/classify.mjs --limit 200
 */

const {
  ANTHROPIC_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  VERTICAL = 'local',
  MAX_COST_CENTS = '100',
} = process.env;

const DRY = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 120;
const BATCH = 20;

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

async function d1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const body = await res.json();
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors)}`);
  return body.result?.[0]?.results ?? [];
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

const leads = await d1(
  `SELECT id, name, city, address_street, address_zip, review_count, rating,
          primary_type
     FROM leads
    WHERE vertical = ?
      AND storefront IS NULL
      AND disqualified = 0
      AND website IS NULL
      AND phone IS NOT NULL
    ORDER BY review_count DESC NULLS LAST
    LIMIT ?`,
  [VERTICAL, LIMIT]
);

console.log(`classify: ${leads.length} lead(s), batches of ${BATCH}${DRY ? '  (DRY RUN)' : ''}`);

if (!leads.length) {
  console.log('nothing to classify. Run agent/sweep.mjs first.');
  process.exit(0);
}

if (DRY) {
  console.log('\n--- system ---\n' + SYSTEM);
  console.log('\n--- first batch prompt ---\n' + buildPrompt(leads.slice(0, BATCH)));
  process.exit(0);
}

let costCents = 0;
let classified = 0;
const tally = { yes: 0, no: 0, unclear: 0, disqualified: 0 };

for (let i = 0; i < leads.length; i += BATCH) {
  if (costCents >= Number(MAX_COST_CENTS)) {
    console.log(`cost ceiling ${MAX_COST_CENTS}c reached, stopping early`);
    break;
  }

  const batch = leads.slice(i, i + BATCH);

  let msg;
  try {
    msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
    });
  } catch (err) {
    console.error(`batch ${i / BATCH + 1} api error: ${err.message}`);
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
    console.error(`batch ${i / BATCH + 1} unparseable, skipping ${batch.length} leads`);
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

  console.log(
    `batch ${i / BATCH + 1}: ${verdicts.length} classified, ${Math.round(costCents)}c so far`
  );
}

await d1(
  `INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out,
                     cost_cents, gh_run_url, summary)
   VALUES ('classify', ?, datetime('now'), 1, ?, ?, ?, ?, ?)`,
  [
    process.env.GITHUB_EVENT_NAME || 'manual',
    leads.length,
    classified,
    Math.round(costCents),
    process.env.GITHUB_RUN_URL || null,
    `storefront yes:${tally.yes} no:${tally.no} unclear:${tally.unclear}, ` +
    `disqualified:${tally.disqualified}`,
  ]
);

console.log(
  `\ndone. ${classified} classified. ` +
  `storefront yes:${tally.yes} no:${tally.no} unclear:${tally.unclear}. ` +
  `~$${(costCents / 100).toFixed(2)}`
);
