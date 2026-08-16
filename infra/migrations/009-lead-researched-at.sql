-- 009 researched_at: research each lead once, not every week forever.
--
--   wrangler d1 execute singh-dynamics --remote --file=infra/migrations/009-lead-researched-at.sql
--
-- The weekly research pass selected leads by "no email yet". A shop whose email
-- genuinely is not published anywhere therefore came back to the front of the
-- queue every Sunday and burned budget failing to find it again. This column is
-- the record that we already looked.
--
-- A NULL means never researched. A timestamp older than the re-check window
-- makes the lead eligible again, since a shop can put up a website or close.

ALTER TABLE leads ADD COLUMN researched_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_research_queue
  ON leads(vertical, researched_at)
  WHERE disqualified = 0 AND website IS NULL;
