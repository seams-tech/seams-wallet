import type { D1PreparedStatementLike } from '../../../storage/tenantRoute';
import type { WalletCustodyRegistrationOutcome } from '@shared/passkey-custody';
import type { WalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type { WalletId } from '@shared/utils/domainIds';
import {
  admitWalletCustodyRegistrationCommit,
  type WalletCustodyRegistrationAdmissionOutcome,
} from './walletCustodyRegistrationAdmission';
import type { WalletCustodyCeremonyCommitPayload } from './walletCustodyRegistrationCommit';
import {
  verifiedCustodyFactorFromAuthority,
  type VerifiedEmailOtpEnrollmentFacts,
} from './verifiedCustodyFactor';
import type { CloudflareD1WalletCustodyCommitStore } from '../../cloudflare/d1/passkeyCustody/d1WalletCustodyCommitStore';

/** Custody becomes committed only with the registration's durable completion receipt. */
type RegistrationCustodyOutcome = WalletCustodyRegistrationOutcome;
export type RegistrationCustodyReservation =
  | {
      readonly kind: 'prepared';
      readonly outcome: Extract<RegistrationCustodyOutcome, { status: 'committed' }>;
      readonly write: { readonly statements: readonly D1PreparedStatementLike[] };
    }
  | {
      readonly kind: 'settled';
      readonly outcome: RegistrationCustodyOutcome;
      readonly write?: never;
    };

/** Admits the custody payload and claims its routes. It never throws either. */
export async function reserveRegistrationCustody(input: {
  /** Absent when the client did not run a custody ceremony for this leg. */
  readonly payload?: WalletCustodyCeremonyCommitPayload;
  readonly verifiedWalletId: WalletId;
  readonly verifiedAuthority: WalletAuthAuthority;
  /** Required when the verified authority is Email OTP. */
  readonly verifiedEmailOtpEnrollment?: VerifiedEmailOtpEnrollmentFacts;
  readonly nowMs: number;
  readonly store: CloudflareD1WalletCustodyCommitStore;
}): Promise<RegistrationCustodyReservation> {
  const payload = input.payload;
  if (!payload) return settled({ status: 'not_requested' });

  try {
    const factor = verifiedCustodyFactorFromAuthority({
      authority: input.verifiedAuthority,
      ...(input.verifiedEmailOtpEnrollment
        ? { emailOtpEnrollment: input.verifiedEmailOtpEnrollment }
        : {}),
    });
    if (!factor.ok) return settled({ status: 'rejected', reason: factor.reason });

    const admitted = await admitWalletCustodyRegistrationCommit({
      payload,
      verifiedWalletId: input.verifiedWalletId,
      verifiedFactor: factor.factor,
      nowMs: input.nowMs,
      store: input.store,
    });
    if (admitted.kind !== 'reserved') return settled(toOutcome(admitted));
    return {
      kind: 'prepared',
      outcome: { status: 'committed' },
      write: { statements: admitted.statements },
    };
  } catch (error: unknown) {
    return settled(storeFailure(error));
  }
}

function settled(outcome: RegistrationCustodyOutcome): RegistrationCustodyReservation {
  return { kind: 'settled', outcome };
}

// Reservation failures are explicit outcomes. A failed completion transaction
// leaves its operation resumable, so no response can claim uncommitted custody.
function storeFailure(error: unknown): RegistrationCustodyOutcome {
  return {
    status: 'rejected',
    reason: error instanceof Error ? error.message : 'wallet custody commit failed',
  };
}

function toOutcome(
  admitted: WalletCustodyRegistrationAdmissionOutcome,
): RegistrationCustodyOutcome {
  switch (admitted.kind) {
    case 'no_custody_records':
      return { status: 'joined', keyManifestDigestB64u: admitted.keyManifestDigestB64u };
    case 'custody_already_established':
      return { status: 'custody_already_established' };
    case 'already_exists':
      // The same ceremony's records are already stored. Treated as committed
      // because it is exactly what a retried activation looks like, and the
      // client's next step is identical.
      return { status: 'committed' };
    case 'rejected':
      return { status: 'rejected', reason: admitted.reason };
  }
}
