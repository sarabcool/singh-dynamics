import { makePolicy } from '../../src/domain/policy.mjs';

export function defaultPolicy(orgId = 'org-A') {
  return makePolicy({
    organization_id: orgId,
    policy_version_id: `${orgId}-pv-1`,
    effective_from: '2026-01-01T00:00:00Z',
    overrides: {},
  });
}

export function policyWithPlanAuthority(orgId = 'org-A') {
  return makePolicy({
    organization_id: orgId,
    policy_version_id: `${orgId}-pv-plans`,
    effective_from: '2026-01-01T00:00:00Z',
    overrides: {
      payment_plans: {
        enabled: true,
        max_extension_days: 30,
        min_upfront_percent: 30,
        max_invoice_balance_cents: 500_000,
      },
    },
  });
}

export function policyLowAutonomyThreshold(orgId = 'org-A', maxCents = 100_000) {
  return makePolicy({
    organization_id: orgId,
    policy_version_id: `${orgId}-pv-low`,
    effective_from: '2026-01-01T00:00:00Z',
    overrides: { max_autonomous_invoice_balance_cents: maxCents },
  });
}
