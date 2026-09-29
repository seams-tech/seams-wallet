import { base64UrlEncode } from '@shared/utils/base64';
import {
  parseCorrelationId,
  type CorrelationId,
  type IsoTimestamp,
} from '@shared/utils/canonicalPrimitives';
import {
  mpcMaterialActivationRefsEqual,
  parseMpcMaterialActivationRef,
  parseWalletId,
  type MpcMaterialActivationRef,
  type WalletId,
} from '@shared/utils/domainIds';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseEcdsaCiphertextDigest,
  parseEcdsaMaterialSealingKeyId,
  parseEcdsaPendingCiphertextDigest,
  type EcdsaMaterialSealingKeyId,
} from '@shared/utils/ecdsaCapabilityActivation';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  sameRouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import { buildEcdsaRoleLocalPublicFacts, type EcdsaRoleLocalPublicFacts } from '@/core/platform';
import {
  parseEcdsaClientVerifyingPublicKey33B64u,
  parseEcdsaRoleLocalPersistedMaterialRef,
  type EcdsaRoleLocalPersistedMaterialRef,
} from '@/core/signingEngine/session/keyMaterialBrands';
import {
  buildActiveEcdsaCapabilityManifest,
  buildDurableEcdsaMaterialBinding,
  buildEcdsaServerActivationCommit,
  buildEncryptedEcdsaPendingCandidate,
  buildServerCommittedEcdsaActivationJournal,
  buildValidatedEncryptedEcdsaReadyMaterial,
  type ActiveEcdsaCapabilityManifest,
  type EcdsaActivationBinding,
  type EcdsaManifestRevisionExpectation,
  type PreparedEvmFamilySigner,
  type RegisteredEvmFamilySigner,
  type ServerReturnedEcdsaActivationCommit,
  type EcdsaServerActivationCommit,
  type PreparedEcdsaActivationJournal,
  type ServerCommittedEcdsaActivationJournal,
  type ValidatedEncryptedEcdsaReadyMaterial,
} from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import type { VerifiedEcdsaPublicFacts } from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import { requireRecord } from '@shared/utils/validation';
import { SEAMS_WALLET_INDEXES } from '../schemaNames';
import { seamsWalletDB } from '../singletons';
import type { SeamsWalletDBManager, SeamsWalletTransactionContext } from './manager';
import {
  ecdsaClientPresignPoolKey,
  equalEcdsaClientPresignPoolIdentity,
  parseEcdsaClientPresignPoolIdentity,
  type EcdsaClientPresignPoolIdentity,
} from '@/core/signingEngine/workerManager/ecdsaPresignPoolIdentity';
import {
  ECDSA_CLIENT_PRESIGNATURE_CAPACITY,
  MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS,
  type EcdsaClientPresignCleanupTarget,
} from '@/core/signingEngine/workerManager/ecdsaPresignLifecycle';
import {
  MANIFEST_RECORD_VERSION,
  MANIFEST_STORE,
  POINTER_STORE,
  MATERIAL_STORE,
  JOURNAL_STORE,
  SEALING_KEY_STORE,
  PRESIGNATURE_STORE,
  type EcdsaCapabilitySelector,
  type PrepareEcdsaCapabilityActivationInput,
  type ParsedActiveManifestProof,
  type ParsedManifestRow,
  type ParsedPointerRow,
  normalizeSelector,
  selectorFromSigner,
  selectorFromJournal,
  selectorFromManifest,
  selectorKey,
  selectorColumns,
  walletAuthAuthorityRefsMatch,
  selectorsMatch,
  runtimePolicyScopesMatch,
  ecdsaCapabilityScopesMatch,
  ecdsaRoleLocalMaterialBindingsMatch,
  ecdsaRoleLocalPublicFactsMatch,
  ecdsaRegisteredPublicFactsMatch,
  ecdsaServerActivationCommitsMatch,
  ecdsaActivationCommitJournalsMatch,
  ecdsaDurableMaterialBindingsMatch,
  ecdsaActiveCapabilityManifestsMatch,
  buildPreparedJournalFromEncryptedCandidate,
  generateMaterialSealingKey,
  encryptStateBlob,
  ciphertextDigestB64u,
  decryptStateBlob,
  preparedJournalProjection,
  parseCommittedJournal,
  parseActiveProof,
  parseManifestRow,
  storedPointerRow,
  parsePointerRow,
  storedMaterialRow,
  type ParsedMaterialLocator,
  parseMaterialLocator,
  parseMaterialRow,
  materialMatchesManifest,
  storedJournalRow,
  parseJournalRow,
  storedSealingKeyRow,
  parseSealingKeyRow,
  assertNever,
} from './ecdsaCapabilityManifestRecords';
import {
  MAX_DURABLE_CLIENT_PRESIGNATURE_FUTURE_SKEW_MS,
  type DurableClientPresignatureMetadata,
  type DurableClientPresignatureAdmissionResult,
  type DurableClientPresignatureAdmissionInput,
  type DurableClientPresignatureTakeResult,
  type SealedAvailableClientPresignatureRow,
  activeMaterialMatchesPresignature,
  materialRefMatchesPoolIdentity,
  parseDurableClientPresignatureRecordId,
  parsePresignatureTimestamp,
  rawRecordId,
  supportsStrictIndexedDbDurability,
  deleteCursorRows,
  readAvailableClientPresignatureRows,
  parseSealedAvailableClientPresignatureRow,
  metadataFromPresignatureRow,
  encryptPresignatureBytes,
  decryptPresignatureBytes,
  retireClientPresignaturesForActivationInTransaction,
} from './ecdsaClientPresignatures';
import {
  type ActiveEcdsaWalletCapabilitySubject,
  type ActiveEcdsaWalletCapabilitySubjectListResult,
  type EcdsaWalletActivationSelectorListResult,
  type EcdsaCapabilityManifestLookup,
  type EcdsaActivationJournalWriteResult,
  type EcdsaActivationJournalReadResult,
  type EcdsaPreparedActivationOpenResult,
  type EcdsaActiveMaterialOpenResult,
  type EcdsaActiveMaterialRefOpenResult,
  type EcdsaCapabilityMaterialRefLookup,
  type EcdsaCapabilityActivationLookup,
  type EcdsaCapabilityActivationFinalizationResult,
  type LookupTransactionObservation,
  persistenceDigest,
  journalConstraintConflict,
  retryCorrelation,
  errorMessage,
  isConstraintError,
  readPointerRowsForWallet,
  readActivationJournalRows,
  readActiveManifestRows,
  activeLookupUsesMaterialActivation,
  materialRefOpenFailure,
  lookupInTransaction,
} from './ecdsaCapabilityManifestLookups';
const MATERIAL_AAD_VERSION = 1;

type EcdsaPreparedActivationCancellationResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'server_activation_committed' }
  | { readonly kind: 'exact_record_conflict' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'persistence_unavailable' };

type FinalizeEcdsaCapabilityActivationInput = {
  readonly committedJournal: ServerCommittedEcdsaActivationJournal;
  readonly readyMaterial: ValidatedEncryptedEcdsaReadyMaterial;
  readonly activeManifest: ActiveEcdsaCapabilityManifest;
};

type RecordEcdsaServerActivationInput = {
  readonly preparedJournal: PreparedEcdsaActivationJournal;
  readonly serverCommit: ServerReturnedEcdsaActivationCommit;
};

type SealEcdsaCapabilityActivationInput = {
  readonly committedJournal: ServerCommittedEcdsaActivationJournal;
  readonly readyStateBlobB64u: string;
  readonly registeredPublicFacts: VerifiedEcdsaPublicFacts;
  readonly roleLocalPublicFacts: EcdsaRoleLocalPublicFacts;
  readonly routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
  readonly runtimePolicyScope: ReturnType<typeof normalizeRuntimePolicyScope>;
  readonly committedAt: IsoTimestamp;
};

export type ImportCommittedWalletCustodyEcdsaActivationInput = {
  readonly activationBinding: EcdsaActivationBinding;
  readonly serverCommit: ServerReturnedEcdsaActivationCommit;
  readonly readyStateBlobB64u: string;
  readonly registeredPublicFacts: VerifiedEcdsaPublicFacts;
  readonly roleLocalPublicFacts: EcdsaRoleLocalPublicFacts;
  readonly routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
  readonly runtimePolicyScope: ReturnType<typeof normalizeRuntimePolicyScope>;
  readonly committedAt: IsoTimestamp;
};

export type PreparedImportedWalletCustodyEcdsaContinuity = {
  readonly activationBinding: EcdsaActivationBinding;
  readonly serverActivation: EcdsaServerActivationCommit;
  readonly sealingKey: CryptoKey;
  readonly readyMaterial: ValidatedEncryptedEcdsaReadyMaterial;
  readonly activeManifest: ActiveEcdsaCapabilityManifest;
  readonly roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
};

function activeManifestMatchesWalletCustodyImport(
  manifest: ActiveEcdsaCapabilityManifest,
  input: ImportCommittedWalletCustodyEcdsaActivationInput,
  serverActivation: EcdsaServerActivationCommit,
): boolean {
  const binding = input.activationBinding;
  return (
    walletAuthAuthorityRefsMatch(manifest.signer.authority, binding.signer.authority) &&
    ecdsaCapabilityScopesMatch(manifest.signer.scope, binding.signer.scope) &&
    manifest.signer.walletId === binding.signer.walletId &&
    manifest.signer.capability === binding.signer.capability &&
    manifest.signer.materialOwner === binding.signer.materialOwner &&
    manifest.signer.signingRootId === binding.signer.signingRootId &&
    manifest.signer.signingRootVersion === binding.signer.signingRootVersion &&
    ecdsaRegisteredPublicFactsMatch(
      manifest.signer.registeredPublicFacts,
      input.registeredPublicFacts,
    ) &&
    ecdsaServerActivationCommitsMatch(manifest.activation.serverActivation, serverActivation) &&
    mpcMaterialActivationRefsEqual(
      manifest.activation.materialActivation,
      routerAbMpcMaterialActivationRefFromWire(
        serverActivation.serverActivationReceipt.protocolReceipt.ecdsa_activation
          .material_activation,
      ),
    ) &&
    manifest.durableMaterial.bindingDigest === binding.bindingDigest &&
    manifest.durableMaterial.durableMaterialRef === binding.durableMaterialRef &&
    ecdsaRoleLocalMaterialBindingsMatch(
      manifest.durableMaterial.roleLocalBinding,
      binding.roleLocalBinding,
    ) &&
    ecdsaRoleLocalPublicFactsMatch(
      manifest.durableMaterial.roleLocalPublicFacts,
      input.roleLocalPublicFacts,
    ) &&
    sameRouterAbEcdsaDerivationNormalSigningStateV1(
      manifest.durableMaterial.routerAbEcdsaDerivationNormalSigning,
      input.routerAbEcdsaDerivationNormalSigning,
    ) &&
    runtimePolicyScopesMatch(
      manifest.durableMaterial.runtimePolicyScope,
      normalizeRuntimePolicyScope(input.runtimePolicyScope),
    )
  );
}

type FinalizationControlKind = 'exact_record_conflict' | 'corrupt';

class FinalizationControlError extends Error {
  readonly kind: FinalizationControlKind;

  constructor(kind: FinalizationControlKind, message: string) {
    super(message);
    this.name = 'FinalizationControlError';
    this.kind = kind;
  }
}

// An activation binding, or the same facts read back from the active manifest it produced.
type AadActivationBinding = Pick<
  EcdsaActivationBinding,
  'targetManifest' | 'roleLocalBinding' | 'bindingDigest' | 'durableMaterialRef'
> & {
  readonly signer: PreparedEvmFamilySigner | RegisteredEvmFamilySigner;
};

function activationBindingAadProjection(binding: AadActivationBinding) {
  return {
    target_manifest: binding.targetManifest,
    signer: {
      capability: binding.signer.capability,
      signer_id: binding.signer.signerId,
      wallet_id: binding.signer.walletId,
      authority: binding.signer.authority,
      scope: binding.signer.scope,
      material_owner: binding.signer.materialOwner,
      signing_root_id: binding.signer.signingRootId,
      signing_root_version: binding.signer.signingRootVersion,
    },
    role_local_binding: binding.roleLocalBinding,
    binding_digest: binding.bindingDigest,
    durable_material_ref: binding.durableMaterialRef,
  };
}

function pendingAadProjection(
  input:
    | PrepareEcdsaCapabilityActivationInput
    | PreparedEcdsaActivationJournal
    | ServerCommittedEcdsaActivationJournal,
) {
  if ('activationBinding' in input) {
    return {
      version: MATERIAL_AAD_VERSION,
      stage: 'activation_prepared',
      journal_id: input.journalId,
      expected_manifest: input.expectedManifest,
      activation_command: {
        kind: 'ecdsa_server_activation_command',
        correlationId: input.journalId,
        expectedGeneration: input.expectedGeneration,
        requestDigest: input.requestDigest,
        canonicalRequest: input.canonicalRequest,
      },
      activation_binding: activationBindingAadProjection(input.activationBinding),
      created_at: input.createdAt,
    };
  }
  return {
    version: MATERIAL_AAD_VERSION,
    stage: 'activation_prepared',
    journal_id: input.journalId,
    expected_manifest: input.expectedManifest,
    activation_command: input.activationCommand,
    activation_binding: activationBindingAadProjection(input.candidate.activationBinding),
    created_at: input.createdAt,
  };
}

function readyAadProjection(
  input: ServerCommittedEcdsaActivationJournal | ActiveEcdsaCapabilityManifest,
) {
  if (input.kind === 'server_activation_committed') {
    return readyAadProjectionFor(input.candidate.activationBinding, input.serverActivation);
  }
  return readyAadProjectionFor(
    {
      targetManifest: input.identity,
      signer: input.signer,
      roleLocalBinding: input.durableMaterial.roleLocalBinding,
      bindingDigest: input.durableMaterial.bindingDigest,
      durableMaterialRef: input.durableMaterial.durableMaterialRef,
    },
    input.activation.serverActivation,
  );
}

function readyAadProjectionFor(
  activationBinding: AadActivationBinding,
  serverActivation: EcdsaServerActivationCommit,
) {
  return {
    version: MATERIAL_AAD_VERSION,
    stage: 'activation_ready',
    activation_binding: activationBindingAadProjection(activationBinding),
    server_activation: serverActivation,
  };
}

function storedActiveProof(input: ParsedActiveManifestProof) {
  return {
    activation_binding: input.activationBinding,
    server_activation: input.serverActivation,
    registered_public_facts: input.activeManifest.signer.registeredPublicFacts,
    role_local_public_facts: input.durableMaterial.roleLocalPublicFacts,
    router_ab_ecdsa_derivation_normal_signing:
      input.durableMaterial.routerAbEcdsaDerivationNormalSigning,
    runtime_policy_scope: input.durableMaterial.runtimePolicyScope,
    ciphertext_digest: input.durableMaterial.ciphertextDigest,
    committed_at: input.activeManifest.committedAt,
  };
}

function manifestRowCommon(proof: ParsedActiveManifestProof, manifestState: 'active' | 'replaced') {
  return {
    record_version: MANIFEST_RECORD_VERSION,
    manifest_id: proof.activeManifest.identity.manifestId,
    manifest_revision: proof.activeManifest.identity.manifestRevision,
    ...selectorColumns(selectorFromManifest(proof.activeManifest)),
    manifest_state: manifestState,
  };
}

function storedActiveManifestRow(proof: ParsedActiveManifestProof) {
  return {
    ...manifestRowCommon(proof, 'active'),
    active_proof: storedActiveProof(proof),
  };
}

function storedReplacedManifestRow(
  previous: ParsedActiveManifestProof,
  replacement: ParsedActiveManifestProof,
) {
  return {
    ...manifestRowCommon(previous, 'replaced'),
    active_proof: storedActiveProof(previous),
    replacement_proof: storedActiveProof(replacement),
  };
}

export async function prepareImportedWalletCustodyEcdsaContinuity(
  input: ImportCommittedWalletCustodyEcdsaActivationInput,
): Promise<PreparedImportedWalletCustodyEcdsaContinuity> {
  const serverActivation = buildEcdsaServerActivationCommit({
    activationBinding: input.activationBinding,
    serverCommit: input.serverCommit,
  });
  const sealingKeyId = parseEcdsaMaterialSealingKeyId(
    secureRandomId('ecdsa-material-sealing-key', 32, 'ECDSA material sealing key identities'),
  );
  const sealingKey = await generateMaterialSealingKey();
  const encrypted = await encryptStateBlob({
    key: sealingKey,
    stateBlobB64u: input.readyStateBlobB64u,
    aadProjection: readyAadProjectionFor(input.activationBinding, serverActivation),
  });
  const durableMaterial = buildDurableEcdsaMaterialBinding({
    activationBinding: input.activationBinding,
    serverActivation,
    routerAbEcdsaDerivationNormalSigning: input.routerAbEcdsaDerivationNormalSigning,
    roleLocalPublicFacts: input.roleLocalPublicFacts,
    ciphertextDigest: parseEcdsaCiphertextDigest(encrypted.digestB64u),
    runtimePolicyScope: input.runtimePolicyScope,
  });
  const readyMaterial = buildValidatedEncryptedEcdsaReadyMaterial({
    binding: durableMaterial,
    sealingKeyId,
    iv12B64u: encrypted.iv12B64u,
    ciphertextB64u: encrypted.ciphertextB64u,
  });
  const activeManifest = buildActiveEcdsaCapabilityManifest({
    activationBinding: input.activationBinding,
    serverActivation,
    registeredPublicFacts: input.registeredPublicFacts,
    durableMaterial,
    committedAt: input.committedAt,
  });
  return {
    activationBinding: input.activationBinding,
    serverActivation,
    sealingKey,
    readyMaterial,
    activeManifest,
    roleLocalMaterialRef: {
      kind: 'ecdsa_role_local_persisted_material_ref_v1',
      durableMaterialRef: readyMaterial.binding.durableMaterialRef,
      bindingDigest: readyMaterial.binding.bindingDigest,
      materialActivation: readyMaterial.binding.materialActivation,
    },
  };
}

export async function persistPreparedImportedWalletCustodyEcdsaContinuityInTransaction(
  context: SeamsWalletTransactionContext,
  prepared: PreparedImportedWalletCustodyEcdsaContinuity,
): Promise<void> {
  const selector = selectorFromManifest(prepared.activeManifest);
  const pointerStore = context.store(POINTER_STORE);
  const existingPointer = await pointerStore.get(selectorKey(selector));
  const activeRows = await readActiveManifestRows(context, selector);
  if (existingPointer !== undefined || activeRows.length !== 0) {
    throw new FinalizationControlError(
      'exact_record_conflict',
      'ECDSA custody import found an existing active manifest',
    );
  }
  const activeProof: ParsedActiveManifestProof = {
    activationBinding: prepared.activationBinding,
    serverActivation: prepared.serverActivation,
    durableMaterial: prepared.readyMaterial.binding,
    activeManifest: prepared.activeManifest,
    committedAt: prepared.activeManifest.committedAt,
  };
  await context
    .store(SEALING_KEY_STORE)
    .add(storedSealingKeyRow(prepared.readyMaterial.sealingKeyId, prepared.sealingKey));
  await context
    .store(MATERIAL_STORE)
    .add(storedMaterialRow(prepared.readyMaterial, prepared.activeManifest));
  await context.store(MANIFEST_STORE).add(storedActiveManifestRow(activeProof));
  await pointerStore.put(storedPointerRow(prepared.activeManifest));
}

function assertActiveProofInput(
  input: FinalizeEcdsaCapabilityActivationInput,
): ParsedActiveManifestProof {
  const proof: ParsedActiveManifestProof = {
    activationBinding: input.committedJournal.candidate.activationBinding,
    serverActivation: input.committedJournal.serverActivation,
    durableMaterial: input.readyMaterial.binding,
    activeManifest: input.activeManifest,
    committedAt: input.activeManifest.committedAt,
  };
  const parsed = parseActiveProof(storedActiveProof(proof));
  if (
    !ecdsaActiveCapabilityManifestsMatch(parsed.activeManifest, input.activeManifest) ||
    !ecdsaDurableMaterialBindingsMatch(parsed.durableMaterial, input.readyMaterial.binding)
  ) {
    throw new Error('ECDSA finalization input does not describe one exact active manifest');
  }
  return parsed;
}

function assertExpectedPointer(
  expected: EcdsaManifestRevisionExpectation,
  pointerRaw: unknown,
  selector: EcdsaCapabilitySelector,
): ParsedPointerRow | null {
  switch (expected.kind) {
    case 'no_current_manifest':
      if (pointerRaw !== undefined) {
        throw new FinalizationControlError(
          'exact_record_conflict',
          'initial ECDSA activation found an existing current pointer',
        );
      }
      return null;
    case 'exact_manifest': {
      if (pointerRaw === undefined) {
        throw new FinalizationControlError(
          'exact_record_conflict',
          'replacement ECDSA activation is missing its expected current pointer',
        );
      }
      let pointer: ParsedPointerRow;
      try {
        pointer = parsePointerRow(pointerRaw);
      } catch (error: unknown) {
        throw new FinalizationControlError('corrupt', errorMessage(error));
      }
      if (
        !selectorsMatch(pointer.selector, selector) ||
        pointer.manifestId !== expected.manifestId ||
        pointer.manifestRevision !== expected.manifestRevision
      ) {
        throw new FinalizationControlError(
          'exact_record_conflict',
          'replacement ECDSA activation pointer CAS did not match',
        );
      }
      return pointer;
    }
  }
  return assertNever(expected);
}

async function cancelPreparedActivationInTransaction(
  preparedJournal: PreparedEcdsaActivationJournal,
  context: SeamsWalletTransactionContext,
): Promise<
  Exclude<EcdsaPreparedActivationCancellationResult, { kind: 'persistence_unavailable' }>
> {
  const journalStore = context.store(JOURNAL_STORE);
  const raw = await journalStore.get(preparedJournal.journalId);
  if (raw === undefined) return { kind: 'missing' };

  let persisted: ReturnType<typeof parseJournalRow>;
  try {
    persisted = parseJournalRow(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  if (persisted.journal.journalId !== preparedJournal.journalId) {
    return { kind: 'corrupt' };
  }
  switch (persisted.journal.kind) {
    case 'server_activation_committed':
      return { kind: 'server_activation_committed' };
    case 'activation_prepared':
      if (!ecdsaActivationCommitJournalsMatch(persisted.journal, preparedJournal)) {
        return { kind: 'exact_record_conflict' };
      }
      await context
        .store(SEALING_KEY_STORE)
        .delete(persisted.journal.candidate.encryptedPending.sealingKeyId);
      await journalStore.delete(persisted.journal.journalId);
      return { kind: 'cancelled' };
  }
  return assertNever(persisted.journal);
}

function persistPreparedContinuity(
  manager: SeamsWalletDBManager,
  prepared: PreparedImportedWalletCustodyEcdsaContinuity,
): Promise<void> {
  return manager.runTransaction(
    [MANIFEST_STORE, POINTER_STORE, MATERIAL_STORE, SEALING_KEY_STORE],
    'readwrite',
    (context) =>
      persistPreparedImportedWalletCustodyEcdsaContinuityInTransaction(context, prepared),
  );
}

// `persist` is the caller's own write: the store method uses its manager, while
// importWalletCustodyEcdsaContinuity goes through the store it was handed.
export async function importCommittedActivation(
  store: IndexedDbEcdsaCapabilityManifestStore,
  input: ImportCommittedWalletCustodyEcdsaActivationInput,
  persist: (prepared: PreparedImportedWalletCustodyEcdsaContinuity) => Promise<void>,
): Promise<EcdsaCapabilityActivationFinalizationResult> {
  const serverActivation = buildEcdsaServerActivationCommit({
    activationBinding: input.activationBinding,
    serverCommit: input.serverCommit,
  });
  const selector = selectorFromSigner(input.activationBinding.signer);
  const existing = await store.lookup(selector);
  if (existing.kind === 'active') {
    if (activeManifestMatchesWalletCustodyImport(existing.manifest, input, serverActivation)) {
      return { kind: 'committed', manifest: existing.manifest, material: existing.material };
    }
    return {
      kind: 'exact_record_conflict',
      selector,
      conflictDigest: await persistenceDigest(
        'custody_import_conflict',
        selector,
        'ECDSA custody import conflicts with the active manifest',
      ),
    };
  }
  try {
    const prepared = await prepareImportedWalletCustodyEcdsaContinuity(input);
    await persist(prepared);
    return {
      kind: 'committed',
      manifest: prepared.activeManifest,
      material: prepared.readyMaterial,
    };
  } catch (error: unknown) {
    if (error instanceof FinalizationControlError || isConstraintError(error)) {
      const replay = await store.lookup(selector);
      if (
        replay.kind === 'active' &&
        activeManifestMatchesWalletCustodyImport(replay.manifest, input, serverActivation)
      ) {
        return { kind: 'committed', manifest: replay.manifest, material: replay.material };
      }
      return {
        kind: 'exact_record_conflict',
        selector,
        conflictDigest: await persistenceDigest(
          'custody_import_conflict',
          selector,
          errorMessage(error),
        ),
      };
    }
    return {
      kind: 'corrupt',
      selector,
      corruptionDigest: await persistenceDigest(
        'custody_import_corrupt',
        selector,
        errorMessage(error),
      ),
    };
  }
}

export class IndexedDbEcdsaCapabilityManifestStore {
  private readonly manager: SeamsWalletDBManager;

  constructor(manager: SeamsWalletDBManager = seamsWalletDB) {
    this.manager = manager;
  }

  async admitClientPresignature(
    input: DurableClientPresignatureAdmissionInput,
  ): Promise<DurableClientPresignatureAdmissionResult> {
    if (!supportsStrictIndexedDbDurability()) return { kind: 'persistence_unavailable' };
    const poolIdentity = parseEcdsaClientPresignPoolIdentity(input.poolIdentity);
    const durableMaterialRef = parseEcdsaRoleLocalPersistedMaterialRef(
      input.durableMaterialRef,
    );
    if (!materialRefMatchesPoolIdentity(durableMaterialRef, poolIdentity)) {
      return { kind: 'persistence_unavailable' };
    }
    if (input.groupPublicKey33.length !== 33 || input.bigR33.length !== 33) {
      return { kind: 'persistence_unavailable' };
    }
    const createdAtMs = parsePresignatureTimestamp(input.createdAtMs, 'createdAtMs');
    const expiresAtMs = parsePresignatureTimestamp(input.expiresAtMs, 'expiresAtMs');
    if (
      createdAtMs > Date.now() + MAX_DURABLE_CLIENT_PRESIGNATURE_FUTURE_SKEW_MS ||
      expiresAtMs <= createdAtMs ||
      expiresAtMs > createdAtMs + MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS
    ) {
      return { kind: 'persistence_unavailable' };
    }
    const presignatureId = String(input.presignatureId || '').trim();
    if (!presignatureId || input.plaintext97.length !== 97) {
      return { kind: 'persistence_unavailable' };
    }

    let lookup: EcdsaCapabilityMaterialRefLookup;
    try {
      lookup = await this.lookupByMaterialRef(durableMaterialRef);
    } catch {
      return { kind: 'persistence_unavailable' };
    }
    if (lookup.kind !== 'active') return { kind: 'persistence_unavailable' };
    if (!activeMaterialMatchesPresignature(lookup.material, poolIdentity, durableMaterialRef)) {
      return { kind: 'persistence_unavailable' };
    }
    let sealingKey: CryptoKey | null;
    try {
      sealingKey = await this.readMaterialSealingKey(lookup.material.sealingKeyId);
    } catch {
      return { kind: 'persistence_unavailable' };
    }
    if (!sealingKey) return { kind: 'persistence_unavailable' };

    const recordId = parseDurableClientPresignatureRecordId(
      secureRandomId('ecdsa-client-presignature', 32, 'ECDSA durable presignature record'),
    );
    const groupPublicKey33B64u = parseEcdsaClientVerifyingPublicKey33B64u(
      base64UrlEncode(input.groupPublicKey33),
    );
    const bigR33B64u = parseEcdsaClientVerifyingPublicKey33B64u(base64UrlEncode(input.bigR33));
    const metadata: DurableClientPresignatureMetadata = {
      kind: 'sealed_available_client_presignature_v1',
      recordId,
      poolIdentity,
      durableMaterialRef,
      presignatureId,
      groupPublicKey33B64u,
      bigR33B64u,
      createdAtMs,
      expiresAtMs,
      sealingKeyId: lookup.material.sealingKeyId,
    };
    let encrypted: Awaited<ReturnType<typeof encryptPresignatureBytes>>;
    try {
      encrypted = await encryptPresignatureBytes({
        key: sealingKey,
        plaintext97: input.plaintext97,
        metadata,
      });
    } catch {
      input.plaintext97.fill(0);
      return { kind: 'persistence_unavailable' };
    }

    const row: SealedAvailableClientPresignatureRow = {
      kind: 'sealed_available_client_presignature_v1',
      record_id: recordId,
      pool_identity: poolIdentity,
      pool_identity_key: ecdsaClientPresignPoolKey(poolIdentity),
      wallet_id: poolIdentity.walletId,
      material_activation_id: poolIdentity.materialActivationId,
      durable_material_ref: durableMaterialRef,
      presignature_id: presignatureId,
      group_public_key33_b64u: groupPublicKey33B64u,
      big_r33_b64u: bigR33B64u,
      created_at_ms: createdAtMs,
      expires_at_ms: expiresAtMs,
      sealed: {
        kind: 'ecdsa_activation_aes_gcm_v1',
        sealing_key_id: lookup.material.sealingKeyId,
        iv12_b64u: encrypted.iv12B64u,
        ciphertext_b64u: encrypted.ciphertextB64u,
        ciphertext_digest_b64u: encrypted.ciphertextDigestB64u,
      },
    };
    try {
      const result = await this.manager.runTransaction(
        [PRESIGNATURE_STORE, MATERIAL_STORE],
        'readwrite',
        async (context) => {
          const nowMs = Date.now();
          const available = await readAvailableClientPresignatureRows(context, poolIdentity, nowMs);
          if (available.length >= ECDSA_CLIENT_PRESIGNATURE_CAPACITY) {
            return { kind: 'capacity_full' as const };
          }
          const materialRow = await context
            .store(MATERIAL_STORE)
            .get(durableMaterialRef.durableMaterialRef);
          if (materialRow === undefined) return { kind: 'persistence_unavailable' as const };
          try {
            const locator = parseMaterialLocator(materialRow);
            const materialRecord = requireRecord(materialRow, 'ECDSA role-local material row');
            // The manifest identifies the wallet capability instance; the pool names its MPC capability.
            if (
              locator.durableMaterialRef !== durableMaterialRef.durableMaterialRef ||
              locator.bindingDigest !== durableMaterialRef.bindingDigest ||
              locator.selector.capability !== lookup.manifest.signer.capability ||
              String(locator.selector.authority.walletId) !== poolIdentity.walletId ||
              parseEcdsaMaterialSealingKeyId(materialRecord.sealing_key_id) !==
                lookup.material.sealingKeyId
            ) {
              return { kind: 'persistence_unavailable' as const };
            }
          } catch {
            return { kind: 'persistence_unavailable' as const };
          }
          await context.store(PRESIGNATURE_STORE).put(row);
          return { kind: 'stored' as const };
        },
        { durability: 'strict' },
      );
      return result.kind === 'stored' ? { kind: 'stored', metadata } : result;
    } catch {
      return { kind: 'persistence_ambiguous' };
    }
  }

  async listAvailableClientPresignatures(
    poolIdentityInput: EcdsaClientPresignPoolIdentity,
  ): Promise<readonly DurableClientPresignatureMetadata[]> {
    if (!supportsStrictIndexedDbDurability()) return [];
    const poolIdentity = parseEcdsaClientPresignPoolIdentity(poolIdentityInput);
    const nowMs = Date.now();
    try {
      return await this.manager.runTransaction(
        [PRESIGNATURE_STORE],
        'readwrite',
        async (context) => {
          const rows = await readAvailableClientPresignatureRows(context, poolIdentity, nowMs);
          return rows
            .map(metadataFromPresignatureRow)
            .sort((left, right) => left.createdAtMs - right.createdAtMs);
        },
      );
    } catch {
      return [];
    }
  }

  async takeClientPresignature(input: {
    readonly recordId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  }): Promise<DurableClientPresignatureTakeResult> {
    if (!supportsStrictIndexedDbDurability()) return { kind: 'persistence_unavailable' };
    const recordId = parseDurableClientPresignatureRecordId(input.recordId);
    const poolIdentity = parseEcdsaClientPresignPoolIdentity(input.poolIdentity);
    let row: SealedAvailableClientPresignatureRow | undefined;
    try {
      const claimed = await this.manager.runTransaction(
        [PRESIGNATURE_STORE],
        'readwrite',
        async (context) => {
          const store = context.store(PRESIGNATURE_STORE);
          const raw = await store.get(recordId);
          if (raw === undefined) return { kind: 'claimed_elsewhere' as const };
          let parsed: SealedAvailableClientPresignatureRow;
          try {
            parsed = parseSealedAvailableClientPresignatureRow(raw);
          } catch {
            const malformedRecordId = rawRecordId(raw);
            if (malformedRecordId) await store.delete(malformedRecordId);
            return { kind: 'corrupt' as const };
          }
          if (!equalEcdsaClientPresignPoolIdentity(parsed.pool_identity, poolIdentity)) {
            await store.delete(recordId);
            return { kind: 'binding_rejected' as const };
          }
          if (parsed.expires_at_ms <= Date.now()) {
            await store.delete(recordId);
            return { kind: 'expired' as const };
          }
          await store.delete(recordId);
          return { kind: 'claimed' as const, row: parsed };
        },
        { durability: 'strict' },
      );
      if (claimed.kind !== 'claimed') return { kind: claimed.kind };
      row = claimed.row;
    } catch {
      return { kind: 'persistence_unavailable' };
    }

    let lookup: EcdsaCapabilityMaterialRefLookup;
    try {
      lookup = await this.lookupByMaterialRef(row.durable_material_ref);
    } catch {
      return { kind: 'persistence_unavailable' };
    }
    if (
      lookup.kind !== 'active' ||
      !activeMaterialMatchesPresignature(lookup.material, poolIdentity, row.durable_material_ref) ||
      lookup.material.sealingKeyId !== row.sealed.sealing_key_id
    ) {
      return { kind: 'binding_rejected' };
    }
    let sealingKey: CryptoKey | null;
    try {
      sealingKey = await this.readMaterialSealingKey(row.sealed.sealing_key_id);
    } catch {
      return { kind: 'persistence_unavailable' };
    }
    if (!sealingKey) return { kind: 'corrupt' };
    const metadata = metadataFromPresignatureRow(row);
    try {
      return {
        kind: 'opened',
        metadata,
        plaintext97: await decryptPresignatureBytes({
          key: sealingKey,
          metadata,
          sealed: row.sealed,
        }),
      };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  async deleteClientPresignature(input: {
    readonly recordId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  }): Promise<void> {
    const recordId = parseDurableClientPresignatureRecordId(input.recordId);
    const poolIdentity = parseEcdsaClientPresignPoolIdentity(input.poolIdentity);
    await this.manager.runTransaction([PRESIGNATURE_STORE], 'readwrite', async (context) => {
      const store = context.store(PRESIGNATURE_STORE);
      const raw = await store.get(recordId);
      if (raw === undefined) return;
      const row = parseSealedAvailableClientPresignatureRow(raw);
      if (equalEcdsaClientPresignPoolIdentity(row.pool_identity, poolIdentity)) {
        await store.delete(recordId);
      }
    });
  }

  async deleteClientPresignatures(target: EcdsaClientPresignCleanupTarget): Promise<number> {
    return await this.manager.runTransaction([PRESIGNATURE_STORE], 'readwrite', async (context) => {
      const store = context.store(PRESIGNATURE_STORE);
      let deletedCount = 0;
      switch (target.kind) {
        case 'wallet': {
          const walletId = String(target.walletId).trim();
          if (!walletId) throw new Error('ECDSA durable presignature wallet id is required');
          deletedCount = await deleteCursorRows(
            await store.index(SEAMS_WALLET_INDEXES.walletId).openCursor(walletId),
          );
          break;
        }
        case 'all':
          deletedCount = await deleteCursorRows(await store.openCursor());
          break;
      }
      return deletedCount;
    });
  }

  async listActiveWalletCapabilitySubjects(
    walletIdInput: WalletId,
  ): Promise<ActiveEcdsaWalletCapabilitySubjectListResult> {
    const parsedWalletId = parseWalletId(walletIdInput);
    if (!parsedWalletId.ok) return { kind: 'invalid_current_state' };
    let rows: readonly unknown[];
    try {
      rows = await this.manager.runTransaction([POINTER_STORE], 'readonly', (context) =>
        readPointerRowsForWallet(context, parsedWalletId.value),
      );
    } catch {
      return { kind: 'persistence_unavailable' };
    }

    const selectors: EcdsaCapabilitySelector[] = [];
    try {
      for (const row of rows) {
        const pointer = parsePointerRow(row);
        if (pointer.selector.authority.walletId === parsedWalletId.value) {
          selectors.push(pointer.selector);
        }
      }
    } catch {
      return { kind: 'invalid_current_state' };
    }

    const subjects: ActiveEcdsaWalletCapabilitySubject[] = [];
    for (const selector of selectors) {
      const lookup = await this.lookup(selector);
      if (lookup.kind === 'persistence_unavailable') {
        return { kind: 'persistence_unavailable' };
      }
      if (lookup.kind !== 'active') {
        return { kind: 'invalid_current_state' };
      }
      subjects.push({
        capability: lookup.manifest.signer.capability,
        authority: lookup.manifest.signer.authority,
        ecdsaThresholdKeyId: lookup.manifest.durableMaterial.roleLocalBinding.ecdsaThresholdKeyId,
      });
    }
    return { kind: 'resolved', subjects };
  }

  async listWalletActivationJournalSelectors(
    walletIdInput: WalletId,
  ): Promise<EcdsaWalletActivationSelectorListResult> {
    const parsedWalletId = parseWalletId(walletIdInput);
    if (!parsedWalletId.ok) return { kind: 'invalid_current_state' };
    let rows: readonly unknown[];
    try {
      rows = await this.manager.runTransaction(
        [JOURNAL_STORE],
        'readonly',
        readActivationJournalRows,
      );
    } catch {
      return { kind: 'persistence_unavailable' };
    }

    const selectors: EcdsaCapabilitySelector[] = [];
    try {
      for (const row of rows) {
        const journal = parseJournalRow(row).journal;
        const signer = journal.candidate.activationBinding.signer;
        if (signer.authority.walletId !== parsedWalletId.value) continue;
        selectors.push(selectorFromSigner(signer));
      }
    } catch {
      return { kind: 'invalid_current_state' };
    }
    return { kind: 'resolved', selectors };
  }

  async prepareActivation(
    input: PrepareEcdsaCapabilityActivationInput,
  ): Promise<EcdsaActivationJournalWriteResult<PreparedEcdsaActivationJournal>> {
    const selector = selectorFromSigner(input.activationBinding.signer);
    try {
      const keyId = parseEcdsaMaterialSealingKeyId(
        secureRandomId('ecdsa-material-key', 32, 'ECDSA activation material sealing key'),
      );
      const key = await generateMaterialSealingKey();
      const encrypted = await encryptStateBlob({
        key,
        stateBlobB64u: input.pendingPayloadB64u,
        aadProjection: pendingAadProjection(input),
      });
      const journal = buildPreparedJournalFromEncryptedCandidate({
        preparation: input,
        encryptedPending: buildEncryptedEcdsaPendingCandidate({
          sealingKeyId: keyId,
          iv12B64u: encrypted.iv12B64u,
          ciphertextB64u: encrypted.ciphertextB64u,
          ciphertextDigest: parseEcdsaPendingCiphertextDigest(encrypted.digestB64u),
        }),
      });
      await this.manager.runTransaction(
        [SEALING_KEY_STORE, JOURNAL_STORE],
        'readwrite',
        async (context) => {
          await context.store(SEALING_KEY_STORE).add(storedSealingKeyRow(keyId, key));
          await context.store(JOURNAL_STORE).add(storedJournalRow(journal));
        },
      );
      return { kind: 'stored', journal };
    } catch (error: unknown) {
      if (isConstraintError(error)) return await journalConstraintConflict(selector, error);
      if (error instanceof DOMException && error.name === 'OperationError') {
        return {
          kind: 'corrupt',
          corruptionDigest: await persistenceDigest(
            'journal_encryption_failed',
            selector,
            errorMessage(error),
          ),
        };
      }
      if (error instanceof Error && !(error instanceof DOMException)) {
        return {
          kind: 'corrupt',
          corruptionDigest: await persistenceDigest(
            'journal_preparation_invalid',
            selector,
            error.message,
          ),
        };
      }
      return {
        kind: 'persistence_unavailable',
        retryCorrelation: retryCorrelation(),
      };
    }
  }

  async recordServerActivation(
    input: RecordEcdsaServerActivationInput,
  ): Promise<EcdsaActivationJournalWriteResult<ServerCommittedEcdsaActivationJournal>> {
    let committedJournal: ServerCommittedEcdsaActivationJournal;
    try {
      committedJournal = buildServerCommittedEcdsaActivationJournal(input);
    } catch (error: unknown) {
      return {
        kind: 'corrupt',
        corruptionDigest: await persistenceDigest(
          'server_activation_commit_corrupt',
          selectorFromJournal(input.preparedJournal),
          errorMessage(error),
        ),
      };
    }
    return await this.putActivationJournal(committedJournal);
  }

  private async putActivationJournal(
    journalInput: ServerCommittedEcdsaActivationJournal,
  ): Promise<EcdsaActivationJournalWriteResult<ServerCommittedEcdsaActivationJournal>> {
    let journal: ServerCommittedEcdsaActivationJournal;
    try {
      journal = parseCommittedJournal(journalInput);
      if (
        (await ciphertextDigestB64u(journal.candidate.encryptedPending.ciphertextB64u)) !==
        journal.candidate.encryptedPending.ciphertextDigest
      ) {
        throw new Error('ECDSA pending material ciphertext digest is invalid');
      }
    } catch (error: unknown) {
      return {
        kind: 'corrupt',
        corruptionDigest: await persistenceDigest(
          'journal_input_corrupt',
          selectorFromJournal(journalInput),
          errorMessage(error),
        ),
      };
    }
    const selector = selectorFromJournal(journal);
    try {
      const sealingKey = await this.readMaterialSealingKey(
        journal.candidate.encryptedPending.sealingKeyId,
      );
      if (!sealingKey) {
        throw new FinalizationControlError(
          'corrupt',
          'ECDSA activation journal references a missing sealing key',
        );
      }
      await decryptStateBlob({
        key: sealingKey,
        iv12B64u: journal.candidate.encryptedPending.iv12B64u,
        ciphertextB64u: journal.candidate.encryptedPending.ciphertextB64u,
        aadProjection: pendingAadProjection(journal),
      });
      await this.manager.runTransaction(
        [SEALING_KEY_STORE, JOURNAL_STORE],
        'readwrite',
        async (context) => {
          const sealingKeyRaw = await context
            .store(SEALING_KEY_STORE)
            .get(journal.candidate.encryptedPending.sealingKeyId);
          if (sealingKeyRaw === undefined) {
            throw new FinalizationControlError(
              'corrupt',
              'ECDSA activation journal references a missing sealing key',
            );
          }
          try {
            parseSealingKeyRow(sealingKeyRaw);
          } catch (error: unknown) {
            throw new FinalizationControlError('corrupt', errorMessage(error));
          }
          const journalStore = context.store(JOURNAL_STORE);
          const existingRaw = await journalStore.get(journal.journalId);
          if (existingRaw === undefined) {
            throw new FinalizationControlError(
              'exact_record_conflict',
              'ECDSA committed activation is missing its prepared journal',
            );
          }
          let existing: ReturnType<typeof parseJournalRow>;
          try {
            existing = parseJournalRow(existingRaw);
          } catch (error: unknown) {
            throw new FinalizationControlError('corrupt', errorMessage(error));
          }
          if (
            !selectorsMatch(existing.selector, selector) ||
            (existing.journal.kind === 'activation_prepared' &&
              !ecdsaActivationCommitJournalsMatch(
                existing.journal,
                preparedJournalProjection(journal),
              )) ||
            (existing.journal.kind === 'server_activation_committed' &&
              !ecdsaActivationCommitJournalsMatch(existing.journal, journal))
          ) {
            throw new FinalizationControlError(
              'exact_record_conflict',
              'ECDSA activation journal conflicts with its existing correlation',
            );
          }
          await journalStore.put(storedJournalRow(journal));
        },
      );
      return {
        kind: 'stored',
        journal,
      };
    } catch (error: unknown) {
      if (error instanceof FinalizationControlError) {
        const digest = await persistenceDigest(
          error.kind === 'corrupt' ? 'journal_corrupt' : 'journal_conflict',
          selector,
          error.message,
        );
        return error.kind === 'corrupt'
          ? { kind: 'corrupt', corruptionDigest: digest }
          : { kind: 'exact_record_conflict', conflictDigest: digest };
      }
      if (isConstraintError(error)) return await journalConstraintConflict(selector, error);
      if (error instanceof DOMException && error.name === 'OperationError') {
        return {
          kind: 'corrupt',
          corruptionDigest: await persistenceDigest(
            'journal_ciphertext_corrupt',
            selector,
            errorMessage(error),
          ),
        };
      }
      return {
        kind: 'persistence_unavailable',
        retryCorrelation: retryCorrelation(),
      };
    }
  }

  async readActivationJournal(
    journalIdInput: CorrelationId,
  ): Promise<EcdsaActivationJournalReadResult> {
    const journalId = parseCorrelationId(journalIdInput);
    try {
      const raw = await this.manager.runTransaction(
        [JOURNAL_STORE],
        'readonly',
        async (context) => await context.store(JOURNAL_STORE).get(journalId),
      );
      if (raw === undefined) return { kind: 'missing' };
      try {
        const parsed = parseJournalRow(raw);
        return parsed.journal.journalId === journalId
          ? { kind: 'found', journal: parsed.journal }
          : { kind: 'corrupt' };
      } catch {
        return { kind: 'corrupt' };
      }
    } catch {
      return { kind: 'persistence_unavailable' };
    }
  }

  async discoverActivationJournal(
    selectorInput: EcdsaCapabilitySelector,
  ): Promise<EcdsaActivationJournalReadResult> {
    let selector: EcdsaCapabilitySelector;
    try {
      selector = normalizeSelector(selectorInput);
    } catch {
      return { kind: 'corrupt' };
    }
    try {
      const raw = await this.manager.runTransaction(
        [JOURNAL_STORE],
        'readonly',
        async (context) =>
          await context
            .store(JOURNAL_STORE)
            .index(SEAMS_WALLET_INDEXES.capabilityWalletAuthority)
            .get(selectorKey(selector)),
      );
      if (raw === undefined) return { kind: 'missing' };
      try {
        const parsed = parseJournalRow(raw);
        return selectorsMatch(parsed.selector, selector)
          ? { kind: 'found', journal: parsed.journal }
          : { kind: 'corrupt' };
      } catch {
        return { kind: 'corrupt' };
      }
    } catch {
      return { kind: 'persistence_unavailable' };
    }
  }

  async cancelPreparedActivation(
    preparedJournal: PreparedEcdsaActivationJournal,
  ): Promise<EcdsaPreparedActivationCancellationResult> {
    try {
      return await this.manager.runTransaction(
        [SEALING_KEY_STORE, JOURNAL_STORE],
        'readwrite',
        cancelPreparedActivationInTransaction.bind(undefined, preparedJournal),
      );
    } catch {
      return { kind: 'persistence_unavailable' };
    }
  }

  async openPreparedActivation(
    journalIdInput: CorrelationId,
  ): Promise<EcdsaPreparedActivationOpenResult> {
    const read = await this.readActivationJournal(journalIdInput);
    if (read.kind !== 'found') return read;
    const encryptedPending = read.journal.candidate.encryptedPending;
    try {
      if (
        (await ciphertextDigestB64u(encryptedPending.ciphertextB64u)) !==
        encryptedPending.ciphertextDigest
      ) {
        return { kind: 'corrupt' };
      }
      const sealingKey = await this.readMaterialSealingKey(encryptedPending.sealingKeyId);
      if (!sealingKey) return { kind: 'corrupt' };
      return {
        kind: 'found',
        journal: read.journal,
        pendingPayloadB64u: await decryptStateBlob({
          key: sealingKey,
          iv12B64u: encryptedPending.iv12B64u,
          ciphertextB64u: encryptedPending.ciphertextB64u,
          aadProjection: pendingAadProjection(read.journal),
        }),
      };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  async lookup(selectorInput: EcdsaCapabilitySelector): Promise<EcdsaCapabilityManifestLookup> {
    const selector = normalizeSelector(selectorInput);
    let observation: LookupTransactionObservation;
    try {
      observation = await this.manager.runTransaction(
        [MANIFEST_STORE, POINTER_STORE, MATERIAL_STORE, SEALING_KEY_STORE],
        'readonly',
        async (context) => await lookupInTransaction(context, selector),
      );
    } catch {
      return {
        kind: 'persistence_unavailable',
        selector,
        retryCorrelation: retryCorrelation(),
      };
    }
    switch (observation.kind) {
      case 'active':
        return observation;
      case 'retired':
        return observation;
      case 'missing':
        return {
          kind: 'missing',
          selector,
          subject: observation.subject,
        };
      case 'exact_binding_mismatch':
        return {
          kind: 'exact_binding_mismatch',
          selector,
          failureDigest: await persistenceDigest(observation.kind, selector, observation.detail),
        };
      case 'exact_record_conflict':
        return {
          kind: 'exact_record_conflict',
          selector,
          conflictDigest: await persistenceDigest(observation.kind, selector, observation.detail),
        };
      case 'corrupt':
        return {
          kind: 'corrupt',
          selector,
          corruptionDigest: await persistenceDigest(observation.kind, selector, observation.detail),
        };
    }
    return assertNever(observation);
  }

  async lookupByMaterialActivation(input: {
    readonly walletId: WalletId;
    readonly materialActivation: MpcMaterialActivationRef;
    readonly authority?: WalletAuthAuthorityRef;
  }): Promise<EcdsaCapabilityActivationLookup> {
    const walletIdResult = parseWalletId(input.walletId);
    const materialActivationResult = parseMpcMaterialActivationRef(input.materialActivation);
    const capability = materialActivationResult.ok
      ? materialActivationResult.value.capability
      : input.materialActivation.capability;
    if (!walletIdResult.ok || !materialActivationResult.ok) {
      return { kind: 'corrupt', capability };
    }
    const walletId = walletIdResult.value;
    const materialActivation = materialActivationResult.value;
    let rows: readonly unknown[];
    try {
      rows = await this.manager.runTransaction(
        [POINTER_STORE],
        'readonly',
        async (context) => await readPointerRowsForWallet(context, walletId),
      );
    } catch {
      return { kind: 'persistence_unavailable', capability };
    }

    const selectors: EcdsaCapabilitySelector[] = [];
    try {
      for (const row of rows) {
        const pointer = parsePointerRow(row);
        if (pointer.selector.authority.walletId === walletId) {
          selectors.push(pointer.selector);
        }
      }
    } catch {
      return { kind: 'corrupt', capability };
    }
    if (selectors.length === 0) {
      return { kind: 'missing', subject: 'capability', capability };
    }
    const exact: Extract<EcdsaCapabilityManifestLookup, { readonly kind: 'active' }>[] = [];
    for (const selector of selectors) {
      const lookup = await this.lookup(selector);
      switch (lookup.kind) {
        case 'active':
          if (activeLookupUsesMaterialActivation(lookup, materialActivation)) exact.push(lookup);
          break;
        case 'retired':
          break;
        case 'missing':
          return { kind: 'missing', subject: lookup.subject, capability };
        case 'exact_binding_mismatch':
        case 'exact_record_conflict':
        case 'corrupt':
        case 'persistence_unavailable':
          return { kind: lookup.kind, capability };
      }
    }
    const requested = input.authority;
    if (requested) {
      const selected = exact.filter((candidate) =>
        walletAuthAuthorityRefsMatch(candidate.manifest.signer.authority, requested),
      );
      // Two projections cannot share one authority digest: the digest is the
      // store's own selector key. More than one here is corruption, not the
      // sibling case.
      if (selected.length > 1) return { kind: 'exact_record_conflict', capability };
      return selected[0] ?? { kind: 'exact_binding_mismatch', capability };
    }
    if (exact.length > 1) {
      return {
        kind: 'ambiguous_authority',
        capability,
        authorities: exact.map((candidate) => candidate.manifest.signer.authority),
      };
    }
    return exact[0] ?? { kind: 'exact_binding_mismatch', capability };
  }

  async openActiveMaterial(
    selectorInput: EcdsaCapabilitySelector,
  ): Promise<EcdsaActiveMaterialOpenResult> {
    const selector = normalizeSelector(selectorInput);
    const lookup = await this.lookup(selector);
    if (lookup.kind !== 'active') return lookup;
    return await this.openActiveMaterialLookup(lookup);
  }

  async lookupByMaterialRef(
    materialRefInput: EcdsaRoleLocalPersistedMaterialRef,
  ): Promise<EcdsaCapabilityMaterialRefLookup> {
    const materialRef = parseEcdsaRoleLocalPersistedMaterialRef(materialRefInput);
    const capability = materialRef.materialActivation.capability;
    let raw: unknown;
    try {
      raw = await this.manager.runTransaction(
        [MATERIAL_STORE],
        'readonly',
        async (context) => await context.store(MATERIAL_STORE).get(materialRef.durableMaterialRef),
      );
    } catch {
      return { kind: 'persistence_unavailable', capability };
    }
    if (raw === undefined) return await this.lookupMissingMaterialByRef(materialRef);
    let locator: ParsedMaterialLocator;
    try {
      locator = parseMaterialLocator(raw);
    } catch {
      return { kind: 'corrupt', capability };
    }
    if (
      locator.durableMaterialRef !== materialRef.durableMaterialRef ||
      locator.bindingDigest !== materialRef.bindingDigest
    ) {
      return { kind: 'exact_binding_mismatch', capability };
    }
    const lookup = await this.lookup(locator.selector);
    switch (lookup.kind) {
      case 'active':
        if (
          lookup.manifest.durableMaterial.durableMaterialRef !== materialRef.durableMaterialRef ||
          lookup.manifest.durableMaterial.bindingDigest !== materialRef.bindingDigest ||
          !activeLookupUsesMaterialActivation(lookup, materialRef.materialActivation)
        ) {
          return { kind: 'exact_binding_mismatch', capability };
        }
        return lookup;
      case 'retired':
        return lookup;
      case 'missing':
        return {
          kind: 'missing',
          subject: lookup.subject,
          capability,
        };
      case 'exact_binding_mismatch':
      case 'exact_record_conflict':
      case 'corrupt':
      case 'persistence_unavailable':
        return { kind: lookup.kind, capability };
    }
    return assertNever(lookup);
  }

  private async lookupMissingMaterialByRef(
    materialRef: EcdsaRoleLocalPersistedMaterialRef,
  ): Promise<EcdsaCapabilityMaterialRefLookup> {
    const capability = materialRef.materialActivation.capability;
    let rows: unknown[];
    try {
      rows = await this.manager.runTransaction(
        [MANIFEST_STORE],
        'readonly',
        async (context) => await context.store(MANIFEST_STORE).getAll(),
      );
    } catch {
      return { kind: 'persistence_unavailable', capability };
    }
    const exact: ParsedManifestRow[] = [];
    let bindingMismatch = false;
    for (const raw of rows) {
      let parsed: ParsedManifestRow;
      try {
        parsed = parseManifestRow(raw);
      } catch {
        return { kind: 'corrupt', capability };
      }
      const durableMaterial = parsed.activeProof.durableMaterial;
      if (durableMaterial.durableMaterialRef !== materialRef.durableMaterialRef) continue;
      if (
        durableMaterial.bindingDigest !== materialRef.bindingDigest ||
        !mpcMaterialActivationRefsEqual(
          durableMaterial.materialActivation,
          materialRef.materialActivation,
        )
      ) {
        bindingMismatch = true;
        continue;
      }
      exact.push(parsed);
    }
    if (exact.length > 1) return { kind: 'exact_record_conflict', capability };
    const [matched] = exact;
    if (!matched) {
      return bindingMismatch
        ? { kind: 'exact_binding_mismatch', capability }
        : { kind: 'missing', subject: 'material', capability };
    }
    if (matched.state === 'replaced') {
      return { kind: 'retired', manifest: matched.manifest };
    }
    return { kind: 'missing', subject: 'material', capability };
  }

  async openActiveMaterialLookup(
    lookup: Extract<EcdsaCapabilityMaterialRefLookup, { readonly kind: 'active' }>,
  ): Promise<EcdsaActiveMaterialOpenResult> {
    const selector = selectorFromManifest(lookup.manifest);
    try {
      if (
        (await ciphertextDigestB64u(lookup.material.ciphertextB64u)) !==
        lookup.material.binding.ciphertextDigest
      ) {
        throw new Error('active ECDSA material ciphertext digest is invalid');
      }
      const sealingKey = await this.readMaterialSealingKey(lookup.material.sealingKeyId);
      if (!sealingKey) throw new Error('active ECDSA material sealing key is missing');
      return {
        kind: 'active',
        manifest: lookup.manifest,
        readyStateBlobB64u: await decryptStateBlob({
          key: sealingKey,
          iv12B64u: lookup.material.iv12B64u,
          ciphertextB64u: lookup.material.ciphertextB64u,
          aadProjection: readyAadProjection(lookup.manifest),
        }),
      };
    } catch (error: unknown) {
      return {
        kind: 'corrupt',
        selector,
        corruptionDigest: await persistenceDigest(
          'active_material_open_corrupt',
          selector,
          errorMessage(error),
        ),
      };
    }
  }

  async openActiveMaterialByRef(
    materialRefInput: EcdsaRoleLocalPersistedMaterialRef,
  ): Promise<EcdsaActiveMaterialRefOpenResult> {
    let lookup: EcdsaCapabilityMaterialRefLookup;
    try {
      lookup = await this.lookupByMaterialRef(materialRefInput);
    } catch {
      return { kind: 'corrupt' };
    }
    if (lookup.kind !== 'active') return materialRefOpenFailure(lookup);
    const opened = await this.openActiveMaterialLookup(lookup);
    return opened.kind === 'active' ? opened : materialRefOpenFailure(opened);
  }

  async sealAndFinalizeActivation(
    input: SealEcdsaCapabilityActivationInput,
  ): Promise<EcdsaCapabilityActivationFinalizationResult> {
    const selector = selectorFromJournal(input.committedJournal);
    try {
      const parsedJournal = parseCommittedJournal(input.committedJournal);
      const sealingKeyId = parsedJournal.candidate.encryptedPending.sealingKeyId;
      const sealingKey = await this.readMaterialSealingKey(sealingKeyId);
      if (!sealingKey) throw new Error('ECDSA activation material sealing key is missing');
      const encrypted = await encryptStateBlob({
        key: sealingKey,
        stateBlobB64u: input.readyStateBlobB64u,
        aadProjection: readyAadProjection(parsedJournal),
      });
      const durableMaterial = buildDurableEcdsaMaterialBinding({
        activationBinding: parsedJournal.candidate.activationBinding,
        serverActivation: parsedJournal.serverActivation,
        routerAbEcdsaDerivationNormalSigning: input.routerAbEcdsaDerivationNormalSigning,
        roleLocalPublicFacts: buildEcdsaRoleLocalPublicFacts(input.roleLocalPublicFacts),
        ciphertextDigest: parseEcdsaCiphertextDigest(encrypted.digestB64u),
        runtimePolicyScope: input.runtimePolicyScope,
      });
      const readyMaterial = buildValidatedEncryptedEcdsaReadyMaterial({
        binding: durableMaterial,
        sealingKeyId,
        iv12B64u: encrypted.iv12B64u,
        ciphertextB64u: encrypted.ciphertextB64u,
      });
      const activeManifest = buildActiveEcdsaCapabilityManifest({
        activationBinding: parsedJournal.candidate.activationBinding,
        serverActivation: parsedJournal.serverActivation,
        registeredPublicFacts: input.registeredPublicFacts,
        durableMaterial,
        committedAt: input.committedAt,
      });
      return await this.finalizeActivation({
        committedJournal: parsedJournal,
        readyMaterial,
        activeManifest,
      });
    } catch (error: unknown) {
      return {
        kind: 'corrupt',
        selector,
        corruptionDigest: await persistenceDigest(
          'activation_seal_corrupt',
          selector,
          errorMessage(error),
        ),
      };
    }
  }

  async importCommittedWalletCustodyActivation(
    input: ImportCommittedWalletCustodyEcdsaActivationInput,
  ): Promise<EcdsaCapabilityActivationFinalizationResult> {
    return await importCommittedActivation(this, input, (prepared) =>
      persistPreparedContinuity(this.manager, prepared),
    );
  }

  async persistPreparedWalletCustodyEcdsaContinuity(
    prepared: PreparedImportedWalletCustodyEcdsaContinuity,
  ): Promise<void> {
    await persistPreparedContinuity(this.manager, prepared);
  }

  private async readMaterialSealingKey(
    keyIdInput: EcdsaMaterialSealingKeyId,
  ): Promise<CryptoKey | null> {
    const keyId = parseEcdsaMaterialSealingKeyId(keyIdInput);
    const raw = await this.manager.runTransaction(
      [SEALING_KEY_STORE],
      'readonly',
      async (context) => await context.store(SEALING_KEY_STORE).get(keyId),
    );
    if (raw === undefined) return null;
    const parsed = parseSealingKeyRow(raw);
    if (parsed.keyId !== keyId) {
      throw new Error('ECDSA material sealing key row identity is inconsistent');
    }
    return parsed.key;
  }

  private async finalizeActivation(
    input: FinalizeEcdsaCapabilityActivationInput,
  ): Promise<EcdsaCapabilityActivationFinalizationResult> {
    let activeProof: ParsedActiveManifestProof;
    try {
      activeProof = assertActiveProofInput(input);
    } catch (error: unknown) {
      const selector = selectorFromJournal(input.committedJournal);
      return {
        kind: 'corrupt',
        selector,
        corruptionDigest: await persistenceDigest(
          'finalization_input_corrupt',
          selector,
          errorMessage(error),
        ),
      };
    }
    const selector = selectorFromManifest(activeProof.activeManifest);
    try {
      if (
        (await ciphertextDigestB64u(input.readyMaterial.ciphertextB64u)) !==
        input.readyMaterial.binding.ciphertextDigest
      ) {
        throw new FinalizationControlError(
          'corrupt',
          'ECDSA ready material ciphertext digest is invalid',
        );
      }
      const sealingKey = await this.readMaterialSealingKey(input.readyMaterial.sealingKeyId);
      if (!sealingKey) {
        throw new FinalizationControlError(
          'corrupt',
          'ECDSA ready material sealing key is missing',
        );
      }
      await decryptStateBlob({
        key: sealingKey,
        iv12B64u: input.readyMaterial.iv12B64u,
        ciphertextB64u: input.readyMaterial.ciphertextB64u,
        aadProjection: readyAadProjection(input.committedJournal),
      });
      await this.manager.runTransaction(
        [
          MANIFEST_STORE,
          POINTER_STORE,
          MATERIAL_STORE,
          JOURNAL_STORE,
          SEALING_KEY_STORE,
          PRESIGNATURE_STORE,
        ],
        'readwrite',
        async (context) => {
          await finalizeInTransaction(context, input, activeProof, selector);
        },
      );
      return {
        kind: 'committed',
        manifest: activeProof.activeManifest,
        material: input.readyMaterial,
      };
    } catch (error: unknown) {
      if (error instanceof FinalizationControlError) {
        const digest = await persistenceDigest(
          error.kind === 'corrupt' ? 'finalization_corrupt' : 'finalization_conflict',
          selector,
          error.message,
        );
        return error.kind === 'corrupt'
          ? {
              kind: 'corrupt',
              selector,
              corruptionDigest: digest,
            }
          : {
              kind: 'exact_record_conflict',
              selector,
              conflictDigest: digest,
            };
      }
      if (isConstraintError(error)) {
        return {
          kind: 'exact_record_conflict',
          selector,
          conflictDigest: await persistenceDigest(
            'finalization_constraint_conflict',
            selector,
            errorMessage(error),
          ),
        };
      }
      return {
        kind: 'persistence_unavailable',
        selector,
        retryCorrelation: retryCorrelation(),
      };
    }
  }
}

async function finalizeInTransaction(
  context: SeamsWalletTransactionContext,
  input: FinalizeEcdsaCapabilityActivationInput,
  activeProof: ParsedActiveManifestProof,
  selector: EcdsaCapabilitySelector,
): Promise<void> {
  const journalStore = context.store(JOURNAL_STORE);
  const journalRaw = await journalStore.get(input.committedJournal.journalId);
  if (journalRaw === undefined) {
    throw new FinalizationControlError(
      'exact_record_conflict',
      'ECDSA finalization is missing its durable activation journal',
    );
  }
  let persistedJournal: ReturnType<typeof parseJournalRow>;
  try {
    persistedJournal = parseJournalRow(journalRaw);
  } catch (error: unknown) {
    throw new FinalizationControlError('corrupt', errorMessage(error));
  }
  if (
    persistedJournal.journal.kind !== 'server_activation_committed' ||
    !selectorsMatch(persistedJournal.selector, selector) ||
    !ecdsaActivationCommitJournalsMatch(persistedJournal.journal, input.committedJournal)
  ) {
    throw new FinalizationControlError(
      'exact_record_conflict',
      'ECDSA finalization journal does not match its committed activation',
    );
  }
  const sealingKeyRaw = await context
    .store(SEALING_KEY_STORE)
    .get(input.readyMaterial.sealingKeyId);
  if (sealingKeyRaw === undefined) {
    throw new FinalizationControlError(
      'corrupt',
      'ECDSA finalization is missing its material sealing key',
    );
  }
  try {
    parseSealingKeyRow(sealingKeyRaw);
  } catch (error: unknown) {
    throw new FinalizationControlError('corrupt', errorMessage(error));
  }

  const pointerStore = context.store(POINTER_STORE);
  const pointerRaw = await pointerStore.get(selectorKey(selector));
  const expected = input.committedJournal.expectedManifest;
  const currentPointer = assertExpectedPointer(expected, pointerRaw, selector);
  const activeRows = await readActiveManifestRows(context, selector);

  let previousProof: ParsedActiveManifestProof | null = null;
  let previousSealingKeyId: EcdsaMaterialSealingKeyId | null = null;
  if (currentPointer === null) {
    if (activeRows.length !== 0) {
      throw new FinalizationControlError(
        'exact_record_conflict',
        'initial ECDSA activation found an unpointed active manifest',
      );
    }
  } else {
    if (activeRows.length !== 1) {
      throw new FinalizationControlError(
        'exact_record_conflict',
        'replacement ECDSA activation found conflicting current manifests',
      );
    }
    let previousManifest: ParsedManifestRow;
    try {
      previousManifest = parseManifestRow(activeRows[0]);
    } catch (error: unknown) {
      throw new FinalizationControlError('corrupt', errorMessage(error));
    }
    if (
      previousManifest.state !== 'active' ||
      previousManifest.manifest.identity.manifestId !== currentPointer.manifestId
    ) {
      throw new FinalizationControlError(
        'exact_record_conflict',
        'replacement ECDSA activation current manifest does not match its pointer',
      );
    }
    if (
      input.committedJournal.activationCommand.expectedGeneration.kind !== 'exact_generation' ||
      previousManifest.activeProof.serverActivation.serverGeneration !==
        input.committedJournal.activationCommand.expectedGeneration.serverGeneration
    ) {
      throw new FinalizationControlError(
        'exact_record_conflict',
        'replacement ECDSA activation server generation CAS did not match',
      );
    }
    const previousMaterialRaw = await context
      .store(MATERIAL_STORE)
      .get(previousManifest.manifest.durableMaterial.durableMaterialRef);
    if (previousMaterialRaw === undefined) {
      throw new FinalizationControlError(
        'corrupt',
        'replacement ECDSA activation is missing prior material',
      );
    }
    try {
      const previousMaterial = parseMaterialRow(previousMaterialRaw, previousManifest.activeProof);
      if (!materialMatchesManifest(previousMaterial, previousManifest.manifest)) {
        throw new Error('prior ECDSA material does not match its active manifest');
      }
      if (previousMaterial.sealingKeyId === input.readyMaterial.sealingKeyId) {
        throw new Error('replacement ECDSA activation must use a fresh material sealing key');
      }
      previousSealingKeyId = previousMaterial.sealingKeyId;
    } catch (error: unknown) {
      throw new FinalizationControlError('corrupt', errorMessage(error));
    }
    previousProof = previousManifest.activeProof;
  }

  const manifestStore = context.store(MANIFEST_STORE);
  const materialStore = context.store(MATERIAL_STORE);
  if (previousProof) {
    if (!previousSealingKeyId) {
      throw new FinalizationControlError(
        'corrupt',
        'replacement ECDSA activation is missing its prior sealing key identity',
      );
    }
    await retireClientPresignaturesForActivationInTransaction(
      context,
      String(previousProof.durableMaterial.materialActivation.materialOwner),
      String(previousProof.durableMaterial.materialActivation.activationId),
    );
    await manifestStore.put(storedReplacedManifestRow(previousProof, activeProof));
    await materialStore.delete(previousProof.durableMaterial.durableMaterialRef);
    await context.store(SEALING_KEY_STORE).delete(previousSealingKeyId);
  }
  await materialStore.add(storedMaterialRow(input.readyMaterial, activeProof.activeManifest));
  await manifestStore.add(storedActiveManifestRow(activeProof));
  await pointerStore.put(storedPointerRow(activeProof.activeManifest));
  await journalStore.delete(input.committedJournal.journalId);
}
