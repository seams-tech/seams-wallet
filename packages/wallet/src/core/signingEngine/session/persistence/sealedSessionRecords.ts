// The sealed signing-session records: their shapes, how a stored payload is classified and
// normalized into a current or inactive record, and how records, store keys and storage rows
// are built.
import { normalizeInteger, normalizeOptionalNonEmptyString } from '@shared/utils/normalize';
import {
  parseMpcMaterialActivationRef,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import {
  SIGNING_SESSION_SEALED_RECORD_VERSION,
  SIGNING_SESSION_SEAL_ALG,
  SIGNING_SESSION_SEAL_GROUP_ID,
  SIGNING_SESSION_SEAL_STORAGE_SCOPE,
  SIGNING_SESSION_SECRET_KIND,
  type SealedSigningSessionEcdsaRestoreMetadata,
  type SealedSigningSessionEcdsaRestoreSource,
  type SealedSigningSessionRecord,
} from '@shared/utils/signingSessionSeal';
import {
  normalizeRuntimePolicyScope,
  signingRootScopeFromRuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import {
  thresholdEcdsaChainTargetFromRequest,
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  parseRouterAbEd25519NormalSigningState,
  type RouterAbEd25519NormalSigningState,
} from '../../threshold/ed25519/routerAbNormalSigningState';
import {
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationPublicCapabilityV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseEcdsaRoleLocalPersistedMaterialRef,
  type EcdsaRoleLocalPersistedMaterialRef,
} from '../keyMaterialBrands';
import { ecdsaSealedRecordStoreKey } from './ecdsaSealedRecordKey';
import {
  parseEmailOtpWalletAuthAuthority,
  parseWalletAuthAuthorityRef,
  type EmailOtpWalletAuthAuthority,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { asRecord } from '@shared/utils/validation';

export type SigningSessionSealedStoreRecord = SealedSigningSessionRecord & {
  storeKey: string;
  curve: 'ed25519' | 'ecdsa';
};

type Ed25519SealedRecordThresholdSessionIds = {
  ed25519: string;
  ecdsa?: string;
};

type EcdsaSealedRecordThresholdSessionIds = {
  ed25519?: string;
  ecdsa: string;
};

type CurrentEd25519RestoreMetadataBase = {
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  rpId: string;
  relayerKeyId: string;
  participantIds: number[];
  runtimePolicyScope?: unknown;
  signerSlot: number;
  routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

export type CurrentEd25519RestoreMetadata =
  | (CurrentEd25519RestoreMetadataBase & {
      credentialIdB64u: string;
      materialActivation: MpcMaterialActivationRef;
      providerSubjectId?: never;
      emailHashHex?: never;
    })
  | (CurrentEd25519RestoreMetadataBase & {
      provider: 'google' | 'email';
      providerSubjectId: string;
      emailHashHex: string;
      materialActivation: MpcMaterialActivationRef;
      credentialIdB64u?: never;
    });

export type CurrentEd25519SealedSessionRecord = Omit<
  Extract<SigningSessionSealedStoreRecord, { curve: 'ed25519' }>,
  'curve' | 'thresholdSessionIds' | 'walletId' | 'relayerUrl' | 'ed25519Restore' | 'ecdsaRestore'
> & {
  curve: 'ed25519';
  thresholdSessionIds: Ed25519SealedRecordThresholdSessionIds;
  walletId: string;
  relayerUrl: string;
  ed25519Restore: CurrentEd25519RestoreMetadata;
  ecdsaRestore?: SealedSigningSessionEcdsaRestoreMetadata;
};

export type CurrentEcdsaSealedSessionRecord = Omit<
  Extract<SigningSessionSealedStoreRecord, { curve: 'ecdsa' }>,
  | 'curve'
  | 'thresholdSessionIds'
  | 'walletId'
  | 'relayerUrl'
  | 'signingRootId'
  | 'signingRootVersion'
  | 'ecdsaRestore'
  | 'ed25519Restore'
> & {
  curve: 'ecdsa';
  thresholdSessionIds: EcdsaSealedRecordThresholdSessionIds;
  walletId: string;
  signingRootId?: never;
  signingRootVersion?: never;
  relayerUrl: string;
  ecdsaRestore: SealedSigningSessionEcdsaRestoreMetadata;
  ed25519Restore?: CurrentEd25519RestoreMetadata;
};

const ECDSA_INACTIVE_SEALED_MATERIAL_RECORD_KIND = 'ecdsa_inactive_sealed_material_v1' as const;

type EcdsaInactiveSealedMaterialRecordBase = {
  recordKind: typeof ECDSA_INACTIVE_SEALED_MATERIAL_RECORD_KIND;
  storeKey: string;
  curve: 'ecdsa';
  walletId: string;
  relayerUrl: string;
  alg: typeof SIGNING_SESSION_SEAL_ALG;
  storageScope: typeof SIGNING_SESSION_SEAL_STORAGE_SCOPE;
  secretKind: typeof SIGNING_SESSION_SECRET_KIND;
  sealedSecretB64u: string;
  keyVersion: string;
  groupId: typeof SIGNING_SESSION_SEAL_GROUP_ID;
  updatedAtMs: number;
  issuedAtMs?: never;
  expiresAtMs?: never;
  remainingUses?: never;
  thresholdSessionIds?: never;
  authorizationRetirementReason: 'expired' | 'exhausted';
  ed25519Restore?: never;
};

type EcdsaInactiveMaterialPublicRestoreBase = {
  chainTarget: ThresholdEcdsaChainTarget;
  signingRootId: string;
  signingRootVersion: string;
  keyHandle: string;
  ecdsaThresholdKeyId: string;
  ethereumAddress: string;
  relayerKeyId: string;
  thresholdEcdsaPublicKeyB64u: string;
  participantIds: number[];
  runtimePolicyScope: ReturnType<typeof normalizeRuntimePolicyScope>;
  routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  clientVerifyingShareB64u?: never;
};

export type EcdsaInactiveMaterialPublicRestore =
  | (EcdsaInactiveMaterialPublicRestoreBase & {
      source: Exclude<SealedSigningSessionEcdsaRestoreSource, 'email_otp'>;
      authority: WalletAuthAuthorityRef;
      rpId: string;
      credentialIdB64u: string;
      roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
      providerSubjectId?: never;
      emailHashHex?: never;
    })
  | (EcdsaInactiveMaterialPublicRestoreBase & {
      source: 'email_otp';
      provider: 'google' | 'email';
      providerSubjectId: string;
      emailHashHex: string;
      authority: WalletAuthAuthorityRef;
      emailOtpAuthority: EmailOtpWalletAuthAuthority;
      roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
      rpId?: never;
      credentialIdB64u?: never;
    });

export type EcdsaInactiveSealedMaterialRecord = EcdsaInactiveSealedMaterialRecordBase &
  (
    | {
        authMethod: 'passkey';
        ecdsaRestore: Exclude<EcdsaInactiveMaterialPublicRestore, { source: 'email_otp' }>;
      }
    | {
        authMethod: 'email_otp';
        ecdsaRestore: Extract<EcdsaInactiveMaterialPublicRestore, { source: 'email_otp' }>;
      }
  );

export type EcdsaDurableLaneRecord =
  | SigningSessionSealedStoreRecord
  | EcdsaInactiveSealedMaterialRecord;

export type CurrentSealedSessionRecord =
  | CurrentEd25519SealedSessionRecord
  | CurrentEcdsaSealedSessionRecord;
export type RawSealedSessionRecord = Record<string, unknown>;

type SealedSessionRecordClassificationReason =
  | 'invalid_payload'
  | 'invalid_header'
  | 'invalid_identity'
  | 'owned_by_lane_holder_store'
  | 'missing_participant_ids'
  | 'missing_restore_metadata';

export type CurrentSealedSessionRecordClassification = {
  kind: 'current';
  record: CurrentSealedSessionRecord;
};

type EcdsaInactiveSealedMaterialRecordClassification = {
  kind: 'ecdsa_inactive_material';
  record: EcdsaInactiveSealedMaterialRecord;
};

type NonCurrentSealedSessionRecordClassificationKind =
  | 'delete_required'
  | 'rebuild_required'
  | 'unrelated_record'
  | 'malformed';

type NonCurrentSealedSessionRecordClassification = {
  [K in NonCurrentSealedSessionRecordClassificationKind]: {
    kind: K;
    storeKey: string | null;
    walletId: string | null;
    reason: SealedSessionRecordClassificationReason;
    safeSummary: Record<string, unknown>;
  };
}[NonCurrentSealedSessionRecordClassificationKind];

export type SealedSessionRecordClassification =
  | CurrentSealedSessionRecordClassification
  | EcdsaInactiveSealedMaterialRecordClassification
  | NonCurrentSealedSessionRecordClassification;

type BuildCurrentSealedSessionRecordCommonInput = {
  thresholdSessionId: string;
  sealedSecretB64u: string;
  authMethod: 'passkey' | 'email_otp';
  keyVersion: string;
  groupId: typeof SIGNING_SESSION_SEAL_GROUP_ID;
  issuedAtMs: number;
  expiresAtMs: number;
  remainingUses: number;
  updatedAtMs: number;
};

export type BuildCurrentEd25519SealedSessionRecordInput =
  BuildCurrentSealedSessionRecordCommonInput & {
    curve: 'ed25519';
    thresholdSessionIds: Ed25519SealedRecordThresholdSessionIds;
    walletId: string;
    signingRootId?: string;
    signingRootVersion?: string;
    relayerUrl: string;
    ecdsaRestore?: SealedSigningSessionEcdsaRestoreMetadata;
    ed25519Restore: CurrentEd25519RestoreMetadata;
  };

export type BuildCurrentEcdsaSealedSessionRecordInput =
  BuildCurrentSealedSessionRecordCommonInput & {
    curve: 'ecdsa';
    thresholdSessionIds: EcdsaSealedRecordThresholdSessionIds;
    walletId: string;
    relayerUrl: string;
    ecdsaRestore: SealedSigningSessionEcdsaRestoreMetadata;
    ed25519Restore?: CurrentEd25519RestoreMetadata;
  };

export type BuildCurrentSealedSessionRecordInput =
  | BuildCurrentEd25519SealedSessionRecordInput
  | BuildCurrentEcdsaSealedSessionRecordInput;

const SEALED_RECORD_PAYLOAD_FIELD = 'sealed_record';

function normalizeThresholdSessionIds(value: unknown): {
  ed25519?: string;
  ecdsa?: string;
} {
  const obj = asRecord(value) ?? {};
  const ed25519 = normalizeOptionalNonEmptyString(obj.ed25519);
  const ecdsa = normalizeOptionalNonEmptyString(obj.ecdsa);
  return {
    ...(ed25519 ? { ed25519 } : {}),
    ...(ecdsa ? { ecdsa } : {}),
  };
}

export function normalizeThresholdSessionIdsFromStoredRecord(value: unknown): {
  ed25519?: string;
  ecdsa?: string;
} {
  const obj = asRecord(value) ?? {};
  return normalizeThresholdSessionIds(obj.thresholdSessionIds);
}

export function hasRetiredAuthorizationIdentityField(value: unknown): boolean {
  const obj = asRecord(value);
  if (!obj) return false;
  const camelCaseKey = ['signing', 'Grant', 'Id'].join('');
  const snakeCaseKey = ['signing', 'grant', 'id'].join('_');
  return (
    Object.prototype.hasOwnProperty.call(obj, camelCaseKey) ||
    Object.prototype.hasOwnProperty.call(obj, snakeCaseKey)
  );
}

function normalizeCurve(value: unknown): 'ed25519' | 'ecdsa' | undefined {
  const curve = String(value || '').trim();
  return curve === 'ed25519' || curve === 'ecdsa' ? curve : undefined;
}

export function storagePayloadFromSealedStoreRow(value: unknown): unknown {
  const obj = asRecord(value);
  return obj && SEALED_RECORD_PAYLOAD_FIELD in obj ? obj[SEALED_RECORD_PAYLOAD_FIELD] : value;
}

function durableLaneStorageRow(record: CurrentSealedSessionRecord): Record<string, unknown> {
  const ecdsaChainTarget = record.ecdsaRestore?.chainTarget;
  const ecdsaThresholdSessionId = normalizeOptionalNonEmptyString(record.thresholdSessionIds.ecdsa);
  const ed25519ThresholdSessionId = normalizeOptionalNonEmptyString(
    record.thresholdSessionIds.ed25519,
  );
  return {
    store_key: record.storeKey,
    wallet_id: record.walletId,
    auth_method: record.authMethod,
    curve: record.curve,
    signing_root_id: normalizeOptionalNonEmptyString(
      'signingRootId' in record ? record.signingRootId : undefined,
    ),
    signing_root_version: normalizeOptionalNonEmptyString(
      'signingRootVersion' in record ? record.signingRootVersion : undefined,
    ),
    ed25519_threshold_session_id: ed25519ThresholdSessionId,
    ecdsa_threshold_session_id: ecdsaThresholdSessionId,
    threshold_session_id: ecdsaThresholdSessionId || ed25519ThresholdSessionId,
    key_handle: normalizeOptionalNonEmptyString(record.ecdsaRestore?.keyHandle),
    chain_target_key: ecdsaChainTarget ? thresholdEcdsaChainTargetKey(ecdsaChainTarget) : undefined,
    expires_at_ms: record.expiresAtMs,
    updated_at: record.updatedAtMs,
    [SEALED_RECORD_PAYLOAD_FIELD]: record,
  };
}

export function inactiveEcdsaMaterialStorageRow(
  record: EcdsaInactiveSealedMaterialRecord,
): Record<string, unknown> {
  return {
    store_key: record.storeKey,
    wallet_id: record.walletId,
    auth_method: record.authMethod,
    curve: record.curve,
    key_handle: record.ecdsaRestore.keyHandle,
    chain_target_key: thresholdEcdsaChainTargetKey(record.ecdsaRestore.chainTarget),
    updated_at: record.updatedAtMs,
    [SEALED_RECORD_PAYLOAD_FIELD]: record,
  };
}

export function sealedRecordStorageRow(
  record: CurrentSealedSessionRecord,
): Record<string, unknown> {
  return durableLaneStorageRow(record);
}

function normalizeEthereumAddress(value: unknown): `0x${string}` | undefined {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? (normalized as `0x${string}`) : undefined;
}

function resolveSealedRecordCurve(args: {
  curve?: 'ed25519' | 'ecdsa';
  thresholdSessionIds: { ed25519?: string; ecdsa?: string };
}): 'ed25519' | 'ecdsa' | null {
  if (args.curve) return args.curve;
  if (args.thresholdSessionIds.ecdsa) return 'ecdsa';
  if (args.thresholdSessionIds.ed25519) return 'ed25519';
  return null;
}

function parseSealedEcdsaRouterAbDerivationNormalSigningState(
  value: unknown,
): RouterAbEcdsaDerivationNormalSigningStateV1 | null {
  try {
    return parseRouterAbEcdsaDerivationNormalSigningStateV1(value);
  } catch {
    return null;
  }
}

function normalizeSealedEcdsaRestoreSource(
  value: unknown,
): SealedSigningSessionEcdsaRestoreSource | null {
  switch (value) {
    case 'login':
    case 'registration':
    case 'manual-bootstrap':
    case 'email_otp':
      return value;
    default:
      return null;
  }
}

function signingRootBindingFromStoredRuntimePolicyScope(
  value: unknown,
): { signingRootId: string; signingRootVersion: string } | null {
  try {
    const scope = signingRootScopeFromRuntimePolicyScope(normalizeRuntimePolicyScope(value));
    const signingRootId = normalizeOptionalNonEmptyString(scope.signingRootId);
    const signingRootVersion = normalizeOptionalNonEmptyString(scope.signingRootVersion);
    return signingRootId && signingRootVersion ? { signingRootId, signingRootVersion } : null;
  } catch {
    return null;
  }
}

function normalizeEcdsaRestoreMetadata(
  value: unknown,
): SealedSigningSessionEcdsaRestoreMetadata | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  let chainTarget: ThresholdEcdsaChainTarget | null = null;
  try {
    chainTarget = thresholdEcdsaChainTargetFromRequest(asRecord(obj.chainTarget) ?? {});
  } catch {
    chainTarget = null;
  }
  const source = normalizeSealedEcdsaRestoreSource(obj.source);
  const authorityRef = parseWalletAuthAuthorityRef(obj.authority);
  const rpId = normalizeOptionalNonEmptyString(obj.rpId);
  const runtimePolicyScope =
    obj.runtimePolicyScope && typeof obj.runtimePolicyScope === 'object'
      ? obj.runtimePolicyScope
      : undefined;
  const runtimeSigningRootBinding =
    signingRootBindingFromStoredRuntimePolicyScope(runtimePolicyScope);
  const explicitSigningRootId = normalizeOptionalNonEmptyString(obj.signingRootId);
  const explicitSigningRootVersion = normalizeOptionalNonEmptyString(obj.signingRootVersion);
  if (
    explicitSigningRootId &&
    runtimeSigningRootBinding?.signingRootId &&
    explicitSigningRootId !== runtimeSigningRootBinding.signingRootId
  ) {
    return undefined;
  }
  if (
    explicitSigningRootVersion &&
    runtimeSigningRootBinding?.signingRootVersion &&
    explicitSigningRootVersion !== runtimeSigningRootBinding.signingRootVersion
  ) {
    return undefined;
  }
  const signingRootId = explicitSigningRootId || runtimeSigningRootBinding?.signingRootId || '';
  const signingRootVersion =
    explicitSigningRootVersion || runtimeSigningRootBinding?.signingRootVersion || '';
  const credentialIdB64u = normalizeOptionalNonEmptyString(obj.credentialIdB64u);
  let roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef | null = null;
  try {
    roleLocalMaterialRef = parseEcdsaRoleLocalPersistedMaterialRef(obj.roleLocalMaterialRef);
  } catch {
    roleLocalMaterialRef = null;
  }
  const emailOtpAuthority = parseEmailOtpWalletAuthAuthority(obj.emailOtpAuthority);
  const provider = obj.provider === 'google' || obj.provider === 'email' ? obj.provider : null;
  const providerSubjectId = normalizeOptionalNonEmptyString(obj.providerSubjectId);
  const emailHashHex = normalizeOptionalNonEmptyString(obj.emailHashHex);
  const keyHandle = normalizeOptionalNonEmptyString(obj.keyHandle);
  const ecdsaThresholdKeyId = normalizeOptionalNonEmptyString(obj.ecdsaThresholdKeyId);
  const ethereumAddress = normalizeEthereumAddress(obj.ethereumAddress);
  const relayerKeyId = normalizeOptionalNonEmptyString(obj.relayerKeyId);
  const thresholdEcdsaPublicKeyB64u = normalizeOptionalNonEmptyString(
    obj.thresholdEcdsaPublicKeyB64u,
  );
  const routerAbEcdsaDerivationNormalSigning = parseSealedEcdsaRouterAbDerivationNormalSigningState(
    obj.routerAbEcdsaDerivationNormalSigning,
  );
  let publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1 | null = null;
  try {
    publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(obj.publicCapability);
  } catch {
    publicCapability = null;
  }
  const participantIds = normalizeParticipantIds(obj.participantIds);
  if (
    !chainTarget ||
    !source ||
    !signingRootId ||
    !signingRootVersion ||
    !keyHandle ||
    !ethereumAddress ||
    !relayerKeyId ||
    !routerAbEcdsaDerivationNormalSigning ||
    !publicCapability ||
    !participantIds.length
  ) {
    return undefined;
  }
  const authBranch =
    credentialIdB64u && rpId && roleLocalMaterialRef && authorityRef && source !== 'email_otp'
      ? ({
          source,
          authority: authorityRef,
          roleLocalMaterialRef,
          rpId,
          credentialIdB64u,
        } as const)
      : providerSubjectId &&
          provider &&
          emailHashHex &&
          roleLocalMaterialRef &&
          authorityRef &&
          emailOtpAuthority &&
          source === 'email_otp'
        ? ({
            source,
            provider,
            providerSubjectId,
            emailHashHex,
            authority: authorityRef,
            emailOtpAuthority,
            roleLocalMaterialRef,
          } as const)
        : null;
  if (!authBranch) return undefined;
  const clientVerifyingShareB64u = normalizeOptionalNonEmptyString(obj.clientVerifyingShareB64u);
  return {
    chainTarget,
    signingRootId,
    signingRootVersion,
    ...authBranch,
    keyHandle,
    ...(ecdsaThresholdKeyId ? { ecdsaThresholdKeyId } : {}),
    ethereumAddress,
    relayerKeyId,
    ...(clientVerifyingShareB64u ? { clientVerifyingShareB64u } : {}),
    ...(thresholdEcdsaPublicKeyB64u ? { thresholdEcdsaPublicKeyB64u } : {}),
    participantIds,
    routerAbEcdsaDerivationNormalSigning,
    publicCapability,
    ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
  };
}

function normalizeCurrentEd25519RestoreMetadata(
  value: unknown,
): CurrentEd25519RestoreMetadata | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const nearAccountId = normalizeOptionalNonEmptyString(obj.nearAccountId);
  const nearEd25519SigningKeyId = normalizeOptionalNonEmptyString(obj.nearEd25519SigningKeyId);
  const rpId = normalizeOptionalNonEmptyString(obj.rpId);
  const credentialIdB64u = normalizeOptionalNonEmptyString(obj.credentialIdB64u);
  const providerSubjectId = normalizeOptionalNonEmptyString(obj.providerSubjectId);
  const provider = obj.provider === 'google' || obj.provider === 'email' ? obj.provider : null;
  const emailHashHex = normalizeOptionalNonEmptyString(obj.emailHashHex);
  const authSubjectId = normalizeOptionalNonEmptyString(obj.authSubjectId);
  const relayerKeyId = normalizeOptionalNonEmptyString(obj.relayerKeyId);
  const participantIds = normalizeParticipantIds(obj.participantIds);
  const signerSlot = normalizeInteger(obj.signerSlot);
  const routerAbNormalSigning = parseRouterAbEd25519NormalSigningState(obj.routerAbNormalSigning);
  const materialActivation = parseMpcMaterialActivationRef(obj.materialActivation);
  const authBranch =
    credentialIdB64u && !providerSubjectId && materialActivation.ok
      ? ({ credentialIdB64u, materialActivation: materialActivation.value } as const)
      : provider && providerSubjectId && emailHashHex && !credentialIdB64u && materialActivation.ok
        ? ({
            provider,
            providerSubjectId,
            emailHashHex,
            materialActivation: materialActivation.value,
          } as const)
        : null;
  if (
    !nearAccountId ||
    !nearEd25519SigningKeyId ||
    !rpId ||
    !relayerKeyId ||
    !participantIds.length ||
    signerSlot == null ||
    signerSlot <= 0 ||
    !routerAbNormalSigning ||
    !authBranch ||
    authSubjectId
  ) {
    return undefined;
  }
  return {
    nearAccountId,
    nearEd25519SigningKeyId,
    rpId,
    ...authBranch,
    relayerKeyId,
    participantIds,
    ...(obj.runtimePolicyScope && typeof obj.runtimePolicyScope === 'object'
      ? { runtimePolicyScope: obj.runtimePolicyScope }
      : {}),
    signerSlot,
    routerAbNormalSigning,
  };
}

type Ed25519SealedRecordStoreKeyInput = {
  walletId: string;
  authMethod: 'passkey' | 'email_otp';
  restore: CurrentEd25519RestoreMetadata;
};

function ed25519SealedRecordStoreKey(args: Ed25519SealedRecordStoreKeyInput): string {
  const materialActivation = args.restore.materialActivation;
  return [
    'ed25519-material-v2',
    args.walletId,
    args.authMethod,
    'ed25519',
    materialActivation.activationId,
    materialActivation.capability,
    materialActivation.materialOwner,
    materialActivation.keyBinding,
    materialActivation.lifecycleBinding,
    materialActivation.signingWorker,
  ]
    .map(sealedStoreKeyPart)
    .join(':');
}

export function makeInactiveEcdsaMaterialStoreKey(args: {
  walletId: string;
  authMethod: 'passkey' | 'email_otp';
  restore: EcdsaInactiveMaterialPublicRestore;
}): string {
  const material = args.restore.roleLocalMaterialRef;
  return [
    'inactive-material',
    args.walletId,
    args.authMethod,
    'ecdsa',
    thresholdEcdsaChainTargetKey(args.restore.chainTarget),
    material.materialActivation.activationId,
  ]
    .map(sealedStoreKeyPart)
    .join(':');
}

function sealedStoreKeyPart(value: unknown): string {
  return encodeURIComponent(String(value || '').trim());
}

function normalizeAuthMethod(value: unknown): 'passkey' | 'email_otp' | undefined {
  const authMethod = String(value || '').trim();
  return authMethod === 'passkey' || authMethod === 'email_otp' ? authMethod : undefined;
}

function hasStaleSealedSessionWalletIdentityFields(value: unknown): boolean {
  const obj = asRecord(value);
  return Boolean(
    normalizeOptionalNonEmptyString(obj?.subjectId) || normalizeOptionalNonEmptyString(obj?.userId),
  );
}

function hasTopLevelSigningRootFields(value: unknown): boolean {
  const obj = asRecord(value);
  return Boolean(
    normalizeOptionalNonEmptyString(obj?.signingRootId) ||
    normalizeOptionalNonEmptyString(obj?.signingRootVersion),
  );
}

function normalizeParticipantIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((participantId) => Math.floor(Number(participantId)))
    .filter((participantId) => Number.isFinite(participantId) && participantId > 0);
}

function buildSealedSessionSafeSummary(
  obj: RawSealedSessionRecord | null,
): Record<string, unknown> {
  return {
    authMethod: normalizeOptionalNonEmptyString(obj?.authMethod) || null,
    curve: normalizeOptionalNonEmptyString(obj?.curve) || null,
    storeKey: normalizeOptionalNonEmptyString(obj?.storeKey) || null,
    walletId: normalizeOptionalNonEmptyString(obj?.walletId) || null,
    thresholdSessionIds: normalizeThresholdSessionIdsFromStoredRecord(obj),
    hasEcdsaRestore: Boolean(asRecord(obj?.ecdsaRestore)),
    hasEd25519Restore: Boolean(asRecord(obj?.ed25519Restore)),
    issuedAtMs: normalizeInteger(obj?.issuedAtMs),
    expiresAtMs: normalizeInteger(obj?.expiresAtMs),
    remainingUses: normalizeInteger(obj?.remainingUses),
    updatedAtMs: normalizeInteger(obj?.updatedAtMs),
  };
}

export function classifyNonCurrentRecord(
  kind: NonCurrentSealedSessionRecordClassificationKind,
  obj: RawSealedSessionRecord | null,
  reason: SealedSessionRecordClassificationReason,
): NonCurrentSealedSessionRecordClassification {
  return {
    kind,
    storeKey: normalizeOptionalNonEmptyString(obj?.storeKey) || null,
    walletId: normalizeOptionalNonEmptyString(obj?.walletId) || null,
    reason,
    safeSummary: buildSealedSessionSafeSummary(obj),
  };
}

/** The seal header every current record opens with, in its stored order. */
function currentSealedRecordHeader(authMethod: 'passkey' | 'email_otp') {
  return {
    v: SIGNING_SESSION_SEALED_RECORD_VERSION,
    alg: SIGNING_SESSION_SEAL_ALG,
    storageScope: SIGNING_SESSION_SEAL_STORAGE_SCOPE,
    authMethod,
    secretKind: SIGNING_SESSION_SECRET_KIND,
  } as const;
}

export function classifyRawSealedSessionRecord(raw: unknown): SealedSessionRecordClassification {
  raw = storagePayloadFromSealedStoreRow(raw);
  const obj = asRecord(raw);
  if (!obj) return classifyNonCurrentRecord('malformed', null, 'invalid_payload');
  if (obj.kind === 'lane_sealed_holder_record_v1') {
    return classifyNonCurrentRecord('unrelated_record', obj, 'owned_by_lane_holder_store');
  }
  if (hasRetiredAuthorizationIdentityField(obj)) {
    return classifyNonCurrentRecord('delete_required', obj, 'invalid_identity');
  }
  if (obj.recordKind === 'ecdsa_reauth_anchor_v1') {
    return classifyNonCurrentRecord('delete_required', obj, 'invalid_header');
  }
  if (obj.recordKind === ECDSA_INACTIVE_SEALED_MATERIAL_RECORD_KIND) {
    const record = normalizeEcdsaInactiveSealedMaterialRecord(obj);
    return record
      ? { kind: 'ecdsa_inactive_material', record }
      : classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (Number(obj.v) === 1) {
    return classifyNonCurrentRecord('delete_required', obj, 'invalid_header');
  }
  if (Number(obj.v) !== SIGNING_SESSION_SEALED_RECORD_VERSION) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_header');
  }
  if (String(obj.alg || '').trim() !== SIGNING_SESSION_SEAL_ALG) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_header');
  }
  if (String(obj.storageScope || '').trim() !== SIGNING_SESSION_SEAL_STORAGE_SCOPE) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_header');
  }
  if (String(obj.secretKind || '').trim() !== SIGNING_SESSION_SECRET_KIND) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_header');
  }

  const authMethod = String(obj.authMethod || '').trim();
  const thresholdSessionIds = normalizeThresholdSessionIdsFromStoredRecord(obj);
  const sealedSecretB64u = normalizeOptionalNonEmptyString(obj.sealedSecretB64u);
  const curve = normalizeCurve(obj.curve);
  const subjectId = normalizeOptionalNonEmptyString(obj.subjectId);
  const userId = normalizeOptionalNonEmptyString(obj.userId);
  const walletId = normalizeOptionalNonEmptyString(obj.walletId);
  const signingRootId = normalizeOptionalNonEmptyString(obj.signingRootId);
  const explicitSigningRootVersion = normalizeOptionalNonEmptyString(obj.signingRootVersion);
  const signingRootVersion = explicitSigningRootVersion || (signingRootId ? 'default' : null);
  const relayerUrl = normalizeOptionalNonEmptyString(obj.relayerUrl);
  const keyVersion = normalizeOptionalNonEmptyString(obj.keyVersion);
  const groupId = normalizeOptionalNonEmptyString(obj.groupId);
  const issuedAtMs = normalizeInteger(obj.issuedAtMs);
  const expiresAtMs = normalizeInteger(obj.expiresAtMs);
  const remainingUses = normalizeInteger(obj.remainingUses);
  const updatedAtMs = normalizeInteger(obj.updatedAtMs);

  if (!sealedSecretB64u || !keyVersion || groupId !== SIGNING_SESSION_SEAL_GROUP_ID) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (authMethod !== 'passkey' && authMethod !== 'email_otp') {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (!thresholdSessionIds.ed25519 && !thresholdSessionIds.ecdsa) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (!walletId) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  const recordCurve = resolveSealedRecordCurve({ curve, thresholdSessionIds });
  if (!recordCurve) return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  if (issuedAtMs == null || issuedAtMs <= 0) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (expiresAtMs == null || expiresAtMs <= 0) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (remainingUses == null || remainingUses < 0) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (updatedAtMs == null || updatedAtMs <= 0) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }

  const ecdsaRestoreObj = asRecord(obj.ecdsaRestore);
  const ed25519RestoreObj = asRecord(obj.ed25519Restore);
  const ecdsaRestore = normalizeEcdsaRestoreMetadata(obj.ecdsaRestore);
  const ed25519Restore = normalizeCurrentEd25519RestoreMetadata(obj.ed25519Restore);

  if (recordCurve === 'ecdsa') {
    if (!thresholdSessionIds.ecdsa) {
      return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
    }
    if (subjectId || userId || signingRootId || explicitSigningRootVersion) {
      return classifyNonCurrentRecord('delete_required', obj, 'invalid_identity');
    }
    if (!ecdsaRestoreObj || !relayerUrl) {
      return classifyNonCurrentRecord('rebuild_required', obj, 'missing_restore_metadata');
    }
    if (!normalizeParticipantIds(ecdsaRestoreObj.participantIds).length) {
      return classifyNonCurrentRecord('delete_required', obj, 'missing_participant_ids');
    }
    if (!ecdsaRestore) {
      return classifyNonCurrentRecord('rebuild_required', obj, 'missing_restore_metadata');
    }
    const storeKey = ecdsaSealedRecordStoreKey({
      walletId,
      authMethod,
      chainTarget: ecdsaRestore.chainTarget,
      materialActivation: ecdsaRestore.roleLocalMaterialRef.materialActivation,
    });
    const providedStoreKey = normalizeOptionalNonEmptyString(obj.storeKey);
    if (providedStoreKey && providedStoreKey !== storeKey) {
      return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
    }
    return {
      kind: 'current',
      record: {
        ...currentSealedRecordHeader(authMethod),
        storeKey,
        thresholdSessionIds: {
          ...(thresholdSessionIds.ed25519 ? { ed25519: thresholdSessionIds.ed25519 } : {}),
          ecdsa: thresholdSessionIds.ecdsa,
        },
        sealedSecretB64u,
        curve: 'ecdsa',
        walletId,
        relayerUrl,
        keyVersion,
        groupId: SIGNING_SESSION_SEAL_GROUP_ID,
        ecdsaRestore,
        ...(ed25519Restore ? { ed25519Restore } : {}),
        issuedAtMs,
        expiresAtMs,
        remainingUses,
        updatedAtMs,
      },
    };
  }

  if (!thresholdSessionIds.ed25519) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  if (subjectId || userId)
    return classifyNonCurrentRecord('delete_required', obj, 'invalid_identity');
  if (!ed25519RestoreObj || !relayerUrl) {
    return classifyNonCurrentRecord('rebuild_required', obj, 'missing_restore_metadata');
  }
  if (!normalizeParticipantIds(ed25519RestoreObj.participantIds).length) {
    return classifyNonCurrentRecord('delete_required', obj, 'missing_participant_ids');
  }
  if (!ed25519Restore) {
    return classifyNonCurrentRecord('rebuild_required', obj, 'missing_restore_metadata');
  }
  const storeKey = ed25519SealedRecordStoreKey({
    walletId,
    authMethod,
    restore: ed25519Restore,
  });
  const providedStoreKey = normalizeOptionalNonEmptyString(obj.storeKey);
  if (providedStoreKey && providedStoreKey !== storeKey) {
    return classifyNonCurrentRecord('malformed', obj, 'invalid_identity');
  }
  return {
    kind: 'current',
    record: {
      ...currentSealedRecordHeader(authMethod),
      storeKey,
      thresholdSessionIds: {
        ed25519: thresholdSessionIds.ed25519,
        ...(thresholdSessionIds.ecdsa ? { ecdsa: thresholdSessionIds.ecdsa } : {}),
      },
      sealedSecretB64u,
      curve: 'ed25519',
      walletId,
      ...(signingRootId ? { signingRootId } : {}),
      ...(signingRootVersion ? { signingRootVersion } : {}),
      relayerUrl,
      keyVersion,
      groupId: SIGNING_SESSION_SEAL_GROUP_ID,
      ...(ecdsaRestore ? { ecdsaRestore } : {}),
      ed25519Restore,
      issuedAtMs,
      expiresAtMs,
      remainingUses,
      updatedAtMs,
    },
  };
}

export function normalizeSigningSessionSealedStoreRecord(
  value: unknown,
): CurrentSealedSessionRecord | null {
  const classification = classifyRawSealedSessionRecord(storagePayloadFromSealedStoreRow(value));
  return classification.kind === 'current' ? classification.record : null;
}

function normalizeEcdsaInactiveMaterialPublicRestore(
  value: unknown,
): EcdsaInactiveMaterialPublicRestore | null {
  const obj = asRecord(value);
  if (!obj) return null;
  if (obj.clientVerifyingShareB64u != null) {
    return null;
  }
  let chainTarget: ThresholdEcdsaChainTarget;
  let runtimePolicyScope: ReturnType<typeof normalizeRuntimePolicyScope>;
  let routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
  let publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  try {
    chainTarget = thresholdEcdsaChainTargetFromRequest(
      obj.chainTarget && typeof obj.chainTarget === 'object'
        ? (obj.chainTarget as Record<string, unknown>)
        : {},
    );
    runtimePolicyScope = normalizeRuntimePolicyScope(obj.runtimePolicyScope);
    const parsedRouterAbState = parseRouterAbEcdsaDerivationNormalSigningStateV1(
      obj.routerAbEcdsaDerivationNormalSigning,
    );
    if (!parsedRouterAbState) return null;
    routerAbEcdsaDerivationNormalSigning = parsedRouterAbState;
    publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(obj.publicCapability);
  } catch {
    return null;
  }
  const signingRootId = normalizeOptionalNonEmptyString(obj.signingRootId);
  const signingRootVersion = normalizeOptionalNonEmptyString(obj.signingRootVersion);
  let roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef | null = null;
  try {
    roleLocalMaterialRef = parseEcdsaRoleLocalPersistedMaterialRef(obj.roleLocalMaterialRef);
  } catch {
    roleLocalMaterialRef = null;
  }
  const authorityRef = parseWalletAuthAuthorityRef(obj.authority);
  const emailOtpAuthority = parseEmailOtpWalletAuthAuthority(obj.emailOtpAuthority);
  const keyHandle = normalizeOptionalNonEmptyString(obj.keyHandle);
  const ecdsaThresholdKeyId = normalizeOptionalNonEmptyString(obj.ecdsaThresholdKeyId);
  const ethereumAddress = normalizeOptionalNonEmptyString(obj.ethereumAddress);
  const relayerKeyId = normalizeOptionalNonEmptyString(obj.relayerKeyId);
  const thresholdEcdsaPublicKeyB64u = normalizeOptionalNonEmptyString(
    obj.thresholdEcdsaPublicKeyB64u,
  );
  const participantIds = normalizeParticipantIds(obj.participantIds);
  if (
    !signingRootId ||
    !signingRootVersion ||
    !keyHandle ||
    !ecdsaThresholdKeyId ||
    !ethereumAddress ||
    !relayerKeyId ||
    !thresholdEcdsaPublicKeyB64u ||
    !participantIds.length
  ) {
    return null;
  }
  const base = {
    chainTarget,
    signingRootId,
    signingRootVersion,
    keyHandle,
    ecdsaThresholdKeyId,
    ethereumAddress,
    relayerKeyId,
    thresholdEcdsaPublicKeyB64u,
    participantIds,
    runtimePolicyScope,
    routerAbEcdsaDerivationNormalSigning,
    publicCapability,
  };
  switch (obj.source) {
    case 'email_otp': {
      const provider = obj.provider === 'google' || obj.provider === 'email' ? obj.provider : null;
      const providerSubjectId = normalizeOptionalNonEmptyString(obj.providerSubjectId);
      const emailHashHex = normalizeOptionalNonEmptyString(obj.emailHashHex);
      if (
        !provider ||
        !providerSubjectId ||
        !emailHashHex ||
        !roleLocalMaterialRef ||
        !authorityRef ||
        !emailOtpAuthority ||
        obj.rpId != null ||
        obj.credentialIdB64u != null
      ) {
        return null;
      }
      return {
        ...base,
        source: 'email_otp',
        provider,
        providerSubjectId,
        emailHashHex,
        authority: authorityRef,
        emailOtpAuthority,
        roleLocalMaterialRef,
      };
    }
    case 'login':
    case 'registration':
    case 'manual-bootstrap': {
      const rpId = normalizeOptionalNonEmptyString(obj.rpId);
      const credentialIdB64u = normalizeOptionalNonEmptyString(obj.credentialIdB64u);
      if (
        !rpId ||
        !credentialIdB64u ||
        !roleLocalMaterialRef ||
        !authorityRef ||
        obj.providerSubjectId != null ||
        obj.emailHashHex != null
      ) {
        return null;
      }
      return {
        ...base,
        source: obj.source,
        authority: authorityRef,
        roleLocalMaterialRef,
        rpId,
        credentialIdB64u,
      };
    }
    default:
      return null;
  }
}

function normalizeEcdsaInactiveSealedMaterialRecord(
  value: unknown,
): EcdsaInactiveSealedMaterialRecord | null {
  const payload = storagePayloadFromSealedStoreRow(value);
  const obj = asRecord(payload);
  if (!obj || obj.recordKind !== ECDSA_INACTIVE_SEALED_MATERIAL_RECORD_KIND) return null;
  if (
    hasRetiredAuthorizationIdentityField(obj) ||
    obj.thresholdSessionIds != null ||
    obj.ed25519Restore != null
  ) {
    return null;
  }
  if (obj.curve !== 'ecdsa') return null;
  const authMethod = normalizeAuthMethod(obj.authMethod);
  const walletId = normalizeOptionalNonEmptyString(obj.walletId);
  const relayerUrl = normalizeOptionalNonEmptyString(obj.relayerUrl);
  const ecdsaRestore = normalizeEcdsaInactiveMaterialPublicRestore(obj.ecdsaRestore);
  const sealedSecretB64u = normalizeOptionalNonEmptyString(obj.sealedSecretB64u);
  const keyVersion = normalizeOptionalNonEmptyString(obj.keyVersion);
  const groupId = normalizeOptionalNonEmptyString(obj.groupId);
  const updatedAtMs = normalizeInteger(obj.updatedAtMs);
  const authorizationRetirementReason = obj.authorizationRetirementReason;
  if (
    !authMethod ||
    !walletId ||
    !relayerUrl ||
    !ecdsaRestore ||
    obj.alg !== SIGNING_SESSION_SEAL_ALG ||
    obj.storageScope !== SIGNING_SESSION_SEAL_STORAGE_SCOPE ||
    obj.secretKind !== SIGNING_SESSION_SECRET_KIND ||
    !sealedSecretB64u ||
    !keyVersion ||
    groupId !== SIGNING_SESSION_SEAL_GROUP_ID ||
    obj.issuedAtMs != null ||
    obj.expiresAtMs != null ||
    obj.remainingUses != null ||
    updatedAtMs == null ||
    updatedAtMs <= 0
  ) {
    return null;
  }
  if (
    authorizationRetirementReason !== 'expired' &&
    authorizationRetirementReason !== 'exhausted'
  ) {
    return null;
  }
  const storeKey = makeInactiveEcdsaMaterialStoreKey({
    walletId,
    authMethod,
    restore: ecdsaRestore,
  });
  if (normalizeOptionalNonEmptyString(obj.storeKey) !== storeKey) return null;
  return inactiveEcdsaSealedMaterialRecord({
    storeKey,
    walletId,
    relayerUrl,
    sealedSecretB64u,
    keyVersion,
    updatedAtMs,
    authorizationRetirementReason,
    authMethod,
    ecdsaRestore,
  });
}

/** Null when the auth method and the restore's source name different factors. */
function inactiveEcdsaSealedMaterialRecord(args: {
  storeKey: string;
  walletId: string;
  relayerUrl: string;
  sealedSecretB64u: string;
  keyVersion: string;
  updatedAtMs: number;
  authorizationRetirementReason: 'expired' | 'exhausted';
  authMethod: 'passkey' | 'email_otp';
  ecdsaRestore: EcdsaInactiveMaterialPublicRestore;
}): EcdsaInactiveSealedMaterialRecord | null {
  const { authMethod, ecdsaRestore } = args;
  const common = {
    recordKind: ECDSA_INACTIVE_SEALED_MATERIAL_RECORD_KIND,
    storeKey: args.storeKey,
    curve: 'ecdsa',
    walletId: args.walletId,
    relayerUrl: args.relayerUrl,
    alg: SIGNING_SESSION_SEAL_ALG,
    storageScope: SIGNING_SESSION_SEAL_STORAGE_SCOPE,
    secretKind: SIGNING_SESSION_SECRET_KIND,
    sealedSecretB64u: args.sealedSecretB64u,
    keyVersion: args.keyVersion,
    groupId: SIGNING_SESSION_SEAL_GROUP_ID,
    updatedAtMs: args.updatedAtMs,
    authorizationRetirementReason: args.authorizationRetirementReason,
  } as const;
  if (authMethod === 'email_otp' && ecdsaRestore.source === 'email_otp') {
    return { ...common, authMethod, ecdsaRestore };
  }
  if (authMethod === 'passkey' && ecdsaRestore.source !== 'email_otp') {
    return { ...common, authMethod, ecdsaRestore };
  }
  return null;
}

export function logSealedSessionClassification(args: {
  operation: string;
  classification: Exclude<
    SealedSessionRecordClassification,
    CurrentSealedSessionRecordClassification
  >;
}): void {
  if (args.classification.kind === 'ecdsa_inactive_material') return;
  if (args.classification.kind === 'rebuild_required') return;
  if (args.classification.kind === 'unrelated_record') return;
  const outcome = args.classification.kind === 'malformed' ? 'malformed' : 'rejected';
  const payload = {
    operation: args.operation,
    outcome,
    classificationKind: args.classification.kind,
    ...args.classification,
  };
  console.warn('[SigningSessionSealedStore] rejected sealed record', payload);
}

export function buildCurrentSealedSessionRecord(
  args: BuildCurrentSealedSessionRecordInput,
): CurrentSealedSessionRecord | null {
  const thresholdSessionId = String(args.thresholdSessionId || '').trim();
  const curve = normalizeCurve(args.curve);
  const authMethod =
    args.authMethod === 'passkey' || args.authMethod === 'email_otp' ? args.authMethod : undefined;
  if (!curve || !authMethod) return null;
  const thresholdSessionIds = thresholdSessionIdsForWrite({
    thresholdSessionId,
    curve,
    thresholdSessionIds: args.thresholdSessionIds,
  });
  const walletId = normalizeOptionalNonEmptyString(args.walletId);
  const sealedSecretB64u = normalizeOptionalNonEmptyString(args.sealedSecretB64u);
  const expiresAtMs = normalizeInteger(args.expiresAtMs);
  const remainingUses = normalizeInteger(args.remainingUses);
  const issuedAtMs = normalizeInteger(args.issuedAtMs);
  const updatedAtMs = normalizeInteger(args.updatedAtMs);
  const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion);
  if (
    !thresholdSessionId ||
    !sealedSecretB64u ||
    !keyVersion ||
    args.groupId !== SIGNING_SESSION_SEAL_GROUP_ID
  )
    return null;
  if (!thresholdSessionIds.ed25519 && !thresholdSessionIds.ecdsa) return null;
  if (issuedAtMs == null || issuedAtMs <= 0) return null;
  if (expiresAtMs == null || expiresAtMs <= 0) return null;
  if (remainingUses == null || remainingUses < 0) return null;
  if (updatedAtMs == null || updatedAtMs <= 0) return null;
  const ecdsaRestore = normalizeEcdsaRestoreMetadata(args.ecdsaRestore);
  const ed25519Restore = normalizeCurrentEd25519RestoreMetadata(args.ed25519Restore);
  if (hasStaleSealedSessionWalletIdentityFields(args)) return null;
  if (curve === 'ecdsa') {
    if (!ecdsaRestore?.chainTarget || !walletId) return null;
    if (hasTopLevelSigningRootFields(args)) return null;
  }
  let signingRootIdForWrite: string | undefined;
  let signingRootVersionForWrite: string | undefined;
  if (args.curve === 'ed25519') {
    signingRootIdForWrite = normalizeOptionalNonEmptyString(args.signingRootId);
    signingRootVersionForWrite = normalizeOptionalNonEmptyString(args.signingRootVersion);
  }

  const classification = classifyRawSealedSessionRecord({
    ...currentSealedRecordHeader(authMethod),
    thresholdSessionIds,
    sealedSecretB64u,
    curve,
    ...(walletId ? { walletId } : {}),
    ...(signingRootIdForWrite ? { signingRootId: signingRootIdForWrite } : {}),
    ...(signingRootVersionForWrite ? { signingRootVersion: signingRootVersionForWrite } : {}),
    ...(normalizeOptionalNonEmptyString(args.relayerUrl)
      ? { relayerUrl: normalizeOptionalNonEmptyString(args.relayerUrl) }
      : {}),
    keyVersion,
    groupId: SIGNING_SESSION_SEAL_GROUP_ID,
    ...(ecdsaRestore ? { ecdsaRestore } : {}),
    ...(ed25519Restore ? { ed25519Restore } : {}),
    issuedAtMs,
    expiresAtMs,
    remainingUses,
    updatedAtMs,
  });
  if (classification.kind !== 'current') {
    logSealedSessionClassification({
      operation: 'build current sealed session record',
      classification,
    });
    return null;
  }
  return classification.record;
}

function thresholdSessionIdsForWrite(args: {
  thresholdSessionId: string;
  curve: 'ed25519' | 'ecdsa';
  thresholdSessionIds: {
    ed25519?: string;
    ecdsa?: string;
  };
}): { ed25519?: string; ecdsa?: string } {
  const explicit = normalizeThresholdSessionIds(args.thresholdSessionIds);
  const thresholdSessionId = String(args.thresholdSessionId || '').trim();
  if (!thresholdSessionId) return {};
  if (args.curve === 'ed25519' && explicit.ed25519 === thresholdSessionId) return explicit;
  if (args.curve === 'ecdsa' && explicit.ecdsa === thresholdSessionId) return explicit;
  return {};
}

export function buildEcdsaInactiveMaterialPublicRestore(
  restore: SealedSigningSessionEcdsaRestoreMetadata,
  relayerUrlRaw: string,
): EcdsaInactiveMaterialPublicRestore | null {
  const relayerUrl = normalizeOptionalNonEmptyString(relayerUrlRaw);
  const ecdsaThresholdKeyId = normalizeOptionalNonEmptyString(restore.ecdsaThresholdKeyId);
  const thresholdEcdsaPublicKeyB64u = normalizeOptionalNonEmptyString(
    restore.thresholdEcdsaPublicKeyB64u,
  );
  if (!relayerUrl || !ecdsaThresholdKeyId || !thresholdEcdsaPublicKeyB64u) return null;
  let runtimePolicyScope: ReturnType<typeof normalizeRuntimePolicyScope>;
  try {
    runtimePolicyScope = normalizeRuntimePolicyScope(restore.runtimePolicyScope);
  } catch {
    return null;
  }
  const base = {
    chainTarget: restore.chainTarget,
    signingRootId: restore.signingRootId,
    signingRootVersion: restore.signingRootVersion,
    keyHandle: restore.keyHandle,
    ecdsaThresholdKeyId,
    ethereumAddress: restore.ethereumAddress,
    relayerKeyId: restore.relayerKeyId,
    thresholdEcdsaPublicKeyB64u,
    participantIds: [...restore.participantIds],
    runtimePolicyScope,
    routerAbEcdsaDerivationNormalSigning: restore.routerAbEcdsaDerivationNormalSigning,
    publicCapability: restore.publicCapability,
  };
  switch (restore.source) {
    case 'email_otp':
      return {
        ...base,
        source: 'email_otp',
        provider: restore.provider,
        providerSubjectId: restore.providerSubjectId,
        emailHashHex: restore.emailHashHex,
        authority: restore.authority,
        emailOtpAuthority: restore.emailOtpAuthority,
        roleLocalMaterialRef: parseEcdsaRoleLocalPersistedMaterialRef(restore.roleLocalMaterialRef),
      };
    case 'login':
    case 'registration':
    case 'manual-bootstrap':
      return {
        ...base,
        source: restore.source,
        authority: restore.authority,
        roleLocalMaterialRef: parseEcdsaRoleLocalPersistedMaterialRef(restore.roleLocalMaterialRef),
        rpId: restore.rpId,
        credentialIdB64u: restore.credentialIdB64u,
      };
  }
}

function buildInactiveEcdsaSealedMaterial(args: {
  record: CurrentEcdsaSealedSessionRecord;
  retirement: 'expired' | 'exhausted';
  updatedAtMs: number;
}): EcdsaInactiveSealedMaterialRecord | null {
  const record = args.record;
  const publicRestore = buildEcdsaInactiveMaterialPublicRestore(
    record.ecdsaRestore,
    record.relayerUrl,
  );
  if (!publicRestore) return null;
  return inactiveEcdsaSealedMaterialRecord({
    storeKey: makeInactiveEcdsaMaterialStoreKey({
      walletId: record.walletId,
      authMethod: record.authMethod,
      restore: publicRestore,
    }),
    walletId: record.walletId,
    relayerUrl: record.relayerUrl,
    sealedSecretB64u: record.sealedSecretB64u,
    keyVersion: record.keyVersion,
    updatedAtMs: args.updatedAtMs,
    authorizationRetirementReason: args.retirement,
    authMethod: record.authMethod,
    ecdsaRestore: publicRestore,
  });
}

export function requireInactiveEcdsaSealedMaterial(args: {
  record: CurrentEcdsaSealedSessionRecord;
  retirement: 'expired' | 'exhausted';
  updatedAtMs: number;
}): EcdsaInactiveSealedMaterialRecord {
  const inactiveMaterial = buildInactiveEcdsaSealedMaterial(args);
  if (!inactiveMaterial) {
    throw new Error(
      '[SigningSessionSealedStore] inactive ECDSA material requires exact public restore facts',
    );
  }
  return inactiveMaterial;
}
