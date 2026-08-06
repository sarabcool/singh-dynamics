import {
  requireField, optionalField, isPlainObject, isNonEmptyString,
  isNonNegativeInt, isIsoInstant, isIsoDate, ValidationError
} from '../validate.mjs';

// InvoiceSnapshot is the read-only view of source-of-truth accounting data.
// Singh AR never mutates this; it treats it as authoritative fact from the
// connector (QuickBooks Online in V1) at a specific point in time.

export const INVOICE_SOURCE_STATUSES = Object.freeze([
  'open', 'paid', 'void', 'unknown',
]);

export function makeInvoiceSnapshot(obj) {
  const path = 'invoice';
  if (!isPlainObject(obj)) throw new ValidationError(path, 'object required', obj);

  requireField(obj, path, 'organization_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'provider', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'provider_invoice_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'provider_customer_id', isNonEmptyString, 'non-empty string');
  requireField(obj, path, 'currency',
    (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v), 'ISO 4217 currency code');
  requireField(obj, path, 'original_amount_cents', isNonNegativeInt, 'non-negative int');
  requireField(obj, path, 'open_balance_cents', isNonNegativeInt, 'non-negative int');
  requireField(obj, path, 'issue_date', isIsoDate, 'YYYY-MM-DD');
  requireField(obj, path, 'due_date', isIsoDate, 'YYYY-MM-DD');
  requireField(obj, path, 'source_status',
    (v) => INVOICE_SOURCE_STATUSES.includes(v),
    `one of ${INVOICE_SOURCE_STATUSES.join('|')}`);
  requireField(obj, path, 'last_synced_at', isIsoInstant, 'ISO instant');
  optionalField(obj, path, 'is_consumer_debt', (v) => typeof v === 'boolean', 'boolean');
  optionalField(obj, path, 'tags',
    (v) => Array.isArray(v) && v.every(isNonEmptyString), 'array of strings');
  optionalField(obj, path, 'invoice_link_url', isNonEmptyString, 'string');

  return Object.freeze({
    is_consumer_debt: false,
    tags: [],
    invoice_link_url: null,
    ...obj,
  });
}
