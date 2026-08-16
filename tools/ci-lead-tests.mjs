// CI tests for the lead pipeline: territory config, rotation logic and query
// skipping. Pure functions only. Nothing here calls Google, Claude or D1.
//
// Runs in CI through agent/package.json postinstall, and locally with:
//   node tools/ci-lead-tests.mjs --local

import assert from 'node:assert/strict';
import { METRO_DETROIT, assertTerritoriesValid, getTerritory } from '../agent/config/territories.mjs';
import { planTerritories, REVISIT_DAYS, EXHAUSTED_COOLDOWN_DAYS } from '../agent/lib/territory.mjs';

if (process.env.CI !== 'true' && !process.argv.includes('--local')) process.exit(0);

const NOW = Date.parse('2026-08-16T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}\n  ${err.message}`);
    process.exit(1);
  }
}

test('territory config is structurally valid and has no duplicated towns', () => {
  const stats = assertTerritoriesValid(METRO_DETROIT);
  assert.ok(stats.territories >= 15, `expected at least 15 territories, got ${stats.territories}`);
  assert.ok(stats.towns >= 90, `expected at least 90 distinct towns, got ${stats.towns}`);
});

test('every territory names a tier and at least four towns', () => {
  for (const t of METRO_DETROIT) {
    assert.ok(t.tier >= 1 && t.tier <= 4, `${t.key}: tier out of range`);
    assert.ok(t.towns.length >= 4, `${t.key}: only ${t.towns.length} town(s)`);
    for (const town of t.towns) {
      assert.match(town, / MI$/, `${t.key}: "${town}" must end in MI so the Places query is unambiguous`);
    }
  }
});

test('a cold start picks the lowest tier first', () => {
  const plan = planTerritories({ set: METRO_DETROIT, state: new Map(), count: 2, now: NOW });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].territory.tier, 1);
  assert.equal(plan[1].territory.tier, 1);
  assert.equal(plan[0].reason, 'never swept');
});

test('a territory swept yesterday is not swept again', () => {
  const state = new Map(
    METRO_DETROIT.slice(0, 3).map((t) => [t.key, { territory: t.key, last_swept_at: daysAgo(1), sweeps: 1, exhausted: 0, barren_streak: 0 }])
  );
  const plan = planTerritories({ set: METRO_DETROIT, state, count: 3, now: NOW });
  const picked = plan.map((p) => p.territory.key);
  for (const t of METRO_DETROIT.slice(0, 3)) {
    assert.ok(!picked.includes(t.key), `${t.key} was swept yesterday and must not be re-picked`);
  }
});

test('once everything is swept, the oldest non-exhausted territory comes back', () => {
  const state = new Map(
    METRO_DETROIT.map((t, i) => [t.key, {
      territory: t.key,
      last_swept_at: daysAgo(REVISIT_DAYS + i + 1),
      sweeps: 1, exhausted: 0, barren_streak: 0,
    }])
  );
  const plan = planTerritories({ set: METRO_DETROIT, state, count: 1, now: NOW });
  const oldest = METRO_DETROIT[METRO_DETROIT.length - 1].key;
  assert.equal(plan[0].territory.key, oldest);
  assert.match(plan[0].reason, /last swept/);
});

test('an exhausted territory is skipped until its cooldown expires', () => {
  const [first, ...rest] = METRO_DETROIT;
  const state = new Map([
    [first.key, {
      territory: first.key, last_swept_at: daysAgo(REVISIT_DAYS + 10),
      sweeps: 3, exhausted: 1, exhausted_at: daysAgo(10), barren_streak: 2,
    }],
    ...rest.map((t) => [t.key, {
      territory: t.key, last_swept_at: daysAgo(1), sweeps: 1, exhausted: 0, barren_streak: 0,
    }]),
  ]);

  const plan = planTerritories({ set: METRO_DETROIT, state, count: 5, now: NOW });
  assert.equal(plan.length, 0, 'nothing should be due while the only stale territory is exhausted');

  const cooled = new Map(state);
  cooled.set(first.key, { ...state.get(first.key), exhausted_at: daysAgo(EXHAUSTED_COOLDOWN_DAYS + 1) });
  const plan2 = planTerritories({ set: METRO_DETROIT, state: cooled, count: 5, now: NOW });
  assert.equal(plan2[0].territory.key, first.key);
  assert.match(plan2[0].reason, /cooldown/);
});

test('an explicit territory override wins and an unknown key throws', () => {
  const plan = planTerritories({ set: METRO_DETROIT, state: new Map(), count: 3, now: NOW, only: 'macomb-south' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].territory.key, 'macomb-south');
  assert.throws(
    () => planTerritories({ set: METRO_DETROIT, state: new Map(), only: 'not-a-place' }),
    /unknown territory/
  );
});

test('duplicate towns across territories are rejected', () => {
  const broken = [
    { key: 'a', label: 'A', region: 'X', tier: 1, towns: ['Novi MI'] },
    { key: 'b', label: 'B', region: 'X', tier: 1, towns: ['novi mi'] },
  ];
  assert.throws(() => assertTerritoriesValid(broken), /is in both/);
});

test('getTerritory finds a known key and returns null otherwise', () => {
  assert.equal(getTerritory('oakland-west')?.region, 'Oakland');
  assert.equal(getTerritory('nowhere'), null);
});

console.log(`lead pipeline tests passed (${passed})`);
