-- 007 territories: remember where the discovery sweep has already looked.
--
-- Before this, sweep.mjs read a hardcoded town list and had no memory, so every
-- weekly run re-searched the same eight towns and mostly rediscovered rows that
-- were already in `leads`. These two tables are the memory.
--
--   wrangler d1 execute singh-dynamics --remote --file=infra/migrations/007-territories.sql
--
-- Coarse memory. One row per (offer, territory). Drives which cluster is next.
CREATE TABLE IF NOT EXISTS territory_state (
  offer_id       TEXT    NOT NULL,
  territory      TEXT    NOT NULL,   -- territory key from agent/config/territories.mjs
  first_swept_at TEXT,
  last_swept_at  TEXT,
  sweeps         INTEGER NOT NULL DEFAULT 0,
  results_seen   INTEGER NOT NULL DEFAULT 0,  -- Places rows looked at, lifetime
  new_leads      INTEGER NOT NULL DEFAULT 0,  -- rows that were new, lifetime

  -- Consecutive sweeps that produced zero new leads. Reset to 0 by any sweep
  -- that produces one. This, not a calendar, is what "exhausted" means here.
  barren_streak  INTEGER NOT NULL DEFAULT 0,
  exhausted      INTEGER NOT NULL DEFAULT 0,
  exhausted_at   TEXT,

  PRIMARY KEY (offer_id, territory)
);

CREATE INDEX IF NOT EXISTS idx_territory_next
  ON territory_state(offer_id, exhausted, last_swept_at);

-- Fine memory. One row per Places request actually issued. This is also the
-- honest record of Google Places request usage: count rows, do not multiply by
-- a list price and call it a bill.
CREATE TABLE IF NOT EXISTS search_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id    TEXT    NOT NULL,
  territory   TEXT    NOT NULL,
  town        TEXT    NOT NULL,
  term        TEXT    NOT NULL,
  searched_at TEXT    NOT NULL DEFAULT (datetime('now')),
  results     INTEGER NOT NULL DEFAULT 0,   -- rows Google returned
  new_leads   INTEGER NOT NULL DEFAULT 0    -- rows that were new to `leads`
);

CREATE INDEX IF NOT EXISTS idx_search_log_pair
  ON search_log(offer_id, territory, town, term, searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_log_recent
  ON search_log(offer_id, searched_at DESC);
