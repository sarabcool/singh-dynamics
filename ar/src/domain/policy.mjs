import {
  requireField, optionalField, isPlainObject, isNonEmptyString,
  isNonNegativeInt, isPositiveInt, isHHMM, isIsoInstant, ValidationError
} from '../validate.mjs';

// OrganizationPolicy shape (see docs/singh-ar/POLICY-ENGINE.md).
// Immutable once used; edits create a new policy_version_id.

export const DEFAULT_POLICY = Object.freeze({
  grace_days: 1,
  reminder_intervals_business_days: [0, 4, 5],
  max_routine_reminders: 3,
  max_autonomous_invoice_balance_cents: 1_000_000,
  business_timezone: 'America/Detroit',
  send_window_local: { start: '08:00', end: '17:00' },
  payment_promises: { record_automatically: true },
  payment_plans: {
    enabled: false,
    max_extension_days: 30,
    min_upfront_percent: 30,
    max_invoice_balance_cents: 500_000,
  },
  vip_customer_tags: [],
  pause_on_dispute: true,
  low_confidence_threshold: 0.7,
  source_stale_seconds: 3600, // reject sends if source snapshot is older than this
});

export function makePolicy({
  organization_id,
  policy_version_id,
  effective_from,
  overrides = {},
}) {
  if (!isNonEmptyString(organization_id)) throw new ValidationError('policy.organization_id', 'non-empty string required', organization_id);
  if (!isNonEmptyString(policy_version_id)) throw new ValidationError('policy.policy_version_id', 'non-empty string required', policy_version_id);
  if (!isIsoInstant(effective_from)) throw new ValidationError('policy.effective_from', 'ISO instant required', effective_from);

  const settings = deepMerge(DEFAULT_POLICY, overrides);
  assertPolicySettings(settings);

  return Object.freeze({
    organization_id,
    policy_version_id,
    effective_from,
    ...settings,
  });
}

export function assertPolicySettings(p) {
  const path = 'policy';
  if (!isPlainObject(p)) throw new ValidationError(path, 'object required', p);

  requireField(p, path, 'grace_days', isNonNegativeInt, 'non-negative int');
  const intervals = requireField(p, path, 'reminder_intervals_business_days',
    (v) => Array.isArray(v) && v.length > 0 && v.every(isNonNegativeInt),
    'non-empty array of non-negative ints');
  requireField(p, path, 'max_routine_reminders', isPositiveInt, 'positive int');
  if (intervals.length < p.max_routine_reminders) {
    throw new ValidationError(`${path}.reminder_intervals_business_days`,
      `must have at least max_routine_reminders (${p.max_routine_reminders}) entries`);
  }
  requireField(p, path, 'max_autonomous_invoice_balance_cents', isNonNegativeInt, 'non-negative int');
  requireField(p, path, 'business_timezone', isNonEmptyString, 'non-empty string');
  const win = requireField(p, path, 'send_window_local', isPlainObject, 'object');
  requireField(win, `${path}.send_window_local`, 'start', isHHMM, 'HH:MM 24h');
  requireField(win, `${path}.send_window_local`, 'end', isHHMM, 'HH:MM 24h');
  requireField(p, path, 'payment_promises', isPlainObject, 'object');
  requireField(p.payment_promises, `${path}.payment_promises`, 'record_automatically',
    (v) => typeof v === 'boolean', 'boolean');
  const plans = requireField(p, path, 'payment_plans', isPlainObject, 'object');
  requireField(plans, `${path}.payment_plans`, 'enabled', (v) => typeof v === 'boolean', 'boolean');
  requireField(plans, `${path}.payment_plans`, 'max_extension_days', isNonNegativeInt, 'non-negative int');
  requireField(plans, `${path}.payment_plans`, 'min_upfront_percent',
    (v) => Number.isInteger(v) && v >= 0 && v <= 100, 'integer 0..100');
  requireField(plans, `${path}.payment_plans`, 'max_invoice_balance_cents', isNonNegativeInt, 'non-negative int');
  requireField(p, path, 'vip_customer_tags',
    (v) => Array.isArray(v) && v.every(isNonEmptyString), 'array of strings');
  requireField(p, path, 'pause_on_dispute', (v) => typeof v === 'boolean', 'boolean');
  requireField(p, path, 'low_confidence_threshold',
    (v) => typeof v === 'number' && v >= 0 && v <= 1, 'number 0..1');
  requireField(p, path, 'source_stale_seconds', isPositiveInt, 'positive int');
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    const bv = base[k], pv = patch[k];
    if (isPlainObject(bv) && isPlainObject(pv)) out[k] = deepMerge(bv, pv);
    else out[k] = pv;
  }
  return out;
}
