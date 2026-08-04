-- Migration 002: real dedup key + storefront verdict
--
-- Two problems this fixes.
--
-- 1. DEDUP. slug was `name-searchTown`, and the search town is where we *looked*,
--    not where the business *is*. Sweeping "motorcycle repair" across Owosso,
--    Flint and Fenton returned Mike's Motorcycle Parts three times, and because
--    the town differed each time the slug differed too, so ON CONFLICT never
--    fired. The DB has three rows for one shop with one phone number. Google
--    already hands us a stable identifier per place; we should have keyed on it.
--
-- 2. STOREFRONT. Places tells us about *pure* service-area businesses (no
--    address at all) and we can filter those for free. It does not tell us that
--    "1042 Maple Ct" is somebody's house. That judgement needs a model, and its
--    verdict needs somewhere to live.
--
--   wrangler d1 execute singh-dynamics --remote --file=infra/migrations/002-storefront.sql

ALTER TABLE leads ADD COLUMN place_id TEXT;
ALTER TABLE leads ADD COLUMN storefront TEXT
  CHECK (storefront IN ('yes','no','unclear'));
ALTER TABLE leads ADD COLUMN storefront_reason TEXT;
ALTER TABLE leads ADD COLUMN primary_type TEXT;

-- Partial unique index rather than a UNIQUE column: the 821 rows already in the
-- table have place_id NULL, and SQLite treats every NULL as distinct in a UNIQUE
-- index, so a plain unique constraint would be satisfied but meaningless. This
-- enforces uniqueness only on rows that actually carry an id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_place_id
  ON leads(place_id) WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_callable
  ON leads(vertical, storefront)
  WHERE website IS NULL AND phone IS NOT NULL AND disqualified = 0;
