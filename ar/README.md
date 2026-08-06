# Singh AR deterministic core

Implementation of Mission 001 from `docs/singh-ar/CLAUDE-MISSION-001.md`. This
package is the deterministic control layer: state machine, policy gateway,
event runner, and simulator. No external I/O. No LLM required.

## Boundary

`ar/` is intentionally isolated from the legacy `agent/` lead-generation code.
Nothing in `ar/` imports from `agent/`, `sites/`, `infra/`, or `site/`, and
nothing in those directories imports from `ar/`. Later phases (QBO connector,
Gmail connector, LLM reply classifier) will attach at the seams defined here.

Rule: the LLM proposes, deterministic code disposes. `evaluatePolicy()` is
the only function permitted to authorize an external action.

## Implementation choices

- **Language / toolchain**: vanilla Node ESM. No TypeScript, no bundler, no
  build step. Types are documented with runtime validators in `src/domain/*`
  and enforced via `makeXxx()` factories. Adding a build step now would be
  ceremony that slows the review Sarab actually needs.
- **Dependencies**: none. `package.json` has no `dependencies`, no
  `devDependencies`. Tests run under `node --test`. Every line is auditable
  without a lockfile diff.
- **Time**: all engine code takes a `Clock` and reads only `clock.now()`.
  Business-day math lives in `src/domain/time.mjs`. Tests use `FakeClock`
  semantics via `Clock` constructed at a fixed instant.
- **Idempotency**: every `ProposedAction` carries `action_id`. The runner
  dedupes on `applied_action_ids`. Replaying the same event stream produces
  the same snapshot (asserted in `test/idempotency.test.mjs`).
- **Tenant isolation**: `evaluatePolicy()` returns `BLOCK` with reason code
  `TENANT_MISMATCH` if action / case / invoice / policy do not share the same
  `organization_id`. Cross-tenant tests live in `test/tenant-isolation.test.mjs`.
- **Policy versioning**: every `PolicyResult` copies `policy_version_id` from
  the evaluating policy. Later phases will persist this alongside audit rows.

## Layout

```
ar/
  package.json                # zero-deps, node --test scripts
  README.md                   # this file
  src/
    index.mjs                 # single public entrypoint
    validate.mjs              # hand-rolled runtime validators
    domain/
      time.mjs                # Clock, business-day math
      policy.mjs              # OrganizationPolicy + DEFAULT_POLICY
      invoice.mjs             # InvoiceSnapshot (source-of-truth view)
      case.mjs                # ArCase + valid transitions table
      reply.mjs               # ReplyClassification + intent vocabulary
      action.mjs              # ProposedAction, PolicyResult, action kinds
    engine/
      policy.mjs              # deterministic policy gateway
      transitions.mjs         # state-transition pure functions
      runner.mjs              # in-memory replayable EventRunner
  bin/
    ar-sim.mjs                # human-readable simulator
  test/
    fixtures/
      policies.mjs
      scenarios.mjs           # 30 fixtures for TEST-MATRIX.md
    domain.test.mjs
    policy.test.mjs
    matrix.test.mjs           # replays all 30 scenarios
    idempotency.test.mjs
    tenant-isolation.test.mjs
    red-team.test.mjs
```

## Running

```bash
cd ar
node --test test/*.test.mjs   # 68 tests, ~300ms
node bin/ar-sim.mjs            # six required demo scenarios
node bin/ar-sim.mjs --all      # all 30
node bin/ar-sim.mjs 21 22 28   # specific scenario ids
```

## What this deliberately does NOT include

- QuickBooks Online client. Placeholder: `invoice.provider === 'quickbooks_online'`.
- Gmail client or any send mechanism.
- LLM reply classifier. `ReplyClassification` is the contract the classifier
  must satisfy; whether that comes from a fine-tune, Claude, or a human, the
  gateway's authority is unchanged.
- D1 schema or migration. Domain shapes are pinned here so the migration
  can copy them without inventing new columns.

Those integrations open only after ChatGPT's review of this PR completes.

## Reviewer questions

Handoff notes in the coordination doc list the specific angles ChatGPT should
attack. Additions welcome. Every reason code in `evaluatePolicy()` is a
supported test target; if a scenario is missing, add a fixture in
`test/fixtures/scenarios.mjs` and a matrix expectation rather than
loosening the gateway.
