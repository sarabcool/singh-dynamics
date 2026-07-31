# Autonomous Architecture

Response to the Autonomous Architecture Mandate.
Written 30 July 2026. Supersedes the "I cannot run in the background" claim
from the 29 July session, which was wrong at the architectural level.

---

## 0. Correction first

Last week I told you I only exist while a turn is running and that there was no
process of mine continuing after you closed the lid.

That is true of **this chat interface**. It is false of **the architecture**.

The Claude Agent SDK runs headless. Point a scheduler at it, give it an API key
and a set of tools, and it runs the same reasoning loop with no human present and
no window open. Your laptop is a client, not the computer. Once the loop lives in
CI or on an edge runtime, closing the lid is irrelevant.

So the limitation was temporary and architectural, not fundamental. You were
right to push on it.

---

## 1. The one thing I am going to argue with

Your mandate says to challenge assumptions, so here is the challenge, and it is
about sequencing rather than ambition.

**An autonomous system is a machine for executing a process at scale. You do not
have a process yet.** You have zero customers, zero revenue, and an unvalidated
hypothesis about powersports shops and parts invoices.

If you build the orchestration layer in August, you spend August encoding
assumptions into infrastructure. Every assumption that turns out wrong becomes
technical debt you have to unwind in October, when you have two hours a week and
no summer left. Automating an unvalidated process does not get you a business. It
gets you wrong answers faster, at higher cost, with more code to maintain.

The counter you will reasonably make is: *if I wait, I never build it.*

Fair. So split the difference along a real line:

**Build the substrate now. Build the decision automation after the tenth manual
repetition.**

The substrate is correct no matter what the business turns out to be: a git repo,
a Cloudflare account, a deploy pipeline, monitoring, secrets management. Cheap,
reusable, zero regret.

The decision automation encodes *what you decided and why*, and you cannot know
that until you have made the decision by hand roughly ten times. The tenth time
is when the pattern is real instead of imagined. That is the trigger, not the
calendar.

This is not a reason to move slowly. It is the reason the system will still be
running in March.

---

## 2. The design principle everything else follows from

> **Automate the reversible. Gate the irreversible.**

Autonomy is not a single dial you turn up. It is a property you grant per action,
and the correct amount is a function of how expensive the mistake is to undo.

This is not a compromise or a safety blanket. It is how every production system
that handles money or strangers is actually built.

### Tier A. Full autonomy, no approval, no notification

Reversible, internal, cheap to undo. Runs unattended, always.

- Lead discovery: Maps sweeps, enrichment, dedupe, scoring
- Site generation from config
- Deploys to staging
- Uptime and performance monitoring of live client sites
- Content and seasonal hours updates on existing client sites
- Research, competitive analysis, reporting, dashboards
- Code changes, committed to a branch and opened as a PR
- Refactoring, test writing, dependency updates
- Drafting anything, as long as it does not send

### Tier B. Autonomous with notification and an undo window

Semi-reversible. Executes immediately, tells you, gives you 30 minutes to revert.

- Production deploys for existing clients
- Google Business Profile post updates for managed accounts
- Routine service email to an **existing** client (invoice reminder, "your site
  is updated", uptime notice)
- Retainer renewal notices

### Tier C. Human approval required, always

Irreversible, legally binding, or reputation-carrying. Queues for you.

- Any first contact with a person who is not already a client
- Anything that quotes a price, commits to scope, or promises a date
- Anything that moves money in either direction
- Anything signed
- Anything that deletes or exposes client data
- Any public post under a client's name
- Any change to pricing, terms, or the offer itself

### The mechanism that makes Tier C cheap: the daily approval batch

The failure mode of a gated system is twenty notifications a day, which is worse
than doing it yourself.

So Tier C actions do not interrupt you. They queue into a single digest rendered
as one page. You open it once a day, approve or reject in bulk, and the
orchestration layer executes everything approved.

**Target: three minutes a day of human input.** That is the honest floor given
the legal constraints below, and it is a real answer to "minimize my
involvement," not a dodge.

---

## 3. Orchestration layer: the comparison you asked for

| Option | Cost | Strengths | Why it loses |
|---|---|---|---|
| **GitHub Actions** | $0 public repo, unlimited. $0 private, 2,000 Linux min/mo | Cron, webhooks via `repository_dispatch`, manual dispatch, secrets built in, full Linux with Python and Node, long-running jobs, every run logged forever, git is the state store | Cold starts. Coarse scheduling. Not suited to sub-minute event response |
| **Cloudflare Workers** + Cron Triggers + Queues + D1 + Durable Objects | $5/mo minimum, includes Pages Functions, KV, Durable Objects. D1 free on both tiers with no egress charges | Genuinely always-on, 1-minute cron minimum, real event-driven, already your product stack, global edge | 5 cron triggers max on paid. 15-minute cron duration ceiling, 5-minute CPU ceiling. Cannot host a long agent loop |
| **n8n self-hosted** | $0 + VPS | Visual glue, many pre-built integrations | You now own a server: patching, uptime, security, backups. Adds ops burden, which is the exact opposite of the objective. And the visual editor's value is that it removes the need to write code, which is not a constraint you have |
| **VPS (Hetzner, ~$4/mo)** | $4/mo | Total control, no time limits | Same ops burden as above, worse. You become a sysadmin at 16 with two hours a week |
| **Zapier / Make** | $20-30/mo | Fast to start | Opaque, rate-limited, expensive at volume, and you cannot version-control a Zap. Wrong layer for a system whose brain writes its own code |

### Recommendation: use two, with a clean split

**Cloudflare Workers is the nervous system. GitHub Actions is the brain's body.**

This is not hedging. It falls directly out of the limits above. A Worker cannot
run a twenty-minute agent loop, because cron triggers cap at 15 minutes and CPU
at 5. A GitHub Actions job can run for six hours with a full filesystem, npm, pip,
and commit access. Conversely, Actions cannot respond to a webhook in 200ms, and
Workers can.

So:

```
        inbound event                    scheduled
   (webhook, form, uptime alert)     (cron, 1 min min.)
                 |                            |
                 v                            v
        +--------------------------------------------+
        |        CLOUDFLARE WORKER (always on)        |
        |  routing, validation, rate limiting, state  |
        |     D1 (facts) + Queues (work) + KV         |
        +--------------------------------------------+
                 |                            |
     trivial /   |                            |  needs reasoning
     deterministic                            |  -> repository_dispatch
                 v                            v
        execute inline               +--------------------------+
        (deploy, log, notify)        |     GITHUB ACTIONS       |
                                     |  Claude Agent SDK, up to |
                                     |  6h, full toolchain      |
                                     +--------------------------+
                                                  |
                        +-------------------------+------------------+
                        v                         v                  v
                 commit + PR              write back to D1     queue Tier C
                 (code, configs,          (decisions, scores)  for daily digest
                  site content)
```

### Git is the state store for decisions, D1 for facts

Facts that change constantly (lead status, uptime, invoice records) go in D1.

**Decisions go in git.** Every judgment I make gets committed with reasoning in
the message. That buys you version history, blame, rollback, diff review, and a
complete audit trail, for free, with no database schema. When something goes
wrong in November you will be able to read exactly what was decided in August and
why. No monitoring product gives you that.

---

## 4. What the law actually permits, which is not what you would guess

This section changes the architecture, so it is not a footnote.

### Cold email: legal, automatable, and the correct primary channel

CAN-SPAM does **not** require prior consent for commercial email. B2B cold
outreach to a business address is lawful in the US provided you follow seven
rules: honest headers, honest subject line, disclosure that it is an ad, a
physical mailing address, a working opt-out, opt-out honored within 10 business
days, and responsibility for anyone sending on your behalf.

Penalty for getting it wrong: up to **$53,088 per email**, no cap.

**The requirement that will bite you: every commercial email needs a real
physical mailing address.** At 16 living at home, that means either your home
address goes out to hundreds of strangers, or you rent a virtual mailbox for
$10-15 a month. Budget for the mailbox. This is not optional and it is the most
commonly skipped rule.

### Cold SMS: do not build this, at any tier of autonomy

TCPA statutory damages are **$500 per message** negligent, **$1,500 per message**
willful, with **no cap on total liability**. The B2B carve-out is far narrower
than people assume: it covers manually dialed calls to verified landlines for
non-marketing purposes. It does not cover automated messages to mobile numbers,
which is what nearly every small shop owner's listed number is.

One automated 200-shop SMS campaign is a theoretical $100,000 to $300,000 of
exposure. This is the single largest liability available to you and it is
entirely avoidable by never building it.

**No autonomous SMS. Not Tier A, not Tier B, not with approval. Just no.**

### Facebook DMs: you said avoid, and the law agrees

Automated DMs violate Meta's terms and get accounts restricted. You wanted to
avoid the channel anyway, which resolves cleanly.

But name the tradeoff honestly: **the smallest shops, which are your best-fit
customers, are exactly the ones with no website and no published email.** Ruling
out Facebook narrows their reachable channels to the phone, which is the least
automatable thing in the entire system.

That has a strategic consequence worth seeing clearly. **It makes the website
wedge more valuable, not less.** A shop whose site you built has an email address
on it, because you put it there. You are not just selling a website. You are
manufacturing the contact channel you will need in 2027 for the invoice product.

### Voice: human only for now

Automated outbound calling pulls in TCPA, state two-party consent recording laws
(Michigan is one-party, but you will be calling other states eventually), and AI
disclosure rules that are tightening. Not worth it at this scale. You make the
calls.

---

## 5. Hard walls that no architecture removes

Per the mandate, each of these is classified rather than merely asserted.

| Wall | Type | Can engineering solve it? | Resolution |
|---|---|---|---|
| Payment processors require 18+ | **Legal, absolute** | No | Dad on the account. LLC with Dad as member, you as operator |
| Anthropic API account requires 18+ | **Legal, absolute** | No | Dad's account and card, you operate it |
| Contracts with a minor are voidable | **Legal, absolute** | No | The LLC contracts, not you personally |
| GBP verification goes to the business | **Platform, absolute** | No | Owner verifies with you on the phone, adds you as manager after |
| First contact with a stranger | **Judgment, deliberate** | Technically yes, strategically no | See below |
| The M0 gate decision | **Judgment, absolute** | No | Ten conversations. Only you |
| Running the system unattended | **Was architectural** | **Yes, solved** | Workers + Actions + Agent SDK |
| Lead discovery at scale | **Was manual** | **Yes, solved** | Tier A, fully autonomous |
| Site production | **Was manual** | **Yes, solved** | `shopsites` generator, already built |

### On automating first contact, which is technically possible

CAN-SPAM permits it. I could build it. I recommend against it for two reasons
that have nothing to do with legality.

**Deliverability.** A new domain sending automated cold email at volume gets
flagged in roughly two weeks. Domain reputation is slow to build and effectively
impossible to recover. You would be spending the one asset that makes the channel
work in order to save minutes.

**The bottleneck is not sending, it is replying.** Automating sends increases
volume you cannot service. If 40 shops reply and you are at an internship until 7
August, the automation has made things worse, not better.

And the strategic point: the reason a message from you works at all is that a
real 16-year-old is asking a real question. That is your entire edge over every
agency spamming these shops. Automating the first touch spends it.

**Correct division: I research and draft 100% of it. You read and send.** That is
roughly 30 seconds per message instead of ten minutes, a 20x reduction, with none
of the downside. Automate the preparation, keep the human on the trigger.

---

## 6. Cost model

| Line | Monthly | Notes |
|---|---|---|
| Cloudflare Workers Paid | $5 | Includes Pages Functions, KV, Durable Objects, Hyperdrive |
| Cloudflare Pages, D1, R2 | $0 | Free at this scale, no D1 egress charges |
| GitHub Actions | $0 | Unlimited on public repos, 2,000 Linux min/mo private |
| Anthropic API | $20-60 | The real variable. Scales directly with how much autonomy you turn on |
| Resend (transactional email) | $0 | Free tier covers 3,000/mo |
| Virtual mailbox (CAN-SPAM address) | $10-15 | Required, not optional |
| Domains | ~$1 | ~$12/yr, and clients buy their own |
| **Total** | **$36-81** | Inside your $100 |

### What to cut from your plan

- **Lovable Pro, $25/mo.** Not needed. It ships client-rendered React with limited
  metadata control, which is the wrong tool for sites whose only job is ranking in
  local search. `shopsites` produces better output at $0. Revisit only if the
  studio needs internal dashboards.
- **n8n cloud, ~$24/mo.** Workers plus Actions covers it and stays in version
  control.
- **Zapier or Make, $20-30/mo.** Same reasoning.
- **A VPS.** Adds a server you have to maintain.

That is roughly $75/mo of avoided spend, which more than funds the API budget
that actually buys you autonomy.

---

## 7. Build sequence

**Now through 7 Aug. Zero infrastructure.**
M0 validation. Ten conversations. Manual on purpose, because these conversations
are what tell the system what to automate. Blocked by your internship, not by
tooling.

**Week of 7 Aug. Substrate, one sitting with Dad.**
LLC and bank started. Cloudflare account and Workers Paid. Anthropic API account.
GitHub org and repo. Resend. Virtual mailbox. All the identity-gated items in one
batch, which is the whole point of batching them.

**Week of 11 Aug. First autonomous loop, exactly one job.**
Agent SDK in GitHub Actions on a nightly cron, doing lead discovery and
enrichment only. Writes results to D1, opens a PR with new shop configs. This is
the safest possible first automation: fully reversible, obviously valuable, and it
proves the entire Worker to Actions to git loop end to end. If it works, every
later job is the same shape.

**Week of 18 Aug. Production pipeline.**
Site generation, staged deploy, uptime monitoring, the daily approval digest.
Tier A and B fully live.

**September onward. Automate what the first ten repetitions proved was actually
repetitive.** Not before.

---

## 8. Where I think your model was already right

Your continuous execution model is sound and I am adopting it as written: an
orchestration layer monitors the business, invokes reasoning with full context
when something needs a decision, and carries out the result with connected tools.
That is the correct shape and it is what the diagram in section 3 implements.

One refinement. In your version the orchestration layer carries out every
decision. In mine it carries out **reversible** decisions immediately and queues
**irreversible** ones into the daily digest. That single change is what keeps the
system legal and keeps a bad inference from costing you a client, at a price of
about three minutes of your day.

---

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers cron trigger limits](https://runhooks.app/blog/cloudflare-workers-cron-triggers-limits/)
- [GitHub Actions billing and free tier](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [GitHub Actions 2026 pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- [CAN-SPAM compliance for cold email](https://litemail.ai/blog/can-spam-compliance-guide-for-cold-email-2026)
- [CAN-SPAM penalties per email](https://tomba.io/blog/can-spam-act-email-marketing)
- [TCPA SMS compliance and B2B carve-out](https://www.text-em-all.com/blog/sms-compliance-checklist-for-tcpa-safe-business-messaging)
- [TCPA statutory damages](https://messageiq.io/blogs/avoid-costly-fines-a-guide-to-tcpa-and-can-spam-for-sms-marketing/)
