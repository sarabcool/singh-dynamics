export const OFFER = Object.freeze({
  id: 'metro-detroit-auto-repair',
  vertical: 'auto-repair',
  geography: 'Metro Detroit, Michigan',
  audience: 'independent auto repair businesses with a customer-facing location and no website',
  terms: [
    'auto repair shop',
    'tire shop',
    'transmission repair',
    'collision repair',
    'auto body shop',
    'quick lube',
    'muffler shop',
    'brake shop',
  ],
  townsCore: [
    'Novi MI', 'Wixom MI', 'Walled Lake MI', 'South Lyon MI',
    'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington Hills MI',
  ],
  townsFull: [
    'Novi MI', 'Wixom MI', 'Walled Lake MI', 'South Lyon MI',
    'Northville MI', 'Plymouth MI', 'Livonia MI', 'Farmington Hills MI',
    'New Hudson MI', 'Milford MI', 'Brighton MI', 'Howell MI',
    'Westland MI', 'Garden City MI', 'Redford MI', 'Dearborn Heights MI',
    'Waterford MI', 'Pontiac MI', 'Auburn Hills MI', 'Rochester Hills MI',
    'Troy MI', 'Madison Heights MI', 'Warren MI', 'Roseville MI',
    'Ferndale MI', 'Oak Park MI', 'Southfield MI', 'Taylor MI',
  ],
  scoring: Object.freeze({
    high: 70,
    medium: 45,
    strongSignals: [
      'no website',
      'independent local business',
      'customer-facing commercial location',
      'services where local search visibility can drive phone calls',
      'established review history without looking like a large chain',
    ],
    disqualifiers: [
      'franchise or national chain',
      'manufacturer dealership',
      'closed business',
      'residential-only operation',
      'already has a functioning website',
    ],
  }),
  site: Object.freeze({
    schemaType: 'AutoRepair',
    themes: ['steel', 'pine', 'clay', 'ice'],
  }),
});

export function offerContext() {
  return [
    `Offer id: ${OFFER.id}`,
    `Target: ${OFFER.audience}`,
    `Geography: ${OFFER.geography}`,
    `Strong signals: ${OFFER.scoring.strongSignals.join('; ')}`,
    `Hard disqualifiers: ${OFFER.scoring.disqualifiers.join('; ')}`,
  ].join('\n');
}
