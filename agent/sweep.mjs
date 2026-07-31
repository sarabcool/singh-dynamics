/**
 * Google Places discovery sweep. Tier A.
 *
 * Finds candidate shops and inserts them into `leads` as unscored rows.
 * agent/discover.mjs picks them up on the next nightly run and does the
 * reasoning. This file contains no AI: it is a deterministic API client, which
 * is why it is cheap and why it belongs on its own schedule.
 *
 * CADENCE MATTERS MORE THAN ANYTHING ELSE HERE
 * --------------------------------------------
 * Weekly, not nightly. Text Search is ~$32/1,000 calls. Five terms across eight
 * towns is 40 calls, which nightly is roughly $38/month for a dataset that
 * barely moves. There are only a few hundred small powersports shops in
 * Michigan and new ones appear a handful of times a year.
 *
 * Run it once by hand to map the state, then weekly to catch new entrants.
 *
 *   node agent/sweep.mjs                 # default towns
 *   node agent/sweep.mjs --full          # every town, the one-time sweep
 *   node agent/sweep.mjs --dry-run       # no writes, no API calls billed twice
 */

const {
  GOOGLE_PLACES_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  MAX_SEARCHES = '40',
} = process.env;

const DRY = process.argv.includes('--dry-run');
const FULL = process.argv.includes('--full');

if (!GOOGLE_PLACES_API_KEY && !DRY) {
  console.error('GOOGLE_PLACES_API_KEY missing');
  process.exit(1);
}

// Terms and towns come from what actually worked in the manual sweep.
// Northern Michigan produced far more no-website shops than metro Detroit:
// snowmobile country runs smaller and buys less software.
const TERMS = [
  'motorcycle repair',
  'powersports service',
  'ATV repair',
  'snowmobile repair',
  'small engine repair',
];

const TOWNS_CORE = [
  'Howell MI', 'Brighton MI', 'Fenton MI', 'Owosso MI',
  'Gaylord MI', 'Houghton Lake MI', 'Cadillac MI', 'Traverse City MI',
];

const TOWNS_FULL = [
  ...TOWNS_CORE,
  'Novi MI', 'Wixom MI', 'Walled Lake MI', 'New Hudson MI', 'South Lyon MI',
  'Milford MI', 'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington MI',
  'Flint MI', 'Grayling MI', 'Alpena MI', 'Petoskey MI', 'Big Rapids MI',
  'Mount Pleasant MI', 'Ludington MI', 'Manistee MI', 'Sault Ste Marie MI',
  'Marquette MI', 'Escanaba MI', 'Iron Mountain MI',
];

// Field mask. Places bills at the highest tier of ANY field requested, so one
// expensive field upgrades the entire call. Add nothing here casually.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.googleMapsUri',
].join(',');

// Cheap deterministic filters. Anything ambiguous is left for the reasoning
// pass rather than guessed at here.
const NAME_REJECT = /\b(bicycle|bike shop|cyclery|schwinn|trek|specialized|harley-davidson|polaris dealer|yamaha of|honda of|kawasaki of|autozone|o'reilly|advance auto|napa)\b/i;

function slugify(name, city) {
  return `${name}-${city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function d1(sql, params = []) {
  if (DRY) return [];
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

async function textSearch(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
  });

  if (!res.ok) {
    console.error(`  places error ${res.status}: ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return data.places ?? [];
}

// ---------------------------------------------------------------------------

const towns = FULL ? TOWNS_FULL : TOWNS_CORE;
const budget = Number(MAX_SEARCHES);

let searches = 0;
let seen = 0;
let inserted = 0;
let skipped = 0;

console.log(
  `sweep: ${TERMS.length} terms x ${towns.length} towns, ` +
  `budget ${budget} searches${DRY ? ' (DRY RUN)' : ''}`
);

outer:
for (const town of towns) {
  for (const term of TERMS) {
    if (searches >= budget) {
      console.log(`search budget ${budget} reached, stopping`);
      break outer;
    }

    const q = `${term} in ${town}`;
    searches++;

    const places = DRY ? [] : await textSearch(q);
    console.log(`[${searches}/${budget}] "${q}" -> ${places.length}`);

    for (const p of places) {
      seen++;
      const name = p.displayName?.text ?? '';
      const city = town.replace(/ MI$/, '');

      if (NAME_REJECT.test(name)) {
        skipped++;
        continue;
      }

      // Over ~200 reviews almost certainly means a DMS is already in place.
      // Not our customer, and messaging them burns effort for nothing.
      if ((p.userRatingCount ?? 0) > 200) {
        skipped++;
        continue;
      }

      // INSERT OR IGNORE on the unique slug makes the whole sweep idempotent.
      // Re-running it is free of side effects, which is what lets it be a cron
      // job nobody supervises. last_seen_at still moves so we can tell which
      // shops have gone quiet.
      const rows = await d1(
        `INSERT INTO leads (slug, name, city, state, phone, website, maps_url,
                            address_street, lat, lng, review_count, rating, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(slug) DO UPDATE SET
           last_seen_at = datetime('now'),
           review_count = excluded.review_count,
           rating       = excluded.rating,
           phone        = COALESCE(leads.phone, excluded.phone),
           website      = COALESCE(leads.website, excluded.website)
         RETURNING id, first_seen_at = last_seen_at AS is_new`,
        [
          slugify(name, city),
          name,
          city,
          'MI',
          p.nationalPhoneNumber ?? null,
          p.websiteUri ?? null,          // NULL here is the qualifying signal
          p.googleMapsUri ?? null,
          p.formattedAddress ?? null,
          p.location?.latitude ?? null,
          p.location?.longitude ?? null,
          p.userRatingCount ?? null,
          p.rating ?? null,
          `places:${term}:${city}`,
        ]
      );

      if (rows[0]?.is_new) inserted++;
    }
  }
}

const costCents = Math.round(searches * 3.2);   // ~$32 per 1,000 Text Search

if (!DRY) {
  await d1(
    `INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out,
                       cost_cents, gh_run_url, summary)
     VALUES ('places-sweep', ?, datetime('now'), 1, ?, ?, ?, ?, ?)`,
    [
      process.env.GITHUB_EVENT_NAME || 'manual',
      seen,
      inserted,
      costCents,
      process.env.GITHUB_RUN_URL || null,
      `${searches} searches, ${seen} seen, ${inserted} new, ${skipped} filtered`,
    ]
  );
}

console.log(
  `\ndone. ${searches} searches, ${seen} results, ` +
  `${inserted} new leads, ${skipped} filtered. ~$${(costCents / 100).toFixed(2)}`
);
