# Singh AR Policy Engine

## Purpose

The policy gateway is the product's control layer. AI decides what it thinks should happen. The gateway decides what it is actually allowed to do.

The policy engine must be deterministic, unit-testable, versioned, and independent of the LLM prompt.

## Gateway result

Every proposed action returns exactly one result:
- `ALLOW`: execute without human input.
- `REQUIRE_APPROVAL`: create one decision-queue item.
- `BLOCK`: never execute this action under current product rules.

## Owner-configurable policy fields

Suggested v1 fields:

```json
{
  "grace_days": 1,
  "reminder_intervals_business_days": [0, 4, 5],
  "max_routine_reminders": 3,
  "max_autonomous_invoice_balance_cents": 1000000,
  "business_timezone": "America/Detroit",
  "send_window_local": {"start": "08:00", "end": "17:00"},
  "payment_promises": {"record_automatically": true},
  "payment_plans": {
    "enabled": false,
    "max_extension_days": 30,
    "min_upfront_percent": 30,
    "max_invoice_balance_cents": 500000
  },
  "vip_customer_tags": [],
  "pause_on_dispute": true
}
```

Defaults should be conservative. A tenant may explicitly grant broader authority later.

## Hard prohibitions

The gateway always returns `BLOCK` for:
- inventing a late fee, interest amount, or other charge
- adding a fee not already authorized by source terms/policy
- waiving principal without explicit human approval
- inventing a discount or settlement
- threatening legal action, collections, repossession, credit reporting, or public exposure
- changing contract scope
- pretending a payment was received without source verification
- contacting an invoice/customer marked paid, void, disputed, paused, or wrong-recipient
- consumer/personal debt in v1
- automated voice or SMS
- sending when tenant/accounting synchronization is materially stale

## Routine reminder authorization

A reminder may be `ALLOW` only if all are true:
1. Invoice source status is open/unpaid.
2. Balance is positive.
3. Due date plus grace period has passed.
4. Case is not disputed, paused, claimed-paid pending verification, or human-required.
5. No customer reply after the last outbound message requires handling first.
6. Reminder stage is below configured maximum.
7. Minimum interval since previous reminder has passed.
8. Current balance is at or below autonomous threshold.
9. Connector state is fresh enough to trust payment status.
10. Current send time is within configured window, or action is deferred to the next valid window.

## Payment promises

A statement like "we will pay Friday" does not change the debt terms by itself. V1 may record a clear promise date and pause routine reminders until the configured verification point.

If the date is ambiguous, impossible, excessively far away, or the classifier confidence is below threshold, require human review.

After the promise date, verify QuickBooks before sending anything. If paid, resolve. If not paid, resume at the policy-defined stage.

## Payment plans

Default: `REQUIRE_APPROVAL`.

The engine can later auto-accept only if the tenant explicitly enables bounded plan authority and every numeric condition fits. It may never infer authority from previous approvals by itself. It may propose a policy change after repeated approvals, but only the owner can activate it.

## Disputes

Any credible dispute about amount, work, delivery, quality, quantity, authorization, or obligation immediately pauses routine collection. The agent summarizes the dispute and creates a human decision item.

Do not argue the merits automatically.

## Claimed payment

If a payer says "already paid":
1. stop new reminders temporarily
2. re-sync source accounting data
3. if confirmed, resolve
4. if not confirmed after a safe reconciliation attempt, require human review

## Model uncertainty

The policy engine receives classifier confidence but must not treat confidence alone as authorization. Low confidence always increases friction. For reply intents that could indicate dispute, wrong recipient, or payment, ambiguous cases should default to human review rather than another reminder.

## Policy versioning

Policies are immutable once used. Editing settings creates a new version. Every action audit record stores `policy_version_id`. This lets us explain exactly why an action was allowed months later.
