-- 008 run cost split: stop mixing two different kinds of "cost" in one column.
--
--   wrangler d1 execute singh-dynamics --remote --file=infra/migrations/008-run-cost-split.sql
--
-- `runs.cost_cents` previously held whatever a job felt like putting there. For
-- the sweep that was nothing (correctly, because Google's actual charge is not
-- knowable from inside the job), for classify it was a hand-computed token
-- estimate, and for research it was Claude's reported cost. Reading the table
-- therefore told you very little.
--
-- After this migration:
--   claude_cost_cents  what Claude reported it cost, or a clearly-labelled
--                      token estimate where the API does not report a cost.
--   claude_cost_source 'reported' or 'estimated'. Never guess which one it is.
--   places_requests    Google Places requests issued. A count, not a dollar
--                      figure. Google's real bill depends on the account's free
--                      tier and SKU pricing, which this process cannot see.
--
-- `cost_cents` is left in place and keeps mirroring Claude spend so existing
-- reads and the digest do not break.

ALTER TABLE runs ADD COLUMN claude_cost_cents  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN claude_cost_source TEXT;
ALTER TABLE runs ADD COLUMN places_requests    INTEGER NOT NULL DEFAULT 0;
