import { base64UrlDecode } from '@shared/utils/encoders';
import {
  parseWebAuthnRpId,
} from '@shared/utils/domainIds';
import {
  isEmailOtpWalletAuthAuthority,
  isPasskeyWalletAuthAuthority,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { toOptionalString, isPlainObject } from '@shared/utils/validation';
import {
  type DerivationClientSharePublicKey33B64u,
  type EcdsaDerivationRelayerPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import type { EcdsaDerivationPublicIdentity, ThresholdEd25519AuthorityScope } from '../types';

function decodeFixedB64u(value: string, expectedLength: number): Uint8Array | null {
  try {
    const decoded = base64UrlDecode(value);
    if (decoded.length !== expectedLength) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseSec1CompressedPublicKey33B64u(value: unknown): string | null {
  const text = toOptionalString(value);
  if (!text) return null;
  const decoded = decodeFixedB64u(text, 33);
  if (!decoded) return null;
  const prefix = decoded[0];
  if (prefix !== 0x02 && prefix !== 0x03) return null;
  return text;
}

export function parseEcdsaDerivationPublicIdentity(
  raw: unknown,
): EcdsaDerivationPublicIdentity | null {
  if (!isPlainObject(raw)) return null;
  const derivationClientSharePublicKey33B64u = parseSec1CompressedPublicKey33B64u(
    raw.derivationClientSharePublicKey33B64u,
  );
  const relayerPublicKey33B64u = parseSec1CompressedPublicKey33B64u(raw.relayerPublicKey33B64u);
  const groupPublicKey33B64u = parseSec1CompressedPublicKey33B64u(raw.groupPublicKey33B64u);
  const ethereumAddress = toOptionalString(raw.ethereumAddress);
  if (
    !derivationClientSharePublicKey33B64u ||
    !relayerPublicKey33B64u ||
    !groupPublicKey33B64u ||
    !ethereumAddress
  ) {
    return null;
  }
  return {
    derivationClientSharePublicKey33B64u:
      derivationClientSharePublicKey33B64u as DerivationClientSharePublicKey33B64u,
    relayerPublicKey33B64u: relayerPublicKey33B64u as EcdsaDerivationRelayerPublicKey33B64u,
    groupPublicKey33B64u,
    ethereumAddress,
  };
}

export function parseThresholdEd25519AuthorityScope(
  raw: unknown,
): ThresholdEd25519AuthorityScope | null {
  if (!isPlainObject(raw)) return null;
  const kind = toOptionalString(raw.kind);
  switch (kind) {
    case 'passkey_rp': {
      const rpId = parseWebAuthnRpId(raw.rpId);
      if (
        !rpId.ok ||
        toOptionalString(raw.proofKind) ||
        toOptionalString(raw.email) ||
        toOptionalString(raw.provider) ||
        toOptionalString(raw.providerUserId) ||
        toOptionalString(raw.challengeId) ||
        toOptionalString(raw.googleEmailOtpRegistrationAttemptId) ||
        toOptionalString(raw.googleEmailOtpRegistrationOfferId) ||
        toOptionalString(raw.googleEmailOtpRegistrationCandidateId)
      ) {
        return null;
      }
      return { kind, rpId: rpId.value };
    }
    case 'email_otp': {
      if (
        toOptionalString(raw.rpId) ||
        toOptionalString(raw.email) ||
        toOptionalString(raw.proofKind) ||
        toOptionalString(raw.challengeId) ||
        toOptionalString(raw.googleEmailOtpRegistrationAttemptId) ||
        toOptionalString(raw.googleEmailOtpRegistrationOfferId) ||
        toOptionalString(raw.googleEmailOtpRegistrationCandidateId)
      ) {
        return null;
      }
      const provider = toOptionalString(raw.provider);
      const providerUserId = toOptionalString(raw.providerUserId);
      if ((provider !== 'google' && provider !== 'email') || !providerUserId) return null;
      return { kind, provider, providerUserId };
    }
    default:
      return null;
  }
}

export function thresholdEd25519AuthorityScopeFromWalletAuthAuthority(
  authority: WalletAuthAuthority,
): ThresholdEd25519AuthorityScope {
  if (isPasskeyWalletAuthAuthority(authority)) {
    return { kind: 'passkey_rp', rpId: authority.verifier.rpId };
  }
  if (isEmailOtpWalletAuthAuthority(authority)) {
    return {
      kind: 'email_otp',
      provider: authority.factor.provider,
      providerUserId: authority.factor.providerUserId,
    };
  }
  authority satisfies never;
  throw new Error('[threshold-ed25519] unsupported wallet auth authority');
}

export function thresholdEd25519AuthorityScopesMatch(
  left: ThresholdEd25519AuthorityScope,
  right: ThresholdEd25519AuthorityScope,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey_rp':
      return right.kind === 'passkey_rp' && left.rpId === right.rpId;
    case 'email_otp':
      return (
        right.kind === 'email_otp' &&
        left.provider === right.provider &&
        left.providerUserId === right.providerUserId
      );
  }
  return false;
}
