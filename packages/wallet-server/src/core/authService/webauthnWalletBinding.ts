import { toOptionalTrimmedString } from '@shared/utils/validation';
import { walletIdFromString } from '@shared/utils/registrationIntent';
import type {
  WebAuthnCredentialBindingRecord,
} from '../WebAuthnCredentialBindingStore';

export function parseBoundaryWalletId(raw: unknown): string | null {
  const value = toOptionalTrimmedString(raw);
  if (!value) return null;
  try {
    return String(walletIdFromString(value));
  } catch {
    return null;
  }
}

export type ResolvedEd25519WalletBinding = {
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  rpId: string;
  credentialIdB64u: string;
  signerSlot: number;
};

/**
 * Returns `null` when the binding carries no Ed25519 identity, which is the
 * valid state for a wallet whose Ed25519 Yao ceremony has not settled yet.
 * Callers must surface that as a typed "not provisioned" outcome rather than
 * treating it as a missing credential.
 */
export function resolvedEd25519WalletBindingFromCredentialBinding(args: {
  binding: WebAuthnCredentialBindingRecord;
  signerSlot?: number;
}): ResolvedEd25519WalletBinding | null {
  const { nearAccountId, nearEd25519SigningKeyId } = args.binding;
  if (!nearAccountId || !nearEd25519SigningKeyId) return null;
  const resolvedSignerSlot =
    Number.isSafeInteger(args.signerSlot) && Number(args.signerSlot) > 0
      ? Math.floor(Number(args.signerSlot))
      : args.binding.signerSlot;
  if (!Number.isSafeInteger(resolvedSignerSlot) || Number(resolvedSignerSlot) < 1) return null;
  return {
    walletId: args.binding.userId,
    nearAccountId,
    nearEd25519SigningKeyId,
    rpId: args.binding.rpId,
    credentialIdB64u: args.binding.credentialIdB64u,
    signerSlot: Number(resolvedSignerSlot),
  };
}

