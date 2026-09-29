// The ECDSA capability store's records: their stored rows and parsers, exact-equality checks,
// and the AES-GCM sealing of the state blobs they carry.
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  parseCorrelationId,
  parseDigestB64u,
  parseIsoTimestamp,
  type IsoTimestamp,
} from '@shared/utils/canonicalPrimitives';
import {
  mpcMaterialActivationRefsEqual,
  parseCapabilityInstanceRef,
  parseMpcMaterialOwnerRef,
  type CapabilityInstanceRef,
  type DomainIdParseResult,
} from '@shared/utils/domainIds';
import {
  parseCanonicalEcdsaServerActivationRequest,
  parseEcdsaCapabilityManifestId,
  parseEcdsaCapabilityManifestRevision,
  parseEcdsaCiphertextB64u,
  parseEcdsaCiphertextDigest,
  parseEcdsaIv12B64u,
  parseEcdsaMaterialSealingKeyId,
  parseEcdsaPendingCiphertextDigest,
  parseEcdsaServerGeneration,
  parseEvmFamilyEcdsaSignerId,
  type EcdsaCapabilityManifestId,
  type EcdsaCapabilityManifestRevision,
  type EcdsaMaterialSealingKeyId,
} from '@shared/utils/ecdsaCapabilityActivation';
import { alphabetizeStringify, sha256Bytes } from '@shared/utils/digests';
import {
  normalizeRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import {
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  requireRouterAbEcdsaDerivationNormalSigningStateV1,
  sameRouterAbEcdsaDerivationNormalSigningStateV1,
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  sameRouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseSdkEcdsaDerivationSigningRootId,
  parseSdkEcdsaDerivationSigningRootVersion,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import {
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { thresholdEcdsaChainTargetFromRequest } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { buildEcdsaRoleLocalPublicFacts, type EcdsaRoleLocalPublicFacts } from '@/core/platform';
import {
  buildVerifiedEcdsaPublicFacts,
  toEvmFamilyEcdsaKeyHandle,
  toParticipantId,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import {
  parseEcdsaClientVerifyingPublicKey33B64u,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseEcdsaRoleLocalBindingDigest,
  parseEcdsaRoleLocalDurableMaterialRef,
  parseEcdsaThresholdKeyId,
} from '@/core/signingEngine/session/keyMaterialBrands';
import {
  buildActiveEcdsaCapabilityManifest,
  buildDurableEcdsaMaterialBinding,
  buildEcdsaActivationBinding,
  buildEcdsaCapabilityScope,
  buildEcdsaManifestIdentity,
  buildEcdsaRoleLocalMaterialBinding,
  buildEcdsaServerActivationCommit,
  buildEncryptedEcdsaPendingCandidate,
  buildExactEcdsaManifestExpectation,
  buildExactEcdsaServerGenerationExpectation,
  buildNoCurrentEcdsaManifestExpectation,
  buildNoCurrentEcdsaServerGenerationExpectation,
  buildPreparedEcdsaActivationCandidate,
  buildPreparedEcdsaActivationJournal,
  buildPreparedEvmFamilySigner,
  buildReplacedEcdsaCapabilityManifest,
  buildServerCommittedEcdsaActivationJournal,
  buildValidatedEncryptedEcdsaReadyMaterial,
  type ActiveEcdsaCapabilityManifest,
  type ActiveEcdsaMaterialActivation,
  type BuildPreparedEcdsaActivationJournalInput,
  type DurableEcdsaMaterialBinding,
  type EcdsaActivationBinding,
  type EcdsaCapabilityActivationCommitJournal,
  type EcdsaCapabilityScope,
  type EcdsaManifestIdentity,
  type EcdsaManifestRevisionExpectation,
  type EcdsaRoleLocalMaterialBinding,
  type EcdsaServerActivationCommand,
  type EcdsaServerActivationReceipt,
  type EcdsaServerGenerationExpectation,
  type EncryptedEcdsaPendingCandidate,
  type PreparedEcdsaActivationCandidate,
  type PreparedEvmFamilySigner,
  type RegisteredEvmFamilySigner,
  type ServerReturnedEcdsaActivationCommit,
  type EcdsaServerActivationCommit,
  type PreparedEcdsaActivationJournal,
  type ReplacedEcdsaCapabilityManifest,
  type ServerCommittedEcdsaActivationJournal,
  type ValidatedEncryptedEcdsaReadyMaterial,
} from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import type { VerifiedEcdsaPublicFacts } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import type { ThresholdEcdsaChainTarget } from '@/core/platform/types';
import { requireArray, requireRecord } from '@shared/utils/validation';
import { SEAMS_WALLET_STORES } from '../schemaNames';

// Bumped with the authority ref: these rows now record which wallet auth
// method issued the authority, so a row written before that is read as the
// wrong version and re-derived rather than failing an exact-key check.
export const MANIFEST_RECORD_VERSION = 'ecdsa_capability_manifest_v3' as const;
const POINTER_RECORD_VERSION = 'ecdsa_current_capability_manifest_v2' as const;
const MATERIAL_RECORD_VERSION = 'ecdsa_role_local_material_v2' as const;
const JOURNAL_RECORD_VERSION = 'ecdsa_activation_commit_journal_v1' as const;
const SEALING_KEY_RECORD_VERSION = 'ecdsa_material_sealing_key_v1' as const;

export const MANIFEST_STORE = SEAMS_WALLET_STORES.ecdsaCapabilityManifests;
export const POINTER_STORE = SEAMS_WALLET_STORES.ecdsaCurrentCapabilityManifests;
export const MATERIAL_STORE = SEAMS_WALLET_STORES.ecdsaRoleLocalMaterial;
export const JOURNAL_STORE = SEAMS_WALLET_STORES.ecdsaActivationCommitJournals;
export const SEALING_KEY_STORE = SEAMS_WALLET_STORES.ecdsaMaterialSealingKeys;
export const PRESIGNATURE_STORE = SEAMS_WALLET_STORES.ecdsaClientPresignatures;
export const AES_GCM_IV_BYTES = 12;

export type EcdsaCapabilitySelector = {
  readonly capability: CapabilityInstanceRef;
  readonly authority: WalletAuthAuthorityRef;
};

type PreparedJournalInputWithoutCandidate<T> = T extends unknown ? Omit<T, 'candidate'> : never;

export type PrepareEcdsaCapabilityActivationInput =
  PreparedJournalInputWithoutCandidate<BuildPreparedEcdsaActivationJournalInput> & {
    readonly activationBinding: EcdsaActivationBinding;
    readonly pendingPayloadB64u: string;
  };

export type ParsedActiveManifestProof = {
  readonly activationBinding: EcdsaActivationBinding;
  readonly serverActivation: EcdsaServerActivationCommit;
  readonly durableMaterial: DurableEcdsaMaterialBinding;
  readonly activeManifest: ActiveEcdsaCapabilityManifest;
  readonly committedAt: IsoTimestamp;
};

export type ParsedManifestRow =
  | {
      readonly state: 'active';
      readonly selector: EcdsaCapabilitySelector;
      readonly manifest: ActiveEcdsaCapabilityManifest;
      readonly activeProof: ParsedActiveManifestProof;
    }
  | {
      readonly state: 'replaced';
      readonly selector: EcdsaCapabilitySelector;
      readonly manifest: ReplacedEcdsaCapabilityManifest;
      readonly activeProof: ParsedActiveManifestProof;
      readonly replacementProof: ParsedActiveManifestProof;
    };

export type ParsedPointerRow = {
  readonly selector: EcdsaCapabilitySelector;
  readonly manifestId: EcdsaCapabilityManifestId;
  readonly manifestRevision: EcdsaCapabilityManifestRevision;
};

type ParsedSealingKeyRow = {
  readonly keyId: EcdsaMaterialSealingKeyId;
  readonly key: CryptoKey;
};

export function requireExactKeys(
  record: Record<string, unknown>,
  label: string,
  expectedKeys: readonly string[],
): void {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function unwrapDomainId<T>(result: DomainIdParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function normalizeSelector(selector: EcdsaCapabilitySelector): EcdsaCapabilitySelector {
  const authority = parseWalletAuthAuthorityRef(selector.authority);
  if (!authority) throw new Error('ECDSA capability selector authority is invalid');
  return {
    capability: unwrapDomainId(parseCapabilityInstanceRef(selector.capability)),
    authority,
  };
}

// Copies only the selector fields, so a signer's other fields never reach a result or a digest.
export function selectorFromSigner(signer: EcdsaCapabilitySelector): EcdsaCapabilitySelector {
  return { capability: signer.capability, authority: signer.authority };
}

export function selectorFromJournal(
  journal: EcdsaCapabilityActivationCommitJournal,
): EcdsaCapabilitySelector {
  return selectorFromSigner(journal.candidate.activationBinding.signer);
}

export function selectorFromManifest(
  manifest: ActiveEcdsaCapabilityManifest,
): EcdsaCapabilitySelector {
  return selectorFromSigner(manifest.signer);
}

export function selectorKey(selector: EcdsaCapabilitySelector): readonly [string, string, string] {
  return [
    String(selector.capability),
    String(selector.authority.walletId),
    String(selector.authority.authorityDigest),
  ];
}

// The manifest, pointer, material and journal rows store their selector as these columns.
export function selectorColumns(selector: EcdsaCapabilitySelector) {
  return {
    capability_ref: selector.capability,
    wallet_id: selector.authority.walletId,
    authority_digest: selector.authority.authorityDigest,
    wallet_auth_method_id: selector.authority.walletAuthMethodId,
  };
}

function authorityFromColumns(record: Record<string, unknown>): WalletAuthAuthorityRef | null {
  return parseWalletAuthAuthorityRef({
    kind: 'wallet_auth_authority_ref',
    walletId: record.wallet_id,
    authorityDigest: record.authority_digest,
    walletAuthMethodId: record.wallet_auth_method_id,
  });
}

export function walletAuthAuthorityRefsMatch(
  left: WalletAuthAuthorityRef,
  right: WalletAuthAuthorityRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.walletId === right.walletId &&
    left.authorityDigest === right.authorityDigest &&
    left.walletAuthMethodId === right.walletAuthMethodId
  );
}

export function selectorsMatch(
  left: EcdsaCapabilitySelector,
  right: EcdsaCapabilitySelector,
): boolean {
  const leftKey = selectorKey(left);
  const rightKey = selectorKey(right);
  return leftKey[0] === rightKey[0] && leftKey[1] === rightKey[1] && leftKey[2] === rightKey[2];
}

function orderedNumberValuesMatch(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function runtimePolicyScopesMatch(
  left: RuntimePolicyScope,
  right: RuntimePolicyScope,
): boolean {
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function ecdsaChainTargetsMatch(
  left: ThresholdEcdsaChainTarget,
  right: ThresholdEcdsaChainTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'evm':
      return (
        right.kind === 'evm' &&
        left.namespace === right.namespace &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    case 'tempo':
      return (
        right.kind === 'tempo' &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    default:
      return assertNever(left);
  }
}

export function ecdsaCapabilityScopesMatch(
  left: EcdsaCapabilityScope,
  right: EcdsaCapabilityScope,
): boolean {
  return (
    left.kind === right.kind &&
    left.targetMemberships.length === right.targetMemberships.length &&
    left.targetMemberships.every((target, index) =>
      ecdsaChainTargetsMatch(target, right.targetMemberships[index]),
    )
  );
}

export function ecdsaRoleLocalMaterialBindingsMatch(
  left: EcdsaRoleLocalMaterialBinding,
  right: EcdsaRoleLocalMaterialBinding,
): boolean {
  return (
    left.kind === right.kind &&
    left.keyHandle === right.keyHandle &&
    left.ecdsaThresholdKeyId === right.ecdsaThresholdKeyId &&
    left.clientVerifyingPublicKey33B64u === right.clientVerifyingPublicKey33B64u &&
    orderedNumberValuesMatch(left.participantIds, right.participantIds) &&
    left.relayerKeyId === right.relayerKeyId
  );
}

export function ecdsaRoleLocalPublicFactsMatch(
  left: EcdsaRoleLocalPublicFacts,
  right: EcdsaRoleLocalPublicFacts,
): boolean {
  return (
    left.walletId === right.walletId &&
    ecdsaChainTargetsMatch(left.chainTarget, right.chainTarget) &&
    left.keyHandle === right.keyHandle &&
    left.ecdsaThresholdKeyId === right.ecdsaThresholdKeyId &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion &&
    left.applicationBindingDigestB64u === right.applicationBindingDigestB64u &&
    left.clientParticipantId === right.clientParticipantId &&
    left.relayerParticipantId === right.relayerParticipantId &&
    orderedNumberValuesMatch(left.participantIds, right.participantIds) &&
    left.contextBinding32B64u === right.contextBinding32B64u &&
    left.derivationClientSharePublicKey33B64u === right.derivationClientSharePublicKey33B64u &&
    left.relayerPublicKey33B64u === right.relayerPublicKey33B64u &&
    left.groupPublicKey33B64u === right.groupPublicKey33B64u &&
    left.ethereumAddress === right.ethereumAddress &&
    sameRouterAbEcdsaDerivationPublicCapabilityV1(left.publicCapability, right.publicCapability)
  );
}

export function ecdsaRegisteredPublicFactsMatch(
  left: VerifiedEcdsaPublicFacts,
  right: VerifiedEcdsaPublicFacts,
): boolean {
  return (
    left.kind === right.kind &&
    left.keyHandle === right.keyHandle &&
    left.publicKeyB64u === right.publicKeyB64u &&
    orderedNumberValuesMatch(left.participantIds, right.participantIds) &&
    left.thresholdOwnerAddress === right.thresholdOwnerAddress
  );
}

function ecdsaManifestIdentitiesMatch(
  left: EcdsaManifestIdentity,
  right: EcdsaManifestIdentity,
): boolean {
  return left.manifestId === right.manifestId && left.manifestRevision === right.manifestRevision;
}

function ecdsaManifestRevisionExpectationsMatch(
  left: EcdsaManifestRevisionExpectation,
  right: EcdsaManifestRevisionExpectation,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'no_current_manifest':
      return true;
    case 'exact_manifest':
      return (
        right.kind === 'exact_manifest' &&
        left.manifestId === right.manifestId &&
        left.manifestRevision === right.manifestRevision
      );
    default:
      return assertNever(left);
  }
}

function ecdsaServerGenerationExpectationsMatch(
  left: EcdsaServerGenerationExpectation,
  right: EcdsaServerGenerationExpectation,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'no_current_generation':
      return true;
    case 'exact_generation':
      return right.kind === 'exact_generation' && left.serverGeneration === right.serverGeneration;
    default:
      return assertNever(left);
  }
}

function ecdsaEvmFamilySignersMatch(
  left: PreparedEvmFamilySigner | RegisteredEvmFamilySigner,
  right: PreparedEvmFamilySigner | RegisteredEvmFamilySigner,
): boolean {
  return (
    left.kind === right.kind &&
    left.capability === right.capability &&
    left.signerId === right.signerId &&
    left.walletId === right.walletId &&
    walletAuthAuthorityRefsMatch(left.authority, right.authority) &&
    ecdsaCapabilityScopesMatch(left.scope, right.scope) &&
    left.materialOwner === right.materialOwner &&
    left.signingRootId === right.signingRootId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function ecdsaRegisteredEvmFamilySignersMatch(
  left: RegisteredEvmFamilySigner,
  right: RegisteredEvmFamilySigner,
): boolean {
  return (
    ecdsaEvmFamilySignersMatch(left, right) &&
    ecdsaRegisteredPublicFactsMatch(left.registeredPublicFacts, right.registeredPublicFacts)
  );
}

function ecdsaEncryptedPendingCandidatesMatch(
  left: EncryptedEcdsaPendingCandidate,
  right: EncryptedEcdsaPendingCandidate,
): boolean {
  return (
    left.kind === right.kind &&
    left.sealingKeyId === right.sealingKeyId &&
    left.iv12B64u === right.iv12B64u &&
    left.ciphertextB64u === right.ciphertextB64u &&
    left.ciphertextDigest === right.ciphertextDigest
  );
}

function ecdsaActivationBindingsMatch(
  left: EcdsaActivationBinding,
  right: EcdsaActivationBinding,
): boolean {
  return (
    left.kind === right.kind &&
    ecdsaManifestIdentitiesMatch(left.targetManifest, right.targetManifest) &&
    ecdsaEvmFamilySignersMatch(left.signer, right.signer) &&
    ecdsaRoleLocalMaterialBindingsMatch(left.roleLocalBinding, right.roleLocalBinding) &&
    left.bindingDigest === right.bindingDigest &&
    left.durableMaterialRef === right.durableMaterialRef
  );
}

export function ecdsaServerActivationCommitsMatch(
  left: EcdsaServerActivationCommit,
  right: EcdsaServerActivationCommit,
): boolean {
  return (
    left.kind === right.kind &&
    left.correlationId === right.correlationId &&
    left.activationRequestDigest === right.activationRequestDigest &&
    left.serverGeneration === right.serverGeneration &&
    ecdsaServerActivationReceiptsMatch(left.serverActivationReceipt, right.serverActivationReceipt)
  );
}

function ecdsaServerActivationReceiptsMatch(
  left: EcdsaServerActivationReceipt,
  right: EcdsaServerActivationReceipt,
): boolean {
  return (
    left.kind === right.kind &&
    left.lifecycleId === right.lifecycleId &&
    left.activationDigest === right.activationDigest &&
    left.activatedAt === right.activatedAt &&
    sameRouterAbEcdsaRegistrationActivationReceiptV1(left.protocolReceipt, right.protocolReceipt)
  );
}

function ecdsaActivationCommandsMatch(
  left: EcdsaServerActivationCommand,
  right: EcdsaServerActivationCommand,
): boolean {
  return (
    left.kind === right.kind &&
    left.correlationId === right.correlationId &&
    ecdsaServerGenerationExpectationsMatch(left.expectedGeneration, right.expectedGeneration) &&
    left.requestDigest === right.requestDigest &&
    left.canonicalRequest === right.canonicalRequest
  );
}

function ecdsaPreparedActivationCandidatesMatch(
  left: PreparedEcdsaActivationCandidate,
  right: PreparedEcdsaActivationCandidate,
): boolean {
  return (
    left.kind === right.kind &&
    ecdsaActivationBindingsMatch(left.activationBinding, right.activationBinding) &&
    ecdsaEncryptedPendingCandidatesMatch(left.encryptedPending, right.encryptedPending)
  );
}

export function ecdsaActivationCommitJournalsMatch(
  left: EcdsaCapabilityActivationCommitJournal,
  right: EcdsaCapabilityActivationCommitJournal,
): boolean {
  if (left.kind !== right.kind) return false;
  const commonEqual =
    left.journalId === right.journalId &&
    ecdsaManifestRevisionExpectationsMatch(left.expectedManifest, right.expectedManifest) &&
    ecdsaActivationCommandsMatch(left.activationCommand, right.activationCommand) &&
    ecdsaPreparedActivationCandidatesMatch(left.candidate, right.candidate) &&
    left.createdAt === right.createdAt;
  if (!commonEqual) return false;
  switch (left.kind) {
    case 'activation_prepared':
      return true;
    case 'server_activation_committed':
      return (
        right.kind === 'server_activation_committed' &&
        ecdsaServerActivationCommitsMatch(left.serverActivation, right.serverActivation)
      );
    default:
      return assertNever(left);
  }
}

export function ecdsaDurableMaterialBindingsMatch(
  left: DurableEcdsaMaterialBinding,
  right: DurableEcdsaMaterialBinding,
): boolean {
  return (
    left.kind === right.kind &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation) &&
    sameRouterAbEcdsaDerivationNormalSigningStateV1(
      left.routerAbEcdsaDerivationNormalSigning,
      right.routerAbEcdsaDerivationNormalSigning,
    ) &&
    ecdsaRoleLocalPublicFactsMatch(left.roleLocalPublicFacts, right.roleLocalPublicFacts) &&
    ecdsaRoleLocalMaterialBindingsMatch(left.roleLocalBinding, right.roleLocalBinding) &&
    left.durableMaterialRef === right.durableMaterialRef &&
    left.bindingDigest === right.bindingDigest &&
    left.lifecycleId === right.lifecycleId &&
    left.ciphertextDigest === right.ciphertextDigest &&
    left.activationDigest === right.activationDigest &&
    left.activatedAt === right.activatedAt &&
    runtimePolicyScopesMatch(left.runtimePolicyScope, right.runtimePolicyScope)
  );
}

function ecdsaActiveMaterialActivationsMatch(
  left: ActiveEcdsaMaterialActivation,
  right: ActiveEcdsaMaterialActivation,
): boolean {
  return (
    left.kind === right.kind &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation) &&
    ecdsaServerActivationCommitsMatch(left.serverActivation, right.serverActivation) &&
    left.retention === right.retention
  );
}

export function ecdsaActiveCapabilityManifestsMatch(
  left: ActiveEcdsaCapabilityManifest,
  right: ActiveEcdsaCapabilityManifest,
): boolean {
  return (
    left.kind === right.kind &&
    ecdsaManifestIdentitiesMatch(left.identity, right.identity) &&
    ecdsaRegisteredEvmFamilySignersMatch(left.signer, right.signer) &&
    ecdsaActiveMaterialActivationsMatch(left.activation, right.activation) &&
    ecdsaDurableMaterialBindingsMatch(left.durableMaterial, right.durableMaterial) &&
    left.committedAt === right.committedAt
  );
}

function serverActivationRecordMatches(
  expected: EcdsaServerActivationCommit,
  record: Record<string, unknown>,
): boolean {
  try {
    const receipt = requireRecord(
      record.serverActivationReceipt,
      'ECDSA server activation receipt',
    );
    return (
      record.kind === expected.kind &&
      parseCorrelationId(record.correlationId) === expected.correlationId &&
      parseDigestB64u(record.activationRequestDigest) === expected.activationRequestDigest &&
      parseEcdsaServerGeneration(record.serverGeneration) === expected.serverGeneration &&
      receipt.kind === expected.serverActivationReceipt.kind &&
      receipt.lifecycleId === String(expected.serverActivationReceipt.lifecycleId) &&
      receipt.activationDigest === String(expected.serverActivationReceipt.activationDigest) &&
      parseIsoTimestamp(receipt.activatedAt) === expected.serverActivationReceipt.activatedAt &&
      sameRouterAbEcdsaRegistrationActivationReceiptV1(
        parseRouterAbEcdsaRegistrationActivationReceiptV1(receipt.protocolReceipt),
        expected.serverActivationReceipt.protocolReceipt,
      )
    );
  } catch {
    return false;
  }
}

export function buildPreparedJournalFromEncryptedCandidate(input: {
  readonly preparation: PrepareEcdsaCapabilityActivationInput;
  readonly encryptedPending: EncryptedEcdsaPendingCandidate;
}): PreparedEcdsaActivationJournal {
  const candidate = buildPreparedEcdsaActivationCandidate({
    activationBinding: input.preparation.activationBinding,
    encryptedPending: input.encryptedPending,
  });
  return buildPreparedJournalForExpectations({ ...input.preparation, candidate });
}

type PreparedJournalFields = Omit<
  BuildPreparedEcdsaActivationJournalInput,
  'expectedManifest' | 'expectedGeneration'
> & {
  readonly expectedManifest: EcdsaManifestRevisionExpectation;
  readonly expectedGeneration: EcdsaServerGenerationExpectation;
};

// Checks the manifest and generation expectations agree before building the journal.
function buildPreparedJournalForExpectations(
  input: PreparedJournalFields,
): PreparedEcdsaActivationJournal {
  const common = {
    journalId: input.journalId,
    candidate: input.candidate,
    requestDigest: input.requestDigest,
    canonicalRequest: input.canonicalRequest,
    createdAt: input.createdAt,
  };
  switch (input.expectedManifest.kind) {
    case 'no_current_manifest':
      if (input.expectedGeneration.kind !== 'no_current_generation') {
        throw new Error('Initial ECDSA activation cannot expect a server generation');
      }
      return buildPreparedEcdsaActivationJournal({
        ...common,
        expectedManifest: input.expectedManifest,
        expectedGeneration: input.expectedGeneration,
      });
    case 'exact_manifest':
      if (input.expectedGeneration.kind !== 'exact_generation') {
        throw new Error('Replacement ECDSA activation requires an exact server generation');
      }
      return buildPreparedEcdsaActivationJournal({
        ...common,
        expectedManifest: input.expectedManifest,
        expectedGeneration: input.expectedGeneration,
      });
    default:
      return assertNever(input.expectedManifest);
  }
}

function decodeCanonicalStateBlob(value: string, label: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be non-empty unpadded base64url`);
  }
  const bytes = base64UrlDecode(value);
  if (bytes.length === 0 || base64UrlEncode(bytes) !== value) {
    bytes.fill(0);
    throw new Error(`${label} must be canonical base64url`);
  }
  return bytes;
}

export function additionalData(projection: unknown): Uint8Array {
  return new TextEncoder().encode(alphabetizeStringify(projection));
}

export async function generateMaterialSealingKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptStateBlob(input: {
  readonly key: CryptoKey;
  readonly stateBlobB64u: string;
  readonly aadProjection: unknown;
}): Promise<{
  readonly iv12B64u: ReturnType<typeof parseEcdsaIv12B64u>;
  readonly ciphertextB64u: ReturnType<typeof parseEcdsaCiphertextB64u>;
  readonly digestB64u: string;
}> {
  const plaintext = decodeCanonicalStateBlob(input.stateBlobB64u, 'ECDSA state blob');
  const iv12 = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const aad = additionalData(input.aadProjection);
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv12, additionalData: aad },
        input.key,
        plaintext,
      ),
    );
    try {
      return {
        iv12B64u: parseEcdsaIv12B64u(base64UrlEncode(iv12)),
        ciphertextB64u: parseEcdsaCiphertextB64u(base64UrlEncode(ciphertext)),
        digestB64u: base64UrlEncode(await sha256Bytes(ciphertext)),
      };
    } finally {
      ciphertext.fill(0);
    }
  } finally {
    plaintext.fill(0);
    aad.fill(0);
  }
}

export async function ciphertextDigestB64u(ciphertextB64u: string): Promise<string> {
  const ciphertext = base64UrlDecode(ciphertextB64u);
  try {
    return base64UrlEncode(await sha256Bytes(ciphertext));
  } finally {
    ciphertext.fill(0);
  }
}

export async function decryptStateBlob(input: {
  readonly key: CryptoKey;
  readonly iv12B64u: string;
  readonly ciphertextB64u: string;
  readonly aadProjection: unknown;
}): Promise<string> {
  const iv12 = base64UrlDecode(input.iv12B64u);
  const ciphertext = base64UrlDecode(input.ciphertextB64u);
  const aad = additionalData(input.aadProjection);
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv12, additionalData: aad },
        input.key,
        ciphertext,
      ),
    );
    if (plaintext.length === 0) {
      throw new Error('decrypted ECDSA state blob must not be empty');
    }
    return base64UrlEncode(plaintext);
  } finally {
    iv12.fill(0);
    ciphertext.fill(0);
    aad.fill(0);
    plaintext?.fill(0);
  }
}

function parseManifestIdentity(value: unknown) {
  const record = requireRecord(value, 'ECDSA manifest identity');
  requireExactKeys(record, 'ECDSA manifest identity', ['manifestId', 'manifestRevision']);
  return buildEcdsaManifestIdentity({
    manifestId: parseEcdsaCapabilityManifestId(record.manifestId),
    manifestRevision: parseEcdsaCapabilityManifestRevision(record.manifestRevision),
  });
}

function parseManifestExpectation(value: unknown): EcdsaManifestRevisionExpectation {
  const record = requireRecord(value, 'ECDSA manifest expectation');
  switch (record.kind) {
    case 'no_current_manifest':
      requireExactKeys(record, 'ECDSA no-current manifest expectation', ['kind']);
      return buildNoCurrentEcdsaManifestExpectation();
    case 'exact_manifest':
      requireExactKeys(record, 'ECDSA exact manifest expectation', [
        'kind',
        'manifestId',
        'manifestRevision',
      ]);
      return buildExactEcdsaManifestExpectation(
        buildEcdsaManifestIdentity({
          manifestId: parseEcdsaCapabilityManifestId(record.manifestId),
          manifestRevision: parseEcdsaCapabilityManifestRevision(record.manifestRevision),
        }),
      );
    default:
      throw new Error('ECDSA manifest expectation kind is invalid');
  }
}

function parseChainTarget(value: unknown) {
  const record = requireRecord(value, 'ECDSA capability target');
  switch (record.kind) {
    case 'evm':
      requireExactKeys(record, 'ECDSA EVM capability target', [
        'kind',
        'namespace',
        'chainId',
        'networkSlug',
      ]);
      return thresholdEcdsaChainTargetFromRequest({
        kind: record.kind,
        namespace: record.namespace,
        chainId: record.chainId,
        networkSlug: record.networkSlug,
      });
    case 'tempo':
      requireExactKeys(record, 'ECDSA Tempo capability target', ['kind', 'chainId', 'networkSlug']);
      return thresholdEcdsaChainTargetFromRequest({
        kind: record.kind,
        chainId: record.chainId,
        networkSlug: record.networkSlug,
      });
    default:
      throw new Error('ECDSA capability target kind is invalid');
  }
}

function parseCapabilityScope(value: unknown) {
  const record = requireRecord(value, 'ECDSA capability scope');
  requireExactKeys(record, 'ECDSA capability scope', ['kind', 'targetMemberships']);
  if (record.kind !== 'evm_family') throw new Error('ECDSA capability scope kind is invalid');
  const targetValues = requireArray(
    record.targetMemberships,
    'ECDSA capability target memberships',
  );
  const targets = [];
  for (const targetValue of targetValues) targets.push(parseChainTarget(targetValue));
  const [first, ...rest] = targets;
  if (!first) throw new Error('ECDSA capability scope requires at least one target');
  return buildEcdsaCapabilityScope({
    targetMemberships: [first, ...rest],
  });
}

function parseRoleLocalBinding(value: unknown) {
  const record = requireRecord(value, 'ECDSA role-local material binding');
  requireExactKeys(record, 'ECDSA role-local material binding', [
    'kind',
    'keyHandle',
    'ecdsaThresholdKeyId',
    'clientVerifyingPublicKey33B64u',
    'participantIds',
    'relayerKeyId',
  ]);
  if (record.kind !== 'ecdsa_role_local_material_binding') {
    throw new Error('ECDSA role-local material binding kind is invalid');
  }
  const participantValues = requireArray(record.participantIds, 'ECDSA role-local participant ids');
  const participantIds = [];
  for (const participantValue of participantValues) {
    participantIds.push(toParticipantId(participantValue));
  }
  const [firstParticipantId, ...remainingParticipantIds] = participantIds;
  if (!firstParticipantId) {
    throw new Error('ECDSA role-local material requires at least one participant');
  }
  return buildEcdsaRoleLocalMaterialBinding({
    keyHandle: parseEcdsaKeyHandle(record.keyHandle),
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(record.ecdsaThresholdKeyId),
    clientVerifyingPublicKey33B64u: parseEcdsaClientVerifyingPublicKey33B64u(
      record.clientVerifyingPublicKey33B64u,
    ),
    participantIds: [firstParticipantId, ...remainingParticipantIds],
    relayerKeyId: parseEcdsaRelayerKeyId(record.relayerKeyId),
  });
}

function parsePreparedSigner(value: unknown) {
  const record = requireRecord(value, 'prepared ECDSA signer');
  requireExactKeys(record, 'prepared ECDSA signer', [
    'kind',
    'capability',
    'signerId',
    'walletId',
    'authority',
    'scope',
    'materialOwner',
    'signingRootId',
    'signingRootVersion',
  ]);
  if (record.kind !== 'prepared_evm_family_signer') {
    throw new Error('prepared ECDSA signer kind is invalid');
  }
  const authority = parseWalletAuthAuthorityRef(record.authority);
  if (!authority) throw new Error('prepared ECDSA signer authority is invalid');
  if (String(record.walletId) !== String(authority.walletId)) {
    throw new Error('prepared ECDSA signer wallet does not match its authority');
  }
  return buildPreparedEvmFamilySigner({
    capability: unwrapDomainId(parseCapabilityInstanceRef(record.capability)),
    signerId: parseEvmFamilyEcdsaSignerId(record.signerId),
    authority,
    scope: parseCapabilityScope(record.scope),
    materialOwner: unwrapDomainId(parseMpcMaterialOwnerRef(record.materialOwner)),
    signingRootId: parseSdkEcdsaDerivationSigningRootId(record.signingRootId),
    signingRootVersion: parseSdkEcdsaDerivationSigningRootVersion(record.signingRootVersion),
  });
}

function parseEncryptedPendingCandidate(value: unknown) {
  const record = requireRecord(value, 'encrypted ECDSA pending candidate');
  requireExactKeys(record, 'encrypted ECDSA pending candidate', [
    'kind',
    'sealingKeyId',
    'iv12B64u',
    'ciphertextB64u',
    'ciphertextDigest',
  ]);
  if (record.kind !== 'encrypted_ecdsa_pending_candidate') {
    throw new Error('encrypted ECDSA pending candidate kind is invalid');
  }
  return buildEncryptedEcdsaPendingCandidate({
    sealingKeyId: parseEcdsaMaterialSealingKeyId(record.sealingKeyId),
    iv12B64u: parseEcdsaIv12B64u(record.iv12B64u),
    ciphertextB64u: parseEcdsaCiphertextB64u(record.ciphertextB64u),
    ciphertextDigest: parseEcdsaPendingCiphertextDigest(record.ciphertextDigest),
  });
}

function parseActivationBinding(value: unknown): EcdsaActivationBinding {
  const record = requireRecord(value, 'ECDSA activation binding');
  requireExactKeys(record, 'ECDSA activation binding', [
    'kind',
    'targetManifest',
    'signer',
    'roleLocalBinding',
    'bindingDigest',
    'durableMaterialRef',
  ]);
  if (record.kind !== 'ecdsa_activation_binding') {
    throw new Error('ECDSA activation binding kind is invalid');
  }
  return buildEcdsaActivationBinding({
    targetManifest: parseManifestIdentity(record.targetManifest),
    signer: parsePreparedSigner(record.signer),
    roleLocalBinding: parseRoleLocalBinding(record.roleLocalBinding),
    bindingDigest: parseEcdsaRoleLocalBindingDigest(record.bindingDigest),
    durableMaterialRef: parseEcdsaRoleLocalDurableMaterialRef(record.durableMaterialRef),
  });
}

function parsePreparedCandidate(value: unknown) {
  const record = requireRecord(value, 'prepared ECDSA activation candidate');
  requireExactKeys(record, 'prepared ECDSA activation candidate', [
    'kind',
    'activationBinding',
    'encryptedPending',
  ]);
  if (record.kind !== 'prepared_ecdsa_activation_candidate') {
    throw new Error('prepared ECDSA activation candidate kind is invalid');
  }
  return buildPreparedEcdsaActivationCandidate({
    activationBinding: parseActivationBinding(record.activationBinding),
    encryptedPending: parseEncryptedPendingCandidate(record.encryptedPending),
  });
}

function parseExpectedServerGeneration(value: unknown) {
  const record = requireRecord(value, 'ECDSA server generation expectation');
  switch (record.kind) {
    case 'no_current_generation':
      requireExactKeys(record, 'ECDSA no-current server generation expectation', ['kind']);
      return buildNoCurrentEcdsaServerGenerationExpectation();
    case 'exact_generation':
      requireExactKeys(record, 'ECDSA exact server generation expectation', [
        'kind',
        'serverGeneration',
      ]);
      return buildExactEcdsaServerGenerationExpectation(
        parseEcdsaServerGeneration(record.serverGeneration),
      );
    default:
      throw new Error('ECDSA server generation expectation kind is invalid');
  }
}

function parsePreparedJournal(value: unknown): PreparedEcdsaActivationJournal {
  const record = requireRecord(value, 'prepared ECDSA activation journal');
  requireExactKeys(record, 'prepared ECDSA activation journal', [
    'kind',
    'journalId',
    'expectedManifest',
    'activationCommand',
    'candidate',
    'createdAt',
  ]);
  if (record.kind !== 'activation_prepared') {
    throw new Error('prepared ECDSA activation journal kind is invalid');
  }
  const command = requireRecord(record.activationCommand, 'ECDSA activation command');
  requireExactKeys(command, 'ECDSA activation command', [
    'kind',
    'correlationId',
    'expectedGeneration',
    'requestDigest',
    'canonicalRequest',
  ]);
  if (command.kind !== 'ecdsa_server_activation_command') {
    throw new Error('ECDSA activation command kind is invalid');
  }
  const journalId = parseCorrelationId(record.journalId);
  if (parseCorrelationId(command.correlationId) !== journalId) {
    throw new Error('ECDSA activation command correlation does not match its journal');
  }
  const expectedManifest = parseManifestExpectation(record.expectedManifest);
  const expectedGeneration = parseExpectedServerGeneration(command.expectedGeneration);
  const common = {
    journalId,
    candidate: parsePreparedCandidate(record.candidate),
    requestDigest: parseDigestB64u(command.requestDigest),
    canonicalRequest: parseCanonicalEcdsaServerActivationRequest(command.canonicalRequest),
    createdAt: parseIsoTimestamp(record.createdAt),
  };
  switch (expectedManifest.kind) {
    case 'no_current_manifest':
      if (expectedGeneration.kind !== 'no_current_generation') {
        throw new Error('initial ECDSA journal has an exact server generation');
      }
      return buildPreparedEcdsaActivationJournal({
        ...common,
        expectedManifest,
        expectedGeneration,
      });
    case 'exact_manifest':
      if (expectedGeneration.kind !== 'exact_generation') {
        throw new Error('replacement ECDSA journal is missing its exact server generation');
      }
      return buildPreparedEcdsaActivationJournal({
        ...common,
        expectedManifest,
        expectedGeneration,
      });
  }
  return assertNever(expectedManifest);
}

function preparedJournalValueFromCommitted(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: 'activation_prepared',
    journalId: record.journalId,
    expectedManifest: record.expectedManifest,
    activationCommand: record.activationCommand,
    candidate: record.candidate,
    createdAt: record.createdAt,
  };
}

export function preparedJournalProjection(
  journal: EcdsaCapabilityActivationCommitJournal,
): PreparedEcdsaActivationJournal {
  if (journal.kind === 'activation_prepared') return journal;
  return buildPreparedJournalForExpectations({
    journalId: journal.journalId,
    expectedManifest: journal.expectedManifest,
    expectedGeneration: journal.activationCommand.expectedGeneration,
    candidate: journal.candidate,
    requestDigest: journal.activationCommand.requestDigest,
    canonicalRequest: journal.activationCommand.canonicalRequest,
    createdAt: journal.createdAt,
  });
}

export function parseCommittedJournal(value: unknown): ServerCommittedEcdsaActivationJournal {
  const record = requireRecord(value, 'server-committed ECDSA activation journal');
  requireExactKeys(record, 'server-committed ECDSA activation journal', [
    'kind',
    'journalId',
    'expectedManifest',
    'activationCommand',
    'candidate',
    'createdAt',
    'serverActivation',
  ]);
  if (record.kind !== 'server_activation_committed') {
    throw new Error('server-committed ECDSA activation journal kind is invalid');
  }
  const preparedJournal = parsePreparedJournal(preparedJournalValueFromCommitted(record));
  const serverActivation = parseServerActivationRecord(record.serverActivation);
  const committed = buildServerCommittedEcdsaActivationJournal({
    preparedJournal,
    serverCommit: serverActivation.serverCommit,
  });
  if (!serverActivationRecordMatches(committed.serverActivation, serverActivation.record)) {
    throw new Error('ECDSA server activation commit fields are inconsistent');
  }
  return committed;
}

function parseServerActivationRecord(value: unknown): {
  readonly record: Record<string, unknown>;
  readonly serverCommit: ServerReturnedEcdsaActivationCommit;
} {
  const record = requireRecord(value, 'ECDSA server activation commit');
  requireExactKeys(record, 'ECDSA server activation commit', [
    'kind',
    'correlationId',
    'activationRequestDigest',
    'serverGeneration',
    'serverActivationReceipt',
  ]);
  if (record.kind !== 'ecdsa_server_activation_commit') {
    throw new Error('ECDSA server activation commit kind is invalid');
  }
  const receipt = requireRecord(record.serverActivationReceipt, 'ECDSA server activation receipt');
  requireExactKeys(receipt, 'ECDSA server activation receipt', [
    'kind',
    'lifecycleId',
    'activationDigest',
    'activatedAt',
    'protocolReceipt',
  ]);
  if (receipt.kind !== 'ecdsa_server_activation_receipt') {
    throw new Error('ECDSA server activation receipt kind is invalid');
  }
  return {
    record,
    serverCommit: {
      correlationId: parseCorrelationId(record.correlationId),
      activationRequestDigest: parseDigestB64u(record.activationRequestDigest),
      serverGeneration: parseEcdsaServerGeneration(record.serverGeneration),
      protocolReceipt: receipt.protocolReceipt,
    },
  };
}

function parseJournal(value: unknown): EcdsaCapabilityActivationCommitJournal {
  const record = requireRecord(value, 'ECDSA activation journal');
  switch (record.kind) {
    case 'activation_prepared':
      return parsePreparedJournal(record);
    case 'server_activation_committed':
      return parseCommittedJournal(record);
    default:
      throw new Error('ECDSA activation journal kind is invalid');
  }
}

function parseRegisteredPublicFacts(value: unknown) {
  const record = requireRecord(value, 'registered ECDSA public facts');
  requireExactKeys(record, 'registered ECDSA public facts', [
    'kind',
    'keyHandle',
    'publicKeyB64u',
    'participantIds',
    'thresholdOwnerAddress',
  ]);
  if (record.kind !== 'verified_ecdsa_public_facts') {
    throw new Error('registered ECDSA public facts kind is invalid');
  }
  return buildVerifiedEcdsaPublicFacts({
    keyHandle: toEvmFamilyEcdsaKeyHandle(record.keyHandle),
    publicKeyB64u: record.publicKeyB64u,
    participantIds: requireArray(record.participantIds, 'registered ECDSA participant ids'),
    thresholdOwnerAddress: record.thresholdOwnerAddress,
  });
}

export function parseActiveProof(value: unknown): ParsedActiveManifestProof {
  const record = requireRecord(value, 'active ECDSA manifest proof');
  requireExactKeys(record, 'active ECDSA manifest proof', [
    'activation_binding',
    'server_activation',
    'registered_public_facts',
    'role_local_public_facts',
    'router_ab_ecdsa_derivation_normal_signing',
    'runtime_policy_scope',
    'ciphertext_digest',
    'committed_at',
  ]);
  const activationBinding = parseActivationBinding(record.activation_binding);
  const serverActivationRecord = parseServerActivationRecord(record.server_activation);
  const serverActivation = buildEcdsaServerActivationCommit({
    activationBinding,
    serverCommit: serverActivationRecord.serverCommit,
  });
  if (!serverActivationRecordMatches(serverActivation, serverActivationRecord.record)) {
    throw new Error('ECDSA server activation commit fields are inconsistent');
  }
  const durableMaterial = buildDurableEcdsaMaterialBinding({
    activationBinding,
    serverActivation,
    routerAbEcdsaDerivationNormalSigning: requireRouterAbEcdsaDerivationNormalSigningStateV1(
      record.router_ab_ecdsa_derivation_normal_signing,
    ),
    roleLocalPublicFacts: buildEcdsaRoleLocalPublicFacts(record.role_local_public_facts),
    ciphertextDigest: parseEcdsaCiphertextDigest(record.ciphertext_digest),
    runtimePolicyScope: normalizeRuntimePolicyScope(record.runtime_policy_scope),
  });
  const committedAt = parseIsoTimestamp(record.committed_at);
  const activeManifest = buildActiveEcdsaCapabilityManifest({
    activationBinding,
    serverActivation,
    registeredPublicFacts: parseRegisteredPublicFacts(record.registered_public_facts),
    durableMaterial,
    committedAt,
  });
  return {
    activationBinding,
    serverActivation,
    durableMaterial,
    activeManifest,
    committedAt,
  };
}

export function parseManifestRow(value: unknown): ParsedManifestRow {
  const record = requireRecord(value, 'ECDSA capability manifest row');
  const commonKeys = [
    'record_version',
    'manifest_id',
    'manifest_revision',
    'capability_ref',
    'wallet_id',
    'authority_digest',
    'wallet_auth_method_id',
    'manifest_state',
    'active_proof',
  ];
  switch (record.manifest_state) {
    case 'active': {
      requireExactKeys(record, 'active ECDSA capability manifest row', commonKeys);
      const activeProof = parseActiveProof(record.active_proof);
      const selector = selectorFromManifest(activeProof.activeManifest);
      assertManifestRowCommon(record, activeProof.activeManifest, selector);
      return {
        state: 'active',
        selector,
        manifest: activeProof.activeManifest,
        activeProof,
      };
    }
    case 'replaced': {
      requireExactKeys(record, 'replaced ECDSA capability manifest row', [
        ...commonKeys,
        'replacement_proof',
      ]);
      const activeProof = parseActiveProof(record.active_proof);
      const replacementProof = parseActiveProof(record.replacement_proof);
      const manifest = buildReplacedEcdsaCapabilityManifest({
        activeManifest: activeProof.activeManifest,
        replacementManifest: replacementProof.activeManifest,
      });
      const selector = selectorFromManifest(activeProof.activeManifest);
      assertManifestRowCommon(record, activeProof.activeManifest, selector);
      return {
        state: 'replaced',
        selector,
        manifest,
        activeProof,
        replacementProof,
      };
    }
    default:
      throw new Error('ECDSA capability manifest row state is invalid');
  }
}

function assertManifestRowCommon(
  record: Record<string, unknown>,
  manifest: ActiveEcdsaCapabilityManifest,
  selector: EcdsaCapabilitySelector,
): void {
  if (
    record.record_version !== MANIFEST_RECORD_VERSION ||
    parseEcdsaCapabilityManifestId(record.manifest_id) !== manifest.identity.manifestId ||
    parseEcdsaCapabilityManifestRevision(record.manifest_revision) !==
      manifest.identity.manifestRevision ||
    String(record.capability_ref) !== String(selector.capability) ||
    String(record.wallet_id) !== String(selector.authority.walletId) ||
    String(record.authority_digest) !== String(selector.authority.authorityDigest)
  ) {
    throw new Error('ECDSA capability manifest row identity is inconsistent');
  }
}

export function storedPointerRow(manifest: ActiveEcdsaCapabilityManifest) {
  return {
    record_version: POINTER_RECORD_VERSION,
    ...selectorColumns(selectorFromManifest(manifest)),
    manifest_id: manifest.identity.manifestId,
    manifest_revision: manifest.identity.manifestRevision,
  };
}

export function parsePointerRow(value: unknown): ParsedPointerRow {
  const record = requireRecord(value, 'current ECDSA capability pointer');
  requireExactKeys(record, 'current ECDSA capability pointer', [
    'record_version',
    'capability_ref',
    'wallet_id',
    'authority_digest',
    'wallet_auth_method_id',
    'manifest_id',
    'manifest_revision',
  ]);
  if (record.record_version !== POINTER_RECORD_VERSION) {
    throw new Error('current ECDSA capability pointer version is invalid');
  }
  const authority = authorityFromColumns(record);
  if (!authority) throw new Error('current ECDSA capability pointer authority is invalid');
  return {
    selector: {
      capability: unwrapDomainId(parseCapabilityInstanceRef(record.capability_ref)),
      authority,
    },
    manifestId: parseEcdsaCapabilityManifestId(record.manifest_id),
    manifestRevision: parseEcdsaCapabilityManifestRevision(record.manifest_revision),
  };
}

export function storedMaterialRow(
  material: ValidatedEncryptedEcdsaReadyMaterial,
  manifest: ActiveEcdsaCapabilityManifest,
) {
  return {
    record_version: MATERIAL_RECORD_VERSION,
    durable_material_ref: material.binding.durableMaterialRef,
    binding_digest: material.binding.bindingDigest,
    ...selectorColumns(selectorFromManifest(manifest)),
    sealing_key_id: material.sealingKeyId,
    iv: material.iv12B64u,
    ciphertext: material.ciphertextB64u,
  };
}

export type ParsedMaterialLocator = {
  readonly durableMaterialRef: ReturnType<typeof parseEcdsaRoleLocalDurableMaterialRef>;
  readonly bindingDigest: ReturnType<typeof parseEcdsaRoleLocalBindingDigest>;
  readonly selector: EcdsaCapabilitySelector;
};

export function parseMaterialLocator(value: unknown): ParsedMaterialLocator {
  const record = requireRecord(value, 'ECDSA role-local material row');
  requireExactKeys(record, 'ECDSA role-local material row', [
    'record_version',
    'durable_material_ref',
    'binding_digest',
    'capability_ref',
    'wallet_id',
    'authority_digest',
    'wallet_auth_method_id',
    'sealing_key_id',
    'iv',
    'ciphertext',
  ]);
  if (record.record_version !== MATERIAL_RECORD_VERSION) {
    throw new Error('ECDSA role-local material row version is invalid');
  }
  const authority = authorityFromColumns(record);
  if (!authority) throw new Error('ECDSA role-local material authority is invalid');
  return {
    durableMaterialRef: parseEcdsaRoleLocalDurableMaterialRef(record.durable_material_ref),
    bindingDigest: parseEcdsaRoleLocalBindingDigest(record.binding_digest),
    selector: {
      capability: unwrapDomainId(parseCapabilityInstanceRef(record.capability_ref)),
      authority,
    },
  };
}

export function parseMaterialRow(
  value: unknown,
  activeProof: ParsedActiveManifestProof,
): ValidatedEncryptedEcdsaReadyMaterial {
  const record = requireRecord(value, 'ECDSA role-local material row');
  const locator = parseMaterialLocator(record);
  const material = buildValidatedEncryptedEcdsaReadyMaterial({
    binding: activeProof.durableMaterial,
    sealingKeyId: parseEcdsaMaterialSealingKeyId(record.sealing_key_id),
    iv12B64u: parseEcdsaIv12B64u(record.iv),
    ciphertextB64u: parseEcdsaCiphertextB64u(record.ciphertext),
  });
  if (
    locator.durableMaterialRef !== material.binding.durableMaterialRef ||
    locator.bindingDigest !== material.binding.bindingDigest ||
    !selectorsMatch(locator.selector, selectorFromManifest(activeProof.activeManifest))
  ) {
    throw new Error('ECDSA role-local material row binding is inconsistent');
  }
  return material;
}

export function materialMatchesManifest(
  material: ValidatedEncryptedEcdsaReadyMaterial,
  manifest: ActiveEcdsaCapabilityManifest,
): boolean {
  return (
    material.binding.durableMaterialRef === manifest.durableMaterial.durableMaterialRef &&
    material.binding.bindingDigest === manifest.durableMaterial.bindingDigest &&
    material.binding.lifecycleId === manifest.durableMaterial.lifecycleId &&
    material.binding.ciphertextDigest === manifest.durableMaterial.ciphertextDigest &&
    material.binding.activationDigest === manifest.durableMaterial.activationDigest &&
    material.binding.activatedAt === manifest.durableMaterial.activatedAt &&
    mpcMaterialActivationRefsEqual(
      material.binding.materialActivation,
      manifest.durableMaterial.materialActivation,
    ) &&
    ecdsaRoleLocalMaterialBindingsMatch(
      material.binding.roleLocalBinding,
      manifest.durableMaterial.roleLocalBinding,
    )
  );
}

export function storedJournalRow(journal: EcdsaCapabilityActivationCommitJournal) {
  return {
    record_version: JOURNAL_RECORD_VERSION,
    journal_id: journal.journalId,
    ...selectorColumns(selectorFromJournal(journal)),
    journal,
  };
}

export function parseJournalRow(value: unknown) {
  const record = requireRecord(value, 'ECDSA activation commit journal row');
  requireExactKeys(record, 'ECDSA activation commit journal row', [
    'record_version',
    'journal_id',
    'capability_ref',
    'wallet_id',
    'authority_digest',
    'wallet_auth_method_id',
    'journal',
  ]);
  if (record.record_version !== JOURNAL_RECORD_VERSION) {
    throw new Error('ECDSA activation commit journal row version is invalid');
  }
  const journal = parseJournal(record.journal);
  const selector = selectorFromJournal(journal);
  if (
    parseCorrelationId(record.journal_id) !== journal.journalId ||
    String(record.capability_ref) !== String(selector.capability) ||
    String(record.wallet_id) !== String(selector.authority.walletId) ||
    String(record.authority_digest) !== String(selector.authority.authorityDigest)
  ) {
    throw new Error('ECDSA activation commit journal row identity is inconsistent');
  }
  return { journal, selector };
}

function isNonExtractableAesGcmKey(value: unknown): value is CryptoKey {
  if (typeof CryptoKey === 'undefined' || !(value instanceof CryptoKey)) return false;
  if (value.type !== 'secret' || value.extractable || value.algorithm.name !== 'AES-GCM') {
    return false;
  }
  return value.usages.includes('encrypt') && value.usages.includes('decrypt');
}

export function storedSealingKeyRow(keyId: EcdsaMaterialSealingKeyId, key: CryptoKey) {
  return {
    record_version: SEALING_KEY_RECORD_VERSION,
    key_id: keyId,
    key,
  };
}

export function parseSealingKeyRow(value: unknown): ParsedSealingKeyRow {
  const record = requireRecord(value, 'ECDSA material sealing key row');
  requireExactKeys(record, 'ECDSA material sealing key row', ['record_version', 'key_id', 'key']);
  if (record.record_version !== SEALING_KEY_RECORD_VERSION) {
    throw new Error('ECDSA material sealing key row version is invalid');
  }
  if (!isNonExtractableAesGcmKey(record.key)) {
    throw new Error('ECDSA material sealing key must be a non-extractable AES-GCM key');
  }
  return {
    keyId: parseEcdsaMaterialSealingKeyId(record.key_id),
    key: record.key,
  };
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected ECDSA persistence branch: ${String(value)}`);
}
