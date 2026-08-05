-- Public website inquiries are separate from discovered leads.
-- A person who asks us to build a site is an inbound prospect, not a scraped lead.

CREATE TABLE IF NOT EXISTS inquiries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  shop_name    TEXT NOT NULL,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  city         TEXT,
  notes        TEXT,
  source       TEXT NOT NULL DEFAULT 'singhdynamics.com',
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','reviewed','contacted','client','closed','spam')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status
  ON inquiries(status, created_at DESC);
