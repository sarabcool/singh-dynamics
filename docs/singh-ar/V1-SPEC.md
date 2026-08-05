# Singh AR V1 Specification

## Problem

Small B2B businesses repeatedly check unpaid invoices, decide who needs a reminder, write follow-ups, read replies, remember promises to pay, check whether money arrived, and escalate disputes. The work is repetitive but still requires judgment.

Singh AR automates that loop.

## Primary user

Initial hypothesis: US B2B service businesses using QuickBooks Online and Google Workspace, with recurring net-term invoices and enough volume that owners or office staff spend time chasing payment.

This is a hypothesis, not a permanent market decision. See `FOUNDER-GATES.md`.

## Core loop

1. Sync open invoices and customers from QuickBooks Online.
2. Reconcile source-of-truth payment state.
3. For overdue invoices, build an AR case.
4. Read policy and communication history.
5. Propose the next action.
6. Run the proposal through the deterministic policy gateway.
7. If allowed, execute through the customer's connected mailbox.
8. If approval is required, put one concise item in the decision queue.
9. Read inbound replies, classify them, and update the case.
10. Continue until paid, void, paused, disputed, or escalated.

## Case statuses

Keep invoice source status separate from AR case status.

AR case status:
- `monitoring`: invoice exists but no collection action is currently required.
- `overdue`: collection cadence is active.
- `promised`: payer gave a specific payment promise.
- `plan_requested`: payer requested changed payment terms or installments.
- `disputed`: payer challenged amount, work, quantity, quality, or obligation.
- `claimed_paid`: payer says payment was already sent and source verification is pending.
- `human_required`: a business decision is outside policy.
- `paused`: owner paused automation.
- `resolved`: source confirms paid/void/closed.

Use a separate integer `reminder_stage` rather than encoding reminder stage into status.

## Reply intents

The classifier may return only a controlled vocabulary:
- `promise_to_pay`
- `payment_plan_request`
- `partial_payment`
- `claimed_paid`
- `dispute`
- `request_invoice_copy`
- `question`
- `out_of_office`
- `wrong_recipient`
- `contact_preference`
- `other`

Every classification includes confidence, rationale, extracted dates/amounts when present, and the original message reference.

## Default reminder behavior

Defaults are deliberately conservative and tenant-configurable:
- Grace period: 1 day after due date.
- Stage 1: friendly reminder.
- Stage 2: firmer reminder after 4 business days with no response/payment.
- Stage 3: final routine reminder after another 5 business days.
- After the configured maximum routine attempts, create a human decision item rather than escalating threats automatically.

Messages must remain factual and professional. Firmness means clearer urgency, not harassment.

## Actions v1 can perform automatically

Subject to tenant policy:
- Wait until a configured date.
- Send a routine reminder.
- Record a payment promise without changing contractual terms.
- Pause until the promised date, then verify payment.
- Resend an existing invoice or payment link if source data supports it.
- Verify a claimed payment against QuickBooks Online.
- Update internal AR state and audit logs.
- Stop immediately when source says paid or void.

## Actions that normally require a human decision

- Accepting or countering a payment plan unless the owner explicitly enabled a bounded payment-plan policy.
- Changing due dates or payment terms.
- Waiving principal, fees, or interest.
- Offering a discount or settlement.
- Resolving a dispute about goods/services/amount owed.
- Referring an account to collections or legal counsel.
- Any action above configured monetary or risk thresholds.

## Hard non-goals for v1

- Consumer/personal debt.
- Healthcare debt.
- Credit reporting.
- Legal threats or automated collections referrals.
- Automated voice or SMS.
- Moving customer funds.
- Factoring or purchasing receivables.
- Autonomous changes to invoice amount or contract terms.
- Multi-accounting-platform support before QuickBooks Online works end to end.

## Decision queue UX

A decision item must answer, on one screen:
- Who owes what?
- How late is it?
- What has already happened?
- What did the customer say?
- Why did policy block autonomy?
- What does Singh recommend?
- What exact action will each button perform?

Target: most human decisions under 30 seconds.

## Metrics

Primary operational metrics:
- manual interventions per overdue invoice
- percentage of routine actions executed without human input
- overdue dollars resolved
- median days from due date to payment
- promise-to-pay kept rate
- classification correction rate
- unauthorized-action count, target zero
- messages sent after payment/dispute, target zero

Do not optimize collection aggressiveness at the expense of customer relationships.
