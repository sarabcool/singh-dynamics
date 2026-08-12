# Claude Cowork Mission 001: Singh AR Deterministic Core

Read `CLAUDE.md`, the Agent Coordination Doc, and every file in `docs/singh-ar/` before editing.

## Goal

Build the deterministic Singh AR core in isolation from real customer systems. This mission must produce something we can test aggressively without OAuth, API spend, or external messages.

## Required work

1. Choose a clean module location for Singh AR without touching the separate, active Website Sales code. Prefer an isolated package/module with a clear boundary.
2. Implement typed/validated domain objects for organization policy, invoice snapshot, AR case, inbound reply classification, proposed action, and policy result.
3. Implement the AR case state transition engine.
4. Implement the deterministic policy gateway from `POLICY-ENGINE.md`.
5. Implement an in-memory/fake event runner that can replay a case from source events and customer replies.
6. Add fixtures for at least the first 20 cases in `TEST-MATRIX.md`.
7. Add unit tests. Include idempotency/replay tests and tenant-isolation tests where applicable.
8. Add a CLI or script that prints a human-readable simulation for several scenarios, including:
   - first overdue reminder
   - second firmer reminder
   - clear promise to pay
   - dispute
   - claimed payment
   - payment-plan request
9. Do not integrate QuickBooks, Gmail, Anthropic, Stripe, or any external service in this mission.
10. Do not create a D1 migration yet unless the deterministic model reveals a concrete schema requirement that cannot wait. If so, document the proposal and stop before applying it.

## Constraints

- LLM output cannot grant authority.
- No external messages.
- No money movement.
- No deletion of Website Sales code. It is a separate active subchannel, not legacy.
- No consumer debt workflows.
- No workflow-file edits unless needed for tests; if you edit `.github/workflows/*`, explicitly log why in the coordination doc.
- Keep functions deterministic where possible. Time must be injectable/fakeable for tests.
- Avoid a framework unless it solves a concrete need.

## Definition of done

- Tests green.
- At least 20 matrix scenarios represented.
- Simulation output makes policy decisions understandable.
- README/docs updated for any implementation choice.
- Changes on a dedicated branch with PR.
- Agent Coordination Doc updated with branch, PR, test results, new decisions, and exact handoff to ChatGPT.

## Handoff to ChatGPT

Ask ChatGPT to review the PR specifically for:
- hidden policy bypasses
- state machine gaps
- idempotency
- unsafe default authority
- test cases Claude missed
- accidental coupling to the old lead-generation business

Do not begin QuickBooks integration until the deterministic-core review is complete.
