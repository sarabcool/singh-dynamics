import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EventRunner, Clock, evaluatePolicy, makePolicy, makeInvoiceSnapshot,
  makeArCase, makeProposedAction,
} from '../src/index.mjs';

function setup({ policyOverrides = {}, invoiceOverrides = {}, caseOverrides = {} } = {}) {
  const policy = makePolicy({
    organization_id: 'org-A',
    policy_version_id: 'pv-review',
    effective_from: '2026-01-01T00:00:00Z',
    overrides: policyOverrides,
  });
  const invoice = makeInvoiceSnapshot({
    organization_id: 'org-A', provider: 'quickbooks_online',
    provider_invoice_id: 'inv-1', provider_customer_id: 'cust-1',
    currency: 'USD', original_amount_cents: 200_000, open_balance_cents: 200_000,
    issue_date: '2026-07-01', due_date: '2026-08-04', source_status: 'open',
    last_synced_at: '2026-08-15T09:00:00Z',
    ...invoiceOverrides,
  });
  const arCase = makeArCase({
    organization_id: 'org-A', case_id: 'case-1', invoice_id: 'inv-1',
    status: 'overdue', reminder_stage: 0, policy_version_id: policy.policy_version_id,
    ...caseOverrides,
  });
  return { policy, invoice, arCase, clock: new Clock('2026-08-15T09:00:00Z') };
}

function action(kind, overrides = {}) {
  return makeProposedAction({
    action_id: `review-${kind}`, organization_id: 'org-A', case_id: 'case-1',
    invoice_id: 'inv-1', kind, proposed_by: 'engine', reason: 'review test',
    ...(kind === 'send_reminder' ? { tone_stage: 1 } : {}),
    ...overrides,
  });
}

test('review: same-tenant wrong invoice identity is blocked', () => {
  const { policy, invoice, arCase, clock } = setup();
  const r = evaluatePolicy({
    action: action('send_reminder', { invoice_id: 'inv-other' }),
    arCase, invoice, policy, clock,
  });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('ENTITY_MISMATCH'));
});

test('review: case cannot silently switch policy versions', () => {
  const { policy, invoice, arCase, clock } = setup({
    caseOverrides: { policy_version_id: 'pv-old' },
  });
  const r = evaluatePolicy({ action: action('send_reminder'), arCase, invoice, policy, clock });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('POLICY_VERSION_MISMATCH'));
});

test('review: future policy version is not active yet', () => {
  const policy = makePolicy({
    organization_id: 'org-A', policy_version_id: 'pv-future',
    effective_from: '2026-09-01T00:00:00Z',
  });
  const { invoice, arCase: baseCase, clock } = setup();
  const arCase = { ...baseCase, policy_version_id: 'pv-future' };
  const r = evaluatePolicy({ action: action('send_reminder'), arCase, invoice, policy, clock });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('POLICY_NOT_EFFECTIVE'));
});

test('review: unpause requires a human decision', () => {
  const { policy, invoice, arCase, clock } = setup({ caseOverrides: { status: 'paused' } });
  const r = evaluatePolicy({ action: action('unpause'), arCase, invoice, policy, clock });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
  assert.ok(r.reason_codes.includes('HUMAN_RESUME_REQUIRED'));
});

test('review: resolve is blocked until accounting source confirms paid or void', () => {
  const { policy, invoice, arCase, clock } = setup();
  const blocked = evaluatePolicy({ action: action('resolve'), arCase, invoice, policy, clock });
  assert.equal(blocked.decision, 'BLOCK');
  assert.ok(blocked.reason_codes.includes('SOURCE_NOT_RESOLVED'));

  const paid = makeInvoiceSnapshot({
    ...invoice, source_status: 'paid', open_balance_cents: 0,
    last_synced_at: '2026-08-15T09:00:00Z',
  });
  const allowed = evaluatePolicy({ action: action('resolve'), arCase, invoice: paid, policy, clock });
  assert.equal(allowed.decision, 'ALLOW');
});

test('review: reminder cannot choose a more aggressive tone than case stage', () => {
  const { policy, invoice, arCase, clock } = setup();
  const r = evaluatePolicy({
    action: action('send_reminder', { tone_stage: 99 }),
    arCase, invoice, policy, clock,
  });
  assert.equal(r.decision, 'BLOCK');
  assert.ok(r.reason_codes.includes('TONE_STAGE_MISMATCH'));
});

test('review: enabled plan authority still requires a matching customer request', () => {
  const { policy, invoice, arCase, clock } = setup({
    policyOverrides: { payment_plans: { enabled: true } },
  });
  const plan = action('accept_payment_plan', {
    extra: { total_cents: 200_000, upfront_cents: 60_000, extension_days: 30 },
  });
  const r = evaluatePolicy({ action: plan, arCase, invoice, policy, clock, lastReply: null });
  assert.equal(r.decision, 'REQUIRE_APPROVAL');
  assert.ok(r.reason_codes.includes('PLAN_REPLY_CONTEXT_MISSING'));
});

test('review: tenant disabling automatic promises prevents promised-state mutation', () => {
  const s = setup({
    policyOverrides: { payment_promises: { record_automatically: false } },
  });
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{
    kind: 'reply', at: '2026-08-15T10:00:00Z',
    reply: { intent: 'promise_to_pay', confidence: 0.95, rationale: 'pay Friday',
      extracted_dates: ['2026-08-21'], original_message_ref: 'promise-disabled' },
  }]);
  assert.equal(runner.case.status, 'human_required');
  assert.equal(runner.case.promise_date, null);
});

test('review: far-future promise requires human instead of pausing collection for years', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{
    kind: 'reply', at: '2026-08-15T10:00:00Z',
    reply: { intent: 'promise_to_pay', confidence: 0.95, rationale: 'pay in 2028',
      extracted_dates: ['2028-01-01'], original_message_ref: 'promise-far' },
  }]);
  assert.equal(runner.case.status, 'human_required');
  assert.equal(runner.case.promise_date, null);
});

test('review: low-confidence operational reply always requires a human', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{
    kind: 'reply', at: '2026-08-15T10:00:00Z',
    reply: { intent: 'out_of_office', confidence: 0.2, rationale: 'uncertain auto-reply parse',
      return_date: '2026-08-25', original_message_ref: 'low-confidence-ooo' },
  }]);
  assert.equal(runner.case.status, 'human_required');
});

test('review: claimed payment that fresh accounting data does not confirm escalates', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{
    kind: 'reply', at: '2026-08-15T10:00:00Z',
    reply: { intent: 'claimed_paid', confidence: 0.95, rationale: 'customer says paid',
      original_message_ref: 'paid-claim-unconfirmed' },
  }]);
  assert.equal(runner.case.status, 'claimed_paid');
  runner.ingest([{
    kind: 'source_snapshot', at: '2026-08-15T10:01:00Z',
    invoice: makeInvoiceSnapshot({ ...s.invoice, last_synced_at: '2026-08-15T10:01:00Z' }),
  }]);
  assert.equal(runner.case.status, 'human_required');
  assert.equal(runner.log.filter((e) => e.kind === 'reconcile_claim').length, 1);
});

test('review: duplicate inbound message reference is applied once', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  const reply = { intent: 'promise_to_pay', confidence: 0.95, rationale: 'pay Friday',
    extracted_dates: ['2026-08-21'], original_message_ref: 'same-message' };
  runner.ingest([
    { kind: 'reply', at: '2026-08-15T10:00:00Z', reply },
    { kind: 'reply', at: '2026-08-15T10:01:00Z', reply },
  ]);
  assert.equal(runner.case.status, 'promised');
  assert.equal(runner.case.applied_action_ids.length, 1);
  assert.equal(runner.log.filter((e) => e.kind === 'duplicate_reply_ignored').length, 1);
});

test('review: same-tenant wrong invoice snapshot cannot resolve a case', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  const wrongPaid = makeInvoiceSnapshot({
    ...s.invoice, provider_invoice_id: 'inv-other', source_status: 'paid', open_balance_cents: 0,
    last_synced_at: '2026-08-15T10:00:00Z',
  });
  assert.throws(() => runner.ingest([{
    kind: 'source_snapshot', at: '2026-08-15T10:00:00Z', invoice: wrongPaid,
  }]), /source_snapshot identity mismatch/);
  assert.equal(runner.case.status, 'overdue');
});

test('review: apply_action cannot invent an execution that was never proposed', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  assert.throws(() => runner.ingest([{
    kind: 'apply_action', at: '2026-08-15T09:00:01Z',
    action_id: 'invented-action', kind_applied: 'send_reminder',
  }]), /cannot apply unknown action_id/);
  assert.equal(runner.case.reminder_stage, 0);
});

test('review: retries at later timestamps reuse one reminder action identity', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([
    { kind: 'tick', at: '2026-08-15T09:00:00Z' },
    { kind: 'tick', at: '2026-08-15T09:01:00Z' },
  ]);
  assert.equal(runner.log.filter((e) => e.kind === 'propose').length, 1);
  assert.equal(runner.log.filter((e) => e.kind === 'duplicate_proposal_ignored').length, 1);
  assert.ok(runner.proposals.has('case-1:reminder:1'));
});

test('review: execution re-check prevents a send after source becomes paid', () => {
  const s = setup();
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{ kind: 'tick', at: '2026-08-15T09:00:00Z' }]);
  const paid = makeInvoiceSnapshot({
    ...s.invoice, source_status: 'paid', open_balance_cents: 0,
    last_synced_at: '2026-08-15T09:00:02Z',
  });
  runner.ingest([{ kind: 'source_snapshot', at: '2026-08-15T09:00:02Z', invoice: paid }]);
  runner.ingest([{
    kind: 'apply_action', at: '2026-08-15T09:00:03Z',
    action_id: 'case-1:reminder:1', kind_applied: 'send_reminder',
  }]);
  assert.equal(runner.case.status, 'resolved');
  assert.equal(runner.case.applied_action_ids.length, 0);
  assert.equal(runner.log.at(-1).kind, 'apply_blocked');
});

test('review: clock rejects out-of-order events', () => {
  const clock = new Clock('2026-08-15T10:00:00Z');
  assert.throws(() => clock.advanceTo('2026-08-15T09:59:59Z'), /clock cannot move backwards/);
});

test('review: requested invoice copy can be resent without increasing reminder stage', () => {
  const s = setup({
    invoiceOverrides: {
      invoice_link_url: 'https://example.test/invoice/inv-1',
      last_synced_at: '2026-08-15T09:59:30Z',
    },
    caseOverrides: { reminder_stage: 1, last_action_at: '2026-08-06T09:00:00Z' },
  });
  const runner = new EventRunner({ initialCase: s.arCase, initialInvoice: s.invoice, policy: s.policy, clock: s.clock });
  runner.ingest([{
    kind: 'reply', at: '2026-08-15T10:00:00Z',
    reply: { intent: 'request_invoice_copy', confidence: 0.98, rationale: 'please resend invoice',
      original_message_ref: 'copy-request' },
  }]);
  const proposed = runner.proposals.get('case-1:resend:copy-request');
  assert.equal(proposed.result.decision, 'ALLOW');
  runner.ingest([{
    kind: 'apply_action', at: '2026-08-15T10:00:01Z',
    action_id: 'case-1:resend:copy-request', kind_applied: 'resend_invoice',
  }]);
  assert.equal(runner.case.reminder_stage, 1);
  assert.equal(runner.case.applied_action_ids.length, 1);
});
