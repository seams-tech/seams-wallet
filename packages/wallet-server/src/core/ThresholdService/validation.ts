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
import { ensureEd25519Prefix } from '@shared/utils/near';
import {
  type DerivationClientSharePublicKey33B64u,
  type EcdsaDerivationRelayerPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import {
  THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  normalizeThresholdEd25519ParticipantIds,
} from '@shared/threshold/participants';
import type {
  EcdsaDerivationPublicIdentity,
  ThresholdEcdsaSigningRootMetadata,
  ThresholdEd25519AuthorityScope,
} from '../types';
import { parseEcdsaKeyHandle, type EcdsaKeyHandle } from '../keyMaterialBrands';
import type {
  ThresholdEcdsaMpcSessionRecord,
  ThresholdEd25519MpcSessionRecord,
} from './stores/SessionStore';
import type {
  EcdsaWalletSessionRecord,
  EcdsaWalletSessionRecordCore,
  Ed25519WalletSessionRecord,
} from './stores/WalletSessionStore';

function isValidNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

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

function hasThresholdEcdsaSigningRootMetadata(raw: Record<string, unknown>): boolean {
  return (
    raw.signingRootId !== undefined ||
    raw.signingRootVersion !== undefined ||
    raw.walletKeyVersion !== undefined ||
    raw.derivationVersion !== undefined
  );
}

function parseThresholdEcdsaSigningRootMetadataFields(
  raw: Record<string, unknown>,
): ThresholdEcdsaSigningRootMetadata | null {
  const signingRootId = toOptionalString(raw.signingRootId);
  const signingRootVersion = toOptionalString(raw.signingRootVersion);
  const walletKeyVersion = toOptionalString(raw.walletKeyVersion);
  const derivationVersionRaw = raw.derivationVersion;
  if (!signingRootId || !walletKeyVersion) return null;
  if (!isValidNumber(derivationVersionRaw)) return null;
  const derivationVersion = Math.floor(derivationVersionRaw);
  if (derivationVersion < 1 || derivationVersion !== derivationVersionRaw) return null;
  return {
    signingRootId,
    ...(signingRootVersion ? { signingRootVersion } : {}),
    walletKeyVersion,
    derivationVersion,
  };
}

function parseOptionalThresholdEcdsaSigningRootMetadataFields(
  raw: Record<string, unknown>,
): { ok: true; value?: ThresholdEcdsaSigningRootMetadata } | { ok: false } {
  if (!hasThresholdEcdsaSigningRootMetadata(raw)) return { ok: true };
  const value = parseThresholdEcdsaSigningRootMetadataFields(raw);
  return value ? { ok: true, value } : { ok: false };
}

export function toPrefixWithColon(prefix: unknown, defaultPrefix: string): string {
  const p = toOptionalString(prefix);
  if (!p) return defaultPrefix;
  return p.endsWith(':') ? p : `${p}:`;
}

export function toThresholdEd25519KeyPrefix(prefix: unknown): string {
  return toPrefixWithColon(prefix, 'w3a:threshold-ed25519:key:');
}

export function toThresholdEd25519SessionPrefix(prefix: unknown): string {
  return toPrefixWithColon(prefix, 'w3a:threshold-ed25519:sess:');
}

export function toThresholdEd25519WalletSessionPrefix(prefix: unknown): string {
  return toPrefixWithColon(prefix, 'w3a:threshold-ed25519:wallet-session:');
}

export function toThresholdEd25519PrefixFromBase(
  basePrefix: unknown,
  kind: 'key' | 'sess' | 'wallet-session',
): string {
  const base = toOptionalString(basePrefix);
  if (!base) return '';
  const trimmed = base.trim();
  if (!trimmed) return '';
  const prefix = trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
  return `${prefix}${kind}:`;
}

export function canonicalThresholdEd25519RelayerKeyId(relayerKeyId: unknown): string {
  return ensureEd25519Prefix(toOptionalString(relayerKeyId));
}

export function toThresholdEcdsaSessionPrefix(prefix: unknown): string {
  return toPrefixWithColon(prefix, 'w3a:threshold-ecdsa:sess:');
}

export function toThresholdEcdsaWalletSessionPrefix(prefix: unknown): string {
  return toPrefixWithColon(prefix, 'w3a:threshold-ecdsa:wallet-session:');
}

export function toThresholdEcdsaPrefixFromBase(
  basePrefix: unknown,
  kind: 'key' | 'sess' | 'wallet-session' | 'presign',
): string {
  const base = toOptionalString(basePrefix);
  if (!base) return '';
  const trimmed = base.trim();
  if (!trimmed) return '';
  const prefix = trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
  return `${prefix}threshold-ecdsa:${kind}:`;
}

type ParsedThresholdEd25519RouterMaterial = {
  signingShareB64u: string;
  verifyingShareB64u: string;
};

type ParsedThresholdEd25519ReadyKeyRecord = {
  kind: 'ready';
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  publicKey: string;
  routerMaterial: ParsedThresholdEd25519RouterMaterial;
  keyVersion: string;
  recoveryExportCapable: true;
};

function parseThresholdEd25519RouterMaterial(
  raw: Record<string, unknown>,
): ParsedThresholdEd25519RouterMaterial | null {
  if (!isPlainObject(raw.routerMaterial)) return null;
  const signingShareB64u = toOptionalString(raw.routerMaterial.signingShareB64u);
  const verifyingShareB64u = toOptionalString(raw.routerMaterial.verifyingShareB64u);
  if (!signingShareB64u || !verifyingShareB64u) return null;
  return { signingShareB64u, verifyingShareB64u };
}

function parseThresholdEd25519ReadyKeyRecord(
  raw: unknown,
): ParsedThresholdEd25519ReadyKeyRecord | null {
  if (!isPlainObject(raw)) return null;
  const kind = toOptionalString(raw.kind);
  const walletId = toOptionalString(raw.walletId);
  const nearAccountId = toOptionalString(raw.nearAccountId);
  const nearEd25519SigningKeyId = toOptionalString(raw.nearEd25519SigningKeyId);
  const authorityScope = parseThresholdEd25519AuthorityScope(raw.authorityScope);
  const publicKey = toOptionalString(raw.publicKey);
  const routerMaterial = parseThresholdEd25519RouterMaterial(raw);
  const keyVersion = toOptionalString(raw.keyVersion);
  const recoveryExportCapable = raw.recoveryExportCapable === true ? (true as const) : false;
  if (
    Object.prototype.hasOwnProperty.call(raw, 'rpId') ||
    kind !== 'ready' ||
    !walletId ||
    !nearAccountId ||
    !nearEd25519SigningKeyId ||
    !authorityScope ||
    !publicKey ||
    !routerMaterial ||
    !keyVersion ||
    recoveryExportCapable !== true
  )
    return null;
  return {
    kind: 'ready',
    walletId,
    nearAccountId,
    nearEd25519SigningKeyId,
    authorityScope,
    publicKey,
    routerMaterial,
    keyVersion,
    recoveryExportCapable: true,
  };
}

export function parseThresholdEd25519KeyRecord(
  raw: unknown,
): ParsedThresholdEd25519ReadyKeyRecord | null {
  return parseThresholdEd25519ReadyKeyRecord(raw);
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

export function parseThresholdEd25519MpcSessionRecord(
  raw: unknown,
): ThresholdEd25519MpcSessionRecord | null {
  if (!isPlainObject(raw)) return null;
  const expiresAtMs = raw.expiresAtMs;
  const ecdsaThresholdKeyId = toOptionalString(raw.ecdsaThresholdKeyId);
  const keyHandle = toOptionalString(raw.keyHandle);
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const purpose = toOptionalString(raw.purpose);
  const intentDigestB64u = toOptionalString(raw.intentDigestB64u);
  const signingDigestB64u = toOptionalString(raw.signingDigestB64u);
  const userId = toOptionalString(raw.userId);
  const authorityScope = parseThresholdEd25519AuthorityScope(raw.authorityScope);
  const clientVerifyingShareB64u = toOptionalString(raw.clientVerifyingShareB64u);
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  const signingRootMetadata = parseOptionalThresholdEcdsaSigningRootMetadataFields(raw);
  if (Object.prototype.hasOwnProperty.call(raw, 'rpId')) return null;
  if (!signingRootMetadata.ok) return null;
  if (!isValidNumber(expiresAtMs)) return null;
  if (
    !relayerKeyId ||
    !purpose ||
    !intentDigestB64u ||
    !signingDigestB64u ||
    !userId ||
    !authorityScope
  ) {
    return null;
  }
  return {
    expiresAtMs,
    ...(ecdsaThresholdKeyId ? { ecdsaThresholdKeyId } : {}),
    ...(keyHandle ? { keyHandle } : {}),
    relayerKeyId,
    purpose,
    intentDigestB64u,
    signingDigestB64u,
    userId,
    authorityScope,
    ...(clientVerifyingShareB64u ? { clientVerifyingShareB64u } : {}),
    participantIds,
    ...(signingRootMetadata.value ? signingRootMetadata.value : {}),
  };
}

export function parseThresholdEcdsaMpcSessionRecord(
  raw: unknown,
): ThresholdEcdsaMpcSessionRecord | null {
  if (!isPlainObject(raw)) return null;
  const expiresAtMs = raw.expiresAtMs;
  const ecdsaThresholdKeyId = toOptionalString(raw.ecdsaThresholdKeyId);
  const keyHandle = toOptionalString(raw.keyHandle);
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const purpose = toOptionalString(raw.purpose);
  const intentDigestB64u = toOptionalString(raw.intentDigestB64u);
  const signingDigestB64u = toOptionalString(raw.signingDigestB64u);
  const walletId = toOptionalString(raw.walletId);
  const clientVerifyingShareB64u = toOptionalString(raw.clientVerifyingShareB64u);
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  const signingRootMetadata = parseOptionalThresholdEcdsaSigningRootMetadataFields(raw);
  if (!signingRootMetadata.ok) return null;
  if (!isValidNumber(expiresAtMs)) return null;
  if (!relayerKeyId || !purpose || !intentDigestB64u || !signingDigestB64u || !walletId) {
    return null;
  }
  return {
    expiresAtMs,
    ...(ecdsaThresholdKeyId ? { ecdsaThresholdKeyId } : {}),
    ...(keyHandle ? { keyHandle } : {}),
    relayerKeyId,
    purpose,
    intentDigestB64u,
    signingDigestB64u,
    walletId,
    ...(clientVerifyingShareB64u ? { clientVerifyingShareB64u } : {}),
    participantIds,
    ...(signingRootMetadata.value ? signingRootMetadata.value : {}),
  };
}

export function parseEd25519WalletSessionRecord(raw: unknown): Ed25519WalletSessionRecord | null {
  if (!isPlainObject(raw)) return null;
  const expiresAtMs = raw.expiresAtMs;
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const userId = toOptionalString(raw.userId);
  const walletId = toOptionalString(raw.walletId);
  const nearAccountId = toOptionalString(raw.nearAccountId);
  const nearEd25519SigningKeyId = toOptionalString(raw.nearEd25519SigningKeyId);
  const authorityScope = parseThresholdEd25519AuthorityScope(raw.authorityScope);
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  const signingRootMetadata = parseOptionalThresholdEcdsaSigningRootMetadataFields(raw);
  if (Object.prototype.hasOwnProperty.call(raw, 'rpId')) return null;
  if (!signingRootMetadata.ok) return null;
  if (!isValidNumber(expiresAtMs)) return null;
  if (
    !relayerKeyId ||
    !userId ||
    !walletId ||
    !nearAccountId ||
    !nearEd25519SigningKeyId ||
    !authorityScope
  ) {
    return null;
  }
  return {
    expiresAtMs,
    relayerKeyId,
    userId,
    walletId,
    nearAccountId,
    nearEd25519SigningKeyId,
    authorityScope,
    participantIds,
    ...(signingRootMetadata.value ? signingRootMetadata.value : {}),
  };
}

export function parseEcdsaWalletSessionRecord(raw: unknown): EcdsaWalletSessionRecord | null {
  if (!isPlainObject(raw)) return null;
  if ('evmFamilySigningKeySlotId' in raw) return null;
  const expiresAtMs = raw.expiresAtMs;
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const walletId = toOptionalString(raw.walletId);
  let keyHandle: EcdsaKeyHandle;
  try {
    keyHandle = parseEcdsaKeyHandle(raw.keyHandle);
  } catch {
    return null;
  }
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  const signingRootMetadata = parseOptionalThresholdEcdsaSigningRootMetadataFields(raw);
  if (!signingRootMetadata.ok) return null;
  if (!isValidNumber(expiresAtMs)) return null;
  if (!relayerKeyId || !walletId) return null;
  const core: EcdsaWalletSessionRecordCore = {
    expiresAtMs,
    relayerKeyId,
    walletId,
    keyHandle,
    participantIds,
  };
  if (!signingRootMetadata.value) return core;
  return { ...core, ...signingRootMetadata.value };
}

