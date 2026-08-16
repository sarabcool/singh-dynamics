/**
 * Territory rotation and search memory.
 *
 * The pipeline used to sweep the same eight towns every Sunday. After a few
 * runs those towns are exhausted: every independent shop without a website has
 * already been found, so the sweep spends its Places budget rediscovering rows
 * that are already in D1. This module is the memory that stops that.
 *
 * Two levels of memory, deliberately:
 *
 *   territory_state  coarse. "Have we worked this cluster, when, and did the
 *                    last passes produce anything?" Drives which cluster is
 *                    next.
 *   search_log       fine. One row per (town, term) request. Drives which
 *                    individual queries inside a cluster are worth repeating.
 *
 * Nothing here weakens a qualification filter. It only decides where to look
 * and where not to look again yet.
 */

import { d1 } from './d1.mjs';
import { getTerritorySet, assertTerritoriesValid } from '../config/territories.mjs';

/** A territory is re-swept only after this many days, so weekly runs move on. */
export const REVISIT_DAYS = Number(process.env.TERRITORY_REVISIT_DAYS) || 45;

/** Consecutive zero-new-lead sweeps before a territory is marked exhausted. */
export const BARREN_STREAK_LIMIT = Number(process.env.TERRITORY_BARREN_LIMIT) || 2;

/** An exhausted territory is retried this long after, since shops do open. */
export const EXHAUSTED_COOLDOWN_DAYS = Number(process.env.TERRITORY_COOLDOWN_DAYS) || 180;

/** A (town, term) pair that produced nothing is not repeated inside this window. */
export const BARREN_QUERY_DAYS = Number(process.env.TERRITORY_BARREN_QUERY_DAYS) || 60;

/** No (town, term) pair is repeated inside this window, productive or not. */
export const MIN_QUERY_GAP_DAYS = Number(process.env.TERRITORY_MIN_QUERY_GAP_DAYS) || 14;

export async function loadTerritoryState(offerId) {
  const rows = await d1(
    `SELECT territory, last_swept_at, sweeps, results_seen, new_leads,
            barren_streak, exhausted, exhausted_at
       FROM territory_state WHERE offer_id=?`,
    [offerId]
  );
  return new Map(rows.map((r) => [r.territory, r]));
}

function daysSince(iso, now) {
  if (!iso) return Infinity;
  // D1 stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' in UTC.
  const parsed = Date.parse(`${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed)) return Infinity;
  return (now - parsed) / 86_400_000;
}

/**
 * Choose which territories this run should sweep, in order.
 *
 * Preference order, and the reason for each step:
 *   1. never swept, lowest tier first        fresh ground close to home
 *   2. due for a revisit, oldest first       new shops open, old ones close
 *   3. exhausted but past cooldown           last resort, better than nothing
 *
 * Deterministic: same state in, same plan out. A dry run therefore tells you
 * exactly what a real run would do.
 */
export function planTerritories({
  set,
  state,
  count = 1,
  now = Date.now(),
  only = null,
}) {
  const territories = set;
  if (only) {
    const picked = territories.find((t) => t.key === only);
    if (!picked) {
      throw new Error(
        `unknown territory '${only}'. Known: ${territories.map((t) => t.key).join(', ')}`
      );
    }
    return [{ territory: picked, reason: 'explicitly requested' }];
  }

  const annotated = territories.map((t) => {
    const s = state.get(t.key) ?? null;
    return {
      territory: t,
      state: s,
      swept: Boolean(s?.last_swept_at),
      age: daysSince(s?.last_swept_at, now),
      exhausted: Boolean(s?.exhausted),
    };
  });

  const fresh = annotated
    .filter((a) => !a.swept)
    .sort((a, b) => a.territory.tier - b.territory.tier);

  const due = annotated
    .filter((a) => a.swept && !a.exhausted && a.age >= REVISIT_DAYS)
    .sort((a, b) => b.age - a.age);

  const cooled = annotated
    .filter((a) => a.exhausted && daysSince(a.state?.exhausted_at, now) >= EXHAUSTED_COOLDOWN_DAYS)
    .sort((a, b) => b.age - a.age);

  const plan = [
    ...fresh.map((a) => ({ territory: a.territory, reason: 'never swept' })),
    ...due.map((a) => ({
      territory: a.territory,
      reason: `last swept ${Math.round(a.age)} days ago`,
    })),
    ...cooled.map((a) => ({
      territory: a.territory,
      reason: `exhausted but past ${EXHAUSTED_COOLDOWN_DAYS}-day cooldown`,
    })),
  ];

  return plan.slice(0, Math.max(1, count));
}

/**
 * The (town, term) queries worth running inside a territory right now.
 *
 * Skips a pair when it was searched too recently, and skips it for much longer
 * when the last search produced no new leads. This is the difference between
 * "we already looked there" and "there is nothing there."
 */
export async function pendingQueries({ offerId, territory, terms, now = Date.now() }) {
  const history = await d1(
    `SELECT town, term, MAX(searched_at) AS searched_at,
            SUM(new_leads) AS new_leads_total
       FROM search_log
      WHERE offer_id=? AND territory=?
      GROUP BY town, term`,
    [offerId, territory.key]
  );

  const lastByPair = new Map(
    history.map((r) => [`${r.town}\u0000${r.term}`, r])
  );

  const queries = [];
  const skipped = [];
  for (const town of territory.towns) {
    for (const term of terms) {
      const prior = lastByPair.get(`${town}\u0000${term}`);
      if (prior) {
        const age = daysSince(prior.searched_at, now);
        if (age < MIN_QUERY_GAP_DAYS) {
          skipped.push({ town, term, reason: `searched ${Math.round(age)}d ago` });
          continue;
        }
        if (Number(prior.new_leads_total ?? 0) === 0 && age < BARREN_QUERY_DAYS) {
          skipped.push({ town, term, reason: `no new leads, ${Math.round(age)}d ago` });
          continue;
        }
      }
      queries.push({ town, term });
    }
  }
  return { queries, skipped };
}

export async function recordSearch({ offerId, territory, town, term, results, newLeads }) {
  await d1(
    `INSERT INTO search_log (offer_id, territory, town, term, results, new_leads)
     VALUES (?,?,?,?,?,?)`,
    [offerId, territory, town, term, results, newLeads]
  );
}

/**
 * Close out a territory sweep. `newLeads` of zero increments the barren streak;
 * anything above zero resets it, because a territory that just produced a lead
 * is plainly not exhausted.
 */
export async function recordTerritorySweep({ offerId, territory, resultsSeen, newLeads, complete = true }) {
  if (!complete) {
    // The request budget ran out part way through this territory. Count what we
    // found, but do not stamp last_swept_at: the territory is not finished, and
    // stamping it would park the unsearched half of the towns for a full
    // revisit window. Leaving the stamp alone means the rotation picks this
    // territory again next run and pendingQueries resumes where it stopped.
    await d1(
      `INSERT INTO territory_state
         (offer_id, territory, first_swept_at, last_swept_at, sweeps,
          results_seen, new_leads, barren_streak, exhausted)
       VALUES (?,?,datetime('now'),NULL,0,?,?,0,0)
       ON CONFLICT(offer_id, territory) DO UPDATE SET
         results_seen = territory_state.results_seen + excluded.results_seen,
         new_leads    = territory_state.new_leads + excluded.new_leads`,
      [offerId, territory, resultsSeen, newLeads]
    );
    return { barrenStreak: 0, exhausted: false, complete: false };
  }

  const existing = await d1(
    `SELECT barren_streak FROM territory_state WHERE offer_id=? AND territory=?`,
    [offerId, territory]
  );
  const priorStreak = Number(existing[0]?.barren_streak ?? 0);
  const streak = newLeads > 0 ? 0 : priorStreak + 1;
  const exhausted = streak >= BARREN_STREAK_LIMIT ? 1 : 0;

  await d1(
    `INSERT INTO territory_state
       (offer_id, territory, first_swept_at, last_swept_at, sweeps,
        results_seen, new_leads, barren_streak, exhausted, exhausted_at)
     VALUES (?,?,datetime('now'),datetime('now'),1,?,?,?,?,
             CASE WHEN ?=1 THEN datetime('now') ELSE NULL END)
     ON CONFLICT(offer_id, territory) DO UPDATE SET
       last_swept_at = datetime('now'),
       sweeps        = territory_state.sweeps + 1,
       results_seen  = territory_state.results_seen + excluded.results_seen,
       new_leads     = territory_state.new_leads + excluded.new_leads,
       barren_streak = excluded.barren_streak,
       exhausted     = excluded.exhausted,
       exhausted_at  = CASE WHEN excluded.exhausted=1
                              THEN COALESCE(territory_state.exhausted_at, datetime('now'))
                            ELSE NULL END`,
    [offerId, territory, resultsSeen, newLeads, streak, exhausted, exhausted]
  );

  return { barrenStreak: streak, exhausted: Boolean(exhausted), complete: true };
}

export function territorySetFor(offer) {
  const set = getTerritorySet(offer.territorySet ?? 'metro-detroit');
  assertTerritoriesValid(set);
  return set;
}
