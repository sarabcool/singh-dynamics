// Public API for the Singh AR deterministic core.
// Consumers import from here, never from src/domain/* or src/engine/* directly.
// This gives us a single revision point when the schema stabilizes.

export { Clock, addBusinessDaysIso, addDaysIso, diffDays, dueDateToInstant } from './domain/time.mjs';
export { DEFAULT_POLICY, makePolicy, assertPolicySettings } from './domain/policy.mjs';
export { makeInvoiceSnapshot, INVOICE_SOURCE_STATUSES } from './domain/invoice.mjs';
export {
  makeArCase, CASE_STATUSES, TERMINAL_STATUSES,
  isValidTransition, assertTransition,
} from './domain/case.mjs';
export { makeReplyClassification, REPLY_INTENTS } from './domain/reply.mjs';
export {
  makeProposedAction, makePolicyResult,
  ACTION_KINDS, EXTERNAL_ACTION_KINDS, HARD_PROHIBITED_KINDS,
  REQUIRE_APPROVAL_KINDS_DEFAULT, POLICY_DECISIONS,
} from './domain/action.mjs';

export { evaluate as evaluatePolicy } from './engine/policy.mjs';
export {
  reconcileWithSource, advanceOverdueState, applyReply, reconcileUnconfirmedPaymentClaim,
  recordReminderSent, recordInvoiceResent,
} from './engine/transitions.mjs';
export { EventRunner } from './engine/runner.mjs';

export { ValidationError } from './validate.mjs';
