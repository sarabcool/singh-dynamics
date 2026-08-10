/**
 * Offer definitions for Singh Dynamics discovery.
 *
 * One offer = one vertical = one targeting strategy. They are kept separate,
 * rather than merged into a single catch-all, for three reasons:
 *
 *   1. Search terms, schema.org type and disqualifiers genuinely differ per
 *      trade. A plumber marked up as AutoRepair is wrong, and "residential-only
 *      operation" is a disqualifier for a storefront shop but describes most
 *      landscapers.
 *   2. Google Places Text Search is billed per call. terms x towns is the whole
 *      cost of a sweep, so sweeping one trade at a time is how spend stays
 *      predictable.
 *   3. The active offer is selected explicitly by id, so a workflow run cannot
 *      silently drift onto a different targeting strategy.
 *
 * Select with the OFFER_ID environment variable. Unknown ids throw rather than
 * falling back, because a typo that silently swept the wrong vertical would be
 * expensive and hard to notice.
 */

const TOWNS_CORE = Object.freeze([
  'Novi MI', 'Wixom MI', 'Walled Lake MI', 'South Lyon MI',
  'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington Hills MI',
]);

const TOWNS_FULL = Object.freeze([
  ...TOWNS_CORE,
  'New Hudson MI', 'Milford MI', 'Brighton MI', 'Howell MI',
  'Westland MI', 'Garden City MI', 'Redford MI', 'Dearborn Heights MI',
  'Waterford MI', 'Pontiac MI', 'Auburn Hills MI', 'Rochester Hills MI',
  'Troy MI', 'Madison Heights MI', 'Warren MI', 'Roseville MI',
  'Ferndale MI', 'Oak Park MI', 'Southfield MI', 'Taylor MI',
]);

const SHARED_DISQUALIFIERS = Object.freeze([
  'franchise or national chain',
  'closed business',
  'already has a functioning website',
]);

// Trades are reached at home. Excluding service-area businesses, as the
// storefront offers must, would discard most of the plumbers and nearly all of
// the landscapers we are trying to find.
const TRADE_SCORING = Object.freeze({
  high: 70,
  medium: 45,
  strongSignals: Object.freeze([
    'no website',
    'independent local operator rather than a franchise',
    'established review history without looking like a large chain',
    'services where a phone call is the booking mechanism',
    'serves a defined local area we can name on the page',
  ]),
  disqualifiers: Object.freeze([...SHARED_DISQUALIFIERS, 'national lead-generation directory listing']),
});

export const OFFERS = Object.freeze({
  'metro-detroit-auto-repair': Object.freeze({
    id: 'metro-detroit-auto-repair',
    vertical: 'auto-repair',
    geography: 'Metro Detroit, Michigan',
    audience: 'independent auto repair businesses with a customer-facing location and no website',
    // Storefront trade: customers drive to them, so a pure service-area
    // listing is a signal something is wrong, not a lead.
    serviceArea: false,
    terms: Object.freeze([
      'auto repair shop', 'tire shop', 'transmission repair', 'collision repair',
      'auto body shop', 'quick lube', 'muffler shop', 'brake shop',
    ]),
    townsCore: TOWNS_CORE,
    townsFull: TOWNS_FULL,
    scoring: Object.freeze({
      high: 70,
      medium: 45,
      strongSignals: Object.freeze([
        'no website',
        'independent local business',
        'customer-facing commercial location',
        'services where local search visibility can drive phone calls',
        'established review history without looking like a large chain',
      ]),
      disqualifiers: Object.freeze([
        ...SHARED_DISQUALIFIERS,
        'manufacturer dealership',
        'residential-only operation',
      ]),
    }),
    site: Object.freeze({ schemaType: 'AutoRepair', themes: Object.freeze(['steel', 'pine', 'clay', 'ice']) }),
  }),

  'metro-detroit-hvac': Object.freeze({
    id: 'metro-detroit-hvac',
    vertical: 'hvac',
    geography: 'Metro Detroit, Michigan',
    audience: 'independent heating and cooling contractors with no website, storefront or service-area',
    serviceArea: true,
    terms: Object.freeze([
      'hvac contractor', 'heating and cooling', 'furnace repair',
      'air conditioning repair', 'boiler repair',
    ]),
    townsCore: TOWNS_CORE,
    townsFull: TOWNS_FULL,
    scoring: TRADE_SCORING,
    site: Object.freeze({ schemaType: 'HVACBusiness', themes: Object.freeze(['steel', 'ice', 'clay']) }),
  }),

  'metro-detroit-plumbing': Object.freeze({
    id: 'metro-detroit-plumbing',
    vertical: 'plumbing',
    geography: 'Metro Detroit, Michigan',
    audience: 'independent plumbers with no website, storefront or service-area',
    serviceArea: true,
    terms: Object.freeze([
      'plumber', 'plumbing contractor', 'drain cleaning',
      'water heater installation', 'sewer repair',
    ]),
    townsCore: TOWNS_CORE,
    townsFull: TOWNS_FULL,
    scoring: TRADE_SCORING,
    site: Object.freeze({ schemaType: 'Plumber', themes: Object.freeze(['steel', 'ice', 'pine']) }),
  }),

  'metro-detroit-landscaping': Object.freeze({
    id: 'metro-detroit-landscaping',
    vertical: 'landscaping',
    geography: 'Metro Detroit, Michigan',
    audience: 'independent landscaping and lawn care operators with no website',
    serviceArea: true,
    terms: Object.freeze([
      'landscaping company', 'lawn care service', 'lawn mowing service',
      'snow removal service', 'tree trimming service',
    ]),
    townsCore: TOWNS_CORE,
    townsFull: TOWNS_FULL,
    // schema.org has no Landscaping type. HomeAndConstructionBusiness is the
    // nearest real parent; inventing "LandscapingBusiness" would emit markup
    // Google ignores.
    scoring: TRADE_SCORING,
    site: Object.freeze({ schemaType: 'HomeAndConstructionBusiness', themes: Object.freeze(['pine', 'clay', 'steel']) }),
  }),
});

export const DEFAULT_OFFER_ID = 'metro-detroit-auto-repair';

export function getOffer(id = DEFAULT_OFFER_ID) {
  const offer = OFFERS[id];
  if (!offer) {
    throw new Error(`unknown OFFER_ID '${id}'. Known ids: ${Object.keys(OFFERS).join(', ')}`);
  }
  return offer;
}

// The active offer for this process. Every consumer imports this, so a run
// targets exactly one vertical and says which one in its logs.
export const OFFER = getOffer(process.env.OFFER_ID || DEFAULT_OFFER_ID);

export function offerContext(offer = OFFER) {
  return [
    `Offer id: ${offer.id}`,
    `Target: ${offer.audience}`,
    `Geography: ${offer.geography}`,
    `Strong signals: ${offer.scoring.strongSignals.join('; ')}`,
    `Hard disqualifiers: ${offer.scoring.disqualifiers.join('; ')}`,
  ].join('\n');
}
