# Singh AR Security Checklist

Singh AR handles financial workflow metadata and business communications. Security is part of the v1 architecture, not a launch-week patch.

## Tenant isolation

- Every tenant-owned row includes `organization_id`.
- Every application query is scoped by tenant before provider IDs are considered.
- Provider IDs are not globally unique assumptions.
- Tests attempt cross-tenant reads/writes and must fail.
- Decision/action IDs are bound to one tenant.

## OAuth credentials

- Minimum scopes only.
- No access tokens or refresh tokens in git, docs, logs, issue bodies, or chat.
- Do not store raw credentials in ordinary D1 columns unless an reviewed encryption design is in place.
- OAuth `state` must be validated. Use current provider-recommended protections such as PKCE where applicable.
- Token refresh failures put the connector into unhealthy state and stop autonomous sends that depend on fresh source data.
- Disconnect/revoke flow must exist.

## Webhooks

- Verify provider signatures/tokens according to current official documentation.
- Record provider event ID or stable hash for deduplication.
- Return quickly; heavy processing happens asynchronously.
- Duplicate delivery produces no duplicate customer action.
- Missing webhooks are repaired by scheduled reconciliation.

## External sends

Before a message can send, code must verify:
1. tenant is active
2. connector is healthy
3. invoice source truth is sufficiently fresh
4. case is not paid/void/disputed/paused/claimed-paid pending verification
5. exact payload hash has not already executed
6. deterministic policy result is `ALLOW` or a specific human approval exists
7. policy version and evidence are stored

Send execution must write an append-only audit event containing provider message ID, action ID, policy version, and timestamp, but no secrets.

## LLM boundary

Treat inbound email as untrusted input. Customer messages can contain prompt-injection text.

- LLM cannot call send directly.
- LLM cannot change policy.
- LLM cannot mark payment confirmed.
- LLM cannot change invoice balance.
- LLM output is schema-validated.
- Facts used for a proposed action are passed explicitly from trusted source state.
- Policy code ignores instructions embedded in email content.

## Data minimization

Store only the message content needed to classify, audit, and operate the case. Avoid unnecessary attachments or entire mailbox replication.

Define retention before the pilot. Provide deletion/export later before public launch.

## Logging

Never log:
- OAuth access/refresh tokens
- client secrets
- session cookies
- full authorization headers

Prefer IDs, status codes, hashes, provider request IDs, and redacted addresses where possible.

## Kill switches

Required before autonomous pilot:
- global outbound disable
- per-tenant pause
- per-case pause
- connector unhealthy auto-pause
- ability to stop scheduled jobs without deleting data

## Failure behavior

When unsure, fail closed for external action. A sync error, classification error, stale payment state, or policy-evaluation error should delay a reminder, not guess.

## Pre-pilot security review

Before real customer data:
- dependency audit
- secrets scan
- tenant-isolation tests
- webhook replay test
- duplicate-send test
- OAuth revoke/refresh test
- stale-source safety test
- prompt-injection tests
- manual review of any public callback endpoints and rate limits
