/**
 * Google Places (New) discovery sweep.
 *
 * Finds local businesses that have NO WEBSITE, DO have a phone number, and
 * operate from real premises rather than a house. Inserts them into `leads` as
 * unscored rows. agent/classify.mjs does the judgement pass afterwards.
 *
 * This file contains no AI. It is a deterministic API client, which is why it
 * is cheap and why it belongs on its own schedule.
 *
 * WHAT THIS SWEEP IS FOR
 * ----------------------
 * The website-sales business, not the invoice tool. The qualifying signal is the
 * absence of a website and the presence of a phone: something to pitch, and a
 * way to pitch it. The powersports sweep is a different vertical and its rows
 * are still in the table tagged vertical='powersports'.
 *
 * THREE FILTERS, IN ORDER OF COST
 * -------------------------------
 * 1. Free, at request time. `includePureServiceAreaBusinesses: false` tells
 *    Google not to return businesses that have no premises at all: mobile
 *    cleaners, most plumbers, anyone who only travels to the customer. This is
 *    the default, but it is set explicitly because it is load-bearing here and
 *    a future edit that flips it would silently fill the list with home offices.
 *
 * 2. Free, at insert time. Website present, phone missing, not OPERATIONAL,
 *    chain name, or an address with no street number: rejected below without
 *    ever reaching the model.
 *
 * 3. Paid, in classify.mjs. Whether "1042 Maple Ct" is a shop or a house is a
 *    judgement call, and it is the only part of this that needs a model.
 *
 * CADENCE
 * -------
 * Weekly, not nightly. Text Search with this field mask bills at the Enterprise
 * SKU, roughly $32/1,000 calls. The set of businesses without a website in a
 * given town changes a few times a year, not a few times a day.
 *
 *   node agent/sweep.mjs                 # core towns
 *   node agent/sweep.mjs --full          # every town, the one-time sweep
 *   node agent/sweep.mjs --dry-run       # prints the matrix, bills nothing
 */

const {
  GOOGLE_PLACES_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  MAX_SEARCHES = '40',
  VERTICAL = 'local',
} = process.env;

const DRY = process.argv.includes('--dry-run');
const FULL = process.argv.includes('--full');

if (!GOOGLE_PLACES_API_KEY && !DRY) {
  console.error('GOOGLE_PLACES_API_KEY missing');
  process.exit(1);
}

// Trades chosen for one reason: they work out of premises. A plumber or a
// mobile detailer is usually a truck and a phone, which is a fine business but
// fails the "is it a real location" test we are being asked to enforce. Shops
// with a bay, a chair, or a counter pass it by construction.
const TERMS = [
  'auto repair shop',
  'tire shop',
  'auto detailing shop',
  'transmission repair',
  'collision repair',
  'quick lube',
  'small engine repair',
  'appliance repair shop',
  'barber shop',
  'nail salon',
  'hair salon',
  'upholstery shop',
  'machine shop',
  'print shop',
];

// Metro Detroit first. This is the website business, Sarab can drive to these,
// and an in-person drop-in closes better than a cold call.
const TOWNS_CORE = [
  'Novi MI', 'Wixom MI', 'Walled Lake MI', 'South Lyon MI',
  'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington Hills MI',
];

const TOWNS_FULL = [
  ...TOWNS_CORE,
  'New Hudson MI', 'Milford MI', 'Brighton MI', 'Howell MI',
  'Westland MI', 'Garden City MI', 'Redford MI', 'Dearborn Heights MI',
  'Waterford MI', 'Pontiac MI', 'Auburn Hills MI', 'Rochester Hills MI',
  'Troy MI', 'Madison Heights MI', 'Warren MI', 'Roseville MI',
  'Ferndale MI', 'Oak Park MI', 'Southfield MI', 'Taylor MI',
];

// Places bills at the highest tier of ANY field requested, so one expensive
// field upgrades the whole call. This mask is already Enterprise because of
// phone/website/rating. businessStatus, pureServiceAreaBusiness and primaryType
// sit in cheaper tiers, so they ride along for free. Adding anything genuinely
// new here needs a pricing check first.
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
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'places.pureServiceAreaBusiness',
].join(',');

// Chains and franchises. They have corporate websites and no authority to buy
// one anyway, so they are a waste of a dial even when the data looks right.
const NAME_REJECT = new RegExp(
  [
    'autozone', "o'reilly", 'advance auto', 'napa', 'pep boys', 'midas',
    'monro', 'meineke', 'jiffy lube', 'valvoline', 'take 5', 'firestone',
    'goodyear', 'discount tire', 'belle tire', 'tires plus', 'mavis',
    'maaco', 'caliber collision', 'crash champions', 'gerber collision',
    'aamco', 'cottman', 'ziebart', 'supercuts', 'great clips', 'sport clips',
    'fantastic sams', 'cost cutters', 'regis', 'ulta', 'sally beauty',
    'fedex', 'ups store', 'office depot', 'staples', 'sir speedy', 'minuteman',
    'u-haul', 'enterprise rent', 'hertz', 'penske',
  ].join('|'),
  'i'
);

// A storefront has a street number. "Novi, MI 48375, USA" with no number in
// front is a service-area listing that slipped through, or a listing so thin it
// is not worth a call.
const HAS_STREET_NUMBER = /^\s*\d+[A-Za-z]?\s+\S/;

function parseAddress(formatted) {
  // "133 Veterans Dr, Fowlerville, MI 48836, USA"
  const parts = (formatted ?? '').split(',').map((s) => s.trim());
  const street = parts[0] ?? null;
  const city = parts[1] ?? null;
  const zip = (parts[2] ?? '').match(/\b(\d{5})\b/)?.[1] ?? null;
  return { street, city, zip };
}

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
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      // Load-bearing. See header, filter 1.
      includePureServiceAreaBusinesses: false,
    }),
  });

  if (!res.ok) {
    console.error(`  places error ${res.status}: ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return data.places ?? [];
}

/**
 * Returns null if the place should be kept, or a string reason to reject it.
 * Reasons are counted and printed so a sweep that returns nothing is
 * diagnosable without re-running it and paying twice.
 */
function rejectReason(p) {
  const name = p.displayName?.text ?? '';
  const { street } = parseAddress(p.formattedAddress);

  if (!name) return 'no name';
  if (p.websiteUri) return 'has website';
  if (!p.nationalPhoneNumber) return 'no phone';
  if (p.pureServiceAreaBusiness === true) return 'service-area business';
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
    return `status ${p.businessStatus}`;
  }
  if (!p.formattedAddress) return 'no address';
  if (!HAS_STREET_NUMBER.test(street ?? '')) return 'no street number';
  if (NAME_REJECT.test(name)) return 'chain';
  return null;
}

// ---------------------------------------------------------------------------

const towns = FULL ? TOWNS_FULL : TOWNS_CORE;
const budget = Number(MAX_SEARCHES);
const planned = towns.length * TERMS.length;

let searches = 0;
let seen = 0;
let inserted = 0;
const rejects = new Map();

console.log(
  `sweep: ${TERMS.length} terms x ${towns.length} towns = ${planned} possible, ` +
  `budget ${budget} searches, est $${((Math.min(planned, budget) * 3.2) / 100).toFixed(2)}` +
  `${DRY ? '  (DRY RUN, nothing billed)' : ''}`
);

if (planned > budget) {
  console.log(
    `note: budget cuts this short at ${budget}. Towns are worked in order, so ` +
    `the tail of the town list will not be reached this run.`
  );
}

outer:
for (const town of towns) {
  for (const term of TERMS) {
    if (searches >= budget) {
      console.log(`\nsearch budget ${budget} reached, stopping`);
      break outer;
    }

    const q = `${term} in ${town}`;
    searches++;

    const places = DRY ? [] : await textSearch(q);
    console.log(`[${searches}/${budget}] "${q}" -> ${places.length}`);

    for (const p of places) {
      seen++;

      const reason = rejectReason(p);
      if (reason) {
        rejects.set(reason, (rejects.get(reason) ?? 0) + 1);
        continue;
      }

      const name = p.displayName?.text;
      const { street, city, zip } = parseAddress(p.formattedAddress);

      // Key on the Places id, not on name+town. The town is where we searched,
      // not where the business is, and keying on it duplicated every shop that
      // showed up in more than one town's results.
      const rows = await d1(
        `INSERT INTO leads (place_id, slug, name, city, state, phone, website,
                            maps_url, address_street, address_zip, lat, lng,
                            review_count, rating, primary_type, vertical, source)
         VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(place_id) DO UPDATE SET
           last_seen_at = datetime('now'),
           review_count = excluded.review_count,
           rating       = excluded.rating,
           phone        = COALESCE(leads.phone, excluded.phone)
         RETURNING id, first_seen_at = last_seen_at AS is_new`,
        [
          p.id,
          slugify(name, city ?? town.replace(/ MI$/, '')),
          name,
          city ?? town.replace(/ MI$/, ''),
          'MI',
          p.nationalPhoneNumber,
          p.googleMapsUri ?? null,
          street,
          zip,
          p.location?.latitude ?? null,
          p.location?.longitude ?? null,
          p.userRatingCount ?? null,
          p.rating ?? null,
          p.primaryTypeDisplayName?.text ?? null,
          VERTICAL,
          `places:${term}:${town.replace(/ MI$/, '')}`,
        ]
      );

      if (rows[0]?.is_new) inserted++;
    }
  }
}

const costCents = Math.round(searches * 3.2);   // ~$32 per 1,000 Enterprise Text Search
const rejectSummary = [...rejects.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([r, n]) => `${r}: ${n}`)
  .join(', ');

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
      `${searches} searches, ${seen} seen, ${inserted} new. rejected: ${rejectSummary || 'none'}`,
    ]
  );
}

console.log(
  `\ndone. ${searches} searches, ${seen} results, ${inserted} new leads. ` +
  `~$${(costCents / 100).toFixed(2)}`
);
console.log(`rejected: ${rejectSummary || 'none'}`);
