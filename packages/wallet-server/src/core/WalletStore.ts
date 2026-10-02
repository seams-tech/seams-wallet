import type { ThresholdEcdsaChainTarget } from './types';
import type { WalletRegistrationEcdsaWalletKey, WalletId } from './registrationContracts';
import {
  ecdsaClientRootPublicKey33B64uFromString,
  derivationClientSharePublicKey33B64uFromString,
  parseSdkEcdsaDerivationThresholdKeyId,
  type EcdsaClientRootPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import {
  normalizeRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import type {
  RouterAbEd25519YaoActivationResultV1,
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoRecoveryAdmissionRequestV1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import { type RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseRouterAbEcdsaDerivationActivationRefreshResponseV1,
  parseRouterAbEcdsaDerivationActivationRefreshRequestV1,
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  sameRouterAbEcdsaDerivationPublicIdentityV1,
  sameRegistrationSignerSet,
  type RouterAbEcdsaDerivationActivationRefreshForwardedResponseV1,
  type RouterAbEcdsaDerivationActivationRefreshRequestV1,
  type RouterAbEcdsaDerivationPublicCapabilityV1,
  type RouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { toOptionalTrimmedString, isPlainObject } from '@shared/utils/validation';
import { parseWalletId } from '@shared/utils/domainIds';
import {
  thresholdEcdsaChainTargetFromValue,
  thresholdEcdsaChainTargetKey,
} from './thresholdEcdsaChainTarget';

export {
  D1WalletStore,
  WALLET_STORE_D1_SCHEMA_SQL,
  buildWalletEcdsaSignerRecord,
  ensureWalletStoreD1Schema,
} from './d1WalletStore';
export type { D1WalletStoreOptions, D1WalletStoreSchemaOptions } from './d1WalletStore';

export type WalletRecord = {
  version: 'wallet_v1';
  walletId: WalletId;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WalletEd25519YaoActiveCapabilityRecord =
  | {
      readonly version: 'wallet_ed25519_yao_registration_capability_v1';
      readonly activeCapabilityBinding: RouterAbEd25519YaoBytes32V1;
      readonly nearAccountId: string;
      readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
      readonly admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
      readonly activationResult: RouterAbEd25519YaoActivationResultV1<'registration'>;
      readonly runtimePolicyScope: RuntimePolicyScope;
    }
  | {
      readonly version: 'wallet_ed25519_yao_recovery_capability_v1';
      readonly activeCapabilityBinding: RouterAbEd25519YaoBytes32V1;
      readonly nearAccountId: string;
      readonly admissionRequest: RouterAbEd25519YaoRecoveryAdmissionRequestV1;
      readonly activationResult: RouterAbEd25519YaoActivationResultV1<'recovery'>;
      readonly runtimePolicyScope: RuntimePolicyScope;
    };

export type WalletEd25519SignerRecord = {
  version: 'wallet_signer_ed25519_v1';
  walletId: WalletId;
  signerId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  thresholdSessionId: string;
  signerSlot: number;
  publicKey: string;
  signingWorkerId: string;
  keyVersion: string;
  recoveryExportCapable: boolean;
  participantIds: readonly [number, number];
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicyScope: RuntimePolicyScope;
  activeYaoCapability: WalletEd25519YaoActiveCapabilityRecord;
  custodyKeyManifestDigestB64u: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WalletEcdsaSignerKey = Omit<
  WalletRegistrationEcdsaWalletKey,
  'evmFamilySigningKeySlotId'
> & {
  evmFamilySigningKeySlotId?: never;
};

export type WalletEcdsaSignerRecord = {
  version: 'wallet_signer_ecdsa_v1';
  walletId: WalletId;
  evmFamilySigningKeySlotId?: never;
  signerId: string;
  chainTargetKey: string;
  chainTarget: ThresholdEcdsaChainTarget;
  walletKey: WalletEcdsaSignerKey;
  activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  runtimePolicyScope: RuntimePolicyScope;
  custodyKeyManifestDigestB64u: string;
  custodyClientRootPublicKey33B64u: EcdsaClientRootPublicKey33B64u;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WalletSignerRecord = WalletEd25519SignerRecord | WalletEcdsaSignerRecord;

type WalletEcdsaPostRegistrationProofRecordBase = {
  version: 'wallet_ecdsa_pending_session_activation_v1';
  walletId: WalletId;
  lifecycleId: string;
  requestId: string;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  createdAtMs: number;
  expiresAtMs: number;
};

export type WalletEcdsaPendingSessionActivationRecord =
  WalletEcdsaPostRegistrationProofRecordBase & {
    operation: 'refresh';
    request: RouterAbEcdsaDerivationActivationRefreshRequestV1;
    response: RouterAbEcdsaDerivationActivationRefreshForwardedResponseV1;
  };

export type WalletEcdsaPostRegistrationPublicRequest =
  RouterAbEcdsaDerivationActivationRefreshRequestV1;

export interface WalletStore {
  getWallet(input: { walletId: WalletId }): Promise<WalletRecord | null>;
  getEcdsaSignerByKeyHandle(input: {
    walletId: WalletId;
    keyHandle: string;
    chainTarget: ThresholdEcdsaChainTarget;
  }): Promise<WalletEcdsaSignerRecord | null>;
  getEcdsaSignerByPublicCapability(input: {
    walletId: WalletId;
    publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  }): Promise<WalletEcdsaSignerRecord | null>;
  getEcdsaSignerByMaterialActivation(input: {
    walletId: WalletId;
    materialActivation: RouterAbMpcMaterialActivationRefWire;
  }): Promise<WalletEcdsaSignerRecord | null>;
  getEcdsaSignerByPostRegistrationRequest(input: {
    walletId: WalletId;
    request: WalletEcdsaPostRegistrationPublicRequest;
  }): Promise<WalletEcdsaSignerRecord | null>;
  listEcdsaSignersForWallet(input: {
    walletId: WalletId;
  }): Promise<readonly WalletEcdsaSignerRecord[]>;
  /**
   * The wallet's Ed25519 signer for one key-creation slot. Callers that need
   * the manifest a NEAR key set was registered against read it from here — it
   * is recorded on the signer and nowhere else.
   */
  getEd25519SignerBySlot(input: {
    walletId: WalletId;
    signerSlot: number;
  }): Promise<WalletEd25519SignerRecord | null>;
  putEcdsaPendingSessionActivation(
    record: WalletEcdsaPendingSessionActivationRecord,
  ): Promise<void>;
  putSubject(record: WalletRecord): Promise<void>;
  putSigner(record: WalletSignerRecord): Promise<void>;
  putSigners(records: readonly WalletSignerRecord[]): Promise<void>;
}

export function parseWalletEcdsaPendingSessionActivationRecord(
  raw: unknown,
): WalletEcdsaPendingSessionActivationRecord | null {
  if (!isPlainObject(raw) || raw.version !== 'wallet_ecdsa_pending_session_activation_v1')
    return null;
  const walletId = parseWalletId(raw.walletId);
  const lifecycleId = toOptionalTrimmedString(raw.lifecycleId);
  const requestId = toOptionalTrimmedString(raw.requestId);
  const createdAtMs = normalizeTimestampMs(raw.createdAtMs);
  const expiresAtMs = normalizeTimestampMs(raw.expiresAtMs);
  if (
    !walletId.ok ||
    !lifecycleId ||
    !requestId ||
    createdAtMs == null ||
    expiresAtMs == null ||
    expiresAtMs <= createdAtMs
  ) {
    return null;
  }
  try {
    const base = {
      version: 'wallet_ecdsa_pending_session_activation_v1',
      walletId: walletId.value,
      lifecycleId,
      requestId,
      publicCapability: parseRouterAbEcdsaDerivationPublicCapabilityV1(raw.publicCapability),
      createdAtMs,
      expiresAtMs,
    } as const;
    if (raw.operation !== 'refresh') return null;
    return {
      ...base,
      operation: 'refresh',
      request: parseRouterAbEcdsaDerivationActivationRefreshRequestV1(raw.request),
      response: parseForwardedEcdsaRefreshResponse(raw.response),
    };
  } catch {
    return null;
  }
}

function parseForwardedEcdsaRefreshResponse(
  raw: unknown,
): RouterAbEcdsaDerivationActivationRefreshForwardedResponseV1 {
  const response = parseRouterAbEcdsaDerivationActivationRefreshResponseV1(raw);
  if (response.result !== 'forwarded') {
    throw new Error('Persisted ECDSA refresh proof must be forwarded');
  }
  return response;
}

export function ecdsaPostRegistrationRequestMatchesCapability(input: {
  request: WalletEcdsaPostRegistrationPublicRequest;
  capability: RouterAbEcdsaDerivationPublicCapabilityV1;
}): boolean {
  return (
    input.request.client_id === input.capability.client_id &&
    input.request.router_id === input.capability.router_id &&
    input.request.context.application_binding_digest_b64u ===
      input.capability.context.application_binding_digest_b64u &&
    sameRouterAbEcdsaDerivationPublicIdentityV1(
      input.request.public_identity,
      input.capability.public_identity,
    ) &&
    sameRegistrationSignerSet(input.request.signer_set, input.capability.signer_set)
  );
}

function normalizeTimestampMs(value: unknown): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return Math.floor(numberValue);
}

export function parseWalletEcdsaSignerRecord(raw: unknown): WalletEcdsaSignerRecord | null {
  if (!isPlainObject(raw) || raw.version !== 'wallet_signer_ecdsa_v1') return null;
  if ('evmFamilySigningKeySlotId' in raw) return null;
  const walletId = parseWalletId(raw.walletId);
  const signerId = toOptionalTrimmedString(raw.signerId);
  const chainTargetKey = toOptionalTrimmedString(raw.chainTargetKey);
  const chainTarget = thresholdEcdsaChainTargetFromValue(raw.chainTarget);
  const walletKeyRaw = isPlainObject(raw.walletKey) ? raw.walletKey : null;
  const walletKey = walletKeyRaw ? parseWalletEcdsaSignerKey(walletKeyRaw) : null;
  let activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  let runtimePolicyScope: RuntimePolicyScope;
  let custodyClientRootPublicKey33B64u: EcdsaClientRootPublicKey33B64u;
  try {
    activationReceipt = parseRouterAbEcdsaRegistrationActivationReceiptV1(raw.activationReceipt);
    runtimePolicyScope = normalizeRuntimePolicyScope(raw.runtimePolicyScope);
    custodyClientRootPublicKey33B64u = ecdsaClientRootPublicKey33B64uFromString(
      String(raw.custodyClientRootPublicKey33B64u ?? ''),
    );
  } catch {
    return null;
  }
  const custodyKeyManifestDigestB64u = toOptionalTrimmedString(raw.custodyKeyManifestDigestB64u);
  const createdAtMs = normalizeTimestampMs(raw.createdAtMs);
  const updatedAtMs = normalizeTimestampMs(raw.updatedAtMs);
  if (
    !walletId.ok ||
    !signerId ||
    !chainTargetKey ||
    !chainTarget ||
    !walletKey ||
    !custodyKeyManifestDigestB64u ||
    createdAtMs === null ||
    updatedAtMs === null ||
    walletKey.walletId !== walletId.value ||
    thresholdEcdsaChainTargetKey(chainTarget) !== chainTargetKey ||
    thresholdEcdsaChainTargetKey(walletKey.chainTarget) !== chainTargetKey
  ) {
    return null;
  }
  return {
    version: 'wallet_signer_ecdsa_v1',
    walletId: walletId.value,
    signerId,
    chainTargetKey,
    chainTarget,
    walletKey,
    activationReceipt,
    runtimePolicyScope,
    custodyKeyManifestDigestB64u,
    custodyClientRootPublicKey33B64u,
    createdAtMs,
    updatedAtMs,
  };
}

function parseWalletEcdsaSignerKey(raw: Record<string, unknown>): WalletEcdsaSignerKey | null {
  if ('evmFamilySigningKeySlotId' in raw) return null;
  const walletId = parseWalletId(raw.walletId);
  const chainTarget = thresholdEcdsaChainTargetFromValue(raw.chainTarget);
  const participantIds = raw.participantIds;
  const clientShareRetryCounter = normalizeNonNegativeInteger(raw.clientShareRetryCounter);
  const relayerShareRetryCounter = normalizeNonNegativeInteger(raw.relayerShareRetryCounter);
  let publicCapability;
  try {
    publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(raw.publicCapability);
  } catch {
    return null;
  }
  let derivationClientSharePublicKey33B64u;
  try {
    derivationClientSharePublicKey33B64u = derivationClientSharePublicKey33B64uFromString(
      toOptionalTrimmedString(raw.derivationClientSharePublicKey33B64u) || '',
    );
  } catch {
    return null;
  }
  if (
    raw.keyScope !== 'evm-family' ||
    !walletId.ok ||
    !chainTarget ||
    !Array.isArray(participantIds) ||
    participantIds.length !== 2 ||
    participantIds[0] !== 1 ||
    participantIds[1] !== 2 ||
    clientShareRetryCounter === null ||
    relayerShareRetryCounter === null
  ) {
    return null;
  }
  const keyHandle = toOptionalTrimmedString(raw.keyHandle);
  let ecdsaThresholdKeyId;
  try {
    ecdsaThresholdKeyId = parseSdkEcdsaDerivationThresholdKeyId(raw.ecdsaThresholdKeyId);
  } catch {
    return null;
  }
  const signingRootId = toOptionalTrimmedString(raw.signingRootId);
  const signingRootVersion = toOptionalTrimmedString(raw.signingRootVersion);
  const thresholdEcdsaPublicKeyB64u = toOptionalTrimmedString(raw.thresholdEcdsaPublicKeyB64u);
  const thresholdOwnerAddress = toOptionalTrimmedString(raw.thresholdOwnerAddress);
  const relayerKeyId = toOptionalTrimmedString(raw.relayerKeyId);
  const relayerVerifyingShareB64u = toOptionalTrimmedString(raw.relayerVerifyingShareB64u);
  const contextBinding32B64u = toOptionalTrimmedString(raw.contextBinding32B64u);
  if (
    !keyHandle ||
    !signingRootId ||
    !signingRootVersion ||
    !thresholdEcdsaPublicKeyB64u ||
    !thresholdOwnerAddress ||
    !relayerKeyId ||
    !relayerVerifyingShareB64u ||
    !contextBinding32B64u
  ) {
    return null;
  }
  return {
    keyScope: 'evm-family',
    chainTarget,
    walletId: walletId.value,
    keyHandle,
    ecdsaThresholdKeyId,
    signingRootId,
    signingRootVersion,
    thresholdEcdsaPublicKeyB64u,
    thresholdOwnerAddress,
    relayerKeyId,
    relayerVerifyingShareB64u,
    contextBinding32B64u,
    derivationClientSharePublicKey33B64u,
    clientShareRetryCounter,
    relayerShareRetryCounter,
    participantIds: [1, 2],
    publicCapability,
  };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

export function buildWalletEd25519SignerId(input: {
  nearAccountId: string;
  signerSlot: number;
}): string {
  const nearAccountId = String(input.nearAccountId || '').trim();
  const signerSlot = Number(input.signerSlot);
  if (!nearAccountId) throw new Error('Ed25519 signer ID requires nearAccountId');
  if (!Number.isSafeInteger(signerSlot) || signerSlot < 1) {
    throw new Error('Ed25519 signer ID requires an exact signerSlot');
  }
  return `ed25519:${nearAccountId}:${signerSlot}`;
}
