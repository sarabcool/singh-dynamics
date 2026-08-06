// Deterministic hand-rolled validators. No external deps.
// Every domain shape has an assertShape() that throws ValidationError
// with a stable path/reason so tests can pin behavior exactly.

export class ValidationError extends Error {
  constructor(path, reason, value) {
    super(`${path}: ${reason}` + (value === undefined ? '' : ` (got ${JSON.stringify(value)})`));
    this.name = 'ValidationError';
    this.path = path;
    this.reason = reason;
  }
}

export const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

export const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
export const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

// Strict ISO-8601 with either 'Z' or +HH:MM offset. Reject 'T00:00'-only forms.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export const isIsoInstant = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (v) => typeof v === 'string' && ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// "HH:MM" 24h
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHHMM = (v) => typeof v === 'string' && HHMM_RE.test(v);

export function requireField(obj, path, field, predicate, reason) {
  if (!Object.prototype.hasOwnProperty.call(obj, field)) {
    throw new ValidationError(`${path}.${field}`, 'missing');
  }
  const v = obj[field];
  if (!predicate(v)) throw new ValidationError(`${path}.${field}`, reason, v);
  return v;
}

export function optionalField(obj, path, field, predicate, reason) {
  if (obj[field] === undefined || obj[field] === null) return null;
  if (!predicate(obj[field])) throw new ValidationError(`${path}.${field}`, reason, obj[field]);
  return obj[field];
}
