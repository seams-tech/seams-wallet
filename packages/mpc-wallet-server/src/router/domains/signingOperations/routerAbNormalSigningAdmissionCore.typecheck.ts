import type { RouterAbNormalSigningPolicyDecision } from './routerAbNormalSigningAdmissionCore';

const allowed: RouterAbNormalSigningPolicyDecision = { kind: 'allowed' };
const rejected: RouterAbNormalSigningPolicyDecision = {
  kind: 'project_policy_rejected',
  retryAfterMs: 1_000,
};
// @ts-expect-error An allowed decision cannot carry rejection data.
const invalidAllowed: RouterAbNormalSigningPolicyDecision = { kind: 'allowed', retryAfterMs: 1_000 };
// @ts-expect-error A rejection must carry its backoff.
const missingBackoff: RouterAbNormalSigningPolicyDecision = { kind: 'abuse_rejected' };
// @ts-expect-error Spreading a rejection into an allowed branch retains invalid backoff data.
const invalidSpread: RouterAbNormalSigningPolicyDecision = { ...rejected, kind: 'allowed' };
void [allowed, rejected, invalidAllowed, missingBackoff, invalidSpread];
