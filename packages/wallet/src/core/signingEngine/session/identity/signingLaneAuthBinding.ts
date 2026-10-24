import type { RpId } from './evmFamilyEcdsaIdentity';
import { SIGNER_AUTH_METHODS, type SignerAuthMethod } from '@shared/utils/signerDomain';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { LinkedDeviceEnrollmentId, LinkedDeviceId } from '@shared/signing-lanes/ids';
import type { WalletAuthMethodId, WalletAuthorityBindingDigest } from '@shared/utils/domainIds';
import type { ExclusiveUnion } from '@shared/utils/variant';

export type SigningLaneAuthBinding = ExclusiveUnion<
  | { kind: typeof SIGNER_AUTH_METHODS.passkey; rpId: RpId; credentialIdB64u: string }
  | { kind: typeof SIGNER_AUTH_METHODS.emailOtp; providerSubjectId: string }
  | { kind: 'voiceid'; walletAuthMethodId: WalletAuthMethodId; deviceKeyId: DigestB64u }
>;

/**
 * Identity that distinguishes one linked Email OTP owner from the wallet-wide
 * factor and from another enrollment using that factor. It is separate from
 * `SigningLaneAuthBinding` because the provider subject describes the
 * authentication mechanism, while this tuple names the linked principal.
 */
type LinkedOwnerLaneIdentityV1 = {
  readonly enrollmentId: LinkedDeviceEnrollmentId;
  readonly deviceId: LinkedDeviceId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly authorityDigest: DigestB64u;
};

/** Exact Wallet Authority address for a method-bound owner scope. */
type WalletOwnerAuthorityBindingV1 = {
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly authorityDigest: WalletAuthorityBindingDigest;
};

/**
 * The exact owner an authenticated human operation acts as. Derived
 * from the active Wallet Session authority through the active wallet auth
 * method — never assembled from independently supplied wallet, credential,
 * and slot values. A Passkey owner carries the signer slot of its one local
 * authenticator; Email OTP has no local authenticator and no slot.
 */
export type OwnerLaneScope =
  | {
      auth: Extract<SigningLaneAuthBinding, { kind: 'voiceid' }>;
      keyFamily?: never;
      signerSlot?: never;
      linkedOwner?: never;
      ownerAuthority: WalletOwnerAuthorityBindingV1;
    }
  | {
      auth: Extract<SigningLaneAuthBinding, { kind: typeof SIGNER_AUTH_METHODS.passkey }>;
      signerSlot: number;
      keyFamily?: never;
      linkedOwner?: never;
      ownerAuthority?: never;
    }
  | {
      auth: Extract<SigningLaneAuthBinding, { kind: typeof SIGNER_AUTH_METHODS.passkey }>;
      keyFamily: 'ecdsa';
      signerSlot?: never;
      linkedOwner?: never;
      ownerAuthority?: never;
    }
  | {
      auth: Extract<SigningLaneAuthBinding, { kind: typeof SIGNER_AUTH_METHODS.emailOtp }>;
      signerSlot?: never;
      linkedOwner?: never;
      ownerAuthority: WalletOwnerAuthorityBindingV1;
    }
  | {
      auth: Extract<SigningLaneAuthBinding, { kind: typeof SIGNER_AUTH_METHODS.emailOtp }>;
      signerSlot?: never;
      linkedOwner: LinkedOwnerLaneIdentityV1;
      ownerAuthority: WalletOwnerAuthorityBindingV1;
    };

export function signingLaneAuthMethod(auth: SigningLaneAuthBinding): SignerAuthMethod {
  switch (auth.kind) {
    case SIGNER_AUTH_METHODS.passkey:
      return SIGNER_AUTH_METHODS.passkey;
    case SIGNER_AUTH_METHODS.emailOtp:
      return SIGNER_AUTH_METHODS.emailOtp;
    case 'voiceid':
      return 'voiceid';
  }
  auth satisfies never;
  throw new Error('[SigningSession] unsupported signing lane auth binding');
}

function requireSigningLaneAuthKeyPart(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`[SigningSession] ${label} is required for signing lane authority`);
  }
  return normalized;
}

export function signingLaneAuthBindingKey(auth: SigningLaneAuthBinding): string {
  switch (auth.kind) {
    case 'voiceid':
      return ['voiceid', auth.walletAuthMethodId, auth.deviceKeyId].join(':');
    case SIGNER_AUTH_METHODS.passkey:
      return [
        SIGNER_AUTH_METHODS.passkey,
        requireSigningLaneAuthKeyPart(String(auth.rpId), 'passkey rpId'),
        requireSigningLaneAuthKeyPart(auth.credentialIdB64u, 'passkey credential'),
      ].join(':');
    case SIGNER_AUTH_METHODS.emailOtp:
      return [
        SIGNER_AUTH_METHODS.emailOtp,
        requireSigningLaneAuthKeyPart(auth.providerSubjectId, 'Email OTP provider subject'),
      ].join(':');
  }
  auth satisfies never;
  throw new Error('[SigningSession] unsupported signing lane auth binding');
}
