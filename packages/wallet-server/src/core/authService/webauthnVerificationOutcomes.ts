import type { WebAuthnCredentialBindingRecord } from '../WebAuthnCredentialBindingStore';
import type { ResolvedEd25519WalletBinding } from './webauthnWalletBinding';
import { failedVerification } from '@shared/utils/failure';

// The core-store and D1 WebAuthn services answer these login and sync situations with the same
// outcome, so each outcome is written once here and the two services stay in step.

type WebAuthnVerificationFailure = {
  ok: false;
  verified: false;
  code: string;
  message: string;
};

export type WebAuthnLoginEd25519 =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'active';
      readonly nearAccountId: string;
      readonly nearEd25519SigningKeyId: string;
      readonly signerSlot: number;
      readonly publicKey: string;
      readonly relayerKeyId: string;
      readonly participantIds: readonly [number, number];
    };

/** The failure a login or sync returns when its assertion did not verify; null when it did. */
export function webAuthnAuthenticationFailure(verification: {
  readonly success: boolean;
  readonly verified: boolean;
  readonly code?: string;
  readonly message?: string;
}): WebAuthnVerificationFailure | null {
  if (!verification.success || !verification.verified) {
    return failedVerification(
      verification.code || 'not_verified',
      verification.message || 'Authentication verification failed',
    );
  }
  return null;
}

/**
 * The logged-in credential's Ed25519 signer. It is active only when the binding carries every
 * fact signing needs, and absent while the wallet's Ed25519 signer has not settled.
 */
export function webAuthnLoginEd25519(
  binding: WebAuthnCredentialBindingRecord | null,
  walletBinding: Pick<
    ResolvedEd25519WalletBinding,
    'nearAccountId' | 'nearEd25519SigningKeyId' | 'signerSlot'
  > | null,
): { ok: true; ed25519: WebAuthnLoginEd25519 } | WebAuthnVerificationFailure {
  const firstParticipantId = binding?.participantIds?.[0];
  const secondParticipantId = binding?.participantIds?.[1];
  if (!binding) {
    return failedVerification('unknown_credential', 'Credential has no wallet binding');
  }
  const ed25519 =
    walletBinding &&
    binding.publicKey &&
    binding.relayerKeyId &&
    firstParticipantId !== undefined &&
    secondParticipantId !== undefined
      ? {
          kind: 'active' as const,
          nearAccountId: walletBinding.nearAccountId,
          nearEd25519SigningKeyId: walletBinding.nearEd25519SigningKeyId,
          signerSlot: walletBinding.signerSlot,
          publicKey: binding.publicKey,
          relayerKeyId: binding.relayerKeyId,
          participantIds: [firstParticipantId, secondParticipantId] as const,
        }
      : { kind: 'absent' as const };
  return { ok: true, ed25519 };
}

/** The sync credential's binding, if it exists and belongs to the account the challenge expects. */
export function webAuthnSyncCredentialBinding(
  binding: WebAuthnCredentialBindingRecord | null,
  challenge: { readonly expectedUserId?: string },
): { ok: true; binding: WebAuthnCredentialBindingRecord } | WebAuthnVerificationFailure {
  if (!binding) {
    return failedVerification('unknown_credential', 'Credential is not registered on this relay');
  }
  if (challenge.expectedUserId && binding.userId !== challenge.expectedUserId) {
    return failedVerification(
      'unknown_credential',
      `Credential is not registered for account ${challenge.expectedUserId}`,
    );
  }
  return { ok: true, binding };
}
