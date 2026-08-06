// End-to-end scenario matrix. Each scenario is replayed through EventRunner and
// asserts specific case status / policy decisions.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EventRunner, Clock, evaluatePolicy, makeInvoiceSnapshot } from '../src/index.mjs';
import { allScenarios } from './fixtures/scenarios.mjs';

function lastProposal(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === 'propose') return log[i].payload;
  }
  return null;
}
function anyExternalSendProposed(log) {
  return log.some((e) =>
    e.kind === 'propose'
    && (e.payload.action.kind === 'send_reminder' || e.payload.action.kind === 'resend_invoice')
    && e.payload.result.decision === 'ALLOW');
}

for (const s of allScenarios()) {
  test(`scenario ${s.id}: ${s.title}`, () => {
    // The invoice snapshot must go through validation.
    const invoice = makeInvoiceSnapshot(s.initialInvoice);
    const clock = new Clock(invoice.last_synced_at);
    const runner = new EventRunner({
      initialCase: s.initialCase,
      initialInvoice: invoice,
      policy: s.policy,
      clock,
    });
    runner.ingest(s.events);
    const snap = runner.snapshot();

    if (s.expect) {
      if (s.expect.caseStatus) assert.equal(snap.case.status, s.expect.caseStatus, `status`);
      if (s.expect.reminderStage !== undefined) {
        assert.equal(snap.case.reminder_stage, s.expect.reminderStage);
      }
      if (s.expect.appliedIdsCount !== undefined) {
        assert.equal(snap.case.applied_action_ids.length, s.expect.appliedIdsCount);
      }
      if (s.expect.awaitingReply !== undefined) {
        assert.equal(snap.case.awaiting_reply, s.expect.awaitingReply);
      }
      if (s.expect.openBalanceCents !== undefined) {
        assert.equal(snap.invoice.open_balance_cents, s.expect.openBalanceCents);
      }
      if (s.expect.promiseDate) {
        assert.equal(snap.case.promise_date, s.expect.promiseDate);
      }
      if (s.expect.nextActionAtMin) {
        assert.ok(snap.case.next_action_at >= s.expect.nextActionAtMin,
          `next_action_at ${snap.case.next_action_at} < ${s.expect.nextActionAtMin}`);
      }
      if (s.expect.lastProposalKind !== undefined) {
        const p = lastProposal(runner.log);
        if (s.expect.lastProposalKind === null) {
          assert.equal(p, null, 'expected no proposal');
        } else {
          assert.ok(p, 'expected a proposal');
          assert.equal(p.action.kind, s.expect.lastProposalKind);
          if (s.expect.lastDecision) assert.equal(p.result.decision, s.expect.lastDecision);
          if (s.expect.lastReasonCode) {
            assert.ok(p.result.reason_codes.includes(s.expect.lastReasonCode),
              `expected code ${s.expect.lastReasonCode}, got ${p.result.reason_codes}`);
          }
          if (s.expect.lastToneStage) assert.equal(p.action.tone_stage, s.expect.lastToneStage);
        }
      }
      if (s.expect.noExternalSendProposed) {
        assert.equal(anyExternalSendProposed(runner.log), false,
          'expected no allowed external send');
      }
    }

    // extraProposalCheck: explicitly evaluate a crafted action against the
    // final state to test individual policy paths that the runner itself
    // wouldn't propose (waive_balance, threaten_legal, cross-tenant, etc.).
    if (s.extraProposalCheck) {
      const { action, expectDecision, expectReasonCode } = s.extraProposalCheck;
      const result = evaluatePolicy({
        action, arCase: snap.case, invoice: snap.invoice,
        policy: s.policy, clock, lastReply: snap.lastReply,
      });
      assert.equal(result.decision, expectDecision,
        `extra decision: expected ${expectDecision}, got ${result.decision} (${result.reason})`);
      if (expectReasonCode) {
        assert.ok(result.reason_codes.includes(expectReasonCode),
          `expected reason ${expectReasonCode}, got ${result.reason_codes}`);
      }
    }
  });
}
