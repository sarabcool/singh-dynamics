// Tenant isolation. Every policy evaluation must refuse if action's tenant
// does not match the case/invoice/policy tenant.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePolicy, Clock, makePolicy, makeInvoiceSnapshot,
  makeArCase, makeProposedAction,
} from '../src/index.mjs';

function invoice(orgId) {
  return makeInvoiceSnapshot({
    organization_id: orgId, provider: 'quickbooks_online',
    provider_invoice_id: 'i1', provider_customer_id: 'c1',
    currency: 'USD', original_amount_cents: 100, open_balance_cents: 100,
    issue_date: '2026-07-01', due_date: '2026-08-01', source_status: 'open',
    last_synced_at: '2026-08-15T09:00:00Z',
  });
}
function arCase(orgId, policyVersion) {
  return makeArCase({
    organization_id: orgId, case_id: 'c1', invoice_id: 'i1',
    status: 'overdue', reminder_stage: 0, policy_version_id: policyVersion,
  });
}
function policy(orgId) {
  return makePolicy({
    organization_id: orgId, policy_version_id: `${orgId}-pv-1`,
    effective_from: '2026-01-01T00:00:00Z',
  });
}
function action(orgId) {
  return makeProposedAction({
    action_id: 'a1', organization_id: orgId, case_id: 'c1',
    invoice_id: 'i1', kind: 'send_reminder', proposed_by: 'engine',
    reason: 'test',
  });
}

test('isolation: cross-tenant action against tenant A -> BLOCK', () => {
  const p = policy('A');
  const clock = new Clock('2026-08-15T09:00:00Z');
  const res = evaluatePolicy({ action: action('B'), arCase: arCase('A', p.policy_version_id),
    invoice: invoice('A'), policy: p, clock });
  assert.equal(res.decision, 'BLOCK');
  assert.ok(res.reason_codes.includes('TENANT_MISMATCH'));
});

test('isolation: case tenant mismatch alone -> BLOCK', () => {
  const p = policy('A');
  const clock = new Clock('2026-08-15T09:00:00Z');
  const res = evaluatePolicy({ action: action('A'), arCase: arCase('B', p.policy_version_id),
    invoice: invoice('A'), policy: p, clock });
  assert.equal(res.decision, 'BLOCK');
  assert.ok(res.reason_codes.includes('TENANT_MISMATCH'));
});

test('isolation: invoice tenant mismatch alone -> BLOCK', () => {
  const p = policy('A');
  const clock = new Clock('2026-08-15T09:00:00Z');
  const res = evaluatePolicy({ action: action('A'), arCase: arCase('A', p.policy_version_id),
    invoice: invoice('B'), policy: p, clock });
  assert.equal(res.decision, 'BLOCK');
  assert.ok(res.reason_codes.includes('TENANT_MISMATCH'));
});

test('isolation: same-tenant everything -> not blocked by isolation', () => {
  const p = policy('A');
  const clock = new Clock('2026-08-15T09:00:00Z');
  const res = evaluatePolicy({ action: action('A'), arCase: arCase('A', p.policy_version_id),
    invoice: invoice('A'), policy: p, clock });
  assert.notEqual(res.decision, 'BLOCK');
});
