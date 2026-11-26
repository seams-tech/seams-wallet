import type {
  RouterApiEmailOtpExportPolicyDecision,
  RouterApiEmailOtpExportPolicyInput,
  RouterApiOptions,
} from '../../framework/routerApi';
import { WALLET_EMAIL_OTP_EXPORT_OPERATION } from '@shared/utils/emailOtpDomain';

type ResolvedEmailOtpExportPolicyDecision = RouterApiEmailOtpExportPolicyDecision & {
  policySource: 'adapter' | 'default_allow';
};

export async function authorizeEmailOtpExportPolicy(
  opts: RouterApiOptions,
  input: RouterApiEmailOtpExportPolicyInput,
): Promise<ResolvedEmailOtpExportPolicyDecision> {
  const adapter = opts.emailOtpExportPolicy;
  if (!adapter) {
    return {
      ok: true,
      decision: 'ALLOW',
      policyId: 'default-email-otp-export-policy',
      reason: `No Email OTP export policy adapter configured; local default allows ${WALLET_EMAIL_OTP_EXPORT_OPERATION}.`,
      policySource: 'default_allow',
    };
  }

  const decision = await adapter.authorize(input);
  if (decision.ok) {
    return {
      ...decision,
      decision: 'ALLOW',
      policySource: 'adapter',
    };
  }
  return {
    ...decision,
    decision: 'DENY',
    code: String(decision.code || '').trim() || 'export_key_policy_denied',
    message: String(decision.message || '').trim() || 'Email OTP key export denied by policy',
    policySource: 'adapter',
  };
}

