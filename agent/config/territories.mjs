/**
 * Search territories for Singh Dynamics discovery sweeps.
 *
 * A territory is a small named cluster of adjacent towns that one sweep covers
 * in a single pass. Territories exist instead of a flat town list for three
 * reasons:
 *
 *   1. Google Places Text Search is billed per request and caps at 20 results.
 *      "auto repair shop in Detroit MI" returns 20 rows for a city of 600k, so
 *      big places have to be split into areas or most of the city is invisible.
 *   2. Sweeping the same eight towns every Sunday exhausts them and then
 *      returns nothing. Rotating through territories keeps finding new rows.
 *   3. Expanding beyond Metro Detroit later should be a data edit, not a code
 *      change. Adding the rest of Michigan means appending entries with a
 *      higher `tier`; nothing else has to change.
 *
 * `tier` is sweep priority, not importance. Tier 1 is the home base Sarab can
 * drive to in twenty minutes, tier 2 is the rest of the tri-county area, tier 3
 * is the outer ring. Sweeps always drain a lower tier before opening a higher
 * one, so the pipeline does not jump to Port Huron while Livonia still has
 * shops in it.
 *
 * Every town appears in exactly one territory. `assertTerritoriesValid()`
 * enforces that, because a town in two territories would be searched twice and
 * quietly double the Places bill.
 */

/** @typedef {{ key: string, label: string, region: string, tier: number, towns: readonly string[] }} Territory */

/** @type {readonly Territory[]} */
export const METRO_DETROIT = Object.freeze([
  // --- Tier 1: home base -----------------------------------------------------
  Object.freeze({
    key: 'oakland-west',
    label: 'Oakland County, west',
    region: 'Oakland',
    tier: 1,
    towns: Object.freeze([
      'Novi MI', 'Wixom MI', 'Walled Lake MI', 'South Lyon MI',
      'New Hudson MI', 'Commerce Township MI', 'Wolverine Lake MI',
    ]),
  }),
  Object.freeze({
    key: 'wayne-northwest',
    label: 'Wayne County, northwest',
    region: 'Wayne',
    tier: 1,
    towns: Object.freeze([
      'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington Hills MI',
      'Farmington MI', 'Canton MI', 'Westland MI', 'Garden City MI',
      'Redford MI',
    ]),
  }),

  // --- Tier 2: the rest of the tri-county core -------------------------------
  Object.freeze({
    key: 'oakland-north',
    label: 'Oakland County, north lakes',
    region: 'Oakland',
    tier: 2,
    towns: Object.freeze([
      'Waterford MI', 'Pontiac MI', 'Auburn Hills MI', 'White Lake MI',
      'Highland MI', 'Milford MI', 'Clarkston MI', 'Lake Orion MI',
    ]),
  }),
  Object.freeze({
    key: 'oakland-central',
    label: 'Oakland County, south central',
    region: 'Oakland',
    tier: 2,
    towns: Object.freeze([
      'Southfield MI', 'Oak Park MI', 'Ferndale MI', 'Royal Oak MI',
      'Berkley MI', 'Madison Heights MI', 'Hazel Park MI', 'Pleasant Ridge MI',
    ]),
  }),
  Object.freeze({
    key: 'oakland-east',
    label: 'Oakland County, east',
    region: 'Oakland',
    tier: 2,
    towns: Object.freeze([
      'Troy MI', 'Rochester Hills MI', 'Rochester MI', 'Clawson MI',
      'Birmingham MI', 'Bloomfield Hills MI', 'Beverly Hills MI',
    ]),
  }),
  Object.freeze({
    key: 'macomb-south',
    label: 'Macomb County, south',
    region: 'Macomb',
    tier: 2,
    towns: Object.freeze([
      'Warren MI', 'Roseville MI', 'Eastpointe MI', 'Saint Clair Shores MI',
      'Center Line MI', 'Fraser MI', 'Clinton Township MI',
    ]),
  }),
  Object.freeze({
    key: 'macomb-north',
    label: 'Macomb County, north',
    region: 'Macomb',
    tier: 2,
    towns: Object.freeze([
      'Sterling Heights MI', 'Utica MI', 'Shelby Township MI',
      'Macomb Township MI', 'Chesterfield MI', 'New Baltimore MI',
      'Washington Township MI',
    ]),
  }),
  Object.freeze({
    key: 'wayne-downriver',
    label: 'Wayne County, downriver',
    region: 'Wayne',
    tier: 2,
    towns: Object.freeze([
      'Taylor MI', 'Southgate MI', 'Wyandotte MI', 'Lincoln Park MI',
      'Allen Park MI', 'Riverview MI', 'Trenton MI', 'Woodhaven MI',
    ]),
  }),
  Object.freeze({
    key: 'wayne-southeast',
    label: 'Wayne County, southeast',
    region: 'Wayne',
    tier: 2,
    towns: Object.freeze([
      'Dearborn MI', 'Dearborn Heights MI', 'Melvindale MI', 'Ecorse MI',
      'River Rouge MI', 'Inkster MI', 'Wayne MI', 'Romulus MI',
    ]),
  }),
  // Detroit is one Places query away from being invisible: a single citywide
  // search returns 20 rows for a city with hundreds of independent shops. It is
  // split by area so each request covers ground a request can actually cover.
  Object.freeze({
    key: 'detroit-west',
    label: 'Detroit, west side',
    region: 'Detroit',
    tier: 2,
    towns: Object.freeze([
      'Grandmont Rosedale Detroit MI', 'Brightmoor Detroit MI',
      'Warrendale Detroit MI', 'Dexter Linwood Detroit MI',
      'Greenfield Grand River Detroit MI',
    ]),
  }),
  Object.freeze({
    key: 'detroit-east',
    label: 'Detroit, east side',
    region: 'Detroit',
    tier: 2,
    towns: Object.freeze([
      'East English Village Detroit MI', 'Jefferson Chalmers Detroit MI',
      'Osborn Detroit MI', 'Conant Gardens Detroit MI',
      'Gratiot Woods Detroit MI',
    ]),
  }),
  Object.freeze({
    key: 'detroit-core',
    label: 'Detroit, core and southwest',
    region: 'Detroit',
    tier: 2,
    towns: Object.freeze([
      'Southwest Detroit MI', 'Corktown Detroit MI', 'Milwaukee Junction Detroit MI',
      'Hamtramck MI', 'Highland Park MI',
    ]),
  }),

  // --- Tier 3: outer ring ----------------------------------------------------
  Object.freeze({
    key: 'livingston',
    label: 'Livingston County',
    region: 'Livingston',
    tier: 3,
    towns: Object.freeze([
      'Brighton MI', 'Howell MI', 'Hartland MI', 'Fowlerville MI',
      'Pinckney MI', 'Whitmore Lake MI',
    ]),
  }),
  Object.freeze({
    key: 'washtenaw',
    label: 'Washtenaw County',
    region: 'Washtenaw',
    tier: 3,
    towns: Object.freeze([
      'Ann Arbor MI', 'Ypsilanti MI', 'Saline MI', 'Chelsea MI',
      'Dexter MI', 'Milan MI', 'Belleville MI',
    ]),
  }),
  Object.freeze({
    key: 'st-clair',
    label: 'St. Clair County and north Macomb edge',
    region: 'St. Clair',
    tier: 3,
    towns: Object.freeze([
      'Port Huron MI', 'Marysville MI', 'Saint Clair MI', 'Algonac MI',
      'Richmond MI', 'Romeo MI', 'Armada MI', 'New Haven MI',
    ]),
  }),
  Object.freeze({
    key: 'monroe',
    label: 'Monroe County',
    region: 'Monroe',
    tier: 3,
    towns: Object.freeze([
      'Monroe MI', 'Flat Rock MI', 'Rockwood MI', 'Carleton MI',
      'Dundee MI', 'South Rockwood MI',
    ]),
  }),
]);

/**
 * Territory sets by name. Expanding past Metro Detroit means adding another key
 * here (for example `'michigan-west'`) and pointing an offer at it, not editing
 * any of the sweep logic.
 */
export const TERRITORY_SETS = Object.freeze({
  'metro-detroit': METRO_DETROIT,
});

export function getTerritorySet(name = 'metro-detroit') {
  const set = TERRITORY_SETS[name];
  if (!set) {
    throw new Error(
      `unknown territory set '${name}'. Known sets: ${Object.keys(TERRITORY_SETS).join(', ')}`
    );
  }
  return set;
}

export function getTerritory(key, set = METRO_DETROIT) {
  return set.find((t) => t.key === key) ?? null;
}

/**
 * Structural checks that would otherwise only show up as a doubled Places bill
 * or a silently skipped town. Called by the sweep on startup and by CI.
 */
export function assertTerritoriesValid(set = METRO_DETROIT) {
  const problems = [];
  const seenKeys = new Set();
  const seenTowns = new Map();

  for (const territory of set) {
    if (!territory.key || !/^[a-z0-9-]+$/.test(territory.key)) {
      problems.push(`bad territory key: ${JSON.stringify(territory.key)}`);
    }
    if (seenKeys.has(territory.key)) problems.push(`duplicate territory key: ${territory.key}`);
    seenKeys.add(territory.key);

    if (!Number.isInteger(territory.tier) || territory.tier < 1) {
      problems.push(`${territory.key}: tier must be a positive integer`);
    }
    if (!territory.towns?.length) problems.push(`${territory.key}: no towns`);

    for (const town of territory.towns ?? []) {
      const norm = town.trim().toLowerCase();
      if (seenTowns.has(norm)) {
        problems.push(`town "${town}" is in both ${seenTowns.get(norm)} and ${territory.key}`);
      }
      seenTowns.set(norm, territory.key);
    }
  }

  if (problems.length) {
    throw new Error(`territory config invalid:\n  - ${problems.join('\n  - ')}`);
  }
  return { territories: set.length, towns: seenTowns.size };
}
