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
import { makeProposedAction } from '../domain/action.mjs';
import { evaluate as evaluatePolicy } from './policy.mjs';
import {
  reconcileWithSource, advanceOverdueState, applyReply, recordReminderSent,
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
    this.invoice = initialInvoice;
    this.policy = policy;
    this.clock = clock;
    this.lastReply = null;
    this.log = []; // append-only ordered ledger of every step
    this.appliedActionIds = new Set(this.case.applied_action_ids || []);
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
        this.invoice = ev.invoice;
        this._reconcileAndAdvance('source_snapshot');
        break;
      }
      case 'reply': {
        this.lastReply = ev.reply;
        const res = applyReply({
          arCase: this.case, invoice: this.invoice, policy: this.policy,
          reply: ev.reply, clock: this.clock,
        });
        this.case = res.case;
        for (const t of res.transitions) this._log('transition', t);
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
      this._log('propose', { action: proposal, result, source: sourceLabel });
    }
  }

  _proposeNextAction() {
    const c = this.case;
    if (c.status === 'resolved' || c.status === 'paused' || c.status === 'human_required') return null;

    if (c.status === 'claimed_paid') {
      return makeProposedAction({
        action_id: `${c.case_id}:verify:${this.clock.now()}`,
        organization_id: c.organization_id, case_id: c.case_id,
        invoice_id: c.invoice_id, kind: 'verify_payment',
        proposed_by: 'engine',
        reason: 'customer claimed paid; verify against source',
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
        action_id: `${c.case_id}:reminder:${stage}:${this.clock.now()}`,
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
    this.appliedActionIds.add(ev.action_id);
    this.case = {
      ...this.case,
      applied_action_ids: [...this.case.applied_action_ids, ev.action_id],
    };
    if (ev.kind_applied === 'send_reminder' || ev.kind_applied === 'resend_invoice') {
      this.case = recordReminderSent({ arCase: this.case, policy: this.policy, clock: this.clock });
      this._log('applied', { action_id: ev.action_id, kind: ev.kind_applied,
        new_stage: this.case.reminder_stage });
    } else if (ev.kind_applied === 'resolve') {
      if (this.case.status !== 'resolved') {
        // Only valid if source agrees, but the caller decided.
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
      case 'approve':
      case 'reject':
        this._log('human_decision', `${ev.decision} ${ev.target_action_id || ''}`.trim());
        break;
      default:
        throw new Error(`unknown human decision: ${ev.decision}`);
    }
    this._reconcileAndAdvance('post_human');
  }

  _log(kind, payload) {
    this.log.push({ at: this.clock.now(), kind, payload });
  }
}
