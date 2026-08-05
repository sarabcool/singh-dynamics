-- Verified Resend inbound email events.
-- Webhook metadata lands here first; the processor retrieves the body from
-- Resend separately so large email bodies and attachments never hit the Worker.

CREATE TABLE IF NOT EXISTS inbound_emails (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  svix_id        TEXT NOT NULL UNIQUE,
  resend_email_id TEXT NOT NULL UNIQUE,
  from_email     TEXT NOT NULL,
  to_json        TEXT NOT NULL,
  subject        TEXT,
  received_at    TEXT NOT NULL,
  lead_id        INTEGER REFERENCES leads(id),
  body_text      TEXT,
  headers_json   TEXT,
  intent         TEXT,
  status         TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received','processed','unmatched','failed')),
  processed_at   TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_status
  ON inbound_emails(status, created_at);

CREATE INDEX IF NOT EXISTS idx_inbound_email_from
  ON inbound_emails(from_email, created_at DESC);
