import test from 'node:test';
import assert from 'node:assert/strict';
import { EventRunner, Clock, makeInvoiceSnapshot } from '../src/index.mjs';
import { defaultPolicy } from './fixtures/policies.mjs';

const policy = defaultPolicy();

function baseSetup() {
  const initialInvoice = makeInvoiceSnapshot({
    organization_id: 'org-A', provider: 'quickbooks_online',
    provider_invoice_id: 'i1', provider_customer_id: 'c1',
    currency: 'USD', original_amount_cents: 200_000, open_balance_cents: 200_000,
    issue_date: '2026-07-01', due_date: '2026-08-04', source_status: 'open',
    last_synced_at: '2026-08-15T09:00:00Z',
  });
  const initialCase = {
    organization_id: 'org-A', case_id: 'case-idem',
    invoice_id: 'i1', status: 'overdue',
    reminder_stage: 0, last_action_at: null, next_action_at: null,
    policy_version_id: policy.policy_version_id,
  };
  const clock = new Clock('2026-08-15T09:00:00Z');
  return { initialCase, initialInvoice, policy, clock };
}

test('idempotency: duplicate apply_action applied exactly once', () => {
  const runner = new EventRunner(baseSetup());
  runner.ingest([
    { kind: 'tick', at: '2026-08-15T09:00:00Z' },
    { kind: 'apply_action', at: '2026-08-15T09:00:05Z', action_id: 'case-idem:reminder:1', kind_applied: 'send_reminder' },
    { kind: 'apply_action', at: '2026-08-15T09:00:06Z', action_id: 'case-idem:reminder:1', kind_applied: 'send_reminder' },
    { kind: 'apply_action', at: '2026-08-15T09:00:07Z', action_id: 'case-idem:reminder:1', kind_applied: 'send_reminder' },
  ]);
  assert.equal(runner.case.reminder_stage, 1);
  assert.equal(runner.case.applied_action_ids.length, 1);
});

test('idempotency: full replay is deterministic', () => {
  const events = [
    { kind: 'tick', at: '2026-08-15T09:00:00Z' },
    { kind: 'apply_action', at: '2026-08-15T09:00:05Z', action_id: 'case-idem:reminder:1', kind_applied: 'send_reminder' },
    { kind: 'source_snapshot', at: '2026-08-15T10:00:00Z',
      invoice: makeInvoiceSnapshot({
        organization_id: 'org-A', provider: 'quickbooks_online',
        provider_invoice_id: 'i1', provider_customer_id: 'c1',
        currency: 'USD', original_amount_cents: 200_000, open_balance_cents: 0,
        issue_date: '2026-07-01', due_date: '2026-08-04', source_status: 'paid',
        last_synced_at: '2026-08-15T10:00:00Z',
      }) },
  ];

  const runA = new EventRunner(baseSetup());
  runA.ingest(events);
  const runB = new EventRunner(baseSetup());
  runB.ingest(events);

  assert.deepEqual(runA.snapshot(), runB.snapshot());
  assert.equal(runA.case.status, 'resolved');
});

test('idempotency: duplicate source_snapshot events produce single resolve transition', () => {
  const runner = new EventRunner(baseSetup());
  const base = runner.invoice;
  const paid = { ...base, source_status: 'paid', open_balance_cents: 0,
    last_synced_at: '2026-08-15T09:30:00Z' };
  runner.ingest([
    { kind: 'source_snapshot', at: '2026-08-15T09:30:00Z', invoice: paid },
    { kind: 'source_snapshot', at: '2026-08-15T09:31:00Z', invoice: paid },
    { kind: 'source_snapshot', at: '2026-08-15T09:32:00Z', invoice: paid },
  ]);
  const reconciles = runner.log.filter((e) => e.kind === 'reconcile');
  assert.equal(reconciles.length, 1, `expected 1 reconcile, got ${reconciles.length}`);
});
