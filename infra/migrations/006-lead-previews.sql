-- Track staging previews for discovered website prospects.
-- Idempotent table creation so this migration is safe to re-run.

CREATE TABLE IF NOT EXISTS lead_previews (
  lead_id          INTEGER PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  preview_url      TEXT NOT NULL,
  config_sha       TEXT,
  built_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lead_previews_built
  ON lead_previews(built_at DESC);
