// Deterministic policy gateway.
// Given (action, case, invoice, policy, clock) -> exactly one PolicyResult.
// NEVER reads LLM confidence as authority. Confidence only increases friction,
// it never grants authorization.

import {
  ACTION_KINDS, EXTERNAL_ACTION_KINDS, HARD_PROHIBITED_KINDS,
  REQUIRE_APPROVAL_KINDS_DEFAULT, makePolicyResult,
} from '../domain/action.mjs';
import { addBusinessDaysIso, dueDateToInstant, parseIso, diffDays } from '../domain/time.mjs';

const HALT_STATUSES = new Set(['paused', 'disputed', 'resolved', 'human_required', 'claimed_paid']);
const NON_OPEN_SOURCE = new Set(['paid', 'void']);

export function evaluate({ action, arCase, invoice, policy, clock, lastReply = null }) {
  const evaluated_at = clock.now();
  const pv = policy.policy_version_id;

  // Identity defense first. Tenant isolation is necessary but not sufficient:
  // a same-tenant action must still point at the exact case and invoice being
  // evaluated, and the case must be pinned to the policy version in use.
  if (action.organization_id !== policy.organization_id
      || action.organization_id !== invoice.organization_id
      || action.organization_id !== arCase.organization_id) {
    return makePolicyResult({
      decision: 'BLOCK', reason: 'tenant mismatch across action/case/invoice/policy',
      reason_codes: ['TENANT_MISMATCH'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (action.case_id !== arCase.case_id
      || action.invoice_id !== arCase.invoice_id
      || action.invoice_id !== invoice.provider_invoice_id) {
    return makePolicyResult({
      decision: 'BLOCK', reason: 'case/invoice identity mismatch',
      reason_codes: ['ENTITY_MISMATCH'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (arCase.policy_version_id !== policy.policy_version_id) {
    return makePolicyResult({
      decision: 'BLOCK', reason: 'case is pinned to a different policy version',
      reason_codes: ['POLICY_VERSION_MISMATCH'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (parseIso(policy.effective_from) > parseIso(evaluated_at)) {
    return makePolicyResult({
      decision: 'BLOCK', reason: 'policy version is not effective yet',
      reason_codes: ['POLICY_NOT_EFFECTIVE'],
      policy_version_id: pv, evaluated_at,
    });
  }

  // Hard prohibitions first. Nothing overrides these.
  if (HARD_PROHIBITED_KINDS.includes(action.kind)) {
    return makePolicyResult({
      decision: 'BLOCK', reason: `hard-prohibited action kind: ${action.kind}`,
      reason_codes: ['HARD_PROHIBITED'],
      policy_version_id: pv, evaluated_at,
    });
  }

  // Consumer debt: not supported in V1, block all external and gated actions.
  if (invoice.is_consumer_debt) {
    if (action.kind === 'escalate_human' || action.kind === 'pause' || action.kind === 'wait') {
      return allow(pv, evaluated_at, 'internal action allowed on consumer-debt case for handoff');
    }
    return makePolicyResult({
      decision: 'BLOCK', reason: 'consumer/personal debt is unsupported in V1',
      reason_codes: ['CONSUMER_DEBT_UNSUPPORTED'],
      policy_version_id: pv, evaluated_at,
    });
  }

  switch (action.kind) {
    case 'wait':
    case 'escalate_human':
    case 'pause':
    case 'verify_payment':
      return allow(pv, evaluated_at, `internal action ${action.kind}`);

    case 'unpause':
      return requireApproval(pv, evaluated_at,
        'resuming a paused collection case requires human authority', ['HUMAN_RESUME_REQUIRED']);

    case 'resolve':
      if (invoice.source_status === 'paid' || invoice.source_status === 'void') {
        return allow(pv, evaluated_at, `source-verified resolve: ${invoice.source_status}`);
      }
      return block(pv, evaluated_at,
        `cannot resolve while source status is ${invoice.source_status}`, ['SOURCE_NOT_RESOLVED']);

    case 'record_promise':
      return evaluateRecordPromise({ action, policy, evaluated_at, lastReply });

    case 'send_reminder':
    case 'resend_invoice':
      return evaluateExternalSend({
        action, arCase, invoice, policy, clock, evaluated_at, lastReply,
      });

    case 'accept_payment_plan':
      return evaluatePaymentPlan({ action, arCase, invoice, policy, evaluated_at, lastReply });

    case 'change_terms':
    case 'waive_balance':
    case 'apply_discount':
      return makePolicyResult({
        decision: 'REQUIRE_APPROVAL',
        reason: `${action.kind} always requires human approval in V1`,
        reason_codes: ['GATED_BUSINESS_DECISION'],
        policy_version_id: pv, evaluated_at,
      });
  }

  // Defensive default: unknown kinds refuse. ACTION_KINDS validation should
  // have caught this before we got here.
  return makePolicyResult({
    decision: 'BLOCK', reason: `unknown action kind: ${action.kind}`,
    reason_codes: ['UNKNOWN_KIND'],
    policy_version_id: pv, evaluated_at,
  });
}

function allow(pv, evaluated_at, reason) {
  return makePolicyResult({
    decision: 'ALLOW', reason, reason_codes: ['INTERNAL_OR_ROUTINE_OK'],
    policy_version_id: pv, evaluated_at,
  });
}

function evaluateRecordPromise({ action, policy, evaluated_at, lastReply }) {
  const pv = policy.policy_version_id;
  if (!lastReply) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'no reply to record promise from',
      reason_codes: ['MISSING_REPLY_CONTEXT'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (lastReply.intent !== 'promise_to_pay') {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `reply intent ${lastReply.intent} does not match promise`,
      reason_codes: ['INTENT_MISMATCH'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (lastReply.confidence < policy.low_confidence_threshold) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'classifier confidence below threshold',
      reason_codes: ['LOW_CONFIDENCE'],
      policy_version_id: pv, evaluated_at,
    });
  }
  const dates = lastReply.extracted_dates || [];
  if (dates.length !== 1) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `promise date ambiguous: found ${dates.length} candidate dates`,
      reason_codes: ['AMBIGUOUS_DATE'],
      policy_version_id: pv, evaluated_at,
    });
  }
  // Excessively far future dates (>60 days out) get a human eye.
  const daysOut = diffDays(`${dates[0]}T12:00:00Z`, evaluated_at);
  if (daysOut < 0) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `promise date ${dates[0]} is already in the past`,
      reason_codes: ['DATE_IN_PAST'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (daysOut > 60) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `promise date ${dates[0]} is ${daysOut} days out`,
      reason_codes: ['DATE_TOO_FAR'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (!policy.payment_promises.record_automatically) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'tenant disabled automatic promise recording',
      reason_codes: ['TENANT_DISABLED'],
      policy_version_id: pv, evaluated_at,
    });
  }
  return allow(pv, evaluated_at, 'promise recording within policy');
}

function evaluateExternalSend({
  action, arCase, invoice, policy, clock, evaluated_at, lastReply,
}) {
  const pv = policy.policy_version_id;
  const codes = [];

  // The action payload cannot choose its own escalation level. Reminder tone
  // is derived from case stage so an LLM cannot jump from friendly to final.
  if (action.kind === 'send_reminder') {
    const expectedTone = arCase.reminder_stage + 1;
    if (action.tone_stage !== expectedTone) {
      return block(pv, evaluated_at,
        `tone stage ${action.tone_stage} does not match expected ${expectedTone}`,
        ['TONE_STAGE_MISMATCH']);
    }
  }

  // Resending an invoice is only routine when it is answering a clear request.
  if (action.kind === 'resend_invoice') {
    if (!lastReply || lastReply.intent !== 'request_invoice_copy'
        || lastReply.confidence < policy.low_confidence_threshold) {
      return requireApproval(pv, evaluated_at,
        'invoice resend lacks a clear matching customer request', ['RESEND_CONTEXT_MISSING']);
    }
    if (!invoice.invoice_link_url) {
      return requireApproval(pv, evaluated_at,
        'no verified source invoice link/copy is available', ['SOURCE_COPY_UNAVAILABLE']);
    }
  }

  // 1. Invoice source status must be open. Never send on paid/void/unknown.
  if (invoice.source_status !== 'open') {
    codes.push('SOURCE_NOT_OPEN');
    return block(pv, evaluated_at, `invoice source status is ${invoice.source_status}`, codes);
  }
  // 2. Balance must be positive.
  if (invoice.open_balance_cents <= 0) {
    codes.push('ZERO_BALANCE');
    return block(pv, evaluated_at, 'open balance is not positive', codes);
  }

  // A customer-requested invoice copy is service, not another collection
  // escalation. It must still be based on fresh source truth and must stop on
  // manually/operationally halted cases, but reminder cadence, grace, balance
  // authority, and max-reminder rules do not apply to the copy itself.
  if (action.kind === 'resend_invoice') {
    if (HALT_STATUSES.has(arCase.status)) {
      return block(pv, evaluated_at,
        `case status ${arCase.status} halts external sends`, ['CASE_HALTED']);
    }
    const staleness = (parseIso(clock.now()) - parseIso(invoice.last_synced_at)) / 1000;
    if (staleness > policy.source_stale_seconds) {
      return block(pv, evaluated_at,
        `source snapshot is ${Math.floor(staleness)}s old, stale threshold ${policy.source_stale_seconds}s`,
        ['SOURCE_STALE']);
    }
    if (action.not_before && parseIso(action.not_before) > parseIso(clock.now())) {
      return block(pv, evaluated_at,
        `action not_before ${action.not_before} is in the future`, ['DEFERRED_BY_NOT_BEFORE']);
    }
    return allow(pv, evaluated_at, 'verified customer-requested invoice copy');
  }

  // 3. Due date + grace period must have passed.
  const dueInstant = dueDateToInstant(invoice.due_date);
  const graceEnd = addBusinessDaysIso(dueInstant, policy.grace_days);
  if (parseIso(clock.now()) < parseIso(graceEnd)) {
    codes.push('WITHIN_GRACE');
    return block(pv, evaluated_at, `still within grace period until ${graceEnd}`, codes);
  }
  // 4. Case must not be in a halted state.
  if (HALT_STATUSES.has(arCase.status)) {
    codes.push('CASE_HALTED');
    return block(pv, evaluated_at, `case status ${arCase.status} halts external sends`, codes);
  }
  // 5. If awaiting_reply, the human/agent handling that reply comes first.
  if (arCase.awaiting_reply) {
    codes.push('AWAITING_REPLY');
    return requireApproval(pv, evaluated_at, 'unhandled inbound reply exists', codes);
  }
  // 6. Reminder stage must be below configured max.
  if (arCase.reminder_stage >= policy.max_routine_reminders) {
    codes.push('MAX_REMINDERS_REACHED');
    return requireApproval(pv, evaluated_at,
      `case already at max routine reminders (${policy.max_routine_reminders})`, codes);
  }
  // 7. Minimum interval since previous reminder must have passed.
  const intervalDays = policy.reminder_intervals_business_days[arCase.reminder_stage];
  if (arCase.last_action_at) {
    const earliest = addBusinessDaysIso(arCase.last_action_at, intervalDays);
    if (parseIso(clock.now()) < parseIso(earliest)) {
      codes.push('INTERVAL_NOT_MET');
      return block(pv, evaluated_at, `next reminder not before ${earliest}`, codes);
    }
  }
  // 8. Balance must be at or below autonomous threshold.
  if (invoice.open_balance_cents > policy.max_autonomous_invoice_balance_cents) {
    codes.push('OVER_AUTONOMY_THRESHOLD');
    return requireApproval(pv, evaluated_at,
      `balance ${invoice.open_balance_cents} exceeds autonomous threshold ${policy.max_autonomous_invoice_balance_cents}`, codes);
  }
  // 9. Source snapshot must be fresh enough.
  const staleness = (parseIso(clock.now()) - parseIso(invoice.last_synced_at)) / 1000;
  if (staleness > policy.source_stale_seconds) {
    codes.push('SOURCE_STALE');
    return block(pv, evaluated_at,
      `source snapshot is ${Math.floor(staleness)}s old, stale threshold ${policy.source_stale_seconds}s`, codes);
  }
  // 10. Send window check is enforced by the sender at execute time; here we
  //     just note it as a note-code so tests can distinguish "policy said yes,
  //     scheduler said defer".
  //     If not_before is set on the action and it is in the future, defer.
  if (action.not_before && parseIso(action.not_before) > parseIso(clock.now())) {
    codes.push('DEFERRED_BY_NOT_BEFORE');
    return block(pv, evaluated_at, `action not_before ${action.not_before} is in the future`, codes);
  }

  return allow(pv, evaluated_at, 'routine reminder within policy');
}

function evaluatePaymentPlan({ action, arCase, invoice, policy, evaluated_at, lastReply }) {
  const pv = policy.policy_version_id;
  const plans = policy.payment_plans;
  if (!plans.enabled) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: 'tenant has not enabled bounded payment-plan authority',
      reason_codes: ['PLAN_AUTHORITY_DISABLED'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (!lastReply || lastReply.intent !== 'payment_plan_request') {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: 'no matching customer payment-plan request is attached',
      reason_codes: ['PLAN_REPLY_CONTEXT_MISSING'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (lastReply.confidence < policy.low_confidence_threshold) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'classifier confidence below threshold',
      reason_codes: ['LOW_CONFIDENCE'],
      policy_version_id: pv, evaluated_at,
    });
  }
  const proposal = action.extra || {};
  const requestedCents = proposal.total_cents;
  const upfrontCents = proposal.upfront_cents;
  const extensionDays = proposal.extension_days;
  const codes = [];
  if (!Number.isInteger(requestedCents) || requestedCents <= 0) codes.push('BAD_TOTAL');
  if (!Number.isInteger(upfrontCents) || upfrontCents < 0) codes.push('BAD_UPFRONT');
  if (!Number.isInteger(extensionDays) || extensionDays <= 0) codes.push('BAD_EXTENSION');
  if (codes.length) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'malformed plan proposal',
      reason_codes: codes,
      policy_version_id: pv, evaluated_at,
    });
  }
  if (requestedCents !== invoice.open_balance_cents) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `plan total ${requestedCents} does not match balance ${invoice.open_balance_cents}`,
      reason_codes: ['BALANCE_MISMATCH'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (invoice.open_balance_cents > plans.max_invoice_balance_cents) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `balance ${invoice.open_balance_cents} exceeds plan max ${plans.max_invoice_balance_cents}`,
      reason_codes: ['OVER_PLAN_BALANCE'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (extensionDays > plans.max_extension_days) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `extension ${extensionDays}d exceeds max ${plans.max_extension_days}d`,
      reason_codes: ['EXTENSION_TOO_LONG'],
      policy_version_id: pv, evaluated_at,
    });
  }
  const pct = Math.floor((upfrontCents / requestedCents) * 100);
  if (pct < plans.min_upfront_percent) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL',
      reason: `upfront ${pct}% below min ${plans.min_upfront_percent}%`,
      reason_codes: ['UPFRONT_TOO_LOW'],
      policy_version_id: pv, evaluated_at,
    });
  }
  if (lastReply && lastReply.confidence < policy.low_confidence_threshold) {
    return makePolicyResult({
      decision: 'REQUIRE_APPROVAL', reason: 'classifier confidence below threshold',
      reason_codes: ['LOW_CONFIDENCE'],
      policy_version_id: pv, evaluated_at,
    });
  }
  return allow(pv, evaluated_at, 'plan proposal within bounded policy');
}

function block(pv, evaluated_at, reason, codes) {
  return makePolicyResult({
    decision: 'BLOCK', reason, reason_codes: codes,
    policy_version_id: pv, evaluated_at,
  });
}
function requireApproval(pv, evaluated_at, reason, codes) {
  return makePolicyResult({
    decision: 'REQUIRE_APPROVAL', reason, reason_codes: codes,
    policy_version_id: pv, evaluated_at,
  });
}
