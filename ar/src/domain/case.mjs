import {
  requireField, optionalField, isPlainObject, isNonEmptyString,
  isNonNegativeInt, isIsoInstant, ValidationError
} from '../validate.mjs';

// AR case status set. Source status (open/paid/void) is separate and lives on
// InvoiceSnapshot. This is deliberate: we never lose the source truth by
// encoding stage into a single status field.

export const CASE_STATUSES = Object.freeze([
  'monitoring',
  'overdue',
  'promised',
  'plan_requested',
  'disputed',
  'claimed_paid',
  'human_required',
  'paused',
  'resolved',
]);

export const TERMINAL_STATUSES = Object.freeze(['resolved']);

export function makeArCase(obj) {
  const path = 'case';
  if (!isPlainObject(obj)) throw new ValidationError(path, 'object required', obj);

  requireField(obj, path, 'organization_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'case_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'invoice_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'status',
    (v) => CASE_STATUSES.includes(v),
    `one of ${CASE_STATUSES.join('|')}`);
  requireField(obj, path, 'reminder_stage', isNonNegativeInt, 'non-negative int');
  requireField(obj, path, 'policy_version_id', isNonEmptyString, 'non-empty string');
  optionalField(obj, path, 'last_action_at', isIsoInstant, 'ISO instant');
  optionalField(obj, path, 'next_action_at', isIsoInstant, 'ISO instant');
  optionalField(obj, path, 'promise_date', isIsoInstant, 'ISO instant');
  optionalField(obj, path, 'pause_reason', isNonEmptyString, 'non-empty string');
  optionalField(obj, path, 'awaiting_reply', (v) => typeof v === 'boolean', 'boolean');
  optionalField(obj, path, 'applied_action_ids',
    (v) => Array.isArray(v) && v.every(isNonEmptyString), 'array of strings');

  return {
    last_action_at: null,
    next_action_at: null,
    promise_date: null,
    pause_reason: null,
    awaiting_reply: false,
    applied_action_ids: [],
    ...obj,
  };
}

// Allowed transitions. Any transition not listed is invalid. This is
// intentionally strict; if a new legitimate transition is needed, add it here
// and add a test for it. Silent "any -> any" would be a policy hole.
const ALLOWED = new Map([
  ['monitoring', new Set(['overdue', 'resolved', 'paused', 'disputed', 'claimed_paid', 'plan_requested', 'human_required'])],
  ['overdue',    new Set(['overdue', 'promised', 'plan_requested', 'disputed', 'claimed_paid', 'paused', 'human_required', 'resolved'])],
  ['promised',   new Set(['overdue', 'disputed', 'claimed_paid', 'paused', 'human_required', 'resolved'])],
  ['plan_requested', new Set(['overdue', 'promised', 'paused', 'human_required', 'resolved'])],
  ['disputed',   new Set(['paused', 'human_required', 'resolved', 'overdue'])],
  ['claimed_paid', new Set(['resolved', 'overdue', 'human_required', 'paused'])],
  ['human_required', new Set(['overdue', 'promised', 'plan_requested', 'disputed', 'claimed_paid', 'paused', 'resolved'])],
  ['paused',     new Set(['overdue', 'monitoring', 'resolved', 'human_required'])],
  ['resolved',   new Set([])],
]);

export function isValidTransition(from, to) {
  if (!ALLOWED.has(from)) return false;
  return ALLOWED.get(from).has(to);
}

export function assertTransition(from, to) {
  if (!isValidTransition(from, to)) {
    throw new ValidationError('case.status', `invalid transition ${from} -> ${to}`);
  }
}
