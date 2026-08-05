# Integration Decision: QuickBooks Online First

Decision date: 2026-08-05

## Decision

Build the first AR source connector for **QuickBooks Online (QBO)**. Build the first communication connector for **Gmail / Google Workspace**. Keep Stripe Billing for Singh Dynamics' own subscription billing. Add Stripe Invoicing as a later source connector after the QBO loop works.

## Why QBO first

Singh AR is aimed at B2B receivables with due dates, open balances, partial/manual payments, and office staff checking accounting software. QBO exposes invoice and related accounting entities, supports OAuth 2.0, webhooks, API Explorer tooling, and developer sandbox companies. That gives us a realistic place to test without touching a real customer's books.

Verified against current Intuit developer documentation on 2026-08-05:
- QBO Accounting API supports invoice workflows and related entities.
- Developer accounts receive sandbox company capability for testing.
- OAuth 2.0 is the production authorization path.
- Webhooks can notify the app of supported entity changes.

## Why not Stripe-first

Stripe Invoicing has excellent APIs and invoice events such as `invoice.paid` and `invoice.payment_failed`, and it will be a strong second connector. It is also simpler for developer testing.

However, a Stripe-only AR product mostly serves companies already running invoices through Stripe, while the wedge we are testing is broader back-office collection work around net-term B2B invoices. QBO is a better first source-of-truth hypothesis for that job.

## Gmail first

The message should come from the business itself, not from Singh Dynamics. A per-tenant mailbox OAuth connection gives the product access to actual thread history and allows replies to remain in the customer's normal inbox.

Outlook/Microsoft 365 is an obvious second mailbox connector, but not part of the first end-to-end build.

## Integration rules

- Source APIs are authoritative for payment facts.
- Webhooks reduce latency; scheduled reconciliation catches missed events.
- Start QBO read-only.
- Never log access/refresh tokens.
- Use sandbox/test tenants until the full test matrix passes.
- Do not add another accounting platform just because an integration is easy.

## Revisit condition

Revisit this decision only after either:
1. the QBO sandbox loop is working end to end, or
2. at least five target-user conversations show that the initial ICP overwhelmingly invoices somewhere else.
