/**
 * Google Places (New) discovery sweep for the active Singh Dynamics website offer.
 * Deterministic discovery only. AI judgement lives in classify.mjs.
 */

import { OFFER } from './config/offer.mjs';

const {
  GOOGLE_PLACES_API_KEY,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_ID,
  MAX_SEARCHES = '40',
} = process.env;

const DRY = process.argv.includes('--dry-run');
const FULL = process.argv.includes('--full');
const VERTICAL = OFFER.vertical;
const TERMS = OFFER.terms;
const TOWNS_CORE = OFFER.townsCore;
const TOWNS_FULL = OFFER.townsFull;

if (!GOOGLE_PLACES_API_KEY && !DRY) {
  console.error('GOOGLE_PLACES_API_KEY missing');
  process.exit(1);
}

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.rating',
  'places.userRatingCount', 'places.location', 'places.googleMapsUri',
  'places.businessStatus', 'places.primaryTypeDisplayName',
  'places.pureServiceAreaBusiness',
].join(',');

const NAME_REJECT = new RegExp([
  'autozone', "o'reilly", 'advance auto', 'napa', 'pep boys', 'midas',
  'monro', 'meineke', 'jiffy lube', 'valvoline', 'take 5', 'firestone',
  'goodyear', 'discount tire', 'belle tire', 'tires plus', 'mavis',
  'maaco', 'caliber collision', 'crash champions', 'gerber collision',
  'aamco', 'cottman', 'ziebart', 'u-haul', 'enterprise rent', 'hertz', 'penske',
].join('|'), 'i');

const HAS_STREET_NUMBER = /^\s*\d+[A-Za-z]?\s+\S/;
const PLACES_SKU = 'Places API Text Search Enterprise';
const PLACES_FREE_MONTHLY_EVENTS = 1000;

function parseAddress(formatted) {
  const parts = (formatted ?? '').split(',').map((s) => s.trim());
  return {
    street: parts[0] ?? null,
    city: parts[1] ?? null,
    zip: (parts[2] ?? '').match(/\b(\d{5})\b/)?.[1] ?? null,
  };
}

function slugify(name, city, placeId) {
  const base = `${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!placeId) return base;
  const suffix = String(placeId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase();
  return `${base}-${suffix}`;
}

async function d1(sql, params = []) {
  if (DRY) return [];
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`D1: ${JSON.stringify(body.errors)}`);
  return body.result?.[0]?.results ?? [];
}

async function textSearch(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20, includePureServiceAreaBusinesses: false }),
  });
  if (!res.ok) {
    console.error(`  places error ${res.status}: ${await res.text()}`);
    return [];
  }
  return (await res.json()).places ?? [];
}

function rejectReason(p) {
  const name = p.displayName?.text ?? '';
  const { street } = parseAddress(p.formattedAddress);
  if (!name) return 'no name';
  if (p.websiteUri) return 'has website';
  if (!p.nationalPhoneNumber) return 'no phone';
  if (p.pureServiceAreaBusiness === true) return 'service-area business';
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return `status ${p.businessStatus}`;
  if (!p.formattedAddress) return 'no address';
  if (!HAS_STREET_NUMBER.test(street ?? '')) return 'no street number';
  if (NAME_REJECT.test(name)) return 'chain';
  return null;
}

const towns = FULL ? TOWNS_FULL : TOWNS_CORE;
const budget = Number(MAX_SEARCHES);
const planned = towns.length * TERMS.length;
let searches = 0, seen = 0, inserted = 0, failed = 0;
const rejects = new Map();

console.log(`sweep: offer=${OFFER.id}, ${TERMS.length} terms x ${towns.length} towns = ${planned}, budget ${budget}${DRY ? ' (DRY RUN)' : ''}`);

outer: for (const town of towns) {
  for (const term of TERMS) {
    if (searches >= budget) break outer;
    const q = `${term} in ${town}`;
    searches++;
    const places = DRY ? [] : await textSearch(q);
    console.log(`[${searches}/${budget}] "${q}" -> ${places.length}`);
    for (const p of places) {
      seen++;
      const reason = rejectReason(p);
      if (reason) { rejects.set(reason, (rejects.get(reason) ?? 0) + 1); continue; }
      const name = p.displayName?.text;
      const { street, city, zip } = parseAddress(p.formattedAddress);
      try {
        const rows = await d1(`INSERT INTO leads (place_id, slug, name, city, state, phone, website, maps_url, address_street, address_zip, lat, lng, review_count, rating, primary_type, vertical, source)
          VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(place_id) DO UPDATE SET last_seen_at=datetime('now'), review_count=excluded.review_count, rating=excluded.rating, phone=COALESCE(leads.phone, excluded.phone)
          RETURNING id, first_seen_at = last_seen_at AS is_new`, [
          p.id, slugify(name, city ?? town.replace(/ MI$/, ''), p.id), name,
          city ?? town.replace(/ MI$/, ''), 'MI', p.nationalPhoneNumber,
          p.googleMapsUri ?? null, street, zip, p.location?.latitude ?? null,
          p.location?.longitude ?? null, p.userRatingCount ?? null, p.rating ?? null,
          p.primaryTypeDisplayName?.text ?? null, VERTICAL,
          `places:${OFFER.id}:${term}:${town.replace(/ MI$/, '')}`,
        ]);
        if (rows[0]?.is_new) inserted++;
      } catch (err) { failed++; console.error(`insert failed for "${name}": ${err.message}`); }
    }
  }
}

const rejectSummary = [...rejects.entries()].sort((a,b) => b[1]-a[1]).map(([r,n]) => `${r}: ${n}`).join(', ');
const billingSummary = `${PLACES_SKU}; ${searches} request(s); current free cap ${PLACES_FREE_MONTHLY_EVENTS} events/SKU/month; actual Google charge not estimated`;
if (!DRY) await d1(`INSERT INTO runs (job, trigger, finished_at, ok, items_in, items_out, cost_cents, gh_run_url, summary, error)
  VALUES ('places-sweep', ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`, [
  process.env.GITHUB_EVENT_NAME || 'manual', failed === 0 ? 1 : 0, seen, inserted,
  null, process.env.GITHUB_RUN_URL || null,
  `offer=${OFFER.id}; ${searches} searches, ${seen} seen, ${inserted} new; ${billingSummary}; rejected: ${rejectSummary || 'none'}`,
  failed ? `${failed} row(s) failed to insert` : null,
]);
console.log(`done. ${searches} searches, ${seen} results, ${inserted} new leads. Google Places: ${billingSummary}.`);
if (failed) process.exitCode = 1;
