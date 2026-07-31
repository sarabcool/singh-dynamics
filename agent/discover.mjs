/**
 * Nightly lead enrichment and scoring. Tier A, fully autonomous.
 *
 * Invoked by .github/workflows/discover-leads.yml, which is triggered by the
 * Worker's 03:00 ET cron. Runs with no human present.
 *
 * What it does:
 *   1. Pull leads from D1 that have never been enriched
 *   2. Research each one, confirm it still exists, find contact details
 *   3. Score fit and write the reason, so a bad score is debuggable later
 *   4. Draft a site config for anything scoring HIGH
 *   5. Commit configs to a branch and open a PR
 *
 * What it deliberately does NOT do:
 *   - Contact anyone. Ever. First contact is Tier C and queues for approval.
 *   - Set status='contacted'. Only an approved outreach action does that.
 *   - Invent data. A field it cannot verify stays null.
 *
 * KNOWN GAP, read before trusting this to fill the funnel
 * ------------------------------------------------------
 * This enriches leads that already exist in D1. It does not do the raw Google
 * Maps sweep, because headless CI has no browser and scraping Maps from a data
 * centre IP is both fragile and against Google's terms.
 *
 * The correct fix is the Google Places API: Text Search to find shops, Place
 * Details for phone, site and hours. It is legitimate, stable, returns clean
 * JSON, and removes the browser entirely. It is billed per request with a
 * monthly credit, so verify current pricing before enabling.
 *
 * Until that key exists, seed leads with the Chrome-driven Maps sweep and let
 * this job do everything downstream. That is a real division of labour, not a
 * placeholder: discovery is the only manual step and it is roughly 20 minutes.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const {
  ANTHROPIC_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  MAX_LEADS = '15',
  MAX_COST_CENTS = '150',   // hard stop. A loop with a bug is a bill, not a bug.
} = process.env;

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY missing. Nothing can run without it.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// D1 over the REST API. The Worker binding is not available here.
// ---------------------------------------------------------------------------

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
  if (!body.success) {
    throw new Error(`D1 error: ${JSON.stringify(body.errors)}`);
  }
  return body.result?.[0]?.results ?? [];
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

const SYSTEM = `
You are the research arm of Singh Dynamics, running unattended at 3am.

Scoring a powersports repair shop, 0-100. The target customer is a 2-10 person
independent repair shop running on paper or spreadsheets.

Strong positive signals:
  - No website at all. This is the single best qualifier.
  - Under 50 Google reviews. This is the cleanest size proxy available.
  - Repair-only, no new vehicle sales.
  - Reviews mentioning price, honesty, or comparison against dealerships.
  - Northern Michigan. Snowmobile country runs smaller and less software.

Hard disqualifiers, set disqualified=1 and stop:
  - Bicycle shop. "Motorcycle repair" pulls these in constantly and they buy
    from entirely different distributors.
  - Franchise, chain, or multiple locations.
  - Calls itself a dealer, or lists manufacturer brand logos.
  - Over ~200 reviews. Almost certainly already runs a DMS.
  - Not actually a repair business: clothing, rentals, upholstery, storage.

Rules you do not break:
  - Never invent a phone number, address, hours, or review. If you cannot verify
    a field, leave it null. A wrong phone number on a real business's site is
    worse than no site.
  - Never contact anyone. You are researching only.
  - Always write score_reason. A score without a reason is unusable in November.
`.trim();

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const started = Date.now();
let costCents = 0;
let enriched = 0;

const leads = await d1(
  `SELECT id, slug, name, city, state, phone, website, maps_url, review_count
     FROM leads
    WHERE score IS NULL AND disqualified = 0
    ORDER BY first_seen_at
    LIMIT ?`,
  [Number(MAX_LEADS)]
);

console.log(`enriching ${leads.length} lead(s)`);

mkdirSync('sites/shops', { recursive: true });

for (const lead of leads) {
  if (costCents >= Number(MAX_COST_CENTS)) {
    console.log(`cost ceiling ${MAX_COST_CENTS}c reached, stopping early`);
    break;
  }

  const prompt = `
Research this business and return ONLY a JSON object, no prose, no code fence.

  name: ${lead.name}
  city: ${lead.city}, ${lead.state}
  maps: ${lead.maps_url || 'unknown'}
  known phone: ${lead.phone || 'none'}
  known website: ${lead.website || 'none found'}
  known reviews: ${lead.review_count ?? 'unknown'}

Return exactly these keys:
{
  "still_operating": true|false,
  "disqualified": true|false,
  "disqualify_reason": string|null,
  "score": 0-100,
  "score_reason": "one or two sentences",
  "priority": "HIGH"|"MEDIUM"|"LOW",
  "phone": string|null,
  "email": string|null,
  "website": string|null,
  "facebook_url": string|null,
  "address_street": string|null,
  "address_zip": string|null,
  "services": [{"name": string, "desc": string}],
  "review_quotes": [{"text": "verbatim", "author": string, "stars": 1-5}]
}
`.trim();

  let raw = '';
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: 'claude-sonnet-5',
        systemPrompt: SYSTEM,
        allowedTools: ['WebSearch', 'WebFetch'],
        permissionMode: 'bypassPermissions',  // no human present to ask
        maxTurns: 12,
      },
    })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content ?? []) {
          if (block.type === 'text') raw += block.text;
        }
      }
      if (msg.type === 'result') {
        costCents += Math.round((msg.total_cost_usd ?? 0) * 100);
      }
    }
  } catch (err) {
    console.error(`[${lead.slug}] agent error: ${err.message}`);
    continue;
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
  } catch {
    console.error(`[${lead.slug}] unparseable response, skipping`);
    continue;
  }

  await d1(
    `UPDATE leads
        SET score = ?, score_reason = ?, priority = ?,
            disqualified = ?, disqualify_reason = ?,
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            website = COALESCE(?, website),
            facebook_url = COALESCE(?, facebook_url),
            address_street = COALESCE(?, address_street),
            address_zip = COALESCE(?, address_zip),
            last_seen_at = datetime('now')
      WHERE id = ?`,
    [
      data.score ?? null,
      data.score_reason ?? null,
      data.priority ?? null,
      data.disqualified ? 1 : 0,
      data.disqualify_reason ?? null,
      data.phone ?? null,
      data.email ?? null,
      data.website ?? null,
      data.facebook_url ?? null,
      data.address_street ?? null,
      data.address_zip ?? null,
      lead.id,
    ]
  );

  enriched++;
  console.log(`[${lead.slug}] score=${data.score} ${data.priority}`);

  // Pre-build a site config for strong leads so the pitch is "here it is"
  // rather than "would you like one". Unverified fields stay null and the
  // site generator's validator will refuse to ship them.
  if (!data.disqualified && (data.score ?? 0) >= 70 && data.phone) {
    const themes = ['steel', 'pine', 'clay', 'ice'];
    writeFileSync(
      `sites/shops/${lead.slug}.json`,
      JSON.stringify({
        _generated: `discover.mjs ${new Date().toISOString()}`,
        _review_before_shipping: true,
        slug: lead.slug,
        name: lead.name,
        city: lead.city,
        state: lead.state,
        phone: data.phone,
        theme: themes[lead.id % 4],
        schema_type: 'MotorcycleRepair',
        services: data.services ?? [],
        address: {
          street: data.address_street ?? '',
          zip: data.address_zip ?? '',
        },
        maps_url: lead.maps_url ?? '',
        reviews: data.review_quotes ?? [],
        aggregate_rating: { enabled: false, value: '', count: lead.review_count ?? '' },
      }, null, 2)
    );
  }
}

// ---------------------------------------------------------------------------
// log the run, then let the workflow open the PR
// ---------------------------------------------------------------------------

await d1(
  `INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out,
                     cost_cents, gh_run_url, summary)
   VALUES ('discover-leads', ?, datetime('now'), 1, ?, ?, ?, ?, ?)`,
  [
    process.env.GITHUB_EVENT_NAME || 'manual',
    leads.length,
    enriched,
    costCents,
    process.env.GITHUB_RUN_URL || null,
    `enriched ${enriched}/${leads.length} in ${Math.round((Date.now() - started) / 1000)}s`,
  ]
);

console.log(`done. ${enriched} enriched, ${costCents}c spent.`);

// Surface for the workflow's PR body.
execSync(`echo "enriched=${enriched}" >> $GITHUB_OUTPUT`, { stdio: 'inherit' });
execSync(`echo "cost_cents=${costCents}" >> $GITHUB_OUTPUT`, { stdio: 'inherit' });
