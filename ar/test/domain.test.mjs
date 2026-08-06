import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ValidationError,
  makePolicy, DEFAULT_POLICY,
  makeInvoiceSnapshot,
  makeArCase, CASE_STATUSES, isValidTransition,
  makeReplyClassification,
  makeProposedAction, makePolicyResult,
  HARD_PROHIBITED_KINDS, ACTION_KINDS,
  Clock, addBusinessDaysIso,
} from '../src/index.mjs';

test('policy: defaults + overrides merged and frozen', () => {
  const p = makePolicy({
    organization_id: 'org-A',
    policy_version_id: 'v1',
    effective_from: '2026-01-01T00:00:00Z',
    overrides: { grace_days: 3 },
  });
  assert.equal(p.grace_days, 3);
  assert.equal(p.max_routine_reminders, DEFAULT_POLICY.max_routine_reminders);
  assert.throws(() => { p.grace_days = 99; });
});

test('policy: rejects negative grace days', () => {
  assert.throws(() => makePolicy({
    organization_id: 'org-A', policy_version_id: 'v1',
    effective_from: '2026-01-01T00:00:00Z',
    overrides: { grace_days: -1 },
  }), ValidationError);
});

test('policy: rejects reminder_intervals shorter than max_routine_reminders', () => {
  assert.throws(() => makePolicy({
    organization_id: 'org-A', policy_version_id: 'v1',
    effective_from: '2026-01-01T00:00:00Z',
    overrides: { reminder_intervals_business_days: [0], max_routine_reminders: 3 },
  }), ValidationError);
});

test('invoice: valid snapshot round-trip', () => {
  const s = makeInvoiceSnapshot({
    organization_id: 'org-A', provider: 'quickbooks_online',
    provider_invoice_id: 'i1', provider_customer_id: 'c1',
    currency: 'USD', original_amount_cents: 100, open_balance_cents: 100,
    issue_date: '2026-07-01', due_date: '2026-08-01', source_status: 'open',
    last_synced_at: '2026-08-15T09:00:00Z',
  });
  assert.equal(s.source_status, 'open');
  assert.equal(s.tags.length, 0);
});

test('invoice: rejects unknown source_status', () => {
  assert.throws(() => makeInvoiceSnapshot({
    organization_id: 'org-A', provider: 'x', provider_invoice_id: 'i',
    provider_customer_id: 'c', currency: 'USD', original_amount_cents: 1,
    open_balance_cents: 1, issue_date: '2026-07-01', due_date: '2026-08-01',
    source_status: 'partially-paid', last_synced_at: '2026-08-15T09:00:00Z',
  }), ValidationError);
});

test('case: makeArCase applies defaults', () => {
  const c = makeArCase({
    organization_id: 'org-A', case_id: 'c-1', invoice_id: 'i-1',
    status: 'monitoring', reminder_stage: 0, policy_version_id: 'v1',
  });
  assert.equal(c.reminder_stage, 0);
  assert.deepEqual(c.applied_action_ids, []);
});

test('case: transitions are explicit', () => {
  assert.equal(isValidTransition('monitoring', 'overdue'), true);
  assert.equal(isValidTransition('resolved', 'overdue'), false);
  assert.equal(isValidTransition('paused', 'overdue'), true);
  assert.equal(isValidTransition('overdue', 'monitoring'), false);
  for (const from of CASE_STATUSES) {
    for (const to of CASE_STATUSES) {
      if (isValidTransition(from, to)) assert.ok(CASE_STATUSES.includes(to));
    }
  }
});

test('reply: rejects unknown intent', () => {
  assert.throws(() => makeReplyClassification({
    intent: 'threat', confidence: 0.9, rationale: 'x', original_message_ref: 'm',
  }), ValidationError);
});

test('reply: accepts full valid record', () => {
  const r = makeReplyClassification({
    intent: 'promise_to_pay', confidence: 0.9,
    rationale: 'will pay friday', extracted_dates: ['2026-08-21'],
    original_message_ref: 'm',
  });
  assert.equal(r.intent, 'promise_to_pay');
  assert.deepEqual(r.extracted_dates, ['2026-08-21']);
});

test('action: makeProposedAction rejects unknown kind', () => {
  assert.throws(() => makeProposedAction({
    action_id: 'a1', organization_id: 'o', case_id: 'c', invoice_id: 'i',
    kind: 'nuke_customer', proposed_by: 'engine', reason: 'x',
  }), ValidationError);
});

test('action: all HARD_PROHIBITED_KINDS are in ACTION_KINDS', () => {
  for (const k of HARD_PROHIBITED_KINDS) {
    assert.ok(ACTION_KINDS.includes(k), `${k} missing from ACTION_KINDS`);
  }
});

test('policy_result: makePolicyResult validates fields', () => {
  const r = makePolicyResult({
    decision: 'ALLOW', reason: 'ok', reason_codes: ['A'],
    policy_version_id: 'v1', evaluated_at: '2026-08-15T09:00:00Z',
  });
  assert.equal(r.decision, 'ALLOW');
  assert.throws(() => makePolicyResult({
    decision: 'MAYBE', reason: 'x', reason_codes: [], policy_version_id: 'v1',
    evaluated_at: '2026-08-15T09:00:00Z',
  }), ValidationError);
});

test('time: addBusinessDaysIso skips weekends', () => {
  const monIso = addBusinessDaysIso('2026-08-14T09:00:00Z', 1);
  const parsed = new Date(monIso);
  assert.equal(parsed.getUTCDay(), 1, `expected Monday, got ${monIso}`);
});

test('time: addBusinessDaysIso 0 is identity', () => {
  assert.equal(addBusinessDaysIso('2026-08-14T09:00:00Z', 0), '2026-08-14T09:00:00Z');
});

test('clock: advanceTo mutates instant', () => {
  const c = new Clock('2026-08-14T09:00:00Z');
  assert.equal(c.now(), '2026-08-14T09:00:00Z');
  c.advanceTo('2026-08-15T09:00:00Z');
  assert.equal(c.now(), '2026-08-15T09:00:00Z');
});
