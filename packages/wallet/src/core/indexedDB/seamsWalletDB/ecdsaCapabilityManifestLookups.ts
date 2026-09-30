// What the ECDSA capability store reports, and the reads a lookup makes inside one transaction.
import { base64UrlEncode } from '@shared/utils/base64';
import {
  parseCorrelationId,
  parseDigestB64u,
  type CorrelationId,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import {
  mpcMaterialActivationRefsEqual,
  type CapabilityInstanceRef,
  type MpcMaterialActivationRef,
  type WalletId,
} from '@shared/utils/domainIds';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import { parseEcdsaThresholdKeyId } from '@/core/signingEngine/session/keyMaterialBrands';
import type {
  ActiveEcdsaCapabilityManifest,
  EcdsaCapabilityActivationCommitJournal,
  ReplacedEcdsaCapabilityManifest,
  ValidatedEncryptedEcdsaReadyMaterial,
} from '@/core/signingEngine/session/material/ecdsaCapabilityManifest';
import { SEAMS_WALLET_INDEXES } from '../schemaNames';
import type { SeamsWalletTransactionContext } from './manager';
import {
  MANIFEST_STORE,
  POINTER_STORE,
  MATERIAL_STORE,
  JOURNAL_STORE,
  SEALING_KEY_STORE,
  type EcdsaCapabilitySelector,
  type ParsedManifestRow,
  type ParsedPointerRow,
  selectorKey,
  selectorColumns,
  selectorsMatch,
  ciphertextDigestB64u,
  parseManifestRow,
  parsePointerRow,
  parseMaterialRow,
  materialMatchesManifest,
  parseSealingKeyRow,
  assertNever,
} from './ecdsaCapabilityManifestRecords';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type ActiveEcdsaWalletCapabilitySubject = EcdsaCapabilitySelector & {
  readonly ecdsaThresholdKeyId: ReturnType<typeof parseEcdsaThresholdKeyId>;
};

export type ActiveEcdsaWalletCapabilitySubjectListResult = ReadonlyExclusiveUnion<
  | { readonly kind: 'resolved'; readonly subjects: readonly ActiveEcdsaWalletCapabilitySubject[] }
  | { readonly kind: 'invalid_current_state' }
  | { readonly kind: 'persistence_unavailable' }
>;

export type EcdsaWalletActivationSelectorListResult = ReadonlyExclusiveUnion<
  | { readonly kind: 'resolved'; readonly selectors: readonly EcdsaCapabilitySelector[] }
  | { readonly kind: 'invalid_current_state' }
  | { readonly kind: 'persistence_unavailable' }
>;

type LookupFailureExclusions = {
  readonly manifest?: never;
  readonly material?: never;
};

// The failures a lookup and a finalization both report for one exact selector.
type EcdsaSelectorFailure =
  | ({
      readonly kind: 'exact_record_conflict';
      readonly selector: EcdsaCapabilitySelector;
      readonly conflictDigest: DigestB64u;
    } & LookupFailureExclusions)
  | ({
      readonly kind: 'corrupt';
      readonly selector: EcdsaCapabilitySelector;
      readonly corruptionDigest: DigestB64u;
    } & LookupFailureExclusions)
  | ({
      readonly kind: 'persistence_unavailable';
      readonly selector: EcdsaCapabilitySelector;
      readonly retryCorrelation: CorrelationId;
    } & LookupFailureExclusions);

export type EcdsaCapabilityManifestLookup =
  | {
      readonly kind: 'active';
      readonly manifest: ActiveEcdsaCapabilityManifest;
      readonly material: ValidatedEncryptedEcdsaReadyMaterial;
    }
  | {
      readonly kind: 'retired';
      readonly manifest: ReplacedEcdsaCapabilityManifest;
      readonly material?: never;
    }
  | ({
      readonly kind: 'missing';
      readonly selector: EcdsaCapabilitySelector;
      readonly subject: 'capability' | 'material';
    } & LookupFailureExclusions)
  | ({
      readonly kind: 'exact_binding_mismatch';
      readonly selector: EcdsaCapabilitySelector;
      readonly failureDigest: DigestB64u;
    } & LookupFailureExclusions)
  | EcdsaSelectorFailure;

export type EcdsaActivationJournalWriteResult<
  TJournal extends EcdsaCapabilityActivationCommitJournal = EcdsaCapabilityActivationCommitJournal,
> =
  | {
      readonly kind: 'stored';
      readonly journal: TJournal;
    }
  | {
      readonly kind: 'exact_record_conflict';
      readonly conflictDigest: DigestB64u;
      readonly journal?: never;
    }
  | {
      readonly kind: 'corrupt';
      readonly corruptionDigest: DigestB64u;
      readonly journal?: never;
    }
  | {
      readonly kind: 'persistence_unavailable';
      readonly retryCorrelation: CorrelationId;
      readonly journal?: never;
    };

export type EcdsaActivationJournalReadResult =
  | {
      readonly kind: 'found';
      readonly journal: EcdsaCapabilityActivationCommitJournal;
    }
  | {
      readonly kind: 'missing' | 'corrupt' | 'persistence_unavailable';
      readonly journal?: never;
    };

export type EcdsaPreparedActivationOpenResult = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'found';
      readonly journal: EcdsaCapabilityActivationCommitJournal;
      readonly pendingPayloadB64u: string;
    }
  | { readonly kind: 'missing' | 'corrupt' | 'persistence_unavailable' }
>;

type OpenedEcdsaActiveMaterial = {
  readonly kind: 'active';
  readonly manifest: ActiveEcdsaCapabilityManifest;
  readonly readyStateBlobB64u: string;
};

export type EcdsaActiveMaterialOpenResult =
  | OpenedEcdsaActiveMaterial
  | Exclude<EcdsaCapabilityManifestLookup, { readonly kind: 'active' }>;

export type EcdsaActiveMaterialRefOpenResult =
  | OpenedEcdsaActiveMaterial
  | {
      readonly kind: 'missing' | 'binding_mismatch' | 'corrupt' | 'persistence_unavailable';
      readonly manifest?: never;
      readonly readyStateBlobB64u?: never;
    };

type EcdsaCapabilityMaterialRefLookupFailure =
  | {
      readonly kind: 'missing';
      readonly subject: 'capability' | 'material';
      readonly capability: CapabilityInstanceRef;
    }
  | {
      readonly kind:
        | 'exact_binding_mismatch'
        | 'exact_record_conflict'
        | 'corrupt'
        | 'persistence_unavailable';
      readonly capability: CapabilityInstanceRef;
      readonly subject?: never;
    };

export type EcdsaCapabilityMaterialRefLookup =
  | Extract<EcdsaCapabilityManifestLookup, { readonly kind: 'active' | 'retired' }>
  | EcdsaCapabilityMaterialRefLookupFailure;

/**
 * One cryptographic activation can back several exact method-bound
 * access projections, one per wallet auth method installed on the same wallet
 * authority. A material activation therefore no longer names one manifest.
 * A caller that does not say which method it is acting as gets
 * `ambiguous_authority` and must ask again with the exact authority; picking a
 * sibling here would silently sign under a credential the caller never named.
 */
export type EcdsaCapabilityActivationLookup =
  | EcdsaCapabilityMaterialRefLookup
  | {
      readonly kind: 'ambiguous_authority';
      readonly capability: CapabilityInstanceRef;
      readonly authorities: readonly WalletAuthAuthorityRef[];
      readonly subject?: never;
    };

export type EcdsaCapabilityActivationFinalizationResult =
  | {
      readonly kind: 'committed';
      readonly manifest: ActiveEcdsaCapabilityManifest;
      readonly material: ValidatedEncryptedEcdsaReadyMaterial;
    }
  | EcdsaSelectorFailure;

export type LookupTransactionObservation =
  | {
      readonly kind: 'active';
      readonly manifest: ActiveEcdsaCapabilityManifest;
      readonly material: ValidatedEncryptedEcdsaReadyMaterial;
    }
  | {
      readonly kind: 'retired';
      readonly manifest: ReplacedEcdsaCapabilityManifest;
    }
  | {
      readonly kind: 'missing';
      readonly subject: 'capability' | 'material';
      readonly detail: string;
    }
  | {
      readonly kind: 'exact_binding_mismatch' | 'exact_record_conflict' | 'corrupt';
      readonly detail: string;
    };

export async function persistenceDigest(
  category: string,
  selector: EcdsaCapabilitySelector,
  detail: string,
): Promise<DigestB64u> {
  const canonical = alphabetizeStringify({ category, ...selectorColumns(selector), detail });
  return parseDigestB64u(base64UrlEncode(await sha256BytesUtf8(canonical)));
}

export async function journalConstraintConflict(
  selector: EcdsaCapabilitySelector,
  error: unknown,
): Promise<{ readonly kind: 'exact_record_conflict'; readonly conflictDigest: DigestB64u }> {
  return {
    kind: 'exact_record_conflict',
    conflictDigest: await persistenceDigest(
      'journal_constraint_conflict',
      selector,
      ecdsaManifestErrorMessage(error),
    ),
  };
}

export function retryCorrelation(): CorrelationId {
  return parseCorrelationId(
    secureRandomId('ecdsa-persistence-retry', 16, 'ECDSA persistence retry correlations'),
  );
}

export function ecdsaManifestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isConstraintError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'ConstraintError';
}

export async function readPointerRowsForWallet(
  context: SeamsWalletTransactionContext,
  walletId: WalletId,
): Promise<readonly unknown[]> {
  return await context.store(POINTER_STORE).index(SEAMS_WALLET_INDEXES.walletId).getAll(walletId);
}

export async function readActivationJournalRows(
  context: SeamsWalletTransactionContext,
): Promise<readonly unknown[]> {
  return await context.store(JOURNAL_STORE).getAll();
}

export async function readActiveManifestRows(
  context: SeamsWalletTransactionContext,
  selector: EcdsaCapabilitySelector,
): Promise<readonly unknown[]> {
  return await context
    .store(MANIFEST_STORE)
    .index(SEAMS_WALLET_INDEXES.capabilityWalletAuthorityState)
    .getAll([...selectorKey(selector), 'active']);
}

export function activeLookupUsesMaterialActivation(
  lookup: Extract<EcdsaCapabilityManifestLookup, { readonly kind: 'active' }>,
  materialActivation: MpcMaterialActivationRef,
): boolean {
  return (
    mpcMaterialActivationRefsEqual(
      lookup.manifest.activation.materialActivation,
      materialActivation,
    ) &&
    mpcMaterialActivationRefsEqual(
      lookup.manifest.durableMaterial.materialActivation,
      materialActivation,
    ) &&
    mpcMaterialActivationRefsEqual(lookup.material.binding.materialActivation, materialActivation)
  );
}

export function materialRefOpenFailure(
  failure:
    | Exclude<EcdsaCapabilityMaterialRefLookup, { readonly kind: 'active' }>
    | Exclude<EcdsaActiveMaterialOpenResult, { readonly kind: 'active' }>,
): EcdsaActiveMaterialRefOpenResult {
  switch (failure.kind) {
    case 'missing':
    case 'retired':
      return { kind: 'missing' };
    case 'exact_binding_mismatch':
      return { kind: 'binding_mismatch' };
    case 'exact_record_conflict':
    case 'corrupt':
      return { kind: 'corrupt' };
    case 'persistence_unavailable':
      return { kind: 'persistence_unavailable' };
  }
  return assertNever(failure);
}

export async function lookupInTransaction(
  context: SeamsWalletTransactionContext,
  selector: EcdsaCapabilitySelector,
): Promise<LookupTransactionObservation> {
  const pointerRaw = await context.store(POINTER_STORE).get(selectorKey(selector));
  if (pointerRaw === undefined) {
    return await lookupWithoutPointer(context, selector);
  }
  let pointer: ParsedPointerRow;
  try {
    pointer = parsePointerRow(pointerRaw);
  } catch (error: unknown) {
    return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
  }
  if (!selectorsMatch(pointer.selector, selector)) {
    return {
      kind: 'exact_binding_mismatch',
      detail: 'current ECDSA pointer belongs to a different exact authority',
    };
  }
  const manifestRaw = await context.store(MANIFEST_STORE).get(pointer.manifestId);
  if (manifestRaw === undefined) {
    return {
      kind: 'exact_record_conflict',
      detail: 'current ECDSA pointer references a missing manifest',
    };
  }
  let parsedManifest: ParsedManifestRow;
  try {
    parsedManifest = parseManifestRow(manifestRaw);
  } catch (error: unknown) {
    return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
  }
  if (!selectorsMatch(parsedManifest.selector, selector)) {
    return {
      kind: 'exact_binding_mismatch',
      detail: 'current ECDSA manifest belongs to a different exact authority',
    };
  }
  if (
    parsedManifest.manifest.identity.manifestId !== pointer.manifestId ||
    parsedManifest.manifest.identity.manifestRevision !== pointer.manifestRevision
  ) {
    return {
      kind: 'exact_record_conflict',
      detail: 'current ECDSA pointer does not match its manifest identity',
    };
  }
  if (parsedManifest.state === 'replaced') {
    return {
      kind: 'retired',
      manifest: parsedManifest.manifest,
    };
  }
  const activeRows = await readActiveManifestRows(context, selector);
  if (activeRows.length !== 1) {
    return {
      kind: 'exact_record_conflict',
      detail: 'exact ECDSA authority has multiple current manifests',
    };
  }
  let indexedActive: ParsedManifestRow;
  try {
    indexedActive = parseManifestRow(activeRows[0]);
  } catch (error: unknown) {
    return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
  }
  if (
    indexedActive.state !== 'active' ||
    indexedActive.manifest.identity.manifestId !== pointer.manifestId
  ) {
    return {
      kind: 'exact_record_conflict',
      detail: 'exact ECDSA current index disagrees with its pointer',
    };
  }
  const materialRaw = await context
    .store(MATERIAL_STORE)
    .get(parsedManifest.manifest.durableMaterial.durableMaterialRef);
  if (materialRaw === undefined) {
    return {
      kind: 'missing',
      subject: 'material',
      detail: 'active ECDSA manifest is missing its ready material',
    };
  }
  let material: ValidatedEncryptedEcdsaReadyMaterial;
  try {
    material = parseMaterialRow(materialRaw, parsedManifest.activeProof);
  } catch (error: unknown) {
    return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
  }
  if (!materialMatchesManifest(material, parsedManifest.manifest)) {
    return {
      kind: 'exact_binding_mismatch',
      detail: 'active ECDSA material does not match its manifest',
    };
  }
  const sealingKeyRaw = await context.store(SEALING_KEY_STORE).get(material.sealingKeyId);
  if (sealingKeyRaw === undefined) {
    return {
      kind: 'missing',
      subject: 'material',
      detail: 'active ECDSA material is missing its sealing key',
    };
  }
  try {
    const sealingKey = parseSealingKeyRow(sealingKeyRaw);
    if (sealingKey.keyId !== material.sealingKeyId) {
      return {
        kind: 'exact_binding_mismatch',
        detail: 'active ECDSA material sealing key id does not match',
      };
    }
  } catch (error: unknown) {
    return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
  }
  if ((await ciphertextDigestB64u(material.ciphertextB64u)) !== material.binding.ciphertextDigest) {
    return {
      kind: 'corrupt',
      detail: 'active ECDSA material ciphertext digest is invalid',
    };
  }
  return {
    kind: 'active',
    manifest: parsedManifest.manifest,
    material,
  };
}

async function lookupWithoutPointer(
  context: SeamsWalletTransactionContext,
  selector: EcdsaCapabilitySelector,
): Promise<LookupTransactionObservation> {
  const rows = await context
    .store(MANIFEST_STORE)
    .index(SEAMS_WALLET_INDEXES.capabilityWallet)
    .getAll([String(selector.capability), String(selector.authority.walletId)]);
  if (rows.length === 0) {
    return {
      kind: 'missing',
      subject: 'capability',
      detail: 'no ECDSA capability manifest exists',
    };
  }
  let hasDifferentAuthority = false;
  let hasExactAuthority = false;
  let hasSameMethodUnderAnotherDigest = false;
  for (const raw of rows) {
    let parsed: ParsedManifestRow;
    try {
      parsed = parseManifestRow(raw);
    } catch (error: unknown) {
      return { kind: 'corrupt', detail: ecdsaManifestErrorMessage(error) };
    }
    if (selectorsMatch(parsed.selector, selector)) {
      hasExactAuthority = true;
      continue;
    }
    hasDifferentAuthority = true;
    // A sibling differs in BOTH method id and digest, because the digest covers
    // the method's factor and binding id. Same method id under a different
    // digest is a ref disagreeing with itself, which is a real binding conflict
    // and must not be softened into "this method simply has none".
    if (parsed.selector.authority.walletAuthMethodId === selector.authority.walletAuthMethodId) {
      hasSameMethodUnderAnotherDigest = true;
    }
  }
  if (hasExactAuthority) {
    return {
      kind: 'exact_record_conflict',
      detail: 'exact ECDSA authority has manifest history without a current pointer',
    };
  }
  if (hasSameMethodUnderAnotherDigest) {
    return {
      kind: 'exact_binding_mismatch',
      detail: 'ECDSA capability exists for this method under a different authority digest',
    };
  }
  if (hasDifferentAuthority) {
    // A sibling method on the same wallet authority holding its own
    // projection is the ordinary state, not a mismatch. The question asked was
    // whether THIS authority has one, and it does not. Reporting a mismatch
    // here would make installing the second method's access look like
    // corruption; whether the two methods may share custody at all is settled
    // by the membership check at the copy boundary, not by this scan.
    return {
      kind: 'missing',
      subject: 'capability',
      detail: 'no ECDSA capability manifest exists for this exact authority',
    };
  }
  return {
    kind: 'missing',
    subject: 'capability',
    detail: 'no exact ECDSA capability manifest exists',
  };
}
