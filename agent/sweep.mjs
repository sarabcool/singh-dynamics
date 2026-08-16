/**
 * Google Places (New) discovery sweep for the active Singh Dynamics website offer.
 * Deterministic discovery only. AI judgement lives in classify.mjs.
 *
 * The sweep no longer walks a hardcoded town list. It asks lib/territory.mjs
 * which cluster of towns to work next, skips (town, term) queries that recent
 * history says are not worth repeating, and writes back what it found so the
 * next run moves somewhere new. Qualification filters are unchanged: no
 * website, a phone number, a real street address, operational, not a chain.
 *
 * Flags:
 *   --dry-run              plan and print, issue no Places requests, write nothing
 *   --territory <key>      force one specific territory
 *   --territories <n>      how many territories this run may cover (default 1)
 */

import { OFFER } from './config/offer.mjs';
import { d1 as d1Live, assertD1Env } from './lib/d1.mjs';
import {
  territorySetFor, loadTerritoryState, planTerritories,
  pendingQueries, recordSearch, recordTerritorySweep,
} from './lib/territory.mjs';

const { GOOGLE_PLACES_API_KEY, MAX_SEARCHES = '80' } = process.env;

const DRY = process.argv.includes('--dry-run');

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ONLY_TERRITORY = argOf('--territory', process.env.TERRITORY || null);
const TERRITORY_COUNT = Math.min(
  Math.max(Number(argOf('--territories', process.env.TERRITORY_COUNT || '1')) || 1, 1),
  6
);

const VERTICAL = OFFER.vertical;
const TERMS = OFFER.terms;

if (!GOOGLE_PLACES_API_KEY && !DRY) {
  console.error('GOOGLE_PLACES_API_KEY missing');
  process.exit(1);
}
if (!DRY) assertD1Env();

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

async function d1(sql, params = []) {
  if (DRY) return [];
  return d1Live(sql, params);
}

function parseAddress(formatted) {
  const parts = (formatted ?? '').split(',').map((s) => s.trim());
  return {
    street: parts[0] ?? null,
    city: parts[1] ?? null,
    zip: (parts[2] ?? '').match(/\b(\d{5})\b/)?.[1] ?? null,
  };
}

/** "Grandmont Rosedale Detroit MI" -> "Detroit", "Novi MI" -> "Novi". */
function townLabel(town) {
  const withoutState = town.replace(/\s+MI$/i, '').trim();
  const words = withoutState.split(/\s+/);
  return words[words.length - 1] === 'Detroit' ? 'Detroit' : withoutState;
}

function slugify(name, city, placeId) {
  const base = `${name}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!placeId) return base;
  const suffix = String(placeId).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase();
  return `${base}-${suffix}`;
}

async function textSearch(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20, includePureServiceAreaBusinesses: false }),
  });
  if (!res.ok) {
    console.error(`  places error ${res.status}: ${await res.text()}`);
    return null;
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

// --- plan ------------------------------------------------------------------

const set = territorySetFor(OFFER);
const state = DRY && !process.env.CLOUDFLARE_API_TOKEN
  ? new Map()
  : await loadTerritoryState(OFFER.id).catch((err) => {
    console.error(`could not read territory_state (${err.message}); treating all territories as fresh`);
    return new Map();
  });

const plan = planTerritories({ set, state, count: TERRITORY_COUNT, only: ONLY_TERRITORY });

if (!plan.length) {
  console.log(`sweep: offer=${OFFER.id}; every territory is swept, current and not yet due. Nothing to do.`);
  process.exit(0);
}

const budget = Number(MAX_SEARCHES);
console.log(
  `sweep: offer=${OFFER.id}, ${TERMS.length} terms, budget ${budget} request(s)${DRY ? ' (DRY RUN)' : ''}\n` +
  `plan: ${plan.map((p) => `${p.territory.key} (${p.reason})`).join(' -> ')}`
);

// --- sweep -----------------------------------------------------------------

let searches = 0, seen = 0, inserted = 0, failed = 0, apiErrors = 0;
const rejects = new Map();
const territorySummaries = [];

outer: for (const { territory } of plan) {
  const { queries, skipped } = DRY && !process.env.CLOUDFLARE_API_TOKEN
    ? { queries: territory.towns.flatMap((town) => TERMS.map((term) => ({ town, term }))), skipped: [] }
    : await pendingQueries({ offerId: OFFER.id, territory, terms: TERMS });

  console.log(
    `\n[${territory.key}] ${territory.label}: ${queries.length} query/queries to run` +
    (skipped.length ? `, ${skipped.length} skipped as recently searched or barren` : '')
  );
  if (!queries.length) {
    // Nothing left worth asking here right now. Still record the visit so the
    // rotation moves on instead of picking this territory again next run.
    if (!DRY) {
      const outcome = await recordTerritorySweep({
        offerId: OFFER.id, territory: territory.key, resultsSeen: 0, newLeads: 0,
      });
      territorySummaries.push(`${territory.key}: nothing due${outcome.exhausted ? ' (exhausted)' : ''}`);
    }
    continue;
  }

  let tSeen = 0, tNew = 0;
  for (const { town, term } of queries) {
    if (searches >= budget) {
      console.log('  request budget reached; stopping');
      if (!DRY) {
        await recordTerritorySweep({
          offerId: OFFER.id, territory: territory.key, resultsSeen: tSeen, newLeads: tNew,
          complete: false,
        });
        territorySummaries.push(`${territory.key}: ${tNew} new/${tSeen} seen (partial, resumes next run)`);
      }
      break outer;
    }

    const q = `${term} in ${town}`;
    searches++;
    const places = DRY ? [] : await textSearch(q);
    if (places === null) {
      apiErrors++;
      console.log(`  [${searches}/${budget}] "${q}" -> request failed`);
      continue;
    }
    let qNew = 0;
    console.log(`  [${searches}/${budget}] "${q}" -> ${places.length}`);

    for (const p of places) {
      seen++; tSeen++;
      const reason = rejectReason(p);
      if (reason) { rejects.set(reason, (rejects.get(reason) ?? 0) + 1); continue; }
      const name = p.displayName?.text;
      const { street, city, zip } = parseAddress(p.formattedAddress);
      const fallbackCity = townLabel(town);
      try {
        const rows = await d1(`INSERT INTO leads (place_id, slug, name, city, state, phone, website, maps_url, address_street, address_zip, lat, lng, review_count, rating, primary_type, vertical, source)
          VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(place_id) DO UPDATE SET last_seen_at=datetime('now'), review_count=excluded.review_count, rating=excluded.rating, phone=COALESCE(leads.phone, excluded.phone)
          RETURNING id, first_seen_at = last_seen_at AS is_new`, [
          p.id, slugify(name, city ?? fallbackCity, p.id), name,
          city ?? fallbackCity, 'MI', p.nationalPhoneNumber,
          p.googleMapsUri ?? null, street, zip, p.location?.latitude ?? null,
          p.location?.longitude ?? null, p.userRatingCount ?? null, p.rating ?? null,
          p.primaryTypeDisplayName?.text ?? null, VERTICAL,
          `places:${OFFER.id}:${territory.key}:${term}:${fallbackCity}`,
        ]);
        if (rows[0]?.is_new) { inserted++; tNew++; qNew++; }
      } catch (err) { failed++; console.error(`  insert failed for "${name}": ${err.message}`); }
    }

    if (!DRY) {
      await recordSearch({
        offerId: OFFER.id, territory: territory.key, town, term,
        results: places.length, newLeads: qNew,
      });
    }
  }

  if (!DRY) {
    const outcome = await recordTerritorySweep({
      offerId: OFFER.id, territory: territory.key, resultsSeen: tSeen, newLeads: tNew,
    });
    territorySummaries.push(
      `${territory.key}: ${tNew} new/${tSeen} seen${outcome.exhausted ? ' (now marked exhausted)' : ''}`
    );
    console.log(`  ${territory.key}: ${tNew} new lead(s) from ${tSeen} result(s)`);
  }
}

// --- report ----------------------------------------------------------------

const rejectSummary = [...rejects.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}: ${n}`).join(', ');
// Google Places usage is reported as a request count, never as an invented
// dollar figure. The actual charge depends on the account's free tier and SKU
// pricing, neither of which this process can see.
const billingSummary = `${PLACES_SKU}; ${searches} request(s); current free cap ${PLACES_FREE_MONTHLY_EVENTS} events/SKU/month; actual Google charge not estimated`;

if (!DRY) {
  const { logRun } = await import('./lib/d1.mjs');
  await logRun({
    job: 'places-sweep',
    ok: failed === 0 && apiErrors === 0 ? 1 : 0,
    itemsIn: seen,
    itemsOut: inserted,
    claudeCostCents: 0,
    claudeCostSource: null,
    placesRequests: searches,
    summary: `offer=${OFFER.id}; territories: ${territorySummaries.join('; ') || 'none'}; ` +
      `${searches} searches, ${seen} seen, ${inserted} new; ${billingSummary}; rejected: ${rejectSummary || 'none'}`,
    error: [
      failed ? `${failed} row(s) failed to insert` : null,
      apiErrors ? `${apiErrors} Places request(s) failed` : null,
    ].filter(Boolean).join('; ') || null,
  });
}

console.log(`\ndone. ${searches} searches, ${seen} results, ${inserted} new leads. Google Places: ${billingSummary}.`);
if (failed || apiErrors) process.exitCode = 1;
