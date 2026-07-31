# API setup walkthrough

Two keys. One is mandatory, the other is an optimization.

- **Anthropic API.** Without this nothing runs unattended. This is the whole point.
- **Google Places API.** Replaces the manual Maps sweep. Worth doing, not urgent.

Both need an adult with a card. Do them in one sitting.

---

## Part 1. Anthropic API

### Steps

1. **Dad creates the account** at `console.anthropic.com`. Must be 18+. Use an
   email he actually checks, since billing alerts go there.

2. **Add a payment method.** Billing → Payment methods.

3. **Create a Workspace before creating any key.** Settings → Workspaces → Create.
   Name it `singh-dynamics`.

   Do this even though it feels like an extra step. A workspace gets its own
   spend limit and its own keys, so a runaway job can only burn that workspace's
   budget. Keys created at the account level have no such ceiling. This is the
   difference between a bad night costing $30 and costing whatever the card
   allows.

4. **Set the workspace spend limit to $30/month.** Inside the workspace →
   Limits. This is a hard cap, not an alert. Requests fail when it is hit, which
   is exactly the behaviour you want at 3am.

5. **Create the API key** inside that workspace. Name it `singh-dynamics-ci` so
   it is obvious later which key belongs to what.

6. **Copy it once.** It is shown a single time. Paste it straight into GitHub:
   `github.com/sarabcool/singh-dynamics` → Settings → Secrets and variables →
   Actions → New repository secret → name `ANTHROPIC_API_KEY`.

   Do not put it in a file, a note, or a chat message. If it ever leaks, revoke
   and reissue rather than trying to assess the damage.

### What it costs

Enrichment runs on Sonnet, roughly 1 to 3 cents per lead researched. The harness
also carries its own ceiling, `MAX_COST_CENTS=150`, which stops a run at $1.50
regardless of what the workspace limit says. Two independent brakes on purpose.

At 15 leads a night the realistic bill is $5 to $15 a month, well under the $30
cap. The cap exists for the bug you did not anticipate, not the normal case.

---

## Part 2. Google Places API

### Read this before enabling billing

**Google Cloud has no hard spending cap by default.** Budget alerts only send
email. They do not stop anything. A misconfigured loop can run up a bill that you
find out about afterwards.

The actual ceiling is **per-API quotas**, and you have to set them yourself. Skip
this step and you have no protection at all. It is the single most important part
of this section.

### Steps

1. **Create a project.** `console.cloud.google.com` → new project →
   `singh-dynamics`. Sarab's Google account is fine as the owner; Dad's card goes
   on billing.

2. **Link billing.** Billing → Link a billing account.

3. **Enable exactly one API:** APIs & Services → Library → **Places API (New)**.
   Do not bulk-enable the Maps suite. Every enabled API is another way to spend
   money by accident.

4. **Set quotas. Do not skip.** APIs & Services → Places API → Quotas.
   Set requests per day to something you can afford to lose:

   - Text Search: **50/day**
   - Place Details: **200/day**

   At current rates that caps the theoretical worst case around $5/day instead
   of unbounded. Raise it later if a legitimate run hits the ceiling.

5. **Create and restrict the key.** Credentials → Create credentials → API key.
   Then immediately Restrict key:

   - **API restrictions:** Places API only.
   - **Application restrictions:** leave as None.

   None is correct here and it is worth knowing why. GitHub Actions runners have
   rotating IPs, so an IP allowlist would break the job constantly. The API
   restriction is what actually contains the blast radius: a leaked key can only
   call Places, and the quota caps what that costs.

6. **Add a budget alert anyway.** Billing → Budgets → $20/month, alerts at 50%,
   90%, 100%. It will not stop anything, but it tells you something is wrong.

7. **Paste into GitHub secrets** as `GOOGLE_PLACES_API_KEY`.

### What it costs, and the mistake I made

Published rates are roughly **$32 per 1,000 Text Search calls** and **$17 per
1,000 Place Details** calls. Google has historically included a $200 monthly
credit, but I could not confirm it still applies in 2026, so **assume it does
not** and check the console before relying on it.

**I originally specced this as a nightly job. That was wrong and it would have
cost you real money.**

Five search terms across eight towns is 40 Text Search calls. Nightly that is
about $38/month. For what? The set of small powersports repair shops in Michigan
is maybe 200 to 400 businesses and it does not change from Tuesday to Wednesday.
I was paying daily for a static dataset.

**Corrected design:**

| Job | Cadence | Why | Cost |
|---|---|---|---|
| Places sweep | **Weekly**, Sunday 03:00 ET | New shops appear a few times a year, not daily | ~$5/mo |
| Lead enrichment | Nightly | Only touches leads with `score IS NULL`, so it is free on nights with nothing new | $5-15/mo |
| Initial full sweep | **Once**, manual | 200-400 calls to map the whole state | $6-13 one time |

The initial sweep is the right way to start: run it once by hand, get the entire
Michigan universe in one pass, then let the weekly job catch new entrants.

**Use field masks on every request.** Places bills at the highest tier of any
field you ask for, so requesting one expensive field upgrades the whole call.
Request only: `displayName`, `formattedAddress`, `nationalPhoneNumber`,
`websiteUri`, `rating`, `userRatingCount`, `location`. Verify the SKU tier those
land in before the first real run.

### Why the API instead of scraping

Scraping Maps from a datacenter IP is against Google's terms, breaks whenever the
markup changes, and would put the whole system on unstable ground. The API is
legitimate, returns clean JSON, and at weekly cadence costs about the price of a
sandwich. There is no version of this where scraping is the right call.

---

## Part 3. After both keys exist

GitHub repo secrets, final state:

| Secret | From | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic workspace | The brain |
| `GOOGLE_PLACES_API_KEY` | Google Cloud | Discovery |
| `CLOUDFLARE_API_TOKEN` | Cloudflare, **scoped** | D1 and deploys |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard | D1 REST calls |
| `D1_DATABASE_ID` | `wrangler d1 create` output | D1 REST calls |

Scoped Cloudflare token only: Workers Edit, Pages Edit, D1 Edit, Zone DNS Edit.
Never the Global API Key, which includes billing and domain transfers and cannot
be narrowed.

Smoke test without waiting for a cron:

```bash
gh workflow run discover-leads -f max_leads=2
```

Two leads, a few cents. If it opens a PR, the whole path works.

---

## Sources

- [Places API usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Places API pricing breakdown](https://www.woosmap.com/blog/google-places-api-pricing)
