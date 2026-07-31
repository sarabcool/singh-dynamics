-- Singh Dynamics, D1 schema
-- Facts live here. Decisions live in git.
--
--   wrangler d1 create singh-dynamics
--   wrangler d1 execute singh-dynamics --remote --file=infra/schema.sql
--
-- Money is stored as INTEGER CENTS everywhere. Never REAL, never TEXT.
-- Floating point arithmetic on currency produces wrong totals, and in a product
-- whose entire pitch is "we find money your accounting missed," that is fatal.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
-- One row per business discovered. Written by the nightly discovery agent,
-- which is Tier A and may insert and score freely. It may never set
-- status='contacted' on its own; only an approved outreach action does that.

CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT    NOT NULL UNIQUE,   -- stable key, also the site folder
  name              TEXT    NOT NULL,
  city              TEXT    NOT NULL,
  state             TEXT    NOT NULL DEFAULT 'MI',

  phone             TEXT,
  email             TEXT,
  website           TEXT,                       -- NULL is the qualifying signal
  facebook_url      TEXT,
  maps_url          TEXT,
  address_street    TEXT,
  address_zip       TEXT,
  lat               REAL,
  lng               REAL,

  vertical          TEXT    NOT NULL DEFAULT 'powersports',
  review_count      INTEGER,                    -- best size proxy found so far
  rating            REAL,

  -- Scoring. Written by the agent, explanation is mandatory so a bad score is
  -- debuggable six months later without rerunning anything.
  score             INTEGER CHECK (score BETWEEN 0 AND 100),
  score_reason      TEXT,
  priority          TEXT    CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  disqualified      INTEGER NOT NULL DEFAULT 0, -- bicycle shop, dealer, chain
  disqualify_reason TEXT,

  status            TEXT    NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','queued','contacted','replied',
                                      'meeting','client','lost','do_not_contact')),

  -- Honoring an opt-out is a legal obligation under CAN-SPAM, 10 business days.
  -- Enforced in code on every send, not just documented here.
  opted_out         INTEGER NOT NULL DEFAULT 0,
  opted_out_at      TEXT,

  source            TEXT,                       -- 'maps:snowmobile repair:Gaylord'
  first_seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status, priority);
CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads(score DESC)
  WHERE disqualified = 0;
CREATE INDEX IF NOT EXISTS idx_leads_city     ON leads(state, city);
CREATE INDEX IF NOT EXISTS idx_leads_nowebsite ON leads(vertical)
  WHERE website IS NULL AND disqualified = 0;

-- ---------------------------------------------------------------------------
-- approval_queue
-- ---------------------------------------------------------------------------
-- Every Tier C action lands here instead of executing. The daily digest renders
-- this table. Nothing in it has happened yet.

CREATE TABLE IF NOT EXISTS approval_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  action_type  TEXT    NOT NULL
               CHECK (action_type IN ('outreach_email','outreach_call_script',
                                      'quote','contract','payment','publish',
                                      'data_delete','pricing_change')),
  lead_id      INTEGER REFERENCES leads(id) ON DELETE CASCADE,

  summary      TEXT    NOT NULL,   -- one line, human scanning 20 of these fast
  payload      TEXT    NOT NULL,   -- JSON, the exact action to execute
  rationale    TEXT    NOT NULL,   -- why the agent proposed it

  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','executed','failed','expired')),
  decided_at   TEXT,
  decided_note TEXT,
  executed_at  TEXT,
  error        TEXT,

  -- Stale proposals are wrong proposals. A draft written against three-week-old
  -- facts should not be executable.
  expires_at   TEXT    NOT NULL DEFAULT (datetime('now','+7 days'))
);

CREATE INDEX IF NOT EXISTS idx_queue_pending ON approval_queue(status, created_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- clients and sites
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id            INTEGER REFERENCES leads(id),
  name               TEXT    NOT NULL,
  contact_name       TEXT,
  contact_email      TEXT,
  contact_phone      TEXT,

  build_fee_cents    INTEGER,           -- integer cents, see header
  retainer_cents     INTEGER,
  retainer_active    INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,

  -- The client owns their domain, in their name, on their card. Deliberate.
  -- Registering it under ours to create lock-in is what makes local web guys
  -- hated and it poisons the referral chain we actually depend on.
  domain             TEXT,
  domain_owned_by_client INTEGER NOT NULL DEFAULT 1,

  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  churned_at         TEXT,
  notes              TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  pages_project TEXT,
  live_url      TEXT,
  theme         TEXT,
  last_built_at TEXT,
  last_deploy_sha TEXT
);

-- ---------------------------------------------------------------------------
-- uptime
-- ---------------------------------------------------------------------------
-- Tier A. A client's site being down is the one failure that loses a retainer,
-- and we should know before they do.

CREATE TABLE IF NOT EXISTS uptime_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  checked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  status_code INTEGER,
  ms          INTEGER,
  ok          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uptime_recent ON uptime_checks(site_id, checked_at DESC);

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------
-- Every autonomous invocation. Answers "what did it do at 3am and what did it
-- cost." Without this, an agent loop with a bug is invisible until the bill.

CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job          TEXT NOT NULL,          -- 'discover-leads', 'uptime', 'digest'
  trigger      TEXT NOT NULL,          -- 'cron','dispatch','manual'
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  ok           INTEGER,
  items_in     INTEGER DEFAULT 0,
  items_out    INTEGER DEFAULT 0,
  cost_cents   INTEGER DEFAULT 0,      -- API spend, integer cents
  gh_run_url   TEXT,
  summary      TEXT,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job, started_at DESC);

-- ---------------------------------------------------------------------------
-- suppression
-- ---------------------------------------------------------------------------
-- Global do-not-contact. Checked before every outbound send, without exception,
-- including manual ones. Survives lead deletion on purpose: if someone opts out
-- and is later rediscovered by the nightly sweep, they stay suppressed.

CREATE TABLE IF NOT EXISTS suppression (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE,
  phone      TEXT UNIQUE,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
