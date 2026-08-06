import {
  requireField, optionalField, isPlainObject, isNonEmptyString,
  isIsoDate, isNonNegativeInt, ValidationError
} from '../validate.mjs';

// Controlled reply intent vocabulary from V1-SPEC.md. The classifier must
// never invent an intent outside this set. If nothing matches, use 'other'.

export const REPLY_INTENTS = Object.freeze([
  'promise_to_pay',
  'payment_plan_request',
  'partial_payment',
  'claimed_paid',
  'dispute',
  'request_invoice_copy',
  'question',
  'out_of_office',
  'wrong_recipient',
  'contact_preference',
  'other',
]);

export function makeReplyClassification(obj) {
  const path = 'reply';
  if (!isPlainObject(obj)) throw new ValidationError(path, 'object required', obj);

  requireField(obj, path, 'intent',
    (v) => REPLY_INTENTS.includes(v),
    `one of ${REPLY_INTENTS.join('|')}`);
  requireField(obj, path, 'confidence',
    (v) => typeof v === 'number' && v >= 0 && v <= 1, 'number 0..1');
  requireField(obj, path, 'rationale', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'original_message_ref', isNonEmptyString, 'non-empty string');
  optionalField(obj, path, 'extracted_dates',
    (v) => Array.isArray(v) && v.every(isIsoDate), 'array of YYYY-MM-DD');
  optionalField(obj, path, 'extracted_amounts_cents',
    (v) => Array.isArray(v) && v.every(isNonNegativeInt), 'array of non-negative ints');
  optionalField(obj, path, 'return_date', isIsoDate, 'YYYY-MM-DD');

  return Object.freeze({
    extracted_dates: [],
    extracted_amounts_cents: [],
    return_date: null,
    ...obj,
  });
}
