# Singh Dynamics

Software and websites for small local businesses. Michigan.

Two lines: static websites for businesses with no web presence (cash now), and
invoice reconciliation software for small powersports shops (the long game,
still unvalidated as of July 2026).

Read `CLAUDE.md` before touching anything. It is the operating constitution and
it governs both human and autonomous sessions.

---

## Architecture in one paragraph

A Cloudflare Worker is the always-on nervous system: cron, uptime probes,
opt-out handling, and the approval queue. When something needs judgment, it
hands off to GitHub Actions via `repository_dispatch`, where the Claude Agent SDK
runs for as long as it needs with a full toolchain. Facts live in D1. **Decisions
live in git commits**, which gives history, blame, rollback and an audit trail
without a schema. Client sites are static HTML on Cloudflare Pages.

The two-layer split is not a preference. Workers cap at a 15-minute cron and
5 minutes of CPU, so they cannot host a long agent loop. Actions runs six hours
but cannot answer a webhook in 200ms. Each layer does what the other can't.

```
cron / webhook  ->  Cloudflare Worker  ->  repository_dispatch  ->  GitHub Actions
                          |                                              |
                    D1 (facts)                                    git (decisions)
                    approval_queue                                 PR for review
```

---

## Layout

```
CLAUDE.md                    operating rules. read first
agent/discover.mjs           nightly lead enrichment, Agent SDK, Tier A
infra/schema.sql             D1 schema
infra/worker/                Worker: cron, uptime, opt-out, approvals
sites/build.py               static site generator for client sites
sites/shops/*.json           one config per client site
docs/                        architecture, authorization, glossary
.github/workflows/           the jobs that actually run
```

---

## Setup, in order

Nothing here works without the Anthropic API key. Everything else is plumbing.

```bash
# 1. D1
npx wrangler d1 create singh-dynamics
# paste the returned database_id into infra/worker/wrangler.toml
npx wrangler d1 execute singh-dynamics --remote --file=infra/schema.sql

# 2. Worker secrets
cd infra/worker
npx wrangler secret put GITHUB_TOKEN      # fine-grained PAT, this repo only
npx wrangler secret put OPERATOR_TOKEN    # openssl rand -hex 32
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy

# 3. GitHub repo secrets
#    ANTHROPIC_API_KEY, CLOUDFLARE_API_TOKEN,
#    CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID

# 4. Smoke test, no waiting for cron
gh workflow run discover-leads -f max_leads=2
```

**Use a scoped Cloudflare token, never the Global API Key.** Workers Edit,
Pages Edit, D1 Edit, Zone DNS Edit. The Global Key includes billing and domain
transfer access and cannot be narrowed.

---

## Daily operation

One thing lands in your day: the approval digest at 8am ET.

```bash
curl -H "Authorization: Bearer $OPERATOR_TOKEN" https://<worker>/digest
```

Everything in it is a proposal that has not happened. Approve or reject in bulk.
Target is three minutes. Everything else runs without you.

---

## The autonomy boundary

**Runs unattended:** discovery, enrichment, scoring, site generation, staging
deploys, uptime monitoring, drafting, reporting, code changes behind a PR.

**Never runs unattended:** first contact with a stranger, anything quoting a
price or scope, anything moving money, anything signed, anything deleting client
data.

The rule is `automate the reversible, gate the irreversible`. Full reasoning in
`docs/AUTONOMOUS-ARCHITECTURE.md`.

---

## Hard limits worth knowing before you propose a feature

- **No automated SMS or voice.** TCPA is $500 to $1,500 per message, no cap.
- **No automated social DMs.** Platform terms, and it destroys the only real
  edge this business has.
- **No fabricated data on a client site.** Verify or leave it null.
- **Every cold email carries a CAN-SPAM footer.** Physical address, working
  opt-out, honored immediately. Up to $53,088 per violating email.
