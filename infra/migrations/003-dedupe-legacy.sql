-- Migration 003: collapse the pre-place_id duplicates
--
-- READ THIS BEFORE RUNNING. It deletes rows.
--
-- Migration 002 added place_id and a unique index on it, which prevents future
-- duplicates. It did nothing about the ones already in the table, because the
-- 821 existing rows all have place_id NULL and SQLite treats every NULL as
-- distinct in a unique index.
--
-- The damage, confirmed 4 Aug 2026:
--
--   Mike's Motorcycle Parts & Repair | Owosso | (810) 767-9230 | 167 reviews
--   Mike's Motorcycle Parts & Repair | Flint  | (810) 767-9230 | 167 reviews
--   Mike's Motorcycle Parts & Repair | Fenton | (810) 767-9230 | 167 reviews
--
-- One shop, three rows, because the old slug was name + the town we SEARCHED
-- rather than the town the business is IN, and Owosso, Flint and Fenton all
-- returned it. The city column on two of those three rows is simply wrong.
--
-- Why this matters more than tidiness: calling the same shop three times over
-- three weeks, each time opening as though it were a first contact, is exactly
-- the credibility failure that ends a cold-calling relationship. The database
-- would be telling you they had never been contacted, and it would be wrong.
--
-- Phone is the dedup key here, not name. Two genuinely different businesses
-- sharing a landline is rare enough to accept; the same business listed under
-- three towns is already proven.

-- ---------------------------------------------------------------------------
-- STEP 1: look before you delete. Run this alone, first.
-- ---------------------------------------------------------------------------
-- SELECT phone, COUNT(*) AS copies, GROUP_CONCAT(id) AS ids,
--        GROUP_CONCAT(DISTINCT name) AS names,
--        GROUP_CONCAT(city) AS cities
--   FROM leads
--  WHERE phone IS NOT NULL
--  GROUP BY phone
-- HAVING COUNT(*) > 1
--  ORDER BY copies DESC;
--
-- Read the output. If any group holds two names that are plainly different
-- businesses, exclude that phone number from step 2 by hand before running it.

-- ---------------------------------------------------------------------------
-- STEP 2: keep the lowest id per phone, delete the rest.
-- ---------------------------------------------------------------------------
-- Lowest id is the first time the business was seen, which is the row most
-- likely to carry the town it is actually in rather than a town it merely
-- surfaced in. Not guaranteed, but better than random, and the survivor's city
-- is re-verified on the next sweep anyway.
--
-- Rows that have ever been contacted are excluded outright. A row carrying
-- outreach history is not a duplicate to be collapsed, it is a record, and
-- losing it would mean re-contacting someone who has already heard from us.

DELETE FROM leads
 WHERE phone IS NOT NULL
   AND status IN ('new', 'queued')
   AND opted_out = 0
   AND id NOT IN (
     SELECT MIN(id) FROM leads WHERE phone IS NOT NULL GROUP BY phone
   );

-- ---------------------------------------------------------------------------
-- STEP 3: confirm.
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) AS total,
--        COUNT(DISTINCT phone) AS distinct_phones
--   FROM leads WHERE phone IS NOT NULL;
--
-- These two numbers should now be equal, give or take any group you
-- deliberately spared in step 1.
