import {
  requireField, optionalField, isPlainObject, isNonEmptyString,
  isIsoInstant, ValidationError
} from '../validate.mjs';

// Action kinds. Kinds prefixed with 'internal_' never touch the outside world:
// they update Singh's own state only. External kinds (send_reminder,
// resend_invoice) require full policy authorization before execution.

export const ACTION_KINDS = Object.freeze([
  // internal state operations
  'wait',
  'record_promise',
  'verify_payment',
  'resolve',
  'escalate_human',
  'pause',
  'unpause',
  // external customer-facing operations
  'send_reminder',
  'resend_invoice',
  // gated business decisions (default REQUIRE_APPROVAL or BLOCK)
  'accept_payment_plan',
  'change_terms',
  'waive_balance',
  'apply_discount',
  // hard-prohibited kinds - engine may propose to test policy; gateway always BLOCKs
  'invent_fee',
  'threaten_legal',
  'report_to_credit_bureau',
  'send_sms',
  'call_customer',
]);

export const EXTERNAL_ACTION_KINDS = Object.freeze([
  'send_reminder', 'resend_invoice',
]);

export const HARD_PROHIBITED_KINDS = Object.freeze([
  'invent_fee', 'threaten_legal', 'report_to_credit_bureau',
  'send_sms', 'call_customer',
]);

export const REQUIRE_APPROVAL_KINDS_DEFAULT = Object.freeze([
  'accept_payment_plan', 'change_terms', 'waive_balance', 'apply_discount',
]);

export function makeProposedAction(obj) {
  const path = 'action';
  if (!isPlainObject(obj)) throw new ValidationError(path, 'object required', obj);

  requireField(obj, path, 'action_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'organization_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'case_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'invoice_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'kind',
    (v) => ACTION_KINDS.includes(v),
    `one of ${ACTION_KINDS.join('|')}`);
  requireField(obj, path, 'reason', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'proposed_by',
    (v) => v === 'engine' || v === 'llm',
    "'engine' or 'llm'");
  optionalField(obj, path, 'not_before', isIsoInstant, 'ISO instant');
  optionalField(obj, path, 'tone_stage',
    (v) => Number.isInteger(v) && v >= 1, 'positive int');
  optionalField(obj, path, 'confidence',
    (v) => typeof v === 'number' && v >= 0 && v <= 1, 'number 0..1');
  optionalField(obj, path, 'facts_used',
    (v) => Array.isArray(v) && v.every(isNonEmptyString), 'array of strings');
  optionalField(obj, path, 'draft_payload', isPlainObject, 'object');
  optionalField(obj, path, 'extra', isPlainObject, 'object');

  return Object.freeze({
    not_before: null,
    tone_stage: null,
    confidence: null,
    facts_used: [],
    draft_payload: null,
    extra: null,
    ...obj,
  });
}

// PolicyResult. Every proposed action gets exactly one.
export const POLICY_DECISIONS = Object.freeze(['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK']);

export function makePolicyResult({
  decision, reason, reason_codes, policy_version_id, evaluated_at,
}) {
  if (!POLICY_DECISIONS.includes(decision)) {
    throw new ValidationError('policy_result.decision', `one of ${POLICY_DECISIONS.join('|')}`, decision);
  }
  if (!isNonEmptyString(reason)) throw new ValidationError('policy_result.reason', 'non-empty string', reason);
  if (!Array.isArray(reason_codes) || !reason_codes.every(isNonEmptyString)) {
    throw new ValidationError('policy_result.reason_codes', 'array of strings', reason_codes);
  }
  if (!isNonEmptyString(policy_version_id)) {
    throw new ValidationError('policy_result.policy_version_id', 'non-empty string', policy_version_id);
  }
  if (!isIsoInstant(evaluated_at)) {
    throw new ValidationError('policy_result.evaluated_at', 'ISO instant', evaluated_at);
  }
  return Object.freeze({ decision, reason, reason_codes, policy_version_id, evaluated_at });
}
