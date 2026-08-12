# Singh Dynamics, operating rules

Read this first, every session, headless or interactive. It is the constitution.
If anything below conflicts with a request in the moment, raise the conflict
rather than silently picking a side.

---

## What this company is

Singh Dynamics builds autonomous back-office software that performs repetitive
business work while deterministic policy gates keep real business decisions under
human control.

Singh Dynamics runs **three parallel subchannels**, not a single product with
legacy leftovers. None of the three is "the real business" with the others as
side projects or history. Each has its own source-of-truth doc. Do not delete,
deprioritize, or fold one into another without Sarab explicitly saying so.

### Subchannel 1: Website Sales

Building and selling websites, plus lead generation, for local businesses (car
detailing, computer repair, and similar shops). This is the original Singh
Dynamics business.

The source of truth is `docs/website-sales/README.md`. Read it before any
Website Sales work.

### Subchannel 2: Singh AR

A B2B accounts-receivable operations agent. A customer connects QuickBooks
Online and a business mailbox. Singh AR monitors unpaid invoices, performs
routine follow-up, understands replies, records payment promises, verifies
payment state, and escalates only decisions outside the customer's configured
authority policy.

The source of truth is `docs/singh-ar/`. Read those files before any Singh AR
implementation work.

V1 is commercial B2B invoice workflow software, not consumer debt collection.
Do not build consumer collections, legal threats, credit reporting, autonomous
fee invention, debt purchasing, or money movement into V1.

### Subchannel 3: Website QC

A structural integrity and generator-artifact reviewer for AI-generated
websites, not a broad AI visual-design or taste engine. Prioritize specific,
checkable defects such as dead framework classes, fragile external assets, UI
copy/handler mismatches, missing structural sections, dead or duplicate
components, and uncontrolled failure states. Prefer small patches a skeptical
reviewer can verify quickly. Do not patch subjective taste merely to produce a
change.

The source of truth is `docs/website-qc/README.md`. Read it before Website QC
implementation or product-positioning work.

Two independent real-repo validation passes are done (Lovable-family output,
then Bolt.new), both successful, current decision is proceed to the smallest
local reviewer harness. Do not build Website QC auth, billing, SaaS tenancy, a
dashboard, or unrelated infrastructure at this stage. Do not claim continuous
monitoring is validated; the current evidence is one snapshot per repo tested.

### Shared infrastructure, not shared identity

All three subchannels may reuse the same Cloudflare/D1/GitHub Actions stack
where it genuinely fits. Reusing infrastructure does not make one subchannel
subordinate to another, and a decision made for one subchannel's convenience
must not silently constrain or deprioritize the other two.

Every design decision must minimize ongoing operator work. A system that requires
constant manual babysitting has failed the product goal.

---

## The rule that governs everything else

> **Automate the reversible. Gate the irreversible.**

Autonomy is granted per action, and the amount is a function of how expensive the
mistake is to undo. This is not caution, it is how systems that touch money and
strangers are built.

### Tier A. Act freely. No approval, no notification.

Discovery, enrichment, scoring, dedupe. Site generation. Staging deploys.
Monitoring. Research and reporting. Drafting anything that does not send. Code
changes on a branch behind a PR. Refactors, tests, dependency updates.

### Tier B. Act, then notify. Thirty-minute undo window.

Production deploys for existing clients. GBP post updates on managed accounts.
Routine service email to an **existing** client. Renewal notices.

### Tier C. Queue for human approval. Always. No exceptions.

First contact with anyone who is not already a client. Anything quoting a price,
scope, or date. Anything moving money. Anything signed. Anything deleting or
exposing client data. Any public post under a client's name. Any change to
pricing, terms, or the offer.

Tier C actions do **not** interrupt. They queue into `approval_queue` and surface
in one daily digest. Target: three minutes of human input per day.

### Singh AR product authority

Singh AR has a tenant-specific policy gateway documented in
`docs/singh-ar/POLICY-ENGINE.md`. Routine follow-up to an existing business
customer about a verified commercial invoice may execute autonomously only when
the deterministic gateway returns `ALLOW`. The LLM cannot grant itself authority.
Any dispute, change to payment terms, waiver, discount, settlement, invented fee,
legal escalation, or action outside configured limits requires approval or is
blocked. A source invoice marked paid, void, disputed, paused, or stale must never
receive an automated reminder.

---

## Hard prohibitions

These are not defaults to be overridden. Do not build them, do not propose
building them, do not build them if asked without first restating the reason.

- **No automated SMS or voice.** TCPA damages are $500 per message negligent,
  $1,500 willful, no cap. The B2B carve-out covers manually dialed verified
  landlines for non-marketing purposes only. It does not cover us.
- **No automated Facebook, Instagram, or LinkedIn messaging.** Violates platform
  terms, gets accounts restricted, and destroys the only real edge we have.
- **No fabricated data. Ever.** No invented phone numbers, addresses, hours,
  reviews, or testimonials on a real business's site. Quote reviews verbatim or
  omit the section. A wrong phone number on a client's site is the fastest way to
  lose them and everyone they would have referred.
- **No `aggregateRating` schema markup from scraped Google reviews.** Violates
  Google's guidelines, risks a manual action against the client.
- **No sending cold email without the CAN-SPAM footer.** Physical address, working
  opt-out, honest headers, ad disclosure. Up to $53,088 per violating email.
- **No secrets in files, logs, commits, or chat.** They live in GitHub Actions
  secrets and Worker secrets only.
- **No Cloudflare Global API Key.** Scoped tokens only: Workers Edit, Pages Edit,
  D1 Edit, Zone DNS Edit.

---

## Communication rules

- **Define jargon on first use in every session.** Do not assume shorthand from a
  previous conversation landed. See `docs/GLOSSARY.md`. This rule exists because
  it was violated and it cost real confusion.
- **No em dashes in anything a human will read.** Client copy, email, docs, chat.
- **State uncertainty as uncertainty.** "I have not verified this" is always
  better than a confident wrong answer. Sarab catches errors and expects to be
  able to trust the ones he does not catch.
- **Lead with the finding, not the process.** What changed, what it means, what
  it costs. Not a narration of the work.
- **Correct prior errors explicitly when found.** Do not quietly revise.

---

## Sequencing discipline

Build the substrate early. Build decision automation **after the tenth manual
repetition** of the decision, never before.

Automating an unvalidated process does not produce a business. It produces wrong
answers faster and more code to maintain. The tenth repetition is when the pattern
is real rather than imagined. That is the trigger, not the calendar.

The corollary: when asked to automate something that has been done fewer than ten
times by hand, say so and propose the manual version instead.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Always-on events | Cloudflare Workers, cron + queues | 1-min cron, edge, cheap. Free tier until we hit a limit |
| Reasoning jobs | GitHub Actions + Claude Agent SDK | Workers cap at 15-min cron and 5-min CPU. Actions runs 6h with a full toolchain |
| Facts | Cloudflare D1 | Free, no egress charges, already in stack |
| Decisions | **Git commits** | History, blame, rollback, diff review, audit trail. No schema needed |
| Client sites | Static HTML on Cloudflare Pages | $0, instant, indexes properly |
| Customer mailbox | Gmail / Google Workspace first | Send from the customer's own mailbox and preserve real threads |
| Internal/operator email | Resend | Existing transactional infrastructure |
| AR source | QuickBooks Online first | Invoice/customer/payment source of truth with OAuth, webhooks, and sandbox testing |
| Payments | Stripe Billing | Singh Dynamics subscription billing; Stripe Invoicing is a later AR connector |

**Production orchestration:** direct APIs, Cloudflare Workers, D1, and GitHub
Actions remain the default. Zapier MCP is allowed for development coordination
and connected-account agent actions, but Singh AR customer runtime must not depend
on Sarab's personal Zapier connection. Avoid adding n8n, Make, or a VPS without a
concrete requirement that the existing stack cannot meet.

---

## Repo layout

One repo, three subchannels, each with its own docs folder as source of truth.
Shared infrastructure (`agent/`, `infra/`, `.github/workflows/`) is reused
across subchannels where it fits; it is not owned by any one of them.

```
agent/                 Agent SDK harnesses invoked by GitHub Actions
infra/
  schema.sql           D1 schema
  worker/               Cloudflare Worker, cron and dispatch
sites/                 Static site generator for client sites (Website Sales)
site/                  Marketing site source (Website Sales)
docs/
  website-sales/        Website Sales scope, status, protocol (source of truth)
  singh-ar/             Singh AR scope, architecture, policy engine (source of truth)
  website-qc/           Website QC scope, evidence, validation protocol (source of truth)
  (other docs)          Shared infra docs: authorization, DNS, API keys, glossary
.github/workflows/
```

Website QC's reviewer harness, when implementation starts, lives in `agent/`
alongside the other two subchannels' harnesses, not in a separate repo.

---

## Definition of done

A change is done when it is committed, the build passes, the change is reflected
in the docs it affects, and any decision behind it is written down with its
reasoning. A decision that only exists in a chat transcript does not exist.
