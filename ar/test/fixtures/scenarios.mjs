// Fixtures for all 30 scenarios in docs/singh-ar/TEST-MATRIX.md.
// Each scenario describes: initial case, initial invoice snapshot, policy,
// event stream, and expected assertions after replay.
//
// Time is fabricated deterministically. The "current date" for the deterministic
// core is 2026-08-15 (Saturday) unless a scenario advances it.
//
// Convention: due dates are YYYY-MM-DD; instants used in events are ISO with Z.

import { defaultPolicy, policyWithPlanAuthority } from './policies.mjs';

const ORG = 'org-A';
const ORG2 = 'org-B';

function invoiceFor(scenarioId, { balance = 200_000, due, source_status = 'open',
    synced_at, is_consumer_debt = false, tags = [] } = {}) {
  return {
    organization_id: ORG,
    provider: 'quickbooks_online',
    provider_invoice_id: `inv-${scenarioId}`,
    provider_customer_id: `cust-${scenarioId}`,
    currency: 'USD',
    original_amount_cents: balance,
    open_balance_cents: balance,
    issue_date: '2026-07-01',
    due_date: due,
    source_status,
    last_synced_at: synced_at,
    is_consumer_debt,
    tags,
  };
}

function caseFor(scenarioId, policy, { status = 'monitoring', stage = 0, last_action_at = null,
    next_action_at = null, promise_date = null } = {}) {
  return {
    organization_id: policy.organization_id,
    case_id: `case-${scenarioId}`,
    invoice_id: `inv-${scenarioId}`,
    status,
    reminder_stage: stage,
    policy_version_id: policy.policy_version_id,
    last_action_at,
    next_action_at,
    promise_date,
  };
}

const noon = (isoDate) => `${isoDate}T12:00:00Z`;

export function allScenarios() {
  const scenarios = [];

  { const policy = defaultPolicy();
    scenarios.push({ id: 1, title: 'invoice not yet due -> monitor only', policy,
      initialInvoice: invoiceFor(1, { due: '2026-08-20', synced_at: '2026-08-15T12:00:00Z' }),
      initialCase: caseFor(1, policy),
      events: [{ kind: 'tick', at: '2026-08-15T12:00:00Z' }],
      expect: { caseStatus: 'monitoring', lastProposalKind: null } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 2, title: '1 day overdue with no prior reminder -> ALLOW stage-1 reminder', policy,
      initialInvoice: invoiceFor(2, { due: '2026-08-13', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(2, policy),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'ALLOW' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 3, title: 'firmer stage-2 after interval elapsed', policy,
      initialInvoice: invoiceFor(3, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(3, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastToneStage: 2, lastDecision: 'ALLOW' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 4, title: 'reminder sent yesterday -> INTERVAL_NOT_MET', policy,
      initialInvoice: invoiceFor(4, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(4, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-14T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'BLOCK', lastReasonCode: 'INTERVAL_NOT_MET' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 5, title: 'clear promise_to_pay -> record + pause until date', policy,
      initialInvoice: invoiceFor(5, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(5, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-14T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' },
        { kind: 'reply', at: '2026-08-15T10:00:00Z',
          reply: { intent: 'promise_to_pay', confidence: 0.92, rationale: '"we will pay by Friday"',
            extracted_dates: ['2026-08-21'], original_message_ref: 'msg-5-a' } }],
      expect: { caseStatus: 'promised', promiseDate: noon('2026-08-21') } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 6, title: 'promise date passes, source paid -> resolve', policy,
      initialInvoice: invoiceFor(6, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(6, policy, { status: 'promised', stage: 1, last_action_at: '2026-08-14T09:00:00Z', promise_date: noon('2026-08-21') }),
      events: [{ kind: 'source_snapshot', at: '2026-08-22T09:00:00Z',
        invoice: { ...invoiceFor(6, { due: '2026-08-04', synced_at: '2026-08-22T08:59:00Z' }),
          source_status: 'paid', open_balance_cents: 0 } }],
      expect: { caseStatus: 'resolved' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 7, title: 'promise date passes, unpaid -> back to overdue', policy,
      initialInvoice: invoiceFor(7, { due: '2026-08-04', synced_at: '2026-08-22T09:00:00Z' }),
      initialCase: caseFor(7, policy, { status: 'promised', stage: 1, last_action_at: '2026-08-14T09:00:00Z', promise_date: noon('2026-08-21') }),
      events: [{ kind: 'source_snapshot', at: '2026-08-22T09:00:00Z',
        invoice: invoiceFor(7, { due: '2026-08-04', synced_at: '2026-08-22T09:00:00Z' }) }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'ALLOW' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 8, title: 'payment plan request, default policy -> approval required', policy,
      initialInvoice: invoiceFor(8, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(8, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' },
        { kind: 'reply', at: '2026-08-15T10:00:00Z',
          reply: { intent: 'payment_plan_request', confidence: 0.9,
            rationale: '"can we do $2,000 now and rest in 30 days?"',
            extracted_amounts_cents: [200_000], original_message_ref: 'msg-8-a' } }],
      expect: { caseStatus: 'plan_requested' },
      extraProposalCheck: {
        action: { action_id: 'plan-accept-8', organization_id: policy.organization_id,
          case_id: 'case-8', invoice_id: 'inv-8', kind: 'accept_payment_plan',
          proposed_by: 'engine', reason: 'test scenario 8',
          extra: { total_cents: 200_000, upfront_cents: 60_000, extension_days: 30 } },
        expectDecision: 'REQUIRE_APPROVAL', expectReasonCode: 'PLAN_AUTHORITY_DISABLED' } }); }

  { const policy = policyWithPlanAuthority();
    scenarios.push({ id: 9, title: 'payment plan request within bounded enabled policy -> ALLOW', policy,
      initialInvoice: invoiceFor(9, { due: '2026-08-04', balance: 300_000, synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(9, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'payment_plan_request', confidence: 0.95,
          rationale: 'customer requested a bounded payment plan',
          extracted_amounts_cents: [100_000, 200_000], original_message_ref: 'msg-9-a' } }],
      extraProposalCheck: {
        action: { action_id: 'plan-accept-9', organization_id: policy.organization_id,
          case_id: 'case-9', invoice_id: 'inv-9', kind: 'accept_payment_plan',
          proposed_by: 'engine', reason: 'bounded plan proposal fits',
          extra: { total_cents: 300_000, upfront_cents: 100_000, extension_days: 30 } },
        expectDecision: 'ALLOW' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 10, title: 'customer disputes -> human_required', policy,
      initialInvoice: invoiceFor(10, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(10, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'dispute', confidence: 0.95,
          rationale: '"you charged for 40 hrs, we only agreed to 20"',
          original_message_ref: 'msg-10-a' } }],
      expect: { caseStatus: 'human_required' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 11, title: 'claimed_paid + source confirms -> resolve', policy,
      initialInvoice: invoiceFor(11, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(11, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'claimed_paid', confidence: 0.9, rationale: '"we paid last week"',
          original_message_ref: 'msg-11-a' } },
        { kind: 'source_snapshot', at: '2026-08-15T10:00:00Z',
          invoice: { ...invoiceFor(11, { due: '2026-08-04', synced_at: '2026-08-15T10:00:00Z' }),
            source_status: 'paid', open_balance_cents: 0 } }],
      expect: { caseStatus: 'resolved' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 12, title: 'claimed_paid + source disagrees -> no autonomous action', policy,
      initialInvoice: invoiceFor(12, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(12, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'claimed_paid', confidence: 0.9, rationale: '"paid last week"',
          original_message_ref: 'msg-12-a' } },
        { kind: 'source_snapshot', at: '2026-08-15T10:00:00Z',
          invoice: invoiceFor(12, { due: '2026-08-04', synced_at: '2026-08-15T10:00:00Z' }) }],
      expect: { caseStatus: 'claimed_paid', noExternalSendProposed: true } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 13, title: 'partial payment in source -> cadence continues on reduced balance', policy,
      initialInvoice: invoiceFor(13, { balance: 200_000, due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(13, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'source_snapshot', at: '2026-08-15T09:00:00Z',
        invoice: { ...invoiceFor(13, { balance: 200_000, due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
          open_balance_cents: 50_000 } }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'ALLOW', openBalanceCents: 50_000 } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 14, title: 'invoice void -> resolve immediately', policy,
      initialInvoice: invoiceFor(14, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(14, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'source_snapshot', at: '2026-08-15T09:00:00Z',
        invoice: { ...invoiceFor(14, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }), source_status: 'void' } }],
      expect: { caseStatus: 'resolved' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 15, title: 'wrong recipient reply -> human_required', policy,
      initialInvoice: invoiceFor(15, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(15, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'wrong_recipient', confidence: 0.95,
          rationale: '"I am not the right person, contact accounts@..."',
          original_message_ref: 'msg-15-a' } }],
      expect: { caseStatus: 'human_required' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 16, title: 'out_of_office with return date -> defer', policy,
      initialInvoice: invoiceFor(16, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(16, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'out_of_office', confidence: 0.98, rationale: '"out until Aug 25"',
          return_date: '2026-08-25', original_message_ref: 'msg-16-a' } }],
      expect: { caseStatus: 'overdue', nextActionAtMin: '2026-08-25T00:00:00Z' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 17, title: 'low-confidence ambiguous reply -> human_required', policy,
      initialInvoice: invoiceFor(17, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(17, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'promise_to_pay', confidence: 0.4,
          rationale: 'multiple candidate dates in message',
          extracted_dates: ['2026-08-21', '2026-08-22'], original_message_ref: 'msg-17-a' } }],
      expect: { caseStatus: 'human_required' } }); }

  { const policy = defaultPolicy();
    const paidSnap = { ...invoiceFor(18, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      source_status: 'paid', open_balance_cents: 0 };
    scenarios.push({ id: 18, title: 'duplicate source_snapshot -> single transition', policy,
      initialInvoice: invoiceFor(18, { due: '2026-08-04', synced_at: '2026-08-15T08:00:00Z' }),
      initialCase: caseFor(18, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'source_snapshot', at: '2026-08-15T09:00:00Z', invoice: paidSnap },
        { kind: 'source_snapshot', at: '2026-08-15T09:01:00Z', invoice: paidSnap }],
      expect: { caseStatus: 'resolved', reconciliationCountMax: 1 } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 19, title: 'apply_action with duplicate action_id -> applied exactly once', policy,
      initialInvoice: invoiceFor(19, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(19, policy, { status: 'overdue', stage: 0, last_action_at: null }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' },
        { kind: 'apply_action', at: '2026-08-15T09:00:05Z', action_id: 'case-19:reminder:1', kind_applied: 'send_reminder' },
        { kind: 'apply_action', at: '2026-08-15T09:00:06Z', action_id: 'case-19:reminder:1', kind_applied: 'send_reminder' }],
      expect: { reminderStage: 1, appliedIdsCount: 1 } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 20, title: 'missed webhook, reconciliation snapshot repairs state', policy,
      initialInvoice: invoiceFor(20, { due: '2026-08-04', synced_at: '2026-08-15T00:00:00Z' }),
      initialCase: caseFor(20, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'source_snapshot', at: '2026-08-17T00:00:00Z',
        invoice: { ...invoiceFor(20, { due: '2026-08-04', synced_at: '2026-08-17T00:00:00Z' }),
          source_status: 'paid', open_balance_cents: 0 } }],
      expect: { caseStatus: 'resolved' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 21, title: 'stale source snapshot -> BLOCK reminder', policy,
      initialInvoice: invoiceFor(21, { due: '2026-08-04', synced_at: '2026-08-14T00:00:00Z' }),
      initialCase: caseFor(21, policy, { status: 'overdue', stage: 0, last_action_at: null }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'BLOCK', lastReasonCode: 'SOURCE_STALE' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 22, title: 'balance over autonomous threshold -> REQUIRE_APPROVAL', policy,
      initialInvoice: invoiceFor(22, { balance: 2_500_000, due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(22, policy, { status: 'overdue', stage: 0, last_action_at: null }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'REQUIRE_APPROVAL', lastReasonCode: 'OVER_AUTONOMY_THRESHOLD' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 23, title: 'manual pause -> no outbound', policy,
      initialInvoice: invoiceFor(23, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(23, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'human_decision', at: '2026-08-15T09:00:00Z', decision: 'pause', reason: 'owner requested' },
        { kind: 'tick', at: '2026-08-16T09:00:00Z' }],
      expect: { caseStatus: 'paused', noExternalSendProposed: true } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 24, title: 'source paid just before send -> BLOCK by recheck', policy,
      initialInvoice: invoiceFor(24, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(24, policy, { status: 'overdue', stage: 0, last_action_at: null, next_action_at: '2026-08-15T09:00:30Z' }),
      events: [{ kind: 'source_snapshot', at: '2026-08-15T09:00:29Z',
        invoice: { ...invoiceFor(24, { due: '2026-08-04', synced_at: '2026-08-15T09:00:29Z' }),
          source_status: 'paid', open_balance_cents: 0 } },
        { kind: 'tick', at: '2026-08-15T09:00:31Z' }],
      expect: { caseStatus: 'resolved', noExternalSendProposed: true } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 25, title: 'reply request_invoice_copy -> awaiting_reply cleared', policy,
      initialInvoice: invoiceFor(25, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(25, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'request_invoice_copy', confidence: 0.98,
          rationale: '"can you resend the invoice PDF?"', original_message_ref: 'msg-25-a' } }],
      expect: { caseStatus: 'overdue', awaitingReply: false } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 26, title: 'unrelated question reply -> human_required', policy,
      initialInvoice: invoiceFor(26, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(26, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'reply', at: '2026-08-15T09:00:00Z',
        reply: { intent: 'question', confidence: 0.95,
          rationale: '"what were the payment terms on this?"', original_message_ref: 'msg-26-a' } }],
      expect: { caseStatus: 'human_required' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 27, title: 'proposed waive_balance -> REQUIRE_APPROVAL', policy,
      initialInvoice: invoiceFor(27, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(27, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      extraProposalCheck: {
        action: { action_id: 'waive-27', organization_id: policy.organization_id,
          case_id: 'case-27', invoice_id: 'inv-27', kind: 'waive_balance',
          proposed_by: 'engine', reason: 'customer requested waiver' },
        expectDecision: 'REQUIRE_APPROVAL', expectReasonCode: 'GATED_BUSINESS_DECISION' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 28, title: 'proposed threaten_legal -> hard BLOCK', policy,
      initialInvoice: invoiceFor(28, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(28, policy, { status: 'overdue', stage: 1, last_action_at: '2026-08-06T09:00:00Z' }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      extraProposalCheck: {
        action: { action_id: 'threat-28', organization_id: policy.organization_id,
          case_id: 'case-28', invoice_id: 'inv-28', kind: 'threaten_legal',
          proposed_by: 'llm', reason: 'LLM tried to escalate' },
        expectDecision: 'BLOCK', expectReasonCode: 'HARD_PROHIBITED' } }); }

  { const policy = defaultPolicy();
    scenarios.push({ id: 29, title: 'is_consumer_debt=true -> automation blocked', policy,
      initialInvoice: invoiceFor(29, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z', is_consumer_debt: true }),
      initialCase: caseFor(29, policy, { status: 'overdue', stage: 0, last_action_at: null }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      expect: { caseStatus: 'overdue', lastProposalKind: 'send_reminder', lastDecision: 'BLOCK', lastReasonCode: 'CONSUMER_DEBT_UNSUPPORTED' } }); }

  { const policyA = defaultPolicy(ORG);
    scenarios.push({ id: 30, title: 'cross-tenant leak attempt -> tenant mismatch BLOCK', policy: policyA,
      initialInvoice: invoiceFor(30, { due: '2026-08-04', synced_at: '2026-08-15T09:00:00Z' }),
      initialCase: caseFor(30, policyA, { status: 'overdue', stage: 0, last_action_at: null }),
      events: [{ kind: 'tick', at: '2026-08-15T09:00:00Z' }],
      extraProposalCheck: {
        action: { action_id: 'cross-30', organization_id: ORG2,
          case_id: 'case-30', invoice_id: 'inv-30', kind: 'send_reminder',
          proposed_by: 'engine', reason: 'test cross-tenant' },
        expectDecision: 'BLOCK', expectReasonCode: 'TENANT_MISMATCH' } }); }

  return scenarios;
}
