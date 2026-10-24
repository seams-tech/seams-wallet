import { exactRecord } from '../utils/exactRecord';
import {
  parseLinkedDeviceMlDsaExportRootPackageV1,
  type LinkedDeviceMlDsaExportRootPackageV1,
} from './mlDsaExportRoot';
import {
  parseExactAdministeredMlDsa65SignerV1,
  type ExactAdministeredMlDsa65SignerV1,
} from './delegatedActivationPlan';
import type { DeviceId } from '../authorization/capabilityKinds';
import type { CanonicalDelegatedWalletPermissionSetV1 } from '../authorization/delegatedAuthority';
import type { PendingWalletAuthorityV1 } from '../authorization/walletAuthority';
import {
  parseMpcMaterialActivationRef,
  mpcMaterialActivationRefsEqual,
  type LinkDeviceSessionId,
  type LinkedDeviceEnrollmentId,
  type MpcMaterialActivationRef,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from '../utils/domainIds';
import {
  parseDigestB64u,
  sha256Utf8DigestB64u,
  type DigestB64u,
} from '../utils/canonicalPrimitives';
import { alphabetizeStringify } from '../utils/digests';
import {
  parseWalletAuthMethodRecordV2,
  type PendingWalletAuthMethodRecordV2,
} from '../utils/walletAuthMethodRecord';
import { parseWalletAuthorityV1 } from '../authorization/walletAuthority';
import {
  parseLinkedDeviceEd25519ExportRootPackageV1,
  type LinkedDeviceEd25519ExportRootPackageV1,
} from './ed25519ExportRoot';
import {
  parseLinkedDeviceEcdsaEncryptedSourceContributionV1,
  parseLinkedDeviceEcdsaSourcePreservingActivationReceiptV1,
  type LinkedDeviceEcdsaEncryptedSourceContributionV1,
  type LinkedDeviceEcdsaSourcePreservingActivationReceiptV1,
} from './sourceContribution';
import {
  parseRouterAbEd25519YaoEncryptedPackageV1,
  parseRouterAbEd25519YaoActivationPublicReceiptV1,
  parseRouterAbEd25519YaoApplicationBindingFactsV1,
  parseRouterAbEd25519YaoCeremonyBindingV1,
  parseRouterAbEd25519YaoParticipantIdsV1,
  sameRouterAbEd25519YaoByteSequence,
  type RouterAbEd25519YaoApplicationBindingFactsV1,
  type RouterAbEd25519YaoActivationPublicReceiptV1,
  type RouterAbEd25519YaoActivationClientPackageV1,
  type RouterAbEd25519YaoCeremonyBindingV1,
} from '../utils/routerAbEd25519Yao';
import { routerAbMpcMaterialActivationRefFromWire } from '../utils/routerAbNormalSigningIdentity';
import type { ReadonlyExclusiveUnion } from '../utils/variant';

const COMMITTED_SIGNER_PACKAGE_DOMAIN_V1 = 'seams/wallet/committed-signer-package/v1' as const;
const COMMITTED_SIGNER_PACKAGE_SET_DOMAIN_V1 =
  'seams/wallet/committed-signer-package-set/v1' as const;

export type CommittedEd25519SignerPackageV1 = {
  readonly kind: 'committed_ed25519_signer_package_v1';
  readonly materialActivation: MpcMaterialActivationRef;
  readonly targetBinding: RouterAbEd25519YaoCeremonyBindingV1;
  readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
  readonly participantIds: readonly [number, number];
  readonly activationReceipt: RouterAbEd25519YaoActivationPublicReceiptV1;
  readonly deriver_a_client_package: RouterAbEd25519YaoActivationClientPackageV1<'deriver_a'>;
  readonly deriver_b_client_package: RouterAbEd25519YaoActivationClientPackageV1<'deriver_b'>;
};

export type CommittedEcdsaSignerPackageV1 = {
  readonly kind: 'committed_ecdsa_signer_package_v1';
  readonly materialActivation: MpcMaterialActivationRef;
  readonly encryptedTargetClientShare: LinkedDeviceEcdsaEncryptedSourceContributionV1;
  readonly activationReceipt: LinkedDeviceEcdsaSourcePreservingActivationReceiptV1;
};

export type CommittedMlDsaSignerPackageV1 = {
  readonly kind: 'committed_ml_dsa_65_signer_package_v1';
  readonly signer: ExactAdministeredMlDsa65SignerV1;
  readonly exportRoot: LinkedDeviceMlDsaExportRootPackageV1;
};

export type CommittedSignerPackageSetV1 = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ed25519'];
      readonly ed25519: CommittedEd25519SignerPackageV1;
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ecdsa_secp256k1'];
      readonly ecdsa: CommittedEcdsaSignerPackageV1;
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'];
      readonly ed25519: CommittedEd25519SignerPackageV1;
      readonly ecdsa: CommittedEcdsaSignerPackageV1;
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ml_dsa_65'];
      readonly mlDsa: readonly [CommittedMlDsaSignerPackageV1, ...CommittedMlDsaSignerPackageV1[]];
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ml_dsa_65'];
      readonly ed25519: CommittedEd25519SignerPackageV1;
      readonly mlDsa: readonly [CommittedMlDsaSignerPackageV1, ...CommittedMlDsaSignerPackageV1[]];
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ecdsa_secp256k1', 'ml_dsa_65'];
      readonly ecdsa: CommittedEcdsaSignerPackageV1;
      readonly mlDsa: readonly [CommittedMlDsaSignerPackageV1, ...CommittedMlDsaSignerPackageV1[]];
    }
  | {
      readonly kind: 'committed_signer_package_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1', 'ml_dsa_65'];
      readonly ed25519: CommittedEd25519SignerPackageV1;
      readonly ecdsa: CommittedEcdsaSignerPackageV1;
      readonly mlDsa: readonly [CommittedMlDsaSignerPackageV1, ...CommittedMlDsaSignerPackageV1[]];
    }
>;

export type CommittedAuthorityPackagesV1 = {
  readonly kind: 'committed_authority_packages_v1';
  readonly authority: PendingWalletAuthorityV1;
  readonly authMethod: Exclude<PendingWalletAuthMethodRecordV2, { readonly kind: 'voiceid' }>;
  readonly signerPackages: CommittedSignerPackageSetV1;
  readonly ed25519ExportRootPackage: LinkedDeviceEd25519ExportRootPackageV1 | null;
  readonly packageSetDigestB64u: DigestB64u;
};

type CommittedAuthorityPackagesWireV1 = {
  readonly kind: unknown;
  readonly authority: unknown;
  readonly authMethod: unknown;
  readonly signerPackages: unknown;
  readonly ed25519ExportRootPackage: unknown;
  readonly packageSetDigestB64u: unknown;
};

type CommittedEd25519SignerPackageWireV1 = {
  readonly kind: unknown;
  readonly materialActivation: unknown;
  readonly targetBinding: unknown;
  readonly applicationBinding: unknown;
  readonly participantIds: unknown;
  readonly activationReceipt: unknown;
  readonly deriver_a_client_package: unknown;
  readonly deriver_b_client_package: unknown;
};

type CommittedEcdsaSignerPackageWireV1 = {
  readonly kind: unknown;
  readonly materialActivation: unknown;
  readonly encryptedTargetClientShare: unknown;
  readonly activationReceipt: unknown;
};

export function parseCommittedAuthorityPackagesV1(raw: unknown): CommittedAuthorityPackagesV1 {
  const record = parseCommittedAuthorityPackagesWireV1(raw);
  if (record.kind !== 'committed_authority_packages_v1') {
    throw new Error('CommittedAuthorityPackagesV1.kind is invalid');
  }
  const authority = parseWalletAuthorityV1(record.authority);
  if (!authority.ok || authority.value.state !== 'pending_local_install') {
    throw new Error('CommittedAuthorityPackagesV1.authority is not pending');
  }
  const authMethod = parseWalletAuthMethodRecordV2(record.authMethod);
  if (
    !authMethod ||
    authMethod.status !== 'pending_local_install' ||
    authMethod.kind === 'voiceid'
  ) {
    throw new Error('CommittedAuthorityPackagesV1.authMethod is not pending');
  }
  if (
    authMethod.walletId !== authority.value.walletId ||
    authMethod.walletAuthorityId !== authority.value.authorityId
  ) {
    throw new Error('CommittedAuthorityPackagesV1 authority and auth method identities differ');
  }
  const signerPackages = parseCommittedSignerPackageSetV1(record.signerPackages);
  assertSignerPackagesMatchAuthority(signerPackages, authority.value.signerActivations);
  const ed25519ExportRootPackage =
    record.ed25519ExportRootPackage === null
      ? null
      : parseLinkedDeviceEd25519ExportRootPackageV1(record.ed25519ExportRootPackage);
  if (ed25519ExportRootPackage) {
    if (
      ed25519ExportRootPackage.walletId !== authority.value.walletId ||
      ed25519ExportRootPackage.revocationEpoch !== authority.value.revocationEpoch ||
      authority.value.provenance.kind !== 'device_link' ||
      ed25519ExportRootPackage.enrollmentId !== authority.value.provenance.enrollmentId ||
      ed25519ExportRootPackage.linkSessionId !== authority.value.provenance.linkSessionId ||
      String(ed25519ExportRootPackage.deviceId) !== String(authority.value.principal.deviceId)
    ) {
      throw new Error('CommittedAuthorityPackagesV1 export root identity does not match authority');
    }
  }
  for (const entry of signerPackages.mlDsa ?? []) {
    const binding = entry.exportRoot.binding;
    const root = binding.root;
    const target = authority.value;
    if (
      !target.permissions.includes('export_keys') ||
      target.provenance.kind !== 'device_link' ||
      binding.walletId !== target.walletId ||
      binding.walletAuthMethodId !== authMethod.walletAuthMethodId ||
      root.targetFactor.kind !== (authMethod.kind === 'passkey' ? 'passkey_prf' : 'email_otp') ||
      root.revocationEpoch !== target.revocationEpoch ||
      root.linkSessionId !== target.provenance.linkSessionId ||
      root.enrollmentId !== target.provenance.enrollmentId ||
      String(root.deviceId) !== String(target.principal.deviceId)
    )
      throw new Error('ML-DSA export root differs from the target authority');
  }
  return {
    kind: 'committed_authority_packages_v1',
    authority: authority.value,
    authMethod,
    signerPackages,
    ed25519ExportRootPackage,
    packageSetDigestB64u: parseCommittedSignerPackageSetDigestB64u(record.packageSetDigestB64u),
  };
}

function assertSignerPackagesMatchAuthority(
  packages: CommittedSignerPackageSetV1,
  activations: PendingWalletAuthorityV1['signerActivations'],
): void {
  if (packages.keyFamilies.length !== activations.keyFamilies.length) {
    throw new Error('CommittedAuthorityPackagesV1 signer families do not match authority');
  }
  for (let index = 0; index < packages.keyFamilies.length; index += 1) {
    if (packages.keyFamilies[index] !== activations.keyFamilies[index]) {
      throw new Error('CommittedAuthorityPackagesV1 signer family order does not match authority');
    }
  }
  if (
    packages.ed25519 &&
    (!activations.ed25519 ||
      !mpcMaterialActivationRefsEqual(
        packages.ed25519.materialActivation,
        activations.ed25519.materialActivation,
      ))
  )
    throw new Error('Ed25519 package activation differs');
  if (
    packages.ecdsa &&
    (!activations.ecdsa ||
      !mpcMaterialActivationRefsEqual(
        packages.ecdsa.materialActivation,
        activations.ecdsa.materialActivation,
      ))
  )
    throw new Error('ECDSA package activation differs');
  const roots = packages.mlDsa ?? [];
  const keys = activations.mlDsa ?? [];
  if (roots.length !== keys.length) throw new Error('ML-DSA packages do not cover the authority');
  for (let index = 0; index < roots.length; index += 1) {
    if (alphabetizeStringify(roots[index]?.signer) !== alphabetizeStringify(keys[index]?.signer))
      throw new Error('ML-DSA package activation differs');
  }
}

export type CommittedSignerPackageSetDigestInputV1 = {
  readonly authorityId: WalletAuthorityId;
  readonly walletId: WalletId;
  readonly enrollmentId: LinkedDeviceEnrollmentId;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly deviceId: DeviceId;
  readonly authMethodId: WalletAuthMethodId;
  readonly permissions: CanonicalDelegatedWalletPermissionSetV1;
  readonly sourceManifestDigestB64u: DigestB64u;
  readonly signerPackages: CommittedSignerPackageSetV1;
  readonly ed25519ExportRootPackageDigestB64u: DigestB64u | null;
  readonly targetFactorVerificationDigestB64u: DigestB64u;
};

export function buildCommittedSignerPackageSetV1(
  ed25519: CommittedEd25519SignerPackageV1 | null,
  ecdsa: CommittedEcdsaSignerPackageV1 | null,
  mlDsaPackages: readonly CommittedMlDsaSignerPackageV1[],
): CommittedSignerPackageSetV1 {
  const first = mlDsaPackages[0];
  const kind = 'committed_signer_package_set_v1';
  if (first) {
    const mlDsa: readonly [CommittedMlDsaSignerPackageV1, ...CommittedMlDsaSignerPackageV1[]] = [
      first,
      ...mlDsaPackages.slice(1),
    ];
    let previous = '';
    for (const entry of mlDsa) {
      if (entry.signer.walletKeyId <= previous)
        throw new Error('ML-DSA packages must have unique keys in canonical order');
      previous = entry.signer.walletKeyId;
    }
    if (ed25519 && ecdsa)
      return {
        kind,
        keyFamilies: ['ed25519', 'ecdsa_secp256k1', 'ml_dsa_65'],
        ed25519,
        ecdsa,
        mlDsa,
      };
    if (ed25519) return { kind, keyFamilies: ['ed25519', 'ml_dsa_65'], ed25519, mlDsa };
    if (ecdsa) return { kind, keyFamilies: ['ecdsa_secp256k1', 'ml_dsa_65'], ecdsa, mlDsa };
    return { kind, keyFamilies: ['ml_dsa_65'], mlDsa };
  }
  if (ed25519 && ecdsa)
    return { kind, keyFamilies: ['ed25519', 'ecdsa_secp256k1'], ed25519, ecdsa };
  if (ed25519) return { kind, keyFamilies: ['ed25519'], ed25519 };
  if (ecdsa) return { kind, keyFamilies: ['ecdsa_secp256k1'], ecdsa };
  throw new Error('Committed signer packages cannot be empty');
}

export function parseCommittedSignerPackageSetV1(raw: unknown): CommittedSignerPackageSetV1 {
  const object = inspectRawObject(raw);
  if (!object) throw new Error('Committed signer packages must be an object');
  const fields = ['kind', 'keyFamilies'];
  for (const name of ['ed25519', 'ecdsa', 'mlDsa']) {
    if (Object.prototype.hasOwnProperty.call(object, name)) fields.push(name);
  }
  const record = exactRecord(raw, fields, 'Committed signer packages');
  if (record.kind !== 'committed_signer_package_set_v1')
    throw new Error('Invalid committed signer package kind');
  const mlDsa: CommittedMlDsaSignerPackageV1[] = [];
  if ('mlDsa' in record) {
    if (!Array.isArray(record.mlDsa) || record.mlDsa.length === 0 || record.mlDsa.length > 64)
      throw new Error('Invalid ML-DSA package count');
    for (const value of record.mlDsa) mlDsa.push(parseMlDsaPackage(value));
  }
  const result = buildCommittedSignerPackageSetV1(
    'ed25519' in record ? parseEd25519Package(record.ed25519) : null,
    'ecdsa' in record ? parseEcdsaPackage(record.ecdsa) : null,
    mlDsa,
  );
  if (JSON.stringify(record.keyFamilies) !== JSON.stringify(result.keyFamilies))
    throw new Error('Signer package families differ');
  if (
    result.ed25519 &&
    result.ecdsa &&
    result.ed25519.materialActivation.activationId === result.ecdsa.materialActivation.activationId
  )
    throw new Error('Activation identities must be distinct');
  return result;
}

function parseMlDsaPackage(raw: unknown): CommittedMlDsaSignerPackageV1 {
  const record = exactRecord(raw, ['kind', 'signer', 'exportRoot'], 'ML-DSA signer package');
  if (record.kind !== 'committed_ml_dsa_65_signer_package_v1')
    throw new Error('Invalid ML-DSA package kind');
  const signer = parseExactAdministeredMlDsa65SignerV1(record.signer);
  const exportRoot = parseLinkedDeviceMlDsaExportRootPackageV1(record.exportRoot);
  const binding = exportRoot.binding;
  if (
    binding.walletId !== signer.walletId ||
    binding.root.walletKeyId !== signer.walletKeyId ||
    binding.root.mlDsaSigningKeyId !== signer.mlDsaSigningKeyId ||
    binding.root.registeredPublicKeyB64u !== signer.registeredPublicKeyB64u ||
    binding.root.keyManifestDigestB64u !== signer.keyManifestDigestB64u
  )
    throw new Error('The ML-DSA export root differs from its signer');
  return { kind: 'committed_ml_dsa_65_signer_package_v1', signer, exportRoot };
}

export function parseCommittedSignerPackageSetDigestB64u(raw: unknown): DigestB64u {
  return parseDigestB64u(raw);
}

export async function computeCommittedSignerPackageDigestB64u(
  value:
    | CommittedEd25519SignerPackageV1
    | CommittedEcdsaSignerPackageV1
    | CommittedMlDsaSignerPackageV1,
): Promise<DigestB64u> {
  return sha256Utf8DigestB64u(
    alphabetizeStringify({ domain: COMMITTED_SIGNER_PACKAGE_DOMAIN_V1, package: value }),
  );
}

export async function computeCommittedSignerPackageSetDigestB64u(
  input: CommittedSignerPackageSetDigestInputV1,
): Promise<DigestB64u> {
  const packageEntries = await committedSignerPackageSetCanonicalValue(input.signerPackages);
  const value = [
    COMMITTED_SIGNER_PACKAGE_SET_DOMAIN_V1,
    input.authorityId,
    input.walletId,
    input.enrollmentId,
    input.linkSessionId,
    input.deviceId,
    input.authMethodId,
    [...input.permissions],
    input.sourceManifestDigestB64u,
    packageEntries,
    input.ed25519ExportRootPackageDigestB64u,
    input.targetFactorVerificationDigestB64u,
  ];
  return sha256Utf8DigestB64u(alphabetizeStringify(value));
}

function parseEd25519Package(raw: unknown): CommittedEd25519SignerPackageV1 {
  const record = parseCommittedEd25519SignerPackageWireV1(raw);
  if (record.kind !== 'committed_ed25519_signer_package_v1') {
    throw new Error('CommittedEd25519SignerPackageV1.kind is invalid');
  }
  const materialActivation = parseActivation(record.materialActivation, 'materialActivation');
  const targetBinding = parseRouterAbEd25519YaoCeremonyBindingV1(record.targetBinding);
  const applicationBinding = parseRouterAbEd25519YaoApplicationBindingFactsV1(
    record.applicationBinding,
  );
  const activationReceipt = parseRouterAbEd25519YaoActivationPublicReceiptV1(
    record.activationReceipt,
  );
  if (
    !mpcMaterialActivationRefsEqual(
      materialActivation,
      routerAbMpcMaterialActivationRefFromWire(activationReceipt.material_activation),
    )
  ) {
    throw new Error('CommittedEd25519SignerPackageV1 activation receipt does not match material');
  }
  if (
    !mpcMaterialActivationRefsEqual(
      materialActivation,
      routerAbMpcMaterialActivationRefFromWire(targetBinding.material_activation),
    )
  ) {
    throw new Error('CommittedEd25519SignerPackageV1 target binding does not match material');
  }
  const deriverA = parseEd25519ClientPackage(
    record.deriver_a_client_package,
    'deriver_a_client_package',
    'deriver_a',
  );
  const deriverB = parseEd25519ClientPackage(
    record.deriver_b_client_package,
    'deriver_b_client_package',
    'deriver_b',
  );
  if (
    !sameRouterAbEd25519YaoByteSequence(activationReceipt.transcript, deriverA.transcript) ||
    !sameRouterAbEd25519YaoByteSequence(activationReceipt.transcript, deriverB.transcript)
  ) {
    throw new Error('CommittedEd25519SignerPackageV1 receipt transcript does not match packages');
  }
  return {
    kind: 'committed_ed25519_signer_package_v1',
    materialActivation,
    targetBinding,
    applicationBinding,
    participantIds: parseRouterAbEd25519YaoParticipantIdsV1(record.participantIds),
    activationReceipt,
    deriver_a_client_package: deriverA,
    deriver_b_client_package: deriverB,
  };
}

function parseEcdsaPackage(raw: unknown): CommittedEcdsaSignerPackageV1 {
  const record = parseCommittedEcdsaSignerPackageWireV1(raw);
  if (record.kind !== 'committed_ecdsa_signer_package_v1') {
    throw new Error('CommittedEcdsaSignerPackageV1.kind is invalid');
  }
  const materialActivation = parseActivation(record.materialActivation, 'materialActivation');
  const activationReceipt = parseLinkedDeviceEcdsaSourcePreservingActivationReceiptV1(
    record.activationReceipt,
  );
  const targetActivation = activationReceipt.binding.target.activation;
  if (!mpcMaterialActivationRefsEqual(materialActivation, targetActivation)) {
    throw new Error('CommittedEcdsaSignerPackageV1 receipt activation does not match material');
  }
  const encryptedTargetClientShare = parseLinkedDeviceEcdsaEncryptedSourceContributionV1(
    record.encryptedTargetClientShare,
    'encryptedTargetClientShare',
  );
  if (
    encryptedTargetClientShare.recipientPublicKeyB64u !==
    activationReceipt.binding.target.clientRecipientPublicKeyB64u
  ) {
    throw new Error('CommittedEcdsaSignerPackageV1 client share recipient does not match receipt');
  }
  return {
    kind: 'committed_ecdsa_signer_package_v1',
    materialActivation,
    encryptedTargetClientShare,
    activationReceipt,
  };
}

function parseEd25519ClientPackage<Role extends 'deriver_a' | 'deriver_b'>(
  raw: unknown,
  label: string,
  deriver: Role,
): RouterAbEd25519YaoActivationClientPackageV1<Role> {
  const parsed = parseRouterAbEd25519YaoEncryptedPackageV1(raw);
  if (!parsed.ok) throw new Error(`${label} ${parsed.message}`);
  if (parsed.value.kind !== 'activation_client' || parsed.value.deriver !== deriver) {
    throw new Error(`${label} must be an activation_client for ${deriver}`);
  }
  return {
    kind: 'activation_client',
    deriver,
    session: parsed.value.session,
    transcript: parsed.value.transcript,
    encapsulated_key: parsed.value.encapsulated_key,
    ciphertext: parsed.value.ciphertext,
  };
}

function parseActivation(raw: unknown, label: string): MpcMaterialActivationRef {
  const parsed = parseMpcMaterialActivationRef(raw);
  if (!parsed.ok) throw new Error(`${label} ${parsed.error.message}`);
  return parsed.value;
}

function parseCommittedAuthorityPackagesWireV1(raw: unknown): CommittedAuthorityPackagesWireV1 {
  const record = inspectRawObject(raw);
  if (record === null) {
    throw new Error('CommittedAuthorityPackagesV1 must be an object');
  }
  requireExactWireFields(
    record,
    [
      'kind',
      'authority',
      'authMethod',
      'signerPackages',
      'ed25519ExportRootPackage',
      'packageSetDigestB64u',
    ],
    'CommittedAuthorityPackagesV1',
  );
  return {
    kind: Reflect.get(record, 'kind'),
    authority: Reflect.get(record, 'authority'),
    authMethod: Reflect.get(record, 'authMethod'),
    signerPackages: Reflect.get(record, 'signerPackages'),
    ed25519ExportRootPackage: Reflect.get(record, 'ed25519ExportRootPackage'),
    packageSetDigestB64u: Reflect.get(record, 'packageSetDigestB64u'),
  };
}

function parseCommittedEd25519SignerPackageWireV1(
  raw: unknown,
): CommittedEd25519SignerPackageWireV1 {
  const record = inspectRawObject(raw);
  if (record === null) {
    throw new Error('CommittedEd25519SignerPackageV1 must be an object');
  }
  requireExactWireFields(
    record,
    [
      'kind',
      'materialActivation',
      'targetBinding',
      'applicationBinding',
      'participantIds',
      'activationReceipt',
      'deriver_a_client_package',
      'deriver_b_client_package',
    ],
    'CommittedEd25519SignerPackageV1',
  );
  return {
    kind: Reflect.get(record, 'kind'),
    materialActivation: Reflect.get(record, 'materialActivation'),
    targetBinding: Reflect.get(record, 'targetBinding'),
    applicationBinding: Reflect.get(record, 'applicationBinding'),
    participantIds: Reflect.get(record, 'participantIds'),
    activationReceipt: Reflect.get(record, 'activationReceipt'),
    deriver_a_client_package: Reflect.get(record, 'deriver_a_client_package'),
    deriver_b_client_package: Reflect.get(record, 'deriver_b_client_package'),
  };
}

function parseCommittedEcdsaSignerPackageWireV1(raw: unknown): CommittedEcdsaSignerPackageWireV1 {
  const record = inspectRawObject(raw);
  if (record === null) {
    throw new Error('CommittedEcdsaSignerPackageV1 must be an object');
  }
  requireExactWireFields(
    record,
    ['kind', 'materialActivation', 'encryptedTargetClientShare', 'activationReceipt'],
    'CommittedEcdsaSignerPackageV1',
  );
  return {
    kind: Reflect.get(record, 'kind'),
    materialActivation: Reflect.get(record, 'materialActivation'),
    encryptedTargetClientShare: Reflect.get(record, 'encryptedTargetClientShare'),
    activationReceipt: Reflect.get(record, 'activationReceipt'),
  };
}

function inspectRawObject(raw: unknown): object | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function requireExactWireFields(record: object, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  const actual = Object.keys(record);
  if (actual.length !== keys.length) {
    throw new Error(`${label} contains unexpected fields`);
  }
  for (const key of actual) {
    if (!expected.has(key)) throw new Error(`${label} contains unexpected fields`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label}.${key} is required`);
    }
  }
}

async function committedSignerPackageSetCanonicalValue(
  value: CommittedSignerPackageSetV1,
): Promise<readonly unknown[]> {
  const entries: unknown[] = [value.kind, value.keyFamilies];
  if (value.ed25519)
    entries.push(
      value.ed25519.materialActivation,
      await computeCommittedSignerPackageDigestB64u(value.ed25519),
    );
  if (value.ecdsa)
    entries.push(
      value.ecdsa.materialActivation,
      await computeCommittedSignerPackageDigestB64u(value.ecdsa),
    );
  for (const key of value.mlDsa ?? [])
    entries.push(key.signer.walletKeyId, await computeCommittedSignerPackageDigestB64u(key));
  return entries;
}
