# Website Sales

Website Sales is one of Singh Dynamics's three parallel subchannels (alongside Singh AR and Website QC, see `CLAUDE.md`). It is the original Singh Dynamics business and stays first-class, not legacy, not deprioritized, not folded into either of the other two.

## One-line product

Build and sell fast, real websites to local businesses that don't have one (or have a bad one), using cold outreach: show up with a working demo site before asking for money.

## Product principle

**Show the work before asking for the sale.** A real, working demo site with the shop's actual name and number is the pitch. No promises about ranking or results, a fast site with their number on it plus a properly configured Google Business Profile listing is the deliverable, and it is enough.

## Target customer

Local Michigan service businesses with no web presence or a broken one: auto shops, computer repair, similar trades. Sourced by a Google Places sweep that filters for operational businesses, with a phone number, not home-based, and no existing website.

## Existing infrastructure

- `site/sales/index.html`: this subchannel's own marketing site, served at `sales.singhdynamics.com`. Moved here from the repo-root `site/index.html` on 12 August 2026 when `singhdynamics.com` became a holding page for all three subchannels instead of this pitch directly. See `docs/MARKETING-SITES.md`.
- `agent/discover.mjs`, `agent/sweep.mjs`, `agent/classify.mjs`: lead discovery and enrichment (Agent SDK, Tier A, runs unattended).
- `sites/build.py`, `sites/shops/*.json`: static site generator, one config per client site.
- `infra/worker/`: Cloudflare Worker, cron, uptime probes, opt-out handling, approval queue.
- `infra/schema.sql`: D1 tables for leads, approval queue, clients, sites, uptime checks.
- Email/DNS: SPF, DKIM, DMARC configured on `singhdynamics.com`; `billing@` alias live.

## Source-of-truth docs

- `docs/AUTHORIZATION-CHECKLIST.md`: every account, key, and recurring cost needed to run this unattended.
- `docs/AUTONOMOUS-ARCHITECTURE.md`: how the Worker/Actions split lets discovery and site generation run unattended.
- `docs/COLD-OUTREACH-SITE-STANDARD.md`: default scope for a prospect demo site (multi-page, not a one-pager).
- `docs/DNS-RECORDS.md`: DNS configuration for `singhdynamics.com`.
- `docs/SETUP-API-KEYS.md`: Anthropic and Google Places API setup.

## Status as of last verified session (4 August 2026)

Stated plainly because it matters more than the infrastructure list above: **zero demo sites built, zero prospect calls made**, as of the last session with direct visibility into this subchannel. Everything above is real, working plumbing. None of it has produced a dollar yet.

At that point: a Google Places sweep had found roughly 138 verified prospects without a website. Email sending was set up but SPF had a gap (fixed, not re-verified). Three competing website artifacts existed for the Singh Dynamics marketing site itself (a Cloudflare Pages static build, a Worker-hosted SSR build, and a rebuilt static HTML file), unresolved which one is canonical, blocking the custom domain going live.

This status has **not been re-verified** in the current session. Before doing more Website Sales work, check current state directly (Cloudflare dashboard, recent commits, whether any calls have been logged) rather than assuming this is still accurate.

## What actually moves this forward

Per the repository's own sequencing discipline: building more automation before the tenth sale is guessing, not validating. The next three actions, unchanged since 4 August and still the honest next step until someone reports they've been done:

1. Confirm the SPF/DNS fix actually verifies (two-minute test).
2. Build one real demo site by hand for a specific named prospect.
3. Call them. Then four more.

Everything else on this list is infrastructure, not revenue.
