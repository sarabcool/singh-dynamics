# Lead pipeline: territories, research, cost

Operational reference for the auto-shop lead system. Scope and positioning live
in `docs/website-sales/README.md`; this file covers how the pipeline actually
runs and what to do when it misbehaves.

Jargon, defined here because the rule says define it every time:

- **Sweep**: one Google Places discovery pass. Deterministic, no AI.
- **Territory**: a small named cluster of adjacent towns that one sweep covers.
- **Classify**: the Claude pass that decides storefront vs not and scores fit.
- **Research** (also "enrichment"): the Claude pass that re-checks for a website
  and looks for a public business email.
- **Exhausted**: a territory whose last two complete sweeps produced zero new
  leads. Not a permanent state.

---

## The pipeline

```
sweep.mjs            Places discovery in the next territory
  -> classify.mjs    storefront + fit score, Claude
  -> research-weekly-leads.mjs   website re-check + email, Claude
  -> export-weekly-leads.mjs     plain Excel, emailed to the operator inbox
```

Two workflows run it:

| Workflow | Trigger | Use |
|---|---|---|
| `weekly-auto-leads.yml` | Sunday 12:00 UTC, or manual | The normal cadence |
| `more-leads.yml` | Manual only | Ran out of leads before Sunday |

`more-leads.yml` is not scheduled, on purpose. Both share the
`auto-leads-pipeline` concurrency group so two sweeps can never race on
territory state or double the Places bill.

### Getting more leads before Sunday

Actions -> `more-leads` -> Run workflow. Defaults are fine. Inputs:

- `territories`: how many clusters to work. 1 is a normal top-up.
- `territory`: force one cluster by key, for example `macomb-south`. Blank lets
  the rotation choose, which is what you usually want.
- `max_searches`: hard ceiling on Places requests.
- `include_backlog` / `window_days`: how much history the Excel covers.

It applies the same qualification rules as Sunday and emails the same Excel to
the operator inbox. It never contacts a prospect.

---

## Territories

Defined in `agent/config/territories.mjs`. Rotation logic in
`agent/lib/territory.mjs`. State in D1 tables `territory_state` and
`search_log` (migration 007).

Metro Detroit is 17 territories across Oakland, Wayne, Macomb, Detroit,
Livingston, Washtenaw, St. Clair and Monroe. `tier` is sweep order, not
importance: tier 1 is the home base, tier 3 is the outer ring. Lower tiers drain
before higher ones open.

Detroit is split into three area territories rather than being one town. A
Places text search caps at 20 results, so "auto repair shop in Detroit MI" would
render a city of hundreds of independent shops as twenty rows.

**Selection order**, deterministic, same state in gives the same plan out:

1. never swept, lowest tier first
2. due for a revisit (last swept 45+ days ago), oldest first
3. exhausted but past the 180-day cooldown

**Query skipping** inside a territory:

- a (town, term) pair is not repeated within 14 days at all
- a pair that produced no new leads is not repeated for 60 days

**Exhaustion**: two consecutive complete sweeps with zero new leads marks a
territory exhausted. Any sweep that finds a lead resets the streak. Exhausted
territories come back after 180 days, because shops do open.

**Partial sweeps**: if the request budget runs out mid-territory, the run
records what it found but does not stamp `last_swept_at`, so the next run
resumes that territory instead of parking its unsearched half for 45 days.

**Expanding past Metro Detroit** is a data edit. Add entries to
`agent/config/territories.mjs` with a higher tier, or add a new key to
`TERRITORY_SETS` and point the offer at it. No sweep logic changes.

Tuning knobs, all environment variables with sane defaults:
`TERRITORY_REVISIT_DAYS`, `TERRITORY_BARREN_LIMIT`, `TERRITORY_COOLDOWN_DAYS`,
`TERRITORY_BARREN_QUERY_DAYS`, `TERRITORY_MIN_QUERY_GAP_DAYS`.

---

## Research, and the bug that was fixed

Symptom: every lead logged `no structured research result`, the budget was spent,
nothing was enriched. Three defects produced that one line.

1. `permissionMode: 'bypassPermissions'` was set without
   `allowDangerouslySkipPermissions: true`. The Agent SDK only passes
   `--allow-dangerously-skip-permissions` to the CLI when the second option is
   present, so the bypass was never actually enabled and the research tools
   could be denied at runtime.
2. On a non-success result the SDK returns `{ subtype, errors[] }` and no
   `result` string and no `structured_output`. The old code read neither field,
   so `error_max_turns`, `error_max_budget_usd` and
   `error_max_structured_output_retries` all printed the same useless sentence.
3. The JSON contract existed only in the output schema, never in the prompt. When
   structured output failed there was no JSON in the text for the fallback
   parser to find, so the fallback failed too.

Now: the permission flag is set, `maxTurns` is 12, the prompt states the JSON
shape and tells the model that finishing with nulls is a correct answer while
running out of turns is not, every failure names its own cause and turn count,
and CLI stderr is captured and printed on failure.

A lead is researched once. `leads.researched_at` (migration 009) keeps a shop
whose email is genuinely not published from returning to the front of the queue
every Sunday forever. A failed attempt does not set it, so failures retry next
run and show up in the `runs` error column.

### Testing research narrowly

Never run a full Places sweep to test enrichment.

```bash
# See what would be selected and the exact prompt. No API calls.
node agent/research-weekly-leads.mjs --dry-run

# One real lead, one API call, capped.
MAX_COST_CENTS=10 node agent/research-weekly-leads.mjs --lead 123
```

`--lead <id>` bypasses the queue filters so an already-researched lead can be
re-tested. `RESEARCH_MODEL`, `RESEARCH_MAX_TURNS`, `RESEARCH_PER_LEAD_USD` and
`RESEARCH_RECHECK_DAYS` are the other knobs.

---

## Cost accounting

Migration 008 splits `runs` into columns that mean different things:

| Column | Meaning |
|---|---|
| `claude_cost_cents` | Claude spend for the run |
| `claude_cost_source` | `reported` (the API told us) or `estimated` (computed from token counts) |
| `places_requests` | Google Places requests issued. A count, not dollars |
| `cost_cents` | Legacy mirror of Claude spend, kept so existing reads work |

Research reports `reported`, because the Agent SDK returns `total_cost_usd`.
Classify reports `estimated`, because it computes from token counts against list
prices. Never let a reader confuse the two.

Google Places usage is a request count and nothing else. The sweep does not
multiply requests by a list price and call it a bill: the actual charge depends
on the account's free tier and SKU pricing, which the job cannot see. Every
request is also a row in `search_log`, so usage is auditable per town and term.

Hard caps, unchanged in spirit and not to be raised silently:

- classify: `MAX_COST_CENTS` 100 per run
- research: `MAX_COST_CENTS` 75 per run, capped at 150 in code, plus a per-lead
  ceiling of $0.25
- Places: `MAX_SEARCHES` 80 per run

---

## Migrations to apply

```bash
wrangler d1 execute singh-dynamics --remote --file=infra/migrations/007-territories.sql
wrangler d1 execute singh-dynamics --remote --file=infra/migrations/008-run-cost-split.sql
wrangler d1 execute singh-dynamics --remote --file=infra/migrations/009-lead-researched-at.sql
```

Until 007 is applied the sweep treats every territory as fresh and logs why.
Until 008 is applied `logRun` falls back to the legacy column set and says so,
rather than losing the audit row. Both are deliberate: a missing migration
should degrade loudly, not silently.
