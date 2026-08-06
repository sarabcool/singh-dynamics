// Event runner. In-memory, deterministic, replayable. No I/O.
//
// Feed it (initial case, invoice snapshots over time, replies over time,
// policy, clock) and it produces the sequence of proposed actions the engine
// would have generated, each paired with its PolicyResult.
//
// Idempotency guarantee: replaying the same event sequence produces the same
// output, and any action_id observed twice in the input event stream is
// applied exactly once to case state.

import { makeArCase } from '../domain/case.mjs';
import { makeInvoiceSnapshot } from '../domain/invoice.mjs';
import { makeReplyClassification } from '../domain/reply.mjs';
import { makeProposedAction } from '../domain/action.mjs';
import { evaluate as evaluatePolicy } from './policy.mjs';
import {
  reconcileWithSource, advanceOverdueState, applyReply, recordReminderSent, recordInvoiceResent,
} from './transitions.mjs';

// Event kinds accepted by the runner:
//   {kind: 'source_snapshot', at: iso, invoice}
//   {kind: 'reply', at: iso, reply}
//   {kind: 'tick', at: iso}                 // pure time-advance
//   {kind: 'human_decision', at: iso, decision: 'approve'|'reject'|'pause'|'resume', target_action_id?}
//   {kind: 'apply_action', at: iso, action_id, kind, extra?} // simulate executed external send
//
// The runner never actually sends anything. 'apply_action' represents an
// authorized send that has occurred; it advances case state accordingly.

export class EventRunner {
  constructor({ initialCase, initialInvoice, policy, clock }) {
    this.case = makeArCase(initialCase);
    this.invoice = makeInvoiceSnapshot(initialInvoice);
    this.policy = policy;
    this.clock = clock;
    if (this.invoice.organization_id !== this.case.organization_id
        || policy.organization_id !== this.case.organization_id) {
      throw new Error('initial tenant identity mismatch');
    }
    if (this.invoice.provider_invoice_id !== this.case.invoice_id) {
      throw new Error('initial invoice identity mismatch');
    }
    if (policy.policy_version_id !== this.case.policy_version_id) {
      throw new Error('initial policy version mismatch');
    }
    this.lastReply = null;
    this.log = []; // append-only ordered ledger of every step
    this.appliedActionIds = new Set(this.case.applied_action_ids || []);
    this.processedReplyRefs = new Set();
    this.proposals = new Map();
    this.approvedActionIds = new Set();
    this.rejectedActionIds = new Set();
  }

  snapshot() {
    return {
      case: { ...this.case },
      invoice: { ...this.invoice },
      lastReply: this.lastReply ? { ...this.lastReply } : null,
    };
  }

  ingest(events) {
    for (const ev of events) this.ingestOne(ev);
    return this.snapshot();
  }

  ingestOne(ev) {
    if (!ev || typeof ev !== 'object') throw new Error('event must be object');
    if (typeof ev.at !== 'string') throw new Error('event.at required');
    this.clock.advanceTo(ev.at);

    switch (ev.kind) {
      case 'tick': {
        this._reconcileAndAdvance('tick');
        break;
      }
      case 'source_snapshot': {
        const nextInvoice = makeInvoiceSnapshot(ev.invoice);
        if (nextInvoice.organization_id !== this.case.organization_id
            || nextInvoice.provider_invoice_id !== this.case.invoice_id) {
          throw new Error('source_snapshot identity mismatch');
        }
        this.invoice = nextInvoice;
        this._reconcileAndAdvance('source_snapshot');
        break;
      }
      case 'reply': {
        const reply = makeReplyClassification(ev.reply);
        if (this.processedReplyRefs.has(reply.original_message_ref)) {
          this._log('duplicate_reply_ignored', { original_message_ref: reply.original_message_ref });
          break;
        }
        this.processedReplyRefs.add(reply.original_message_ref);
        this.lastReply = reply;

        let promisePolicyResult = null;
        let promiseAction = null;
        if (reply.intent === 'promise_to_pay') {
          promiseAction = makeProposedAction({
            action_id: `${this.case.case_id}:record-promise:${reply.original_message_ref}`,
            organization_id: this.case.organization_id, case_id: this.case.case_id,
            invoice_id: this.case.invoice_id, kind: 'record_promise',
            proposed_by: 'engine', reason: 'record clear customer promise to pay',
          });
          promisePolicyResult = evaluatePolicy({
            action: promiseAction, arCase: this.case, invoice: this.invoice,
            policy: this.policy, clock: this.clock, lastReply: reply,
          });
          this._recordProposal(promiseAction, promisePolicyResult, 'reply');
        }

        const res = applyReply({
          arCase: this.case, invoice: this.invoice, policy: this.policy,
          reply, clock: this.clock, promisePolicyResult,
        });
        this.case = res.case;
        for (const t of res.transitions) this._log('transition', t);
        if (promiseAction && promisePolicyResult?.decision === 'ALLOW'
            && this.case.status === 'promised'
            && !this.appliedActionIds.has(promiseAction.action_id)) {
          this.appliedActionIds.add(promiseAction.action_id);
          this.case = {
            ...this.case,
            applied_action_ids: [...this.case.applied_action_ids, promiseAction.action_id],
          };
          this._log('applied_internal', { action_id: promiseAction.action_id, kind: 'record_promise' });
        }
        this._reconcileAndAdvance('post_reply');
        break;
      }
      case 'human_decision': {
        this._applyHumanDecision(ev);
        break;
      }
      case 'apply_action': {
        this._applyAction(ev);
        break;
      }
      default:
        throw new Error(`unknown event kind: ${ev.kind}`);
    }
  }

  _reconcileAndAdvance(sourceLabel) {
    const r1 = reconcileWithSource({ arCase: this.case, invoice: this.invoice, clock: this.clock });
    this.case = r1.case;
    for (const t of r1.transitions) this._log('reconcile', t);

    const r2 = advanceOverdueState({
      arCase: this.case, invoice: this.invoice, policy: this.policy, clock: this.clock,
    });
    this.case = r2.case;
    for (const t of r2.transitions) this._log('advance', t);

    // Propose the next action if one is warranted at this instant.
    const proposal = this._proposeNextAction();
    if (proposal) {
      const result = evaluatePolicy({
        action: proposal, arCase: this.case, invoice: this.invoice,
        policy: this.policy, clock: this.clock, lastReply: this.lastReply,
      });
      this._recordProposal(proposal, result, sourceLabel);
    }
  }

  _proposeNextAction() {
    const c = this.case;
    if (c.status === 'resolved' || c.status === 'paused' || c.status === 'human_required') return null;

    if (c.status === 'claimed_paid') {
      return makeProposedAction({
        action_id: `${c.case_id}:verify:${this.lastReply?.original_message_ref || 'claim'}`,
        organization_id: c.organization_id, case_id: c.case_id,
        invoice_id: c.invoice_id, kind: 'verify_payment',
        proposed_by: 'engine',
        reason: 'customer claimed paid; verify against source',
      });
    }

    if (this.lastReply?.intent === 'request_invoice_copy' && !c.awaiting_reply
        && c.status === 'overdue') {
      return makeProposedAction({
        action_id: `${c.case_id}:resend:${this.lastReply.original_message_ref}`,
        organization_id: c.organization_id, case_id: c.case_id,
        invoice_id: c.invoice_id, kind: 'resend_invoice',
        proposed_by: 'engine',
        reason: 'customer requested a copy of the existing invoice',
      });
    }

    if (c.status === 'promised') {
      // Wait until promise date; runner does not propose a send.
      return null;
    }

    if (c.status === 'overdue' && (c.next_action_at === null
        || this.clock.now() >= c.next_action_at)) {
      const stage = c.reminder_stage + 1;
      return makeProposedAction({
        action_id: `${c.case_id}:reminder:${stage}`,
        organization_id: c.organization_id, case_id: c.case_id,
        invoice_id: c.invoice_id, kind: 'send_reminder',
        tone_stage: stage,
        proposed_by: 'engine',
        reason: `stage ${stage} routine reminder`,
        facts_used: [
          `invoice ${c.invoice_id} due ${this.invoice.due_date}`,
          `balance ${this.invoice.open_balance_cents}`,
          `source_status ${this.invoice.source_status}`,
        ],
      });
    }

    return null;
  }

  _applyAction(ev) {
    if (this.appliedActionIds.has(ev.action_id)) {
      this._log('duplicate_ignored', { action_id: ev.action_id });
      return;
    }
    if (this.rejectedActionIds.has(ev.action_id)) {
      this._log('apply_blocked', { action_id: ev.action_id, reason: 'human_rejected' });
      return;
    }
    const proposed = this.proposals.get(ev.action_id);
    if (!proposed) throw new Error(`cannot apply unknown action_id: ${ev.action_id}`);
    if (proposed.action.kind !== ev.kind_applied) {
      throw new Error(`action kind mismatch for ${ev.action_id}: ${ev.kind_applied} != ${proposed.action.kind}`);
    }

    // Re-evaluate against current source truth at execution time. An old ALLOW
    // never survives a payment, pause, reply, or other state change.
    const currentResult = evaluatePolicy({
      action: proposed.action, arCase: this.case, invoice: this.invoice,
      policy: this.policy, clock: this.clock, lastReply: this.lastReply,
    });
    if (currentResult.decision === 'BLOCK') {
      this._log('apply_blocked', {
        action_id: ev.action_id, reason: currentResult.reason,
        reason_codes: currentResult.reason_codes,
      });
      return;
    }
    if (currentResult.decision === 'REQUIRE_APPROVAL'
        && !this.approvedActionIds.has(ev.action_id)) {
      this._log('apply_blocked', { action_id: ev.action_id, reason: 'approval_required' });
      return;
    }

    this.appliedActionIds.add(ev.action_id);
    this.case = {
      ...this.case,
      applied_action_ids: [...this.case.applied_action_ids, ev.action_id],
    };
    if (ev.kind_applied === 'send_reminder') {
      this.case = recordReminderSent({ arCase: this.case, policy: this.policy, clock: this.clock });
      this._log('applied', { action_id: ev.action_id, kind: ev.kind_applied,
        new_stage: this.case.reminder_stage });
    } else if (ev.kind_applied === 'resend_invoice') {
      this.case = recordInvoiceResent({ arCase: this.case, policy: this.policy, clock: this.clock });
      this._log('applied', { action_id: ev.action_id, kind: ev.kind_applied,
        new_stage: this.case.reminder_stage });
    } else if (ev.kind_applied === 'resolve') {
      if (this.case.status !== 'resolved') {
        this.case = { ...this.case, status: 'resolved', next_action_at: null };
        this._log('applied', { action_id: ev.action_id, kind: 'resolve' });
      }
    }
  }

  _applyHumanDecision(ev) {
    const c = this.case;
    switch (ev.decision) {
      case 'pause':
        if (c.status !== 'paused' && c.status !== 'resolved') {
          this.case = { ...c, status: 'paused', pause_reason: ev.reason || 'manual', next_action_at: null };
          this._log('human_decision', 'paused');
        }
        break;
      case 'resume':
        if (c.status === 'paused') {
          this.case = { ...c, status: 'overdue', pause_reason: null, next_action_at: this.clock.now() };
          this._log('human_decision', 'resumed');
        }
        break;
      case 'approve': {
        if (!ev.target_action_id || !this.proposals.has(ev.target_action_id)) {
          throw new Error('approve requires a known target_action_id');
        }
        this.approvedActionIds.add(ev.target_action_id);
        this.rejectedActionIds.delete(ev.target_action_id);
        this._log('human_decision', `approve ${ev.target_action_id}`);
        break;
      }
      case 'reject': {
        if (!ev.target_action_id || !this.proposals.has(ev.target_action_id)) {
          throw new Error('reject requires a known target_action_id');
        }
        this.rejectedActionIds.add(ev.target_action_id);
        this.approvedActionIds.delete(ev.target_action_id);
        this._log('human_decision', `reject ${ev.target_action_id}`);
        break;
      }
      default:
        throw new Error(`unknown human decision: ${ev.decision}`);
    }
    this._reconcileAndAdvance('post_human');
  }

  _recordProposal(action, result, source) {
    const prior = this.proposals.get(action.action_id);
    if (prior) {
      this._log('duplicate_proposal_ignored', { action_id: action.action_id, source });
      return prior;
    }
    const record = { action, result, source };
    this.proposals.set(action.action_id, record);
    this._log('propose', record);
    return record;
  }

  _log(kind, payload) {
    this.log.push({ at: this.clock.now(), kind, payload });
  }
}
