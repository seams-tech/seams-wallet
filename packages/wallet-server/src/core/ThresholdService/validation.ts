import { base64UrlDecode } from '@shared/utils/encoders';
import {
  parseWebAuthnRpId,
} from '@shared/utils/domainIds';
import {
  isEmailOtpWalletAuthAuthority,
  isPasskeyWalletAuthAuthority,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { ensureEd25519Prefix, toOptionalString, toTrimmedString } from '@shared/utils/validation';
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
  ThresholdEd25519AuthorityScope,
} from '../types';
import { parseEcdsaKeyHandle, type EcdsaKeyHandle } from '../keyMaterialBrands';

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

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

type ParsedThresholdEcdsaSigningRootMetadata = {
  signingRootId: string;
  signingRootVersion?: string;
  walletKeyVersion: string;
  derivationVersion: number;
};

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
): ParsedThresholdEcdsaSigningRootMetadata | null {
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
): { ok: true; value?: ParsedThresholdEcdsaSigningRootMetadata } | { ok: false } {
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
  if (!isObject(raw.routerMaterial)) return null;
  const signingShareB64u = toOptionalString(raw.routerMaterial.signingShareB64u);
  const verifyingShareB64u = toOptionalString(raw.routerMaterial.verifyingShareB64u);
  if (!signingShareB64u || !verifyingShareB64u) return null;
  return { signingShareB64u, verifyingShareB64u };
}

function parseThresholdEd25519ReadyKeyRecord(
  raw: unknown,
): ParsedThresholdEd25519ReadyKeyRecord | null {
  if (!isObject(raw)) return null;
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
  if (!isObject(raw)) return null;
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

type ParsedThresholdEd25519Commitments = { hiding: string; binding: string };

function parseThresholdEd25519Commitments(raw: unknown): ParsedThresholdEd25519Commitments | null {
  if (!isObject(raw)) return null;
  const hiding = toOptionalString(raw.hiding);
  const binding = toOptionalString(raw.binding);
  if (!hiding || !binding) return null;
  return { hiding, binding };
}

type ParsedThresholdEd25519CommitmentsById = Record<string, ParsedThresholdEd25519Commitments>;

function parseThresholdEd25519CommitmentsById(
  raw: unknown,
): ParsedThresholdEd25519CommitmentsById | null {
  if (!isObject(raw)) return null;
  const out: ParsedThresholdEd25519CommitmentsById = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = toTrimmedString(k);
    if (!key) return null;
    const commitments = parseThresholdEd25519Commitments(v);
    if (!commitments) return null;
    out[key] = commitments;
  }
  return Object.keys(out).length ? out : null;
}

export function parseThresholdEd25519AuthorityScope(
  raw: unknown,
): ThresholdEd25519AuthorityScope | null {
  if (!isObject(raw)) return null;
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

type ParsedThresholdEd25519MpcSessionRecord = {
  expiresAtMs: number;
  ecdsaThresholdKeyId?: string;
  keyHandle?: string;
  relayerKeyId: string;
  purpose: string;
  intentDigestB64u: string;
  signingDigestB64u: string;
  userId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  clientVerifyingShareB64u?: string;
  participantIds: number[];
} & Partial<ParsedThresholdEcdsaSigningRootMetadata>;

type ParsedThresholdEcdsaMpcSessionRecord = {
  expiresAtMs: number;
  ecdsaThresholdKeyId?: string;
  keyHandle?: string;
  relayerKeyId: string;
  purpose: string;
  intentDigestB64u: string;
  signingDigestB64u: string;
  walletId: string;
  clientVerifyingShareB64u?: string;
  participantIds: number[];
} & Partial<ParsedThresholdEcdsaSigningRootMetadata>;

export function parseThresholdEd25519MpcSessionRecord(
  raw: unknown,
): ParsedThresholdEd25519MpcSessionRecord | null {
  if (!isObject(raw)) return null;
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
): ParsedThresholdEcdsaMpcSessionRecord | null {
  if (!isObject(raw)) return null;
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

type ParsedThresholdEd25519SigningShareMaterial =
  | {
      kind: 'key_store';
    }
  | {
      kind: 'embedded_cosigner_share';
      relayerSigningShareB64u: string;
    };

type ParsedThresholdEd25519SigningSessionRecord = {
  expiresAtMs: number;
  mpcSessionId: string;
  relayerKeyId: string;
  signingDigestB64u: string;
  userId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  commitmentsById: ParsedThresholdEd25519CommitmentsById;
  signingShare: ParsedThresholdEd25519SigningShareMaterial;
  relayerNoncesB64u: string;
  participantIds: number[];
};

export function parseThresholdEd25519SigningSessionRecord(
  raw: unknown,
): ParsedThresholdEd25519SigningSessionRecord | null {
  if (!isObject(raw)) return null;
  const expiresAtMs = raw.expiresAtMs;
  const mpcSessionId = toOptionalString(raw.mpcSessionId);
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const signingDigestB64u = toOptionalString(raw.signingDigestB64u);
  const userId = toOptionalString(raw.userId);
  const authorityScope = parseThresholdEd25519AuthorityScope(raw.authorityScope);
  const commitmentsById = parseThresholdEd25519CommitmentsById(raw.commitmentsById);
  const signingShare = parseThresholdEd25519SigningShareMaterial(raw);
  const relayerNoncesB64u = toOptionalString(raw.relayerNoncesB64u);
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  if (!isValidNumber(expiresAtMs)) return null;
  if (Object.prototype.hasOwnProperty.call(raw, 'rpId')) return null;
  if (
    !mpcSessionId ||
    !relayerKeyId ||
    !signingDigestB64u ||
    !userId ||
    !authorityScope ||
    !commitmentsById ||
    !signingShare ||
    !relayerNoncesB64u
  ) {
    return null;
  }
  return {
    expiresAtMs,
    mpcSessionId,
    relayerKeyId,
    signingDigestB64u,
    userId,
    authorityScope,
    commitmentsById,
    signingShare,
    relayerNoncesB64u,
    participantIds,
  };
}

function parseThresholdEd25519SigningShareMaterial(
  raw: Record<string, unknown>,
): ParsedThresholdEd25519SigningShareMaterial | null {
  if (isObject(raw.signingShare)) {
    const kind = toOptionalString(raw.signingShare.kind);
    if (kind === 'key_store') {
      return toOptionalString(raw.signingShare.relayerSigningShareB64u) ? null : { kind };
    }
    if (kind === 'embedded_cosigner_share') {
      const relayerSigningShareB64u = toOptionalString(raw.signingShare.relayerSigningShareB64u);
      return relayerSigningShareB64u ? { kind, relayerSigningShareB64u } : null;
    }
    return null;
  }
  const legacyShare = toOptionalString(raw.relayerSigningShareB64u);
  return legacyShare
    ? { kind: 'embedded_cosigner_share', relayerSigningShareB64u: legacyShare }
    : { kind: 'key_store' };
}

type ParsedThresholdEd25519StringById = Record<string, string>;

function parseThresholdEd25519StringById(raw: unknown): ParsedThresholdEd25519StringById | null {
  if (!isObject(raw)) return null;
  const out: ParsedThresholdEd25519StringById = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = toTrimmedString(k);
    const value = toOptionalString(v);
    if (!key || !value) return null;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

type ParsedThresholdEd25519CoordinatorSigningSessionRecord = {
  mode: 'cosigner';
  expiresAtMs: number;
  mpcSessionId: string;
  relayerKeyId: string;
  signingDigestB64u: string;
  userId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  commitmentsById: ParsedThresholdEd25519CommitmentsById;
  participantIds: number[];
  groupPublicKey: string;
  cosignerIds: number[];
  cosignerRelayerUrlsById: ParsedThresholdEd25519StringById;
  cosignerCoordinatorGrantsById: ParsedThresholdEd25519StringById;
  relayerVerifyingSharesById: ParsedThresholdEd25519StringById;
};

export function parseThresholdEd25519CoordinatorSigningSessionRecord(
  raw: unknown,
): ParsedThresholdEd25519CoordinatorSigningSessionRecord | null {
  if (!isObject(raw)) return null;
  const expiresAtMs = raw.expiresAtMs;
  const mpcSessionId = toOptionalString(raw.mpcSessionId);
  const relayerKeyId = toOptionalString(raw.relayerKeyId);
  const signingDigestB64u = toOptionalString(raw.signingDigestB64u);
  const userId = toOptionalString(raw.userId);
  const authorityScope = parseThresholdEd25519AuthorityScope(raw.authorityScope);
  const commitmentsById = parseThresholdEd25519CommitmentsById(raw.commitmentsById);
  const participantIds = normalizeThresholdEd25519ParticipantIds(raw.participantIds) || [
    ...THRESHOLD_ED25519_2P_PARTICIPANT_IDS,
  ];
  const relayerVerifyingSharesById = parseThresholdEd25519StringById(
    raw.relayerVerifyingSharesById,
  );

  if (!isValidNumber(expiresAtMs)) return null;
  if (Object.prototype.hasOwnProperty.call(raw, 'rpId')) return null;
  if (
    !mpcSessionId ||
    !relayerKeyId ||
    !signingDigestB64u ||
    !userId ||
    !authorityScope ||
    !commitmentsById ||
    !relayerVerifyingSharesById
  ) {
    return null;
  }

  const mode = toOptionalString(raw.mode);
  if (mode !== 'cosigner') return null;

  const groupPublicKey = toOptionalString(raw.groupPublicKey);
  const cosignerIds = normalizeThresholdEd25519ParticipantIds(raw.cosignerIds);
  const cosignerRelayerUrlsById = parseThresholdEd25519StringById(raw.cosignerRelayerUrlsById);
  const cosignerCoordinatorGrantsById = parseThresholdEd25519StringById(
    raw.cosignerCoordinatorGrantsById,
  );
  if (!groupPublicKey || !cosignerIds || !cosignerRelayerUrlsById || !cosignerCoordinatorGrantsById)
    return null;
  return {
    mode: 'cosigner',
    expiresAtMs,
    mpcSessionId,
    relayerKeyId,
    signingDigestB64u,
    userId,
    authorityScope,
    commitmentsById,
    participantIds,
    groupPublicKey,
    cosignerIds,
    cosignerRelayerUrlsById,
    cosignerCoordinatorGrantsById,
    relayerVerifyingSharesById,
  };
}

type ParsedEd25519WalletSessionRecord = {
  expiresAtMs: number;
  relayerKeyId: string;
  userId: string;
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: ThresholdEd25519AuthorityScope;
  participantIds: number[];
} & Partial<ParsedThresholdEcdsaSigningRootMetadata>;

export function parseEd25519WalletSessionRecord(
  raw: unknown,
): ParsedEd25519WalletSessionRecord | null {
  if (!isObject(raw)) return null;
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

type ParsedEcdsaWalletSessionRecordCore = {
  expiresAtMs: number;
  relayerKeyId: string;
  walletId: string;
  keyHandle: EcdsaKeyHandle;
  participantIds: number[];
};

type ParsedEcdsaWalletSessionRecord = ParsedEcdsaWalletSessionRecordCore &
  (
    | {
        signingRootId?: never;
        signingRootVersion?: never;
        walletKeyVersion?: never;
        derivationVersion?: never;
      }
    | ParsedThresholdEcdsaSigningRootMetadata
  );

export function parseEcdsaWalletSessionRecord(raw: unknown): ParsedEcdsaWalletSessionRecord | null {
  if (!isObject(raw)) return null;
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
  const core: ParsedEcdsaWalletSessionRecordCore = {
    expiresAtMs,
    relayerKeyId,
    walletId,
    keyHandle,
    participantIds,
  };
  if (!signingRootMetadata.value) return core;
  return { ...core, ...signingRootMetadata.value };
}

