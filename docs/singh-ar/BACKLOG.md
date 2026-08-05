# Singh AR Implementation Backlog

The order matters. Do not jump to a pretty dashboard while the state/policy loop is undefined.

## P0: Product foundation

Status: this documentation branch.

- [x] Define v1 scope and non-goals.
- [x] Define policy model and hard prohibitions.
- [x] Choose QBO-first source integration.
- [x] Define test matrix.
- [ ] Update repo constitution to point to Singh AR as primary product.
- [ ] Merge foundation docs after CI/review.

## P1: Deterministic simulator

Owner: Claude Cowork implementation, ChatGPT review/adversarial test.

Deliverables:
- `ar/` module or equivalent isolated package.
- Pure state transition functions.
- Pure deterministic policy evaluator.
- Fixture generator for organizations, customers, invoices, replies, and source changes.
- Automated tests implementing at least the first 20 cases in `TEST-MATRIX.md`.
- No external APIs. No LLM required for deterministic scenarios.

Exit gate: policy and state tests green; replay/idempotency behavior is explicit.

## P2: Data model

Owner: Claude. ChatGPT reviews migration against spec before merge.

Expected migration: `006-singh-ar-core.sql` unless another migration lands first. Never reuse a migration number.

Add tenant-scoped AR entities described in `ARCHITECTURE.md`. Keep old lead/site tables intact. Add indexes for tenant + provider IDs, due/action times, and unresolved cases.

Exit gate: migration applies cleanly to a fresh dev D1 and an upgraded copy; schema tests pass.

## P3: QuickBooks sandbox read connector

Owner: Claude for runtime code; Sarab handles provider account/authentication only when required.

Deliverables:
- OAuth start/callback endpoints.
- Secure token storage strategy implemented.
- Realm/company mapping.
- Read customer/invoice/payment state required for v1.
- Webhook receiver with signature/verification requirements from provider docs.
- Scheduled reconciliation fallback.
- Sandbox fixtures captured as sanitized test data.

Exit gate: create/update/pay/void actions in QBO sandbox result in correct internal state without manual DB edits.

## P4: Gmail test-mailbox connector

Owner: Claude runtime implementation; ChatGPT reviews threading and reply classification contract.

Deliverables:
- OAuth per tenant mailbox.
- Send exact approved message.
- Store provider message/thread IDs.
- Ingest replies.
- Preserve threads.
- Idempotent send.

Exit gate: sandbox invoice reminder and reply complete a full thread with no duplicates.

## P5: Reply reasoning

Owner: ChatGPT defines classifier contract/red-team cases; Claude implements provider/model adapter.

Deliverables:
- Structured intent schema from `V1-SPEC.md`.
- Extraction of dates/amounts with explicit uncertainty.
- Model prompt cannot authorize actions.
- Low-confidence fallback.
- Red-team tests.

Exit gate: test corpus reaches agreed accuracy and zero policy bypasses.

## P6: Decision queue and operator dashboard

Build only the screens required to operate the system:
- overdue total
- cases by state
- actions Singh took
- upcoming actions
- promises to pay
- connector health
- decision required cards
- policy settings with version history

No design-system rabbit hole.

Exit gate: an operator can understand every active case without opening D1 or logs.

## P7: Shadow pilot

One design partner. All external messages approval-only. Singh proposes actions and records what it would have done. Measure disagreement.

Exit gate:
- no cross-tenant or source-truth failures
- no messages after payment/dispute
- owner agrees with routine action proposals at a high enough rate to justify limited autonomy
- at least ten real repetitive decisions observed before automating that decision class

## P8: Bounded autonomy

Enable only the proven action classes, initially routine reminders and clear payment promises. Payment plans stay gated until enough real decisions exist and the owner deliberately enables a bounded policy.

## P9: Commercialization

Only after the pilot loop works:
- onboarding
- customer-facing terms/privacy/security docs
- legal review for target market and states
- pricing experiment
- Stripe subscription billing
- support/incident flow
- audit export
- first repeatable acquisition channel

## What not to build yet

- Outlook connector
- Stripe AR connector
- SMS/voice
- consumer collections
- collections agency integrations
- credit reporting
- predictive cash forecasting
- fancy analytics
- mobile app
- generic AI employee features
