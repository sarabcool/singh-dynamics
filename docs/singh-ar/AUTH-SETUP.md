# Singh AR Authentication and Setup Gates

This file lists the human/account actions that cannot be completed purely from code. Do not ask Sarab for these before the phase that actually needs them.

## Mission 001: deterministic core

No new accounts or credentials required. Claude should build this phase entirely offline with fixtures and tests.

## Before QuickBooks sandbox integration

Required:
1. Intuit Developer account under the appropriate business/legal account owner.
2. QuickBooks Online app created in the Intuit Developer Portal.
3. QuickBooks Online sandbox company available.
4. Development Client ID and Client Secret stored only in the project's secret system.
5. OAuth redirect URI pointing at the development Worker callback endpoint.
6. Accounting scope only unless another scope is proven necessary.
7. Webhook endpoint URL and provider verification/signature configuration.

Do not paste credentials into chat, docs, issues, or commits.

Production credentials/app review are a later gate. Sandbox comes first.

## Before Gmail integration

Required:
1. Google Cloud project for Singh AR OAuth. Reuse an existing suitable Singh Dynamics project only if the OAuth/security separation remains clear.
2. OAuth consent configuration.
3. Gmail scopes reduced to the minimum needed for sending and processing the product mailbox workflow.
4. Dedicated test mailbox or test Workspace account. Do not test autonomous messaging against real customers.
5. OAuth redirect URI at the development Worker callback.
6. Client credentials stored as secrets, never committed.

Before production launch, verify Google's current app-verification requirements for the exact scopes used.

## Before first design partner

Required human/business actions:
- Pick the initial customer profile in `FOUNDER-GATES.md`.
- Get one willing design partner who understands the pilot is approval-only at first.
- Confirm their invoices are commercial B2B, not consumer/personal debts.
- Written permission to connect the accounting and mailbox accounts needed for the pilot.
- Decide data retention period for message/invoice content.
- Review privacy/security obligations for customer data.
- Appropriate legal review before public commercial launch, especially for target states and the exact collection workflow.

## Before autonomous sending

All must be true:
- full sandbox test matrix passes
- pilot has run in approval-only shadow mode
- operator can audit every proposed/send decision
- connector health checks work
- source payment status is rechecked before sends
- safe kill switch exists per tenant and globally
- no message can send without a stored policy result and idempotency key
- founder explicitly enables the action class

## Before paid public launch

- Stripe Billing product/prices for Singh AR subscription
- customer terms and privacy policy
- security/contact process for incidents
- account deletion/export flow
- data retention/deletion rules implemented
- production OAuth credentials and provider requirements completed
- backups/recovery tested for critical state
- monitoring/alerts for failed syncs and duplicate-send risk
- legal review appropriate to the commercial product

## Accounts we do not need yet

Do not create random SaaS accounts in advance. No need for Outlook/Microsoft 365 developer setup, Twilio, collections agencies, credit bureaus, n8n, Make, or additional accounting platforms during v1 foundation.
