# Singh AR Architecture

## Design goals

- Event-driven when possible, scheduled reconciliation as fallback.
- Multi-tenant from the first real schema.
- Source accounting system remains the authority for invoice/payment facts.
- LLM proposes actions; deterministic code authorizes them.
- Every external action is idempotent and auditable.
- A missed webhook must not create stale state forever.

## High-level flow

```text
QuickBooks Online webhooks -----> Cloudflare Worker -----> D1 event inbox
          |                             |
          |                             +--> sync/reconcile invoice
          |
Scheduled reconciliation --------------+
                                        |
                                        v
                                  AR case engine
                                        |
                              proposed next action
                                        |
                                        v
                                  POLICY GATEWAY
                                  /      |       \
                             allow    approval   block
                               |         |         |
                               v         v         v
                         Gmail send   decision    audit
                                      queue

Gmail inbound webhook/poll ----> reply classifier ----> AR case update
                                              |
                                              +--> policy gateway
```

## Production integrations

Production should use direct OAuth/API integrations. Zapier MCP is useful for development coordination and agent tooling, but Singh AR customers must not depend on Sarab's personal Zapier connection.

### QuickBooks Online

Use OAuth 2.0 with the accounting scope. Store tenant realm/company ID and encrypted refresh credentials outside plain D1 fields. Webhooks provide change notifications; scheduled reconciliation catches missed notifications and verifies truth.

Read only in the earliest milestone. Do not modify invoices in QuickBooks until a later, separately reviewed feature requires it.

### Gmail

Use OAuth per tenant mailbox. V1 sends from the customer's own mailbox and ingests replies from that mailbox. Preserve `Message-ID`, `In-Reply-To`, and `References` when possible so follow-ups remain threaded.

Do not send from a shared Singh Dynamics marketing domain on behalf of customers.

## Proposed D1 data model

The exact migration is implementation work, but the target entities are:

### `organizations`
Tenant/business settings, timezone, status.

### `connections`
Provider metadata for QuickBooks/Gmail. Never store raw secrets in logs or git. Store only secret references or encrypted values according to the Worker secret design.

### `ar_customers`
Normalized customer identity mapped to provider IDs.

### `ar_invoices`
Provider invoice ID, customer, currency, original amount, open balance, issue/due dates, provider status, last synced timestamp.

### `ar_cases`
Invoice-level workflow state: status, reminder stage, next action time, promise date, assigned policy version, pause reason, last action.

### `ar_messages`
Inbound/outbound communication metadata and provider message IDs. Store only content required for product behavior and audit.

### `ar_events`
Append-only normalized event log. Every webhook, sync change, classification, policy decision, approval decision, and send is recorded with an idempotency key.

### `ar_policies`
Versioned tenant policy JSON plus effective dates. Existing cases keep the policy version used for each decision.

### `decision_queue`
Generalized successor to `approval_queue`, tenant-scoped with proposed action, evidence, recommendation, exact executable payload, and status. During migration, compatibility with the old queue may be retained rather than deleting it.

## Action proposal contract

The reasoning layer returns structured data only:

```json
{
  "action": "send_reminder",
  "invoice_id": "...",
  "reason": "...",
  "tone_stage": 2,
  "not_before": "...",
  "draft": {"subject": "...", "body": "..."},
  "facts_used": ["..."],
  "confidence": 0.94
}
```

The model never returns `authorized: true`. Authorization is owned by deterministic policy code.

## Idempotency

Every inbound provider event gets a provider event ID or derived hash. Every outbound send gets an internal action ID. Before executing, the system checks whether that action was already executed. Replays should produce no duplicate customer message.

## Reconciliation loop

At least daily in v1, and more frequently if cheap:
1. Query recently open/changed invoices.
2. Compare source state with D1.
3. Mark paid/void invoices resolved before any new send.
4. Find promises whose dates passed.
5. Re-evaluate cases due for action.
6. Surface connector failures.

This is the fallback even when webhooks appear healthy.

## Security boundaries

- Minimum OAuth scopes.
- No credentials in git, docs, chat, D1 logs, or action output.
- Tenant ID required on every query.
- External sends require a policy result tied to a specific tenant, invoice, payload hash, and policy version.
- Audit log is append-only from application code.
- Production data and sandbox/test data are separated.

## Deployment sequence

1. Local deterministic simulator with fake invoices and replies.
2. D1 development database.
3. QuickBooks sandbox connection.
4. Test mailbox connection.
5. End-to-end sandbox sends only.
6. One design partner in approval-only mode.
7. Gradually enable bounded autonomous actions.
