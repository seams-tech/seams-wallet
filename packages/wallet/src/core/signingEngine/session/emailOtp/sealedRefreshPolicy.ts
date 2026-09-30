import type {
  WarmSessionClaimResult,
  WarmSessionStatusResult,
} from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type {
  updateExactSealedSessionPolicy,
  SigningSessionSealedRecordFilter,
} from '@/core/signingEngine/session/persistence/sealedSessionStore';
import type { EmailOtpEcdsaSealedRuntimePurpose } from './sealedRuntimePurpose';

type EmailOtpSealedRefreshPolicyPorts = {
  updateExactSealedSessionPolicy: typeof updateExactSealedSessionPolicy;
  clearEcdsaRestoreCaches: () => void;
};

// Updating runtime policy needs the exact sealed record and nothing else: the
// purpose names the lane, the record carries the allowance being replaced. No
// manifest lookup is involved, because no material is being selected here.
export class EmailOtpSealedRefreshPolicy {
  constructor(private readonly ports: EmailOtpSealedRefreshPolicyPorts) {}

  private sealedRecordFilter(
    purpose: EmailOtpEcdsaSealedRuntimePurpose,
  ): SigningSessionSealedRecordFilter {
    return { authMethod: 'email_otp', curve: 'ecdsa', chainTarget: purpose.chainTarget };
  }

  async recordSessionUseConsumed(
    purpose: EmailOtpEcdsaSealedRuntimePurpose,
    result: WarmSessionStatusResult,
  ): Promise<void> {
    await this.recordSessionPolicyResult({ purpose, result });
  }

  async recordSessionMaterialRestored(
    purpose: EmailOtpEcdsaSealedRuntimePurpose,
    result: WarmSessionStatusResult,
  ): Promise<void> {
    await this.recordSessionPolicyResult({ purpose, result });
  }

  /** Writes the observed allowance and expiry to the exact record named by the
   * purpose. Expiry and exhaustion invalidate the authorization and runtime
   * projections and leave the sealed material and its activation intact; the
   * caller requests operation step-up from there. */
  private async recordSessionPolicyResult(args: {
    purpose: EmailOtpEcdsaSealedRuntimePurpose;
    result: WarmSessionStatusResult | WarmSessionClaimResult;
  }): Promise<void> {
    const thresholdSessionId = String(args.purpose.thresholdSessionId || '').trim();
    if (!thresholdSessionId) return;
    if (!args.result.ok) {
      this.ports.clearEcdsaRestoreCaches();
      return;
    }
    await this.ports
      .updateExactSealedSessionPolicy({
        thresholdSessionId,
        filter: this.sealedRecordFilter(args.purpose),
        expiresAtMs: args.result.expiresAtMs,
        remainingUses: args.result.remainingUses,
        updatedAtMs: Date.now(),
      })
      .catch(() => undefined);
    this.ports.clearEcdsaRestoreCaches();
  }
}
