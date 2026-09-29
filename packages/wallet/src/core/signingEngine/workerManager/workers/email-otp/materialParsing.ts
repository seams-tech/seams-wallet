/**
 * Parsers for the custody, unlock and Ed25519 Yao material that requests and unlock responses
 * carry.
 */
import {
  mpcMaterialActivationRefsEqual,
  parseMpcMaterialActivationRef,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/encoders';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
} from '@shared/authorization/capabilityKinds';
import { parsePasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { asRecord } from '@shared/utils/validation';
import { normalizeNonNegativeInteger, normalizePositiveInteger } from '@shared/utils/normalize';
import { normalizeThresholdEd25519ParticipantIds } from '@shared/threshold/participants';
import {
  ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import { parseRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseRouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { WalletCustodyCacheEnvelopeV1 } from '@/core/signingEngine/walletCustody/openCustodyCache';
import type {
  LoadedWalletCustodyEd25519MaterialV1,
  WalletCustodyEd25519MaterialBindingV1,
  WalletCustodySealedEd25519MaterialV1,
} from '@/core/signingEngine/walletCustody/ed25519SeedMaterial';
import type {
  EmailOtpEcdsaSessionBootstrapHandleBinding,
  EmailOtpEd25519YaoActiveCapabilityDescriptorV1,
  EmailOtpEd25519YaoExportMaterialV1,
  EmailOtpEd25519YaoRecoveryAugmentationV1,
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpWalletCustodyEd25519MaterialRequest,
  EmailOtpWalletUnlockMaterialRequest,
} from '@/core/signingEngine/workerManager/workerTypes';
import type { RouterAbEd25519YaoClientSigningInputV1 } from '../../../threshold/ed25519/yaoClient';
import type { WalletRegistrationEd25519YaoSignerRuntimeBootstrap } from '@shared/utils/registrationContracts';
import { parseRouterAbEcdsaPostRegistrationSessionActivationPolicyV1 } from '@shared/utils/routerAbEcdsaDerivation';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  parseOptionalWorkerEcdsaSessionBootstrapHandleBinding,
  parseWorkerRuntimePolicyScope,
  readString,
  readThresholdEd25519SessionId,
  rejectUnknownEmailOtpYaoFields,
} from './payloadParsing';

export function parseWalletCustodyEd25519MaterialRequest(
  value: unknown,
): EmailOtpWalletCustodyEd25519MaterialRequest {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP wallet custody Ed25519 material is required');
  const kind = readString(obj.kind, 'walletCustodyEd25519Material.kind');
  if (kind === 'absent') {
    rejectUnknownEmailOtpYaoFields(obj, ['kind'], 'walletCustodyEd25519Material');
    return { kind: 'absent' };
  }
  if (kind !== 'found') {
    throw new Error(`Unsupported wallet custody Ed25519 material kind: ${kind}`);
  }
  rejectUnknownEmailOtpYaoFields(obj, ['kind', 'material'], 'walletCustodyEd25519Material');
  const material = asRecord(obj.material);
  if (!material) throw new Error('walletCustodyEd25519Material.material is required');
  rejectUnknownEmailOtpYaoFields(
    material,
    ['binding', 'sealed'],
    'walletCustodyEd25519Material.material',
  );
  const bindingRecord = asRecord(material.binding);
  const sealedRecord = asRecord(material.sealed);
  if (!bindingRecord || !sealedRecord) {
    throw new Error('walletCustodyEd25519Material requires binding and sealed records');
  }
  rejectUnknownEmailOtpYaoFields(
    bindingRecord,
    [
      'kind',
      'applicationBindingDigestB64u',
      'registeredPublicKeyB64u',
      'participantIds',
      'stateEpoch',
      'walletId',
      'nearAccountId',
      'nearEd25519SigningKeyId',
      'signerSlot',
      'signingWorkerId',
      'signingWorkerVerifyingShareB64u',
    ],
    'walletCustodyEd25519Material.binding',
  );
  rejectUnknownEmailOtpYaoFields(
    sealedRecord,
    ['ciphertextB64u', 'nonceB64u'],
    'walletCustodyEd25519Material.sealed',
  );
  const participants = normalizeThresholdEd25519ParticipantIds(bindingRecord.participantIds);
  if (!participants || participants.length !== 2) {
    throw new Error('walletCustodyEd25519Material.binding.participantIds is invalid');
  }
  const signerSlot = normalizePositiveInteger(bindingRecord.signerSlot);
  if (!signerSlot) throw new Error('walletCustodyEd25519Material.binding.signerSlot is invalid');
  const binding: WalletCustodyEd25519MaterialBindingV1 = {
    kind: 'wallet_custody_ed25519_active_client_v1',
    applicationBindingDigestB64u: readString(
      bindingRecord.applicationBindingDigestB64u,
      'walletCustodyEd25519Material.binding.applicationBindingDigestB64u',
    ),
    registeredPublicKeyB64u: readString(
      bindingRecord.registeredPublicKeyB64u,
      'walletCustodyEd25519Material.binding.registeredPublicKeyB64u',
    ),
    participantIds: [participants[0], participants[1]],
    stateEpoch: readString(
      bindingRecord.stateEpoch,
      'walletCustodyEd25519Material.binding.stateEpoch',
    ),
    walletId: readString(bindingRecord.walletId, 'walletCustodyEd25519Material.binding.walletId'),
    nearAccountId: readString(
      bindingRecord.nearAccountId,
      'walletCustodyEd25519Material.binding.nearAccountId',
    ),
    nearEd25519SigningKeyId: readString(
      bindingRecord.nearEd25519SigningKeyId,
      'walletCustodyEd25519Material.binding.nearEd25519SigningKeyId',
    ),
    signerSlot,
    signingWorkerId: readString(
      bindingRecord.signingWorkerId,
      'walletCustodyEd25519Material.binding.signingWorkerId',
    ),
    signingWorkerVerifyingShareB64u: readString(
      bindingRecord.signingWorkerVerifyingShareB64u,
      'walletCustodyEd25519Material.binding.signingWorkerVerifyingShareB64u',
    ),
  };
  const sealed: WalletCustodySealedEd25519MaterialV1 = {
    ciphertextB64u: readString(
      sealedRecord.ciphertextB64u,
      'walletCustodyEd25519Material.sealed.ciphertextB64u',
    ),
    nonceB64u: readString(sealedRecord.nonceB64u, 'walletCustodyEd25519Material.sealed.nonceB64u'),
  };
  const parsed: LoadedWalletCustodyEd25519MaterialV1 = { binding, sealed };
  return { kind: 'found', material: parsed };
}

export function parseWalletCustodyCacheEnvelope(value: unknown): WalletCustodyCacheEnvelopeV1 {
  const envelope = asRecord(value);
  if (!envelope) throw new Error('Wallet custody cache envelope is required');
  rejectUnknownEmailOtpYaoFields(
    envelope,
    ['bindingJson', 'nonceB64u', 'ciphertextB64u', 'aadHashB64u', 'ciphertextDigestB64u'],
    'walletCustodyCacheEnvelope',
  );
  return {
    bindingJson: readString(envelope.bindingJson, 'walletCustodyCacheEnvelope.bindingJson'),
    nonceB64u: readString(envelope.nonceB64u, 'walletCustodyCacheEnvelope.nonceB64u'),
    ciphertextB64u: readString(
      envelope.ciphertextB64u,
      'walletCustodyCacheEnvelope.ciphertextB64u',
    ),
    aadHashB64u: readString(envelope.aadHashB64u, 'walletCustodyCacheEnvelope.aadHashB64u'),
    ciphertextDigestB64u: readString(
      envelope.ciphertextDigestB64u,
      'walletCustodyCacheEnvelope.ciphertextDigestB64u',
    ),
  };
}

function parseEmailOtpEd25519YaoParticipantIds(
  value: unknown,
  label: string,
): readonly [number, number] {
  const participantIds = normalizeThresholdEd25519ParticipantIds(value);
  if (!participantIds || participantIds.length !== 2) {
    throw new Error(`${label} requires exactly two participant IDs`);
  }
  return [participantIds[0], participantIds[1]];
}

export function parseEmailOtpEd25519YaoRecoveryAugmentation(
  value: unknown,
): EmailOtpEd25519YaoRecoveryAugmentationV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao recovery augmentation is required');
  rejectUnknownEmailOtpYaoFields(
    obj,
    ['kind', 'signerSlot', 'remainingUses', 'orgId'],
    'ed25519YaoRecovery',
  );
  if (obj.kind !== ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1) {
    throw new Error('Email OTP Ed25519 Yao recovery augmentation kind is invalid');
  }
  const signerSlot = normalizePositiveInteger(obj.signerSlot);
  if (!signerSlot) throw new Error('Email OTP Ed25519 Yao recovery signerSlot is invalid');
  const remainingUses = normalizePositiveInteger(obj.remainingUses);
  if (!remainingUses) throw new Error('Email OTP Ed25519 Yao recovery budget is invalid');
  return {
    kind: ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
    signerSlot,
    remainingUses,
    orgId: readString(obj.orgId, 'ed25519YaoRecovery.orgId'),
  };
}

export const EMAIL_OTP_ED25519_RECOVERY_LANE_FIELDS = [
  'providerSubject',
  'nearAccountId',
  'expectedOperationalPublicKey',
  'expectedThresholdSessionId',
  'walletCustodyEd25519Material',
] as const;

/** The Ed25519 lane an Email OTP unlock restores, named the same way by every request. */
export function parseEmailOtpEd25519RecoveryLane(record: Record<string, unknown>, label: string) {
  return {
    providerSubject: readString(record.providerSubject, `${label}.providerSubject`),
    nearAccountId: readString(record.nearAccountId, `${label}.nearAccountId`),
    expectedOperationalPublicKey: readString(
      record.expectedOperationalPublicKey,
      `${label}.expectedOperationalPublicKey`,
    ),
    expectedThresholdSessionId: readString(
      record.expectedThresholdSessionId,
      `${label}.expectedThresholdSessionId`,
    ),
    walletCustodyEd25519Material: parseWalletCustodyEd25519MaterialRequest(
      record.walletCustodyEd25519Material,
    ),
  };
}

function emailOtpNonUnlockEcdsaHandleBindingFromParsedBinding(
  binding: EmailOtpEcdsaSessionBootstrapHandleBinding,
): Exclude<EmailOtpEcdsaSessionBootstrapHandleBinding, { operation: 'wallet_unlock' }> {
  switch (binding.operation) {
    case 'sign':
      return { ...binding, operation: 'sign' };
    case 'export':
      return { ...binding, operation: 'export' };
    case 'wallet_unlock':
      throw new Error('Email OTP wallet-unlock binding requires first-session activation');
  }
}

export function parseEmailOtpWalletUnlockMaterialRequest(
  value: unknown,
): EmailOtpWalletUnlockMaterialRequest {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP wallet unlock material request is required');
  const kind = readString(obj.kind, 'material.kind');
  switch (kind) {
    case 'ecdsa': {
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'ecdsaSessionHandleBinding', 'runtimePolicyScope', 'ecdsaSessionPolicy'],
        'material',
      );
      const binding = parseOptionalWorkerEcdsaSessionBootstrapHandleBinding(
        obj.ecdsaSessionHandleBinding,
      );
      if (!binding) throw new Error('Email OTP ECDSA wallet unlock requires its session binding');
      const runtimePolicyScope = parseWorkerRuntimePolicyScope(
        obj.runtimePolicyScope,
        'Email OTP ECDSA wallet unlock',
      );
      if (binding.operation === 'wallet_unlock') {
        return {
          kind: 'ecdsa',
          ecdsaSessionHandleBinding: { ...binding, operation: 'wallet_unlock' },
          runtimePolicyScope,
          ecdsaSessionPolicy: parseRouterAbEcdsaPostRegistrationSessionActivationPolicyV1(
            obj.ecdsaSessionPolicy,
          ),
        };
      }
      if (obj.ecdsaSessionPolicy !== undefined) {
        throw new Error('Email OTP first ECDSA activation requires wallet-unlock binding');
      }
      return {
        kind: 'ecdsa',
        ecdsaSessionHandleBinding: emailOtpNonUnlockEcdsaHandleBindingFromParsedBinding(binding),
        runtimePolicyScope,
      };
    }
    case 'ed25519_yao_recovery':
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'ed25519YaoRecovery', ...EMAIL_OTP_ED25519_RECOVERY_LANE_FIELDS],
        'material',
      );
      return {
        kind: 'ed25519_yao_recovery',
        ed25519YaoRecovery: parseEmailOtpEd25519YaoRecoveryAugmentation(obj.ed25519YaoRecovery),
        ...parseEmailOtpEd25519RecoveryLane(obj, 'material'),
      };
    case 'wallet_unlock_capabilities': {
      rejectUnknownEmailOtpYaoFields(obj, ['kind', 'ecdsa', 'ed25519Yao'], 'material');
      const ecdsa = asRecord(obj.ecdsa);
      const ed25519Yao = asRecord(obj.ed25519Yao);
      if (!ecdsa || !ed25519Yao) {
        throw new Error('Wallet unlock capabilities require exact ECDSA and Ed25519 inputs');
      }
      rejectUnknownEmailOtpYaoFields(
        ecdsa,
        ['sessionHandleBinding', 'runtimePolicyScope', 'sessionPolicy'],
        'material.ecdsa',
      );
      rejectUnknownEmailOtpYaoFields(
        ed25519Yao,
        ['recovery', ...EMAIL_OTP_ED25519_RECOVERY_LANE_FIELDS],
        'material.ed25519Yao',
      );
      const binding = parseOptionalWorkerEcdsaSessionBootstrapHandleBinding(
        ecdsa.sessionHandleBinding,
      );
      if (!binding) {
        throw new Error('Email OTP capability unlock requires its ECDSA session binding');
      }
      if (binding.operation !== 'wallet_unlock') {
        throw new Error('Email OTP capability unlock requires wallet-unlock ECDSA binding');
      }
      return {
        kind: 'wallet_unlock_capabilities',
        ecdsa: {
          sessionHandleBinding: { ...binding, operation: 'wallet_unlock' },
          runtimePolicyScope: parseWorkerRuntimePolicyScope(
            ecdsa.runtimePolicyScope,
            'Email OTP capability wallet unlock',
          ),
          sessionPolicy: parseRouterAbEcdsaPostRegistrationSessionActivationPolicyV1(
            ecdsa.sessionPolicy,
          ),
        },
        ed25519Yao: {
          recovery: parseEmailOtpEd25519YaoRecoveryAugmentation(ed25519Yao.recovery),
          ...parseEmailOtpEd25519RecoveryLane(ed25519Yao, 'material.ed25519Yao'),
        },
      };
    }
    default:
      throw new Error(`Unsupported Email OTP wallet unlock material request: ${kind}`);
  }
}

function parseEmailOtpEd25519YaoJsonBytes32(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 32) {
    throw new Error(`${label} must contain exactly 32 bytes`);
  }
  const output: number[] = [];
  for (const byte of value) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} must contain exactly 32 bytes`);
    }
    output.push(byte);
  }
  return output;
}

function parseEmailOtpEd25519YaoMaterialActivation(value: unknown): MpcMaterialActivationRef {
  const wire = parseRouterAbMpcMaterialActivationRef(value);
  const parsed = parseMpcMaterialActivationRef({
    kind: wire.kind,
    activationId: wire.activation_id,
    capability: wire.capability,
    materialOwner: wire.material_owner,
    keyBinding: wire.key_binding,
    lifecycleBinding: wire.lifecycle_binding,
    signingWorker: wire.signing_worker,
  });
  if (!parsed.ok) {
    throw new Error(
      `Email OTP Ed25519 Yao active capability material activation is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.value;
}

function parseEmailOtpEd25519YaoWorkerMaterialActivation(value: unknown): MpcMaterialActivationRef {
  const parsed = parseMpcMaterialActivationRef(value);
  if (!parsed.ok) {
    throw new Error(
      `Email OTP Ed25519 Yao worker active capability material activation is invalid: ${parsed.error.message}`,
    );
  }
  return parsed.value;
}

/** Validate the direct issuer response before reducing it to runtime facts. */
function parseEmailOtpEd25519YaoBootstrapSessionCredential(
  obj: Record<string, unknown>,
  source: EmailOtpEd25519YaoBootstrapSessionCredentialSource,
): void {
  const walletSessionId = parseWalletSessionId(obj.walletSessionId);
  if (!walletSessionId.ok) {
    throw new Error('Email OTP Ed25519 Yao recovery Wallet Session identity is invalid');
  }
  if (obj.sessionKind === 'issued_exact_wallet_session') {
    const issued = parseWalletSessionOperationCredentialV1(obj.operationCredential);
    if (issued.walletSessionId !== walletSessionId.value) {
      throw new Error('Email OTP Ed25519 credential does not identify its Wallet Session');
    }
    if (source.kind === 'wallet_unlock_response' && source.unlockCredential !== undefined) {
      const active = parseWalletSessionOperationCredentialV1(source.unlockCredential);
      if (active.walletSessionId !== walletSessionId.value || active.token !== issued.token) {
        throw new Error('Email OTP Ed25519 unlock credentials identify different Wallet Sessions');
      }
    }
    return;
  }
  if (obj.sessionKind !== 'already_committed_exact_wallet_session') {
    throw new Error('Email OTP Ed25519 Yao recovery session kind is invalid');
  }
  if (obj.operationCredential !== undefined) {
    throw new Error('Reused Ed25519 Wallet Session must not carry its own credential');
  }
  if (source.kind === 'wallet_unlock_response') {
    const reused = parseWalletSessionOperationCredentialV1(source.unlockCredential);
    if (reused.walletSessionId !== walletSessionId.value) {
      throw new Error('Email OTP Ed25519 session reuses another Wallet Session');
    }
  }
}

function assertCredentialFreeEmailOtpEd25519YaoBootstrapSession(
  obj: Record<string, unknown>,
): void {
  if (obj.sessionKind !== undefined || obj.operationCredential !== undefined) {
    throw new Error(
      'Email OTP Ed25519 Yao runtime bootstrap must not carry a Wallet Session credential',
    );
  }
}

type EmailOtpEd25519YaoBootstrapSessionCredentialSource =
  /** The unlock response, whose issued branch carries its own credential. */
  | { readonly kind: 'wallet_unlock_response'; readonly unlockCredential: unknown }
  /** A worker message, which carries only credential-free runtime facts. */
  | { readonly kind: 'resolved_worker_payload' }
  /** An operation-scoped grant may recover material from an exhausted exact session. */
  | { readonly kind: 'operation_step_up_payload' };

const EMAIL_OTP_ED25519_YAO_BOOTSTRAP_SESSION_FIELDS = [
  'walletId',
  'nearAccountId',
  'nearEd25519SigningKeyId',
  'authorityScope',
  'thresholdSessionId',
  'authorizationId',
  'walletSessionId',
  'quotaId',
  'expiresAtMs',
  'participantIds',
  'remainingUses',
  'signingRootId',
  'signingRootVersion',
  'runtimePolicyScope',
  'routerAbNormalSigning',
] as const;

export function parseEmailOtpEd25519YaoBootstrapSession(
  value: unknown,
  source: EmailOtpEd25519YaoBootstrapSessionCredentialSource,
): WalletRegistrationEd25519YaoSignerRuntimeBootstrap {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao recovery session is required');
  rejectUnknownEmailOtpYaoFields(
    obj,
    source.kind === 'wallet_unlock_response'
      ? ['sessionKind', 'operationCredential', ...EMAIL_OTP_ED25519_YAO_BOOTSTRAP_SESSION_FIELDS]
      : EMAIL_OTP_ED25519_YAO_BOOTSTRAP_SESSION_FIELDS,
    'ed25519YaoRecovery.session',
  );
  if (source.kind === 'wallet_unlock_response') {
    parseEmailOtpEd25519YaoBootstrapSessionCredential(obj, source);
  } else {
    assertCredentialFreeEmailOtpEd25519YaoBootstrapSession(obj);
  }
  const authorityScope = asRecord(obj.authorityScope);
  if (!authorityScope) {
    throw new Error('Email OTP Ed25519 Yao recovery authority scope is required');
  }
  rejectUnknownEmailOtpYaoFields(
    authorityScope,
    ['kind', 'provider', 'providerUserId'],
    'ed25519YaoRecovery.session.authorityScope',
  );
  if (
    authorityScope.kind !== 'email_otp' ||
    (authorityScope.provider !== 'google' && authorityScope.provider !== 'email')
  ) {
    throw new Error('Email OTP Ed25519 Yao recovery authority scope is invalid');
  }
  const expiresAtMs = normalizePositiveInteger(obj.expiresAtMs);
  const remainingUses =
    source.kind === 'operation_step_up_payload'
      ? normalizeNonNegativeInteger(obj.remainingUses)
      : normalizePositiveInteger(obj.remainingUses);
  if (!expiresAtMs || remainingUses == null) {
    throw new Error('Email OTP Ed25519 Yao recovery session budget is invalid');
  }
  const routerAbNormalSigning = parseRouterAbEd25519NormalSigningState(obj.routerAbNormalSigning);
  if (!routerAbNormalSigning) {
    throw new Error('Email OTP Ed25519 Yao recovery session signing state is invalid');
  }
  const walletSessionId = parseWalletSessionId(obj.walletSessionId);
  const authorizationId = parseWalletSessionAuthorizationId(obj.authorizationId);
  const quotaId = parseMpcWalletSigningQuotaId(obj.quotaId);
  if (!walletSessionId.ok || !authorizationId.ok || !quotaId.ok) {
    throw new Error('Email OTP Ed25519 Yao recovery Wallet Session identity is invalid');
  }
  const base: WalletRegistrationEd25519YaoSignerRuntimeBootstrap = {
    walletId: toWalletId(readString(obj.walletId, 'session.walletId')),
    nearAccountId: readString(obj.nearAccountId, 'session.nearAccountId'),
    nearEd25519SigningKeyId: readString(
      obj.nearEd25519SigningKeyId,
      'session.nearEd25519SigningKeyId',
    ),
    authorityScope: {
      kind: 'email_otp',
      provider: authorityScope.provider,
      providerUserId: readString(
        authorityScope.providerUserId,
        'session.authorityScope.providerUserId',
      ),
    },
    thresholdSessionId: readString(obj.thresholdSessionId, 'session.thresholdSessionId'),
    authorizationId: authorizationId.value,
    walletSessionId: walletSessionId.value,
    quotaId: quotaId.value,
    expiresAtMs,
    participantIds: parseEmailOtpEd25519YaoParticipantIds(
      obj.participantIds,
      'Email OTP Ed25519 Yao recovery session',
    ),
    remainingUses,
    signingRootId: readString(obj.signingRootId, 'session.signingRootId'),
    signingRootVersion: readString(obj.signingRootVersion, 'session.signingRootVersion'),
    runtimePolicyScope: parseWorkerRuntimePolicyScope(
      obj.runtimePolicyScope,
      'Email OTP Ed25519 Yao recovery session',
    ),
    routerAbNormalSigning,
  };
  return base;
}

type EmailOtpEd25519YaoMaterialActivationParser = (value: unknown) => MpcMaterialActivationRef;

function parseEmailOtpEd25519YaoActiveCapability(
  value: unknown,
): EmailOtpEd25519YaoActiveCapabilityDescriptorV1 {
  return parseEmailOtpEd25519YaoActiveCapabilityWithMaterialParser(
    value,
    parseEmailOtpEd25519YaoMaterialActivation,
    'ed25519YaoRecovery.capability',
  );
}

function parseEmailOtpEd25519YaoWorkerActiveCapability(
  value: unknown,
): EmailOtpEd25519YaoActiveCapabilityDescriptorV1 {
  return parseEmailOtpEd25519YaoActiveCapabilityWithMaterialParser(
    value,
    parseEmailOtpEd25519YaoWorkerMaterialActivation,
    'exportEmailOtpEd25519YaoSeed.material.capability',
  );
}

/** Whether cached custody material belongs to the exact Ed25519 lane of `capability`. */
export function emailOtpCustodyMaterialMatchesLane(
  binding: WalletCustodyEd25519MaterialBindingV1,
  capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1,
): boolean {
  return (
    binding.walletId === capability.applicationBinding.wallet_id &&
    binding.nearAccountId === capability.nearAccountId &&
    binding.nearEd25519SigningKeyId === capability.applicationBinding.near_ed25519_signing_key_id &&
    binding.signerSlot === capability.applicationBinding.key_creation_signer_slot &&
    binding.signingWorkerId === capability.lifecycle.signingWorkerId &&
    binding.registeredPublicKeyB64u ===
      base64UrlEncode(Uint8Array.from(capability.registeredPublicKey))
  );
}

export function parseEmailOtpEd25519YaoExportMaterial(
  value: unknown,
): EmailOtpEd25519YaoExportMaterialV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao export material is required');
  const kind = readString(obj.kind, 'material.kind');
  const materialActivation = parseMpcMaterialActivationRef(obj.materialActivation);
  if (!materialActivation.ok) {
    throw new Error(
      `Email OTP export material activation is invalid: ${materialActivation.error.message}`,
    );
  }
  switch (kind) {
    case 'active_capability': {
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'materialActivation', 'capability'],
        'export material',
      );
      const capability = parseEmailOtpEd25519YaoWorkerActiveCapability(obj.capability);
      if (
        !mpcMaterialActivationRefsEqual(capability.materialActivation, materialActivation.value)
      ) {
        throw new Error('Email OTP export capability activation does not match its material');
      }
      return {
        kind,
        materialActivation: materialActivation.value,
        capability,
      };
    }
    case 'sealed_custody': {
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'materialActivation', 'walletCustodyEd25519Material', 'bootstrap'],
        'export material',
      );
      const custody = parseWalletCustodyEd25519MaterialRequest({
        kind: 'found',
        material: obj.walletCustodyEd25519Material,
      });
      if (custody.kind !== 'found') {
        throw new Error('Sealed Email OTP export material requires cached custody material');
      }
      const bootstrap = parseEmailOtpEd25519YaoRecoveryBootstrap(obj.bootstrap, {
        kind: 'operation_step_up_payload',
      });
      if (
        !mpcMaterialActivationRefsEqual(
          bootstrap.capability.materialActivation,
          materialActivation.value,
        )
      ) {
        throw new Error('Email OTP export bootstrap activation does not match its material');
      }
      if (!emailOtpCustodyMaterialMatchesLane(custody.material.binding, bootstrap.capability)) {
        throw new Error('Email OTP export custody material changed the exact lane');
      }
      return {
        kind,
        materialActivation: materialActivation.value,
        walletCustodyEd25519Material: custody.material,
        bootstrap,
      };
    }
    case 'sealed_export_root': {
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'materialActivation', 'capability', 'exportRootEnvelope'],
        'export material',
      );
      const capability = parseEmailOtpEd25519YaoWorkerActiveCapability(obj.capability);
      if (
        !mpcMaterialActivationRefsEqual(capability.materialActivation, materialActivation.value)
      ) {
        throw new Error('Email OTP export root capability activation does not match its material');
      }
      const exportRootEnvelope = parsePasskeyCustodyEnvelopeRecord(obj.exportRootEnvelope);
      if (
        exportRootEnvelope.lifecycle.state !== 'active' ||
        exportRootEnvelope.binding.kind !== 'ed25519_yao_client_root_v1' ||
        exportRootEnvelope.binding.targetFactor.kind !== 'email_otp' ||
        exportRootEnvelope.factor.kind !== 'email_otp' ||
        exportRootEnvelope.binding.registeredPublicKeyB64u !==
          base64UrlEncode(Uint8Array.from(capability.registeredPublicKey)) ||
        exportRootEnvelope.walletId !== capability.applicationBinding.wallet_id
      ) {
        throw new Error('Email OTP export root envelope changed the exact lane');
      }
      return {
        kind,
        materialActivation: materialActivation.value,
        capability,
        exportRootEnvelope,
      };
    }
    default:
      throw new Error(`Unsupported Email OTP Ed25519 Yao export material kind: ${kind}`);
  }
}

function parseEmailOtpEd25519YaoActiveCapabilityWithMaterialParser(
  value: unknown,
  parseMaterialActivation: EmailOtpEd25519YaoMaterialActivationParser,
  capabilityLabel: string,
): EmailOtpEd25519YaoActiveCapabilityDescriptorV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao active capability is required');
  rejectUnknownEmailOtpYaoFields(
    obj,
    [
      'kind',
      'activeCapabilityBinding',
      'materialActivation',
      'registeredPublicKey',
      'nearAccountId',
      'applicationBinding',
      'runtimePolicyScope',
      'participantIds',
      'lifecycle',
      'stateEpoch',
      'registrationContinuity',
    ],
    capabilityLabel,
  );
  if (obj.kind !== 'router_ab_ed25519_yao_active_capability_v1') {
    throw new Error('Email OTP Ed25519 Yao active capability kind is invalid');
  }
  const application = asRecord(obj.applicationBinding);
  const lifecycle = asRecord(obj.lifecycle);
  if (!application || !lifecycle) {
    throw new Error('Email OTP Ed25519 Yao active capability identity is invalid');
  }
  rejectUnknownEmailOtpYaoFields(
    application,
    ['wallet_id', 'near_ed25519_signing_key_id', 'signing_root_id', 'key_creation_signer_slot'],
    'ed25519YaoRecovery.capability.applicationBinding',
  );
  rejectUnknownEmailOtpYaoFields(
    lifecycle,
    [
      'lifecycleId',
      'rootShareEpoch',
      'accountId',
      'thresholdSessionId',
      'signerSetId',
      'signingWorkerId',
    ],
    'ed25519YaoRecovery.capability.lifecycle',
  );
  const signerSlot = normalizePositiveInteger(application.key_creation_signer_slot);
  const stateEpoch = normalizePositiveInteger(obj.stateEpoch);
  const materialActivation = parseMaterialActivation(obj.materialActivation);
  if (!signerSlot || !stateEpoch) {
    throw new Error('Email OTP Ed25519 Yao active capability epoch or signer slot is invalid');
  }
  const registrationContinuity = asRecord(obj.registrationContinuity);
  if (!registrationContinuity) {
    throw new Error('Email OTP Ed25519 Yao active capability continuity is required');
  }
  const continuityKind = readString(
    registrationContinuity.kind,
    'capability.registrationContinuity.kind',
  );
  let parsedRegistrationContinuity: EmailOtpEd25519YaoActiveCapabilityDescriptorV1['registrationContinuity'];
  if (continuityKind === 'recovery') {
    rejectUnknownEmailOtpYaoFields(
      registrationContinuity,
      ['kind', 'activationTranscript'],
      'capability.registrationContinuity',
    );
    const activationTranscript = parseEmailOtpEd25519YaoJsonBytes32(
      registrationContinuity.activationTranscript,
      'capability.registrationContinuity.activationTranscript',
    );
    parsedRegistrationContinuity = { kind: 'recovery', activationTranscript };
  } else if (continuityKind === 'registration') {
    rejectUnknownEmailOtpYaoFields(
      registrationContinuity,
      ['kind', 'admissionRequest', 'admissionReceipt', 'activationTranscript'],
      'capability.registrationContinuity',
    );
    if (!Array.isArray(registrationContinuity.activationTranscript)) {
      throw new Error('Email OTP registration continuity transcript is required');
    }
    const activationTranscript = registrationContinuity.activationTranscript.map((byte, index) => {
      const parsed = Number(byte);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
        throw new Error(
          `capability.registrationContinuity.activationTranscript[${index}] is invalid`,
        );
      }
      return parsed;
    });
    if (activationTranscript.length === 0) {
      throw new Error('Email OTP registration continuity transcript is empty');
    }
    const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
      registrationContinuity.admissionRequest,
    );
    if (!admissionRequest.ok) throw new Error(admissionRequest.message);
    const admissionReceipt = parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1(
      registrationContinuity.admissionReceipt,
    );
    if (!admissionReceipt.ok) throw new Error(admissionReceipt.message);
    parsedRegistrationContinuity = {
      kind: 'registration',
      admissionRequest: admissionRequest.value,
      admissionReceipt: admissionReceipt.value,
      activationTranscript,
    };
  } else {
    throw new Error(`Unsupported Email OTP registration continuity kind: ${continuityKind}`);
  }
  return {
    kind: 'router_ab_ed25519_yao_active_capability_v1',
    materialActivation,
    activeCapabilityBinding: parseEmailOtpEd25519YaoJsonBytes32(
      obj.activeCapabilityBinding,
      'capability.activeCapabilityBinding',
    ),
    registeredPublicKey: parseEmailOtpEd25519YaoJsonBytes32(
      obj.registeredPublicKey,
      'capability.registeredPublicKey',
    ),
    nearAccountId: readString(obj.nearAccountId, 'capability.nearAccountId'),
    applicationBinding: {
      wallet_id: readString(application.wallet_id, 'applicationBinding.wallet_id'),
      near_ed25519_signing_key_id: readString(
        application.near_ed25519_signing_key_id,
        'applicationBinding.near_ed25519_signing_key_id',
      ),
      signing_root_id: readString(
        application.signing_root_id,
        'applicationBinding.signing_root_id',
      ),
      key_creation_signer_slot: signerSlot,
    },
    runtimePolicyScope: parseWorkerRuntimePolicyScope(
      obj.runtimePolicyScope,
      'Email OTP Ed25519 Yao active capability',
    ),
    participantIds: parseEmailOtpEd25519YaoParticipantIds(
      obj.participantIds,
      'Email OTP Ed25519 Yao active capability',
    ),
    lifecycle: {
      lifecycleId: readString(lifecycle.lifecycleId, 'lifecycle.lifecycleId'),
      rootShareEpoch: readString(lifecycle.rootShareEpoch, 'lifecycle.rootShareEpoch'),
      accountId: readString(lifecycle.accountId, 'lifecycle.accountId'),
      thresholdSessionId: readThresholdEd25519SessionId(
        readString(lifecycle.thresholdSessionId, 'lifecycle.thresholdSessionId'),
        'lifecycle.thresholdSessionId',
      ),
      signerSetId: readString(lifecycle.signerSetId, 'lifecycle.signerSetId'),
      signingWorkerId: readString(lifecycle.signingWorkerId, 'lifecycle.signingWorkerId'),
    },
    stateEpoch,
    registrationContinuity: parsedRegistrationContinuity,
  };
}

export function readEmailOtpEd25519YaoRecoveryBootstrapRecord(
  value: unknown,
): Record<string, unknown> {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao recovery bootstrap is required');
  rejectUnknownEmailOtpYaoFields(obj, ['kind', 'session', 'capability'], 'ed25519YaoRecovery');
  if (obj.kind !== ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1) {
    throw new Error('Email OTP Ed25519 Yao recovery bootstrap kind is invalid');
  }
  return obj;
}

/**
 * The unlock response carries the capability's material activation in its wire form;
 * worker payloads carry the parsed reference.
 */
export function parseEmailOtpEd25519YaoRecoveryBootstrap(
  value: unknown,
  source: EmailOtpEd25519YaoBootstrapSessionCredentialSource,
): EmailOtpEd25519YaoRecoveryBootstrapV1 {
  const obj = readEmailOtpEd25519YaoRecoveryBootstrapRecord(value);
  return {
    kind: ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
    session: parseEmailOtpEd25519YaoBootstrapSession(obj.session, source),
    capability:
      source.kind === 'wallet_unlock_response'
        ? parseEmailOtpEd25519YaoActiveCapability(obj.capability)
        : parseEmailOtpEd25519YaoWorkerActiveCapability(obj.capability),
  };
}

function parseEmailOtpEd25519YaoBytes32(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${label} must contain 32 bytes`);
  }
  return value.slice();
}

export function parseEmailOtpEd25519YaoSigningInput(
  value: unknown,
): RouterAbEd25519YaoClientSigningInputV1 {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP Ed25519 Yao signing input is required');
  rejectUnknownEmailOtpYaoFields(
    obj,
    ['admittedDigest', 'signingWorkerCommitments', 'signingWorkerVerifyingShare'],
    'signing input',
  );
  const commitments = asRecord(obj.signingWorkerCommitments);
  if (!commitments) {
    throw new Error('Email OTP Ed25519 Yao signing input requires worker commitments');
  }
  rejectUnknownEmailOtpYaoFields(commitments, ['hiding', 'binding'], 'signingWorkerCommitments');
  return {
    admittedDigest: parseEmailOtpEd25519YaoBytes32(
      obj.admittedDigest,
      'signing input admittedDigest',
    ),
    signingWorkerCommitments: {
      hiding: readString(commitments.hiding, 'signingWorkerCommitments.hiding'),
      binding: readString(commitments.binding, 'signingWorkerCommitments.binding'),
    },
    signingWorkerVerifyingShare: parseEmailOtpEd25519YaoBytes32(
      obj.signingWorkerVerifyingShare,
      'signing input worker verifying share',
    ),
  };
}
