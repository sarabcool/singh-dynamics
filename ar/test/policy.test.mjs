// Targeted policy-gateway tests for individual decision paths that are hard
// to isolate through the runner's scenario replay.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePolicy, Clock, makePolicy, makeInvoiceSnapshot, makeArCase,
  makeProposedAction, HARD_PROHIBITED_KINDS,
} from '../src/index.mjs';

const clock = () => new Clock('2026-08-15T09:00:00Z');

function baseline({ policyOverrides = {}, invoiceOverrides = {}, caseOverrides = {} } = {}) {
  const policy = makePolicy({
    organization_id: 'org-A', policy_version_id: 'pv-1',
    effective_from: '2026-01-01T00:00:00Z',
    overrides: policyOverrides,
  });
  const invoice = makeInvoiceSnapshot({
    organization_id: 'org-A', provider: 'quickbooks_online',
    provider_invoice_id: 'i1', provider_customer_id: 'c1',
    currency: 'USD', original_amount_cents: 200_000, open_balance_cents: 200_000,
    issue_date: '2026-07-01', due_date: '2026-08-04', source_status: 'open',
    last_synced_at: '2026-08-15T08:59:00Z',
    ...invoiceOverrides,
  });
  const arCase = makeArCase({
    organization_id: 'org-A', case_id: 'c1', invoice_id: 'i1',
    status: 'overdue', reminder_stage: 0, policy_version_id: 'pv-1',
    ...caseOverrides,
  });
  return { policy, invoice, arCase };
}

function proposedReminder(overrides = {}) {
  return makeProposedAction({
    action_id: 'r-1', organization_id: 'org-A', case_id: 'c1', invoice_id: 'i1',
    kind: 'send_reminder', tone_stage: 1, proposed_by: 'engine',
    reason: 'test', ...overrides,
  });
}

test('policy: internal-only actions always ALLOW', () => {
  const { policy, invoice, arCase } = baseline();
  for (const kind of ['wait', 'pause', 'verify_payment', 'escalate_human']) {
    const action = makeProposedAction({
      action_id: `${kind}-1`, organization_id: 'org-A', case_id: 'c1', invoice_id: 'i1',
      kind, proposed_by: 'engine', reason: 'test',
    });
    const r = evaluatePolicy({ action, arCase, invoice, policy, clock: clock() });
    assert.equal(r.decision, 'ALLOW', `${kind} should ALLOW`);
  }
});

test('policy: every hard-prohibited kind returns BLOCK with HARD_PROHIBITED', () => {
  const { policy, invoice, arCase } = baseline();
  for (const kind of HARD_PROHIBITED_KINDS) {
    const action = makeProposedAction({
      action_id: `${kind}-1`, organization_id: 'org-A', case_id: 'c1', invoice_id: 'i1',
      kind, proposed_by: 'llm', reason: 'llm tried',
    });
    const r = evaluatePolicy({ action, arCase, invoice, policy, clock: clock() });
    assert.equal(r.decision, 'BLOCK', `${kind}`);
    assert.ok(r.reason_codes.includes('HARD_PROHIBITED'));
  }
});

test('policy: send_reminder ALLOW happy path', () => {
  const { policy, invoice, arCase } = baseline();
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'ALLOW');
});

test('policy: SOURCE_NOT_OPEN blocks reminder', () => {
  const { policy, invoice, arCase } = baseline({ invoiceOverrides: { source_status: 'paid', open_balance_cents: 0 } });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('SOURCE_NOT_OPEN'));
});

test('policy: WITHIN_GRACE blocks reminder', () => {
  const { policy, invoice, arCase } = baseline({
    invoiceOverrides: { due_date: '2026-08-15', last_synced_at: '2026-08-15T08:59:00Z' },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('WITHIN_GRACE'));
});

test('policy: MAX_REMINDERS_REACHED escalates to approval', () => {
  const { policy, invoice, arCase } = baseline({
    caseOverrides: { reminder_stage: 3 },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
  assert.ok(r.reason_codes.includes('MAX_REMINDERS_REACHED'));
});

test('policy: INTERVAL_NOT_MET blocks', () => {
  const { policy, invoice, arCase } = baseline({
    caseOverrides: { reminder_stage: 1, last_action_at: '2026-08-14T09:00:00Z' },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('INTERVAL_NOT_MET'));
});

test('policy: SOURCE_STALE blocks', () => {
  const { policy, invoice, arCase } = baseline({
    invoiceOverrides: { last_synced_at: '2026-08-14T00:00:00Z' },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('SOURCE_STALE'));
});

test('policy: OVER_AUTONOMY_THRESHOLD -> REQUIRE_APPROVAL', () => {
  const { policy, invoice, arCase } = baseline({
    invoiceOverrides: { original_amount_cents: 2_500_000, open_balance_cents: 2_500_000 },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
  assert.ok(r.reason_codes.includes('OVER_AUTONOMY_THRESHOLD'));
});

test('policy: AWAITING_REPLY escalates to approval', () => {
  const { policy, invoice, arCase } = baseline({
    caseOverrides: { awaiting_reply: true },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
  assert.ok(r.reason_codes.includes('AWAITING_REPLY'));
});

test('policy: consumer debt blocks external actions', () => {
  const { policy, invoice, arCase } = baseline({
    invoiceOverrides: { is_consumer_debt: true },
  });
  const r = evaluatePolicy({ action: proposedReminder(), arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('CONSUMER_DEBT_UNSUPPORTED'));
});

test('policy: LLM cannot self-authorize by cranking confidence', () => {
  // The LLM sets confidence=1.0 but proposes a hard-prohibited kind.
  const { policy, invoice, arCase } = baseline();
  const action = makeProposedAction({
    action_id: 'x', organization_id: 'org-A', case_id: 'c1', invoice_id: 'i1',
    kind: 'threaten_legal', proposed_by: 'llm', reason: 'trust me',
    confidence: 1.0,
  });
  const r = evaluatePolicy({ action, arCase, invoice, policy, clock: clock() });
  assert.equal(r.decision, 'BLOCK');
});
