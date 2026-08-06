// State transition engine. Every function takes (case, invoice, policy, clock,
// context) and returns { case: updatedCase, transitions: [...] }. Pure. No IO.
//
// The engine's job is to observe source truth + inbound replies + prior action
// results and answer: what is this case's status right now, and when should the
// next action fire? It does NOT decide whether an action is allowed. That is
// the policy gateway.

import { assertTransition, TERMINAL_STATUSES } from '../domain/case.mjs';
import { addBusinessDaysIso, dueDateToInstant, parseIso } from '../domain/time.mjs';

const HALT_STATUSES = new Set(['paused', 'human_required', 'resolved']);

function transitionTo(current, next, reason) {
  assertTransition(current.status, next);
  return { case: { ...current, status: next }, note: `${current.status}->${next}: ${reason}` };
}

// Reconcile against source truth first. Source status trumps case status; if
// QBO says paid or void, resolve immediately regardless of AR case state.
export function reconcileWithSource({ arCase, invoice, clock }) {
  if (invoice.source_status === 'paid' || invoice.source_status === 'void') {
    if (arCase.status === 'resolved') return { case: arCase, transitions: [] };
    const t = transitionTo(arCase, 'resolved', `source status ${invoice.source_status}`);
    return {
      case: { ...t.case, next_action_at: null, awaiting_reply: false, pause_reason: null },
      transitions: [t.note],
    };
  }
  return { case: arCase, transitions: [] };
}

// Move monitoring -> overdue when due date + grace has passed. Also handles
// promised -> overdue when the promise date has come and gone without payment.
export function advanceOverdueState({ arCase, invoice, policy, clock }) {
  const transitions = [];
  let c = arCase;

  if (TERMINAL_STATUSES.includes(c.status) || HALT_STATUSES.has(c.status)) {
    return { case: c, transitions };
  }

  const dueInstant = dueDateToInstant(invoice.due_date);
  const graceEnd = addBusinessDaysIso(dueInstant, policy.grace_days);
  const now = parseIso(clock.now());

  if (c.status === 'monitoring' && now >= parseIso(graceEnd)) {
    const t = transitionTo(c, 'overdue', 'past due + grace');
    c = { ...t.case, next_action_at: clock.now() };
    transitions.push(t.note);
  }

  if (c.status === 'promised' && c.promise_date && now > parseIso(c.promise_date)) {
    // Promise date came and went. The runner is responsible for triggering a
    // verify_payment; here we flip the state so a fresh reconcile decides.
    if (invoice.source_status === 'open') {
      const t = transitionTo(c, 'overdue', 'promise date passed, source still open');
      c = { ...t.case, next_action_at: clock.now(), promise_date: null };
      transitions.push(t.note);
    }
  }

  return { case: c, transitions };
}

// Apply an inbound reply to the case. The classifier already validated the
// intent vocabulary. We map intents to case-state changes deterministically.
// We do NOT act on the reply here (no sends); we only update state.
export function applyReply({ arCase, invoice, policy, reply, clock }) {
  const transitions = [];
  let c = { ...arCase, awaiting_reply: true }; // a reply arrived; block sends until handled

  switch (reply.intent) {
    case 'promise_to_pay': {
      if (reply.confidence < policy.low_confidence_threshold
          || (reply.extracted_dates || []).length !== 1) {
        c = markHumanRequired(c, transitions, 'ambiguous or low-confidence promise');
        break;
      }
      const promiseIso = `${reply.extracted_dates[0]}T12:00:00Z`;
      // Only auto-record if we're in an active state.
      if (c.status === 'overdue' || c.status === 'monitoring') {
        const t = transitionTo(c, 'promised', 'clear promise_to_pay');
        c = { ...t.case, promise_date: promiseIso, next_action_at: promiseIso };
        transitions.push(t.note);
      }
      break;
    }
    case 'payment_plan_request': {
      if (c.status !== 'plan_requested' && c.status !== 'resolved') {
        const t = transitionTo(c, 'plan_requested', 'customer requested payment plan');
        c = { ...t.case };
        transitions.push(t.note);
      }
      break;
    }
    case 'dispute': {
      if (policy.pause_on_dispute) {
        c = markHumanRequired(c, transitions, 'dispute pauses routine collection');
      }
      break;
    }
    case 'claimed_paid': {
      if (c.status !== 'claimed_paid' && c.status !== 'resolved') {
        const t = transitionTo(c, 'claimed_paid', 'customer says already paid');
        c = { ...t.case, next_action_at: clock.now() };
        transitions.push(t.note);
      }
      break;
    }
    case 'partial_payment': {
      // No state change; source-truth reconciliation handles the balance update
      // on the next sync. We keep awaiting_reply true so the runner surfaces
      // this to the operator if source doesn't show a partial in reasonable time.
      break;
    }
    case 'wrong_recipient': {
      c = markHumanRequired(c, transitions, 'wrong recipient reply');
      break;
    }
    case 'out_of_office': {
      if (reply.return_date) {
        const returnIso = `${reply.return_date}T09:00:00Z`;
        c = { ...c, next_action_at: returnIso, awaiting_reply: false };
      }
      break;
    }
    case 'request_invoice_copy': {
      // Handled as an internal action proposal by the engine caller; we do
      // not gate the reminder cadence further here.
      c = { ...c, awaiting_reply: false };
      break;
    }
    case 'contact_preference':
    case 'question':
    case 'other': {
      // Ambiguous; low-confidence forces human review. High-confidence
      // "question" or "contact_preference" still needs a human because we
      // do not auto-answer questions in V1.
      c = markHumanRequired(c, transitions, `intent ${reply.intent} requires human`);
      break;
    }
  }

  return { case: c, transitions };
}

function markHumanRequired(c, transitions, reason) {
  if (c.status === 'human_required') return c;
  const t = transitionTo(c, 'human_required', reason);
  transitions.push(t.note);
  return { ...t.case, next_action_at: null };
}

// Record an executed reminder in case state and bump stage.
export function recordReminderSent({ arCase, policy, clock }) {
  const stage = arCase.reminder_stage + 1;
  let next_action_at = null;
  if (stage < policy.max_routine_reminders) {
    const intervalDays = policy.reminder_intervals_business_days[stage];
    next_action_at = addBusinessDaysIso(clock.now(), intervalDays);
  }
  return {
    ...arCase,
    reminder_stage: stage,
    last_action_at: clock.now(),
    next_action_at,
    awaiting_reply: false,
  };
}
