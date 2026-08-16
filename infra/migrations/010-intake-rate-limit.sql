-- 010 intake rate limit: give /intake something to throttle on.
--
--   wrangler d1 execute singh-dynamics --remote --file=infra/migrations/010-intake-rate-limit.sql
--
-- Until now nothing on any site posted to /intake, so its missing rate limit was
-- unexploitable in practice. The sales page now has a real form, so it is
-- exploitable: every accepted POST fires a GitHub repository_dispatch and burns
-- Actions minutes.
--
-- A SALTED HASH, not the address. We do not need to know who someone is to stop
-- them submitting the form two hundred times, and storing raw visitor IPs for a
-- contact form is more personal data than this business has any reason to hold.
-- The salt is the Worker's existing secret, so the column is useless on its own.

ALTER TABLE inquiries ADD COLUMN ip_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_inquiries_ip_recent
  ON inquiries(ip_hash, created_at DESC);
