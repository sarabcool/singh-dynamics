# Singh AR

Singh AR is one of Singh Dynamics's three parallel subchannels (alongside Website Sales and Website QC, see `CLAUDE.md`), not a replacement for the others: software that handles routine business-to-business accounts receivable follow-up with a policy gateway between AI judgment and external action.

## One-line product

Connect QuickBooks Online and a business mailbox. Singh AR watches open invoices, follows up on overdue balances, understands replies, records promises, verifies payments, and asks a human only when a real business decision is required.

## Product principle

**Automate the administrative work. Gate changes to business terms.**

The model may classify, summarize, draft, and propose. A deterministic policy engine decides whether a proposed action is allowed, requires approval, or is prohibited. The model never bypasses that engine.

## V1 scope

V1 supports commercial B2B invoices only. It is not a consumer debt collection product. It does not purchase debt, threaten legal action, report to credit bureaus, invent fees, waive balances, or negotiate outside owner-defined authority.

Federal FDCPA rules generally focus on consumer debts rather than business debts, but state and other laws can still matter. Before public launch, Singh Dynamics must get appropriate legal review for target states and customer types.

## First integrations

1. QuickBooks Online: source of truth for customers, invoices, balances, due dates, and payment state.
2. Gmail / Google Workspace: send and receive customer communication from the customer's own mailbox.
3. Stripe Billing: Singh Dynamics subscription billing. Later, Stripe Invoicing can become a second AR source connector.

## Existing infrastructure reused

- Cloudflare Workers for always-on webhooks, routing, and scheduled reconciliation.
- Cloudflare D1 for tenants, invoices, AR cases, events, policies, and audit state.
- GitHub Actions for long reasoning or maintenance jobs.
- Existing inbound email classification and thread-preservation patterns.
- Existing approval queue pattern, generalized to tenant-specific decision requests.
- Existing CI and deployment pipeline.
- Shared Agent Coordination Doc for Claude and ChatGPT handoffs.

The Website Sales code (`site/`, `sites/`, parts of `agent/`, `infra/worker/`) is a separate active subchannel, not legacy. Do not delete or deprioritize it; see `docs/website-sales/README.md`.

## Source-of-truth docs

- `V1-SPEC.md`: product behavior and non-goals.
- `ARCHITECTURE.md`: system design and data flow.
- `POLICY-ENGINE.md`: authority rules and hard prohibitions.
- `INTEGRATION-DECISION.md`: why QuickBooks Online is first.
- `TEST-MATRIX.md`: scenarios that must pass before real customer use.
- `BACKLOG.md`: implementation sequence and ownership.
- `FOUNDER-GATES.md`: decisions Sarab must make rather than delegating to an agent.
- `CLAUDE-MISSION-001.md`: first Cowork implementation mission.

## Definition of v1 success

A sandbox business can connect its accounting and mailbox, sync invoices, identify overdue items, create the correct next action, send only policy-authorized reminders, process replies, verify payment status, and surface exceptional cases in one decision queue.

The key metric is **manual interventions per overdue invoice**. The target is to reduce this while maintaining zero unauthorized term changes and zero messages on disputed or resolved invoices.
