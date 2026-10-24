import type { WalletCapabilitySubjectV1 } from '../device-linking/contracts';
import { base64UrlEncode } from '../utils/base64';
import { parseDigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { sha256Bytes } from '../utils/digests';
import { concat, lp32, rawDigest, rawPublicKey, text, u32, u64 } from '../utils/digestEncoding';
import {
  parseDelegatedWalletPermissionSetV1,
  type CanonicalDelegatedWalletPermissionSetV1,
} from './delegatedAuthority';
import { parseDeviceId, type AuthorizationParseResult, type DeviceId } from './capabilityKinds';
import {
  buildExactAdministeredSignerManifestV1,
  parseExactAdministeredMlDsa65SignerV1,
  type ExactAdministeredMlDsa65SignerV1,
  parseExactAdministeredSignerManifestV1,
  type ExactAdministeredEd25519SignerV1,
  type ExactAdministeredEcdsaSignerV1,
  type ExactAdministeredSignerManifestV1,
} from '../device-linking/delegatedActivationPlan';
import {
  parseLinkDeviceSessionId,
  parseLinkedDeviceEnrollmentId,
  parseMpcMaterialActivationRef,
  parseWalletAuthorityId,
  parseWalletId,
  parseWalletRecoveryOperationId,
  type LinkDeviceSessionId,
  type LinkedDeviceEnrollmentId,
  type MpcMaterialActivationRef,
  type WalletAuthorityId,
  type WalletId,
  type WalletRecoveryOperationId,
} from '../utils/domainIds';
import { requireRecord } from '../utils/validation';

const SIGNER_ACTIVATION_SET_DOMAIN = 'seams/wallet-signer-activation-set/v1';
const WALLET_AUTHORITY_DOMAIN = 'seams/wallet-authority/v1';

type WalletAuthorityPrincipalV1 = {
  readonly kind: 'owner_device';
  readonly deviceId: DeviceId;
};

export type WalletAuthorityProvenanceV1 =
  | {
      readonly kind: 'wallet_registration';
      readonly enrollmentId?: never;
      readonly sourceAuthorityId?: never;
      readonly linkSessionId?: never;
      readonly recoveryOperationId?: never;
      readonly continuityAuthorityId?: never;
    }
  | {
      readonly kind: 'device_link';
      readonly enrollmentId: LinkedDeviceEnrollmentId;
      readonly sourceAuthorityId: WalletAuthorityId;
      readonly linkSessionId: LinkDeviceSessionId;
      readonly recoveryOperationId?: never;
      readonly continuityAuthorityId?: never;
    }
  | {
      readonly kind: 'wallet_recovery';
      readonly recoveryOperationId: WalletRecoveryOperationId;
      readonly continuityAuthorityId: WalletAuthorityId;
      readonly enrollmentId?: never;
      readonly sourceAuthorityId?: never;
      readonly linkSessionId?: never;
    };

export type WalletEd25519SignerActivationV1 = {
  readonly kind: 'wallet_ed25519_signer_activation_v1';
  readonly signer: ExactAdministeredEd25519SignerV1;
  readonly materialActivation: MpcMaterialActivationRef;
};

export type WalletEcdsaSignerActivationV1 = {
  readonly kind: 'wallet_ecdsa_signer_activation_v1';
  readonly signer: ExactAdministeredEcdsaSignerV1;
  readonly materialActivation: MpcMaterialActivationRef;
};

export type WalletMlDsa65SignerActivationV1 = {
  readonly materialActivation?: never;
  readonly materialEpoch?: never;
  readonly kind: 'wallet_ml_dsa_65_signer_activation_v1';
  readonly signer: ExactAdministeredMlDsa65SignerV1;
};
type MlDsaActivationList = readonly [
  WalletMlDsa65SignerActivationV1,
  ...WalletMlDsa65SignerActivationV1[],
];

export type WalletSignerActivationSetV1 =
  | {
      readonly mlDsa?: never;
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ed25519'];
      readonly ed25519: WalletEd25519SignerActivationV1;
      readonly ecdsa?: never;
    }
  | {
      readonly mlDsa?: never;
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ecdsa_secp256k1'];
      readonly ed25519?: never;
      readonly ecdsa: WalletEcdsaSignerActivationV1;
    }
  | {
      readonly mlDsa?: never;
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'];
      readonly ed25519: WalletEd25519SignerActivationV1;
      readonly ecdsa: WalletEcdsaSignerActivationV1;
    }
  | {
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ml_dsa_65'];
      readonly mlDsa: MlDsaActivationList;
      readonly ed25519?: never;
      readonly ecdsa?: never;
    }
  | {
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ml_dsa_65'];
      readonly mlDsa: MlDsaActivationList;
      readonly ed25519: WalletEd25519SignerActivationV1;
      readonly ecdsa?: never;
    }
  | {
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ecdsa_secp256k1', 'ml_dsa_65'];
      readonly mlDsa: MlDsaActivationList;
      readonly ed25519?: never;
      readonly ecdsa: WalletEcdsaSignerActivationV1;
    }
  | {
      readonly kind: 'wallet_signer_activation_set_v1';
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1', 'ml_dsa_65'];
      readonly mlDsa: MlDsaActivationList;
      readonly ed25519: WalletEd25519SignerActivationV1;
      readonly ecdsa: WalletEcdsaSignerActivationV1;
    };

type WalletSignerActivationMaterialsV1 =
  | {
      readonly keyFamilies: readonly ['ed25519'];
      readonly ed25519: MpcMaterialActivationRef;
      readonly ecdsa?: never;
    }
  | {
      readonly keyFamilies: readonly ['ecdsa_secp256k1'];
      readonly ed25519?: never;
      readonly ecdsa: MpcMaterialActivationRef;
    }
  | {
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'];
      readonly ed25519: MpcMaterialActivationRef;
      readonly ecdsa: MpcMaterialActivationRef;
    }
  | {
      readonly keyFamilies: readonly ['ml_dsa_65'];
      readonly ed25519?: never;
      readonly ecdsa?: never;
    }
  | {
      readonly keyFamilies: readonly ['ed25519', 'ml_dsa_65'];
      readonly ed25519: MpcMaterialActivationRef;
      readonly ecdsa?: never;
    }
  | {
      readonly keyFamilies: readonly ['ecdsa_secp256k1', 'ml_dsa_65'];
      readonly ed25519?: never;
      readonly ecdsa: MpcMaterialActivationRef;
    }
  | {
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1', 'ml_dsa_65'];
      readonly ed25519: MpcMaterialActivationRef;
      readonly ecdsa: MpcMaterialActivationRef;
    };

type WalletSignerActivationSetBuilderInputV1 = {
  readonly manifest: ExactAdministeredSignerManifestV1;
  readonly materialActivations: WalletSignerActivationMaterialsV1;
};

type WalletAuthorityCommonV1 = {
  readonly kind: 'wallet_authority_v1';
  readonly authorityId: WalletAuthorityId;
  readonly walletId: WalletId;
  readonly principal: WalletAuthorityPrincipalV1;
  readonly provenance: WalletAuthorityProvenanceV1;
  readonly permissions: CanonicalDelegatedWalletPermissionSetV1;
  readonly signerActivations: WalletSignerActivationSetV1;
  readonly signerActivationSetDigestB64u: DigestB64u;
  readonly authorityDigestB64u: DigestB64u;
  readonly revocationEpoch: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

export type WalletAuthorityV1 = WalletAuthorityCommonV1 &
  (
    | {
        readonly state: 'pending_local_install';
        readonly localInstallPackageSetDigestB64u: DigestB64u;
        readonly activatedAtMs?: never;
        readonly revokedAtMs?: never;
      }
    | {
        readonly state: 'active';
        readonly localInstallPackageSetDigestB64u?: never;
        readonly activatedAtMs: number;
        readonly revokedAtMs?: never;
      }
    | {
        readonly state: 'revoked';
        readonly localInstallPackageSetDigestB64u?: never;
        readonly activatedAtMs: number;
        readonly revokedAtMs: number;
      }
  );

export type PendingWalletAuthorityV1 = Extract<
  WalletAuthorityV1,
  { readonly state: 'pending_local_install' }
>;
export type ActiveWalletAuthorityV1 = Extract<WalletAuthorityV1, { readonly state: 'active' }>;
export type ActiveRecoveredWalletAuthorityV1 = Omit<ActiveWalletAuthorityV1, 'provenance'> & {
  readonly provenance: Extract<WalletAuthorityProvenanceV1, { readonly kind: 'wallet_recovery' }>;
};
export type RevokedWalletAuthorityV1 = Extract<WalletAuthorityV1, { readonly state: 'revoked' }>;

export type Ed25519WalletSignerActivationSetV1 = Extract<
  WalletSignerActivationSetV1,
  { readonly ed25519: WalletEd25519SignerActivationV1; readonly ecdsa?: never }
>;
export type EcdsaWalletSignerActivationSetV1 = Extract<
  WalletSignerActivationSetV1,
  { readonly ecdsa: WalletEcdsaSignerActivationV1; readonly ed25519?: never }
>;
export type CombinedWalletSignerActivationSetV1 = Extract<
  WalletSignerActivationSetV1,
  {
    readonly ed25519: WalletEd25519SignerActivationV1;
    readonly ecdsa: WalletEcdsaSignerActivationV1;
  }
>;

export type ActiveEd25519WalletAuthorityV1 = Omit<ActiveWalletAuthorityV1, 'signerActivations'> & {
  readonly signerActivations: Ed25519WalletSignerActivationSetV1;
};
export type ActiveEcdsaWalletAuthorityV1 = Omit<ActiveWalletAuthorityV1, 'signerActivations'> & {
  readonly signerActivations: EcdsaWalletSignerActivationSetV1;
};
export type ActiveCombinedWalletAuthorityV1 = Omit<ActiveWalletAuthorityV1, 'signerActivations'> & {
  readonly signerActivations: CombinedWalletSignerActivationSetV1;
};

export function isCombinedWalletSignerActivationSetV1(
  value: WalletSignerActivationSetV1,
): value is CombinedWalletSignerActivationSetV1 {
  return isBothFamilyActivationSet(value);
}

export function isActiveEcdsaWalletAuthorityV1(
  value: ActiveWalletAuthorityV1,
): value is ActiveEcdsaWalletAuthorityV1 {
  return isEcdsaOnlyActivationSet(value.signerActivations);
}

export function isActiveEd25519WalletAuthorityV1(
  value: ActiveWalletAuthorityV1,
): value is ActiveEd25519WalletAuthorityV1 {
  return isEd25519OnlyActivationSet(value.signerActivations);
}

export function isActiveRecoveredWalletAuthorityV1(
  value: ActiveWalletAuthorityV1,
): value is ActiveRecoveredWalletAuthorityV1 {
  return value.provenance.kind === 'wallet_recovery';
}

function buildWalletEd25519SignerActivationV1(input: {
  readonly signer: ExactAdministeredEd25519SignerV1;
  readonly materialActivation: MpcMaterialActivationRef;
}): WalletEd25519SignerActivationV1 {
  return {
    kind: 'wallet_ed25519_signer_activation_v1',
    signer: input.signer,
    materialActivation: input.materialActivation,
  };
}

export function buildWalletEcdsaSignerActivationV1(input: {
  readonly signer: ExactAdministeredEcdsaSignerV1;
  readonly materialActivation: MpcMaterialActivationRef;
}): WalletEcdsaSignerActivationV1 {
  return {
    kind: 'wallet_ecdsa_signer_activation_v1',
    signer: input.signer,
    materialActivation: input.materialActivation,
  };
}

export function buildWalletSignerActivationSetV1(
  input: WalletSignerActivationSetBuilderInputV1,
): WalletSignerActivationSetV1 {
  const manifest = input.manifest;
  const materials = input.materialActivations;
  if (!sameFamilies(manifest.keyFamilies, materials.keyFamilies))
    throw new Error('Signer materials must match the exact manifest families');
  let ed25519: WalletEd25519SignerActivationV1 | null = null;
  let ecdsa: WalletEcdsaSignerActivationV1 | null = null;
  const mlDsa: WalletMlDsa65SignerActivationV1[] = [];
  for (const signer of manifest.signers) {
    switch (signer.keyFamily) {
      case 'ed25519':
        if (!materials.ed25519) throw new Error('Missing Ed25519 material activation');
        ed25519 = buildWalletEd25519SignerActivationV1({
          signer,
          materialActivation: materials.ed25519,
        });
        break;
      case 'ecdsa_secp256k1':
        if (!materials.ecdsa) throw new Error('Missing ECDSA material activation');
        ecdsa = buildWalletEcdsaSignerActivationV1({ signer, materialActivation: materials.ecdsa });
        break;
      case 'ml_dsa_65':
        mlDsa.push({ kind: 'wallet_ml_dsa_65_signer_activation_v1', signer });
        break;
      default:
        return assertNever(signer, 'Signer activation');
    }
  }
  return assembleSignerActivations(ed25519, ecdsa, mlDsa);
}

export function parseWalletSignerActivationSetV1(
  raw: unknown,
): AuthorizationParseResult<WalletSignerActivationSetV1> {
  try {
    const record = requireRecord(raw, 'Wallet signer activations');
    if (record.kind !== 'wallet_signer_activation_set_v1' || !Array.isArray(record.keyFamilies))
      throw new Error('Invalid signer activation kind or families');
    const fields = ['kind', 'keyFamilies'];
    if (record.keyFamilies.includes('ed25519')) fields.push('ed25519');
    if (record.keyFamilies.includes('ecdsa_secp256k1')) fields.push('ecdsa');
    if (record.keyFamilies.includes('ml_dsa_65')) fields.push('mlDsa');
    exactFields(record, fields, 'Wallet signer activations');
    const ed25519 = fields.includes('ed25519')
      ? parseEd25519Activation(record.ed25519, 'ed25519')
      : null;
    const ecdsa = fields.includes('ecdsa') ? parseEcdsaActivation(record.ecdsa, 'ecdsa') : null;
    const mlDsa: WalletMlDsa65SignerActivationV1[] = [];
    if (fields.includes('mlDsa')) {
      if (!Array.isArray(record.mlDsa) || record.mlDsa.length === 0 || record.mlDsa.length > 64)
        throw new Error('ML-DSA activations require a bounded nonempty list');
      for (const rawActivation of record.mlDsa) {
        const activation = exactRecord(rawActivation, ['kind', 'signer'], 'ML-DSA activation');
        if (activation.kind !== 'wallet_ml_dsa_65_signer_activation_v1')
          throw new Error('Invalid ML-DSA activation kind');
        mlDsa.push({
          kind: 'wallet_ml_dsa_65_signer_activation_v1',
          signer: parseExactAdministeredMlDsa65SignerV1(activation.signer),
        });
      }
    }
    const value = assembleSignerActivations(ed25519, ecdsa, mlDsa);
    if (!sameFamilies(record.keyFamilies, value.keyFamilies))
      throw new Error('Signer families must use canonical order');
    return { ok: true, value };
  } catch (error) {
    return invalidResult(errorMessage(error, 'Invalid wallet signer activations'));
  }
}

/** Validates a complete activation set at construction and persistence boundaries. */
function assembleSignerActivations(
  ed25519: WalletEd25519SignerActivationV1 | null,
  ecdsa: WalletEcdsaSignerActivationV1 | null,
  mlDsa: readonly WalletMlDsa65SignerActivationV1[],
): WalletSignerActivationSetV1 {
  const members = [];
  if (ed25519) members.push(ed25519.signer);
  if (ecdsa) members.push(ecdsa.signer);
  for (const activation of mlDsa) members.push(activation.signer);
  const canonical = buildExactAdministeredSignerManifestV1(members);
  const canonicalMlDsa = canonical.signers.filter(isMlDsaSigner);
  for (let index = 0; index < canonicalMlDsa.length; index += 1)
    if (canonicalMlDsa[index].walletKeyId !== mlDsa[index]?.signer.walletKeyId)
      throw new Error('ML-DSA activations must use canonical key order');
  if (
    ed25519 &&
    ecdsa &&
    ed25519.materialActivation.activationId === ecdsa.materialActivation.activationId
  )
    throw new Error('Client material activations must be distinct');
  const [first, ...rest] = mlDsa;
  if (first) {
    const mlDsa: MlDsaActivationList = [first, ...rest];
    if (ed25519 && ecdsa)
      return {
        kind: 'wallet_signer_activation_set_v1',
        keyFamilies: ['ed25519', 'ecdsa_secp256k1', 'ml_dsa_65'],
        ed25519,
        ecdsa,
        mlDsa,
      };
    if (ed25519)
      return {
        kind: 'wallet_signer_activation_set_v1',
        keyFamilies: ['ed25519', 'ml_dsa_65'],
        ed25519,
        mlDsa,
      };
    if (ecdsa)
      return {
        kind: 'wallet_signer_activation_set_v1',
        keyFamilies: ['ecdsa_secp256k1', 'ml_dsa_65'],
        ecdsa,
        mlDsa,
      };
    return { kind: 'wallet_signer_activation_set_v1', keyFamilies: ['ml_dsa_65'], mlDsa };
  }
  if (ed25519 && ecdsa)
    return {
      kind: 'wallet_signer_activation_set_v1',
      keyFamilies: ['ed25519', 'ecdsa_secp256k1'],
      ed25519,
      ecdsa,
    };
  if (ed25519)
    return { kind: 'wallet_signer_activation_set_v1', keyFamilies: ['ed25519'], ed25519 };
  if (ecdsa)
    return { kind: 'wallet_signer_activation_set_v1', keyFamilies: ['ecdsa_secp256k1'], ecdsa };
  throw new Error('A wallet authority requires at least one signer');
}
function isMlDsaSigner(
  signer: ExactAdministeredSignerManifestV1['signers'][number],
): signer is ExactAdministeredMlDsa65SignerV1 {
  return signer.keyFamily === 'ml_dsa_65';
}

export function encodeWalletSignerActivationSetV1(value: WalletSignerActivationSetV1): Uint8Array {
  const parts: Uint8Array[] = [
    text(SIGNER_ACTIVATION_SET_DOMAIN, 'domain'),
    text(value.kind, 'kind'),
    u32(value.keyFamilies.length, 'keyFamilies'),
  ];
  for (const family of value.keyFamilies) parts.push(text(family, 'keyFamilies.item'));
  if (value.ed25519) parts.push(lp32(encodeEd25519Activation(value.ed25519), 'ed25519'));
  if (value.ecdsa) parts.push(lp32(encodeEcdsaActivation(value.ecdsa), 'ecdsa'));
  if (value.mlDsa) {
    parts.push(u32(value.mlDsa.length, 'mlDsa.length'));
    for (const activation of value.mlDsa) {
      const signer = activation.signer;
      parts.push(
        lp32(
          concat([
            text(activation.kind, 'mlDsa.kind'),
            text(signer.kind, 'signer.kind'),
            text(signer.keyFamily, 'signer.family'),
            text(signer.walletId, 'signer.walletId'),
            text(signer.walletKeyId, 'signer.walletKeyId'),
            text(signer.mlDsaSigningKeyId, 'signer.keyId'),
            rawDigest(signer.keyManifestDigestB64u, 'signer.manifest'),
            lp32(
              rawPublicKey(signer.registeredPublicKeyB64u, 'signer.publicKey'),
              'signer.publicKey',
            ),
          ]),
          'mlDsa.activation',
        ),
      );
    }
  }
  return concat(parts);
}

export async function computeWalletSignerActivationSetDigestB64u(
  value: WalletSignerActivationSetV1,
): Promise<DigestB64u> {
  return parseDigestB64u(
    base64UrlEncode(await sha256Bytes(encodeWalletSignerActivationSetV1(value))),
  );
}

/** The fields every lifecycle state carries, copied in record order. */
function walletAuthorityCommonFields<TSignerActivations extends WalletSignerActivationSetV1>(
  input: WalletAuthorityCommonV1 & { readonly signerActivations: TSignerActivations },
): WalletAuthorityCommonV1 & { readonly signerActivations: TSignerActivations } {
  return {
    kind: 'wallet_authority_v1',
    authorityId: input.authorityId,
    walletId: input.walletId,
    principal: input.principal,
    provenance: input.provenance,
    permissions: input.permissions,
    signerActivations: input.signerActivations,
    signerActivationSetDigestB64u: input.signerActivationSetDigestB64u,
    authorityDigestB64u: input.authorityDigestB64u,
    revocationEpoch: input.revocationEpoch,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.updatedAtMs,
  };
}

export function buildPendingWalletAuthorityV1(
  input: PendingWalletAuthorityV1,
): PendingWalletAuthorityV1 {
  validateWalletAuthorityV1(input);
  return {
    ...walletAuthorityCommonFields(input),
    state: 'pending_local_install',
    localInstallPackageSetDigestB64u: input.localInstallPackageSetDigestB64u,
  };
}

export function buildActiveWalletAuthorityV1(
  input: ActiveWalletAuthorityV1,
): ActiveWalletAuthorityV1 {
  validateWalletAuthorityV1(input);
  return {
    ...walletAuthorityCommonFields(input),
    state: 'active',
    activatedAtMs: input.activatedAtMs,
  };
}

export async function replaceActiveWalletAuthorityEd25519MaterialActivationV1(input: {
  readonly authority: ActiveWalletAuthorityV1;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly updatedAtMs: number;
}): Promise<ActiveWalletAuthorityV1> {
  const current = input.authority.signerActivations;
  if (!current.ed25519) {
    throw new Error('active Wallet Authority has no Ed25519 material activation to replace');
  }
  return withSignerActivations(
    input.authority,
    replaceWalletEd25519MaterialV1(current, input.materialActivation),
    input.updatedAtMs,
  );
}

export function replaceWalletEd25519MaterialV1(
  current: WalletSignerActivationSetV1,
  materialActivation: MpcMaterialActivationRef,
): WalletSignerActivationSetV1 {
  if (!current.ed25519) throw new Error('The authority has no Ed25519 activation to replace');
  return assembleSignerActivations(
    buildWalletEd25519SignerActivationV1({ signer: current.ed25519.signer, materialActivation }),
    current.ecdsa ?? null,
    current.mlDsa ?? [],
  );
}

export function buildActiveCombinedWalletAuthorityV1(
  input: ActiveCombinedWalletAuthorityV1,
): ActiveCombinedWalletAuthorityV1 {
  validateWalletAuthorityV1(input);
  return {
    ...walletAuthorityCommonFields(input),
    state: 'active',
    activatedAtMs: input.activatedAtMs,
  };
}

export function buildRevokedWalletAuthorityV1(
  input: RevokedWalletAuthorityV1,
): RevokedWalletAuthorityV1 {
  validateWalletAuthorityV1(input);
  return {
    ...walletAuthorityCommonFields(input),
    state: 'revoked',
    activatedAtMs: input.activatedAtMs,
    revokedAtMs: input.revokedAtMs,
  };
}

/** The record fields every lifecycle state has, in canonical order; each state adds its own. */
const WALLET_AUTHORITY_FIELDS = [
  'kind',
  'authorityId',
  'walletId',
  'principal',
  'provenance',
  'permissions',
  'signerActivations',
  'signerActivationSetDigestB64u',
  'authorityDigestB64u',
  'revocationEpoch',
  'createdAtMs',
  'updatedAtMs',
  'state',
] as const;

export function parseWalletAuthorityV1(raw: unknown): AuthorizationParseResult<WalletAuthorityV1> {
  try {
    const record = requireRecord(raw, 'WalletAuthorityV1');
    const common = parseWalletAuthorityCommon(record);
    switch (record.state) {
      case 'pending_local_install': {
        exactFields(
          record,
          [...WALLET_AUTHORITY_FIELDS, 'localInstallPackageSetDigestB64u'],
          'WalletAuthorityV1',
        );
        return {
          ok: true,
          value: buildPendingWalletAuthorityV1({
            kind: 'wallet_authority_v1',
            ...common,
            state: 'pending_local_install',
            localInstallPackageSetDigestB64u: parseDigestField(
              record.localInstallPackageSetDigestB64u,
              'localInstallPackageSetDigestB64u',
            ),
          }),
        };
      }
      case 'active': {
        exactFields(record, [...WALLET_AUTHORITY_FIELDS, 'activatedAtMs'], 'WalletAuthorityV1');
        return {
          ok: true,
          value: buildActiveWalletAuthorityV1({
            kind: 'wallet_authority_v1',
            ...common,
            state: 'active',
            activatedAtMs: parseSafeInteger(record.activatedAtMs, 'activatedAtMs'),
          }),
        };
      }
      case 'revoked': {
        exactFields(
          record,
          [...WALLET_AUTHORITY_FIELDS, 'activatedAtMs', 'revokedAtMs'],
          'WalletAuthorityV1',
        );
        return {
          ok: true,
          value: buildRevokedWalletAuthorityV1({
            kind: 'wallet_authority_v1',
            ...common,
            state: 'revoked',
            activatedAtMs: parseSafeInteger(record.activatedAtMs, 'activatedAtMs'),
            revokedAtMs: parseSafeInteger(record.revokedAtMs, 'revokedAtMs'),
          }),
        };
      }
      default:
        return invalidResult('WalletAuthorityV1.state is unsupported');
    }
  } catch (error) {
    return invalidResult(errorMessage(error, 'wallet authority is invalid'));
  }
}

type WalletAuthorityDigestFields = Pick<
  WalletAuthorityV1,
  | 'kind'
  | 'authorityId'
  | 'walletId'
  | 'principal'
  | 'provenance'
  | 'permissions'
  | 'signerActivationSetDigestB64u'
  | 'state'
  | 'revocationEpoch'
>;

function encodeWalletAuthorityV1(value: WalletAuthorityDigestFields): Uint8Array {
  const parts: Uint8Array[] = [
    text(WALLET_AUTHORITY_DOMAIN, 'domain'),
    text(value.kind, 'kind'),
    text(value.authorityId, 'authorityId'),
    text(value.walletId, 'walletId'),
    lp32(encodePrincipal(value.principal), 'principal'),
    lp32(encodeProvenance(value.provenance), 'provenance'),
    lp32(encodePermissions(value.permissions), 'permissions'),
    rawDigest(value.signerActivationSetDigestB64u, 'signerActivationSetDigestB64u'),
    text(value.state, 'state'),
    u64(value.revocationEpoch, 'revocationEpoch'),
  ];
  return concat(parts);
}

export async function computeWalletAuthorityDigestB64u(
  value: WalletAuthorityDigestFields,
): Promise<DigestB64u> {
  return parseDigestB64u(base64UrlEncode(await sha256Bytes(encodeWalletAuthorityV1(value))));
}

export async function walletAuthorityDigestsMatchV1(value: WalletAuthorityV1): Promise<boolean> {
  const activationDigest = await computeWalletSignerActivationSetDigestB64u(
    value.signerActivations,
  );
  if (activationDigest !== value.signerActivationSetDigestB64u) return false;
  const authorityDigest = await computeWalletAuthorityDigestB64u(value);
  return authorityDigest === value.authorityDigestB64u;
}

/**
 * True when both authorities' stored digests verify and agree. The authority digest does not
 * cover the timestamps, so those must agree too.
 */
export async function sameVerifiedActiveWalletAuthorityV1(
  left: ActiveWalletAuthorityV1,
  right: ActiveWalletAuthorityV1,
): Promise<boolean> {
  const [leftVerified, rightVerified] = await Promise.all([
    walletAuthorityDigestsMatchV1(left),
    walletAuthorityDigestsMatchV1(right),
  ]);
  return (
    leftVerified &&
    rightVerified &&
    left.authorityDigestB64u === right.authorityDigestB64u &&
    left.signerActivationSetDigestB64u === right.signerActivationSetDigestB64u &&
    left.createdAtMs === right.createdAtMs &&
    left.updatedAtMs === right.updatedAtMs &&
    left.activatedAtMs === right.activatedAtMs
  );
}

function parseWalletAuthorityCommon(
  record: Record<string, unknown>,
): Omit<WalletAuthorityCommonV1, 'kind'> {
  const kind = record.kind;
  if (kind !== 'wallet_authority_v1') throw new Error('WalletAuthorityV1.kind is unsupported');
  const authorityId = requireParsed(parseWalletAuthorityId(record.authorityId), 'authorityId');
  const walletId = requireParsed(parseWalletId(record.walletId), 'walletId');
  const principal = parsePrincipal(record.principal);
  const provenance = parseProvenance(record.provenance);
  const permissions = requireParsed(
    parseDelegatedWalletPermissionSetV1(record.permissions),
    'permissions',
  );
  const signerActivations = requireParsed(
    parseWalletSignerActivationSetV1(record.signerActivations),
    'signerActivations',
  );
  const signerActivationSetDigestB64u = parseDigestField(
    record.signerActivationSetDigestB64u,
    'signerActivationSetDigestB64u',
  );
  const authorityDigestB64u = parseDigestField(record.authorityDigestB64u, 'authorityDigestB64u');
  const revocationEpoch = parseSafeInteger(record.revocationEpoch, 'revocationEpoch');
  const createdAtMs = parseSafeInteger(record.createdAtMs, 'createdAtMs');
  const updatedAtMs = parseSafeInteger(record.updatedAtMs, 'updatedAtMs');
  validateSignerActivationsForWallet(signerActivations, walletId);
  return {
    authorityId,
    walletId,
    principal,
    provenance,
    permissions,
    signerActivations,
    signerActivationSetDigestB64u,
    authorityDigestB64u,
    revocationEpoch,
    createdAtMs,
    updatedAtMs,
  };
}

function validateWalletAuthorityV1(value: WalletAuthorityV1): void {
  if (value.kind !== 'wallet_authority_v1') throw new Error('wallet authority kind is unsupported');
  if (!Number.isSafeInteger(value.revocationEpoch) || value.revocationEpoch < 0) {
    throw new Error('wallet authority revocationEpoch must be a non-negative safe integer');
  }
  validateTimestamp(value.createdAtMs, 'createdAtMs');
  validateTimestamp(value.updatedAtMs, 'updatedAtMs');
  if (value.updatedAtMs < value.createdAtMs) {
    throw new Error('wallet authority updatedAtMs cannot precede createdAtMs');
  }
  parseDigestField(value.signerActivationSetDigestB64u, 'signerActivationSetDigestB64u');
  parseDigestField(value.authorityDigestB64u, 'authorityDigestB64u');
  validateSignerActivationsForWallet(value.signerActivations, value.walletId);
  validateProvenance(value.provenance);
  switch (value.state) {
    case 'pending_local_install':
      parseDigestField(value.localInstallPackageSetDigestB64u, 'localInstallPackageSetDigestB64u');
      break;
    case 'active':
      validateTimestamp(value.activatedAtMs, 'activatedAtMs');
      break;
    case 'revoked':
      validateTimestamp(value.activatedAtMs, 'activatedAtMs');
      validateTimestamp(value.revokedAtMs, 'revokedAtMs');
      if (value.revokedAtMs < value.activatedAtMs) {
        throw new Error('revokedAtMs cannot precede activatedAtMs');
      }
      break;
  }
}

function parsePrincipal(raw: unknown): WalletAuthorityPrincipalV1 {
  const record = exactRecord(raw, ['kind', 'deviceId'], 'WalletAuthorityPrincipalV1');
  if (record.kind !== 'owner_device')
    throw new Error('wallet authority principal kind is unsupported');
  return {
    kind: 'owner_device',
    deviceId: requireParsed(parseDeviceId(record.deviceId), 'deviceId'),
  };
}

function parseProvenance(raw: unknown): WalletAuthorityProvenanceV1 {
  const record = requireRecord(raw, 'WalletAuthorityProvenanceV1');
  switch (record.kind) {
    case 'wallet_registration':
      exactFields(record, ['kind'], 'WalletAuthorityProvenanceV1');
      return { kind: 'wallet_registration' };
    case 'device_link':
      exactFields(
        record,
        ['kind', 'enrollmentId', 'sourceAuthorityId', 'linkSessionId'],
        'WalletAuthorityProvenanceV1',
      );
      return {
        kind: 'device_link',
        enrollmentId: requireParsed(
          parseLinkedDeviceEnrollmentId(record.enrollmentId),
          'enrollmentId',
        ),
        sourceAuthorityId: requireParsed(
          parseWalletAuthorityId(record.sourceAuthorityId),
          'sourceAuthorityId',
        ),
        linkSessionId: requireParsed(
          parseLinkDeviceSessionId(record.linkSessionId),
          'linkSessionId',
        ),
      };
    case 'wallet_recovery':
      exactFields(
        record,
        ['kind', 'recoveryOperationId', 'continuityAuthorityId'],
        'WalletAuthorityProvenanceV1',
      );
      return {
        kind: 'wallet_recovery',
        recoveryOperationId: requireParsed(
          parseWalletRecoveryOperationId(record.recoveryOperationId),
          'recoveryOperationId',
        ),
        continuityAuthorityId: requireParsed(
          parseWalletAuthorityId(record.continuityAuthorityId),
          'continuityAuthorityId',
        ),
      };
    default:
      throw new Error('wallet authority provenance kind is unsupported');
  }
}

function validateProvenance(value: WalletAuthorityProvenanceV1): void {
  switch (value.kind) {
    case 'wallet_registration':
      return;
    case 'device_link':
      if (!value.enrollmentId || !value.sourceAuthorityId || !value.linkSessionId) {
        throw new Error('device-link provenance requires every audit identity');
      }
      return;
    case 'wallet_recovery':
      if (!value.recoveryOperationId || !value.continuityAuthorityId) {
        throw new Error('wallet-recovery provenance requires every audit identity');
      }
      return;
  }
  assertNever(value, 'wallet authority provenance');
}

function validateSignerActivationsForWallet(
  value: WalletSignerActivationSetV1,
  walletId: WalletId,
): void {
  if (value.ed25519 && value.ed25519.signer.walletId !== walletId)
    throw new Error('Ed25519 activation belongs to another wallet');
  if (value.ecdsa && value.ecdsa.signer.walletId !== walletId)
    throw new Error('ECDSA activation belongs to another wallet');
  for (const activation of value.mlDsa ?? [])
    if (activation.signer.walletId !== walletId)
      throw new Error('ML-DSA activation belongs to another wallet');
}

function parseEd25519Activation(raw: unknown, label: string): WalletEd25519SignerActivationV1 {
  const record = exactRecord(raw, ['kind', 'signer', 'materialActivation'], label);
  if (record.kind !== 'wallet_ed25519_signer_activation_v1') {
    throw new Error(`${label}.kind is invalid`);
  }
  const manifest = parseManifestForSigner(record.signer, 'ed25519', `${label}.signer`);
  if (!isEd25519OnlyManifest(manifest)) throw new Error(`${label}.signer is not Ed25519`);
  return buildWalletEd25519SignerActivationV1({
    signer: manifest.signers[0],
    materialActivation: requireParsed(
      parseMpcMaterialActivationRef(record.materialActivation),
      `${label}.materialActivation`,
    ),
  });
}

function parseEcdsaActivation(raw: unknown, label: string): WalletEcdsaSignerActivationV1 {
  const record = exactRecord(raw, ['kind', 'signer', 'materialActivation'], label);
  if (record.kind !== 'wallet_ecdsa_signer_activation_v1') {
    throw new Error(`${label}.kind is invalid`);
  }
  const manifest = parseManifestForSigner(record.signer, 'ecdsa_secp256k1', `${label}.signer`);
  if (!isEcdsaOnlyManifest(manifest)) throw new Error(`${label}.signer is not ECDSA`);
  return buildWalletEcdsaSignerActivationV1({
    signer: manifest.signers[0],
    materialActivation: requireParsed(
      parseMpcMaterialActivationRef(record.materialActivation),
      `${label}.materialActivation`,
    ),
  });
}

function parseManifestForSigner(
  raw: unknown,
  family: 'ed25519' | 'ecdsa_secp256k1',
  _label: string,
): ExactAdministeredSignerManifestV1 {
  return parseExactAdministeredSignerManifestV1({
    kind: 'exact_administered_signer_manifest_v1',
    keyFamilies: [family],
    signers: [raw],
  });
}

function encodeEd25519Activation(value: WalletEd25519SignerActivationV1): Uint8Array {
  return concat([
    text(value.kind, 'ed25519.kind'),
    lp32(encodeEd25519Signer(value.signer), 'ed25519.signer'),
    lp32(encodeMaterialActivation(value.materialActivation), 'ed25519.materialActivation'),
  ]);
}

function encodeEcdsaActivation(value: WalletEcdsaSignerActivationV1): Uint8Array {
  return concat([
    text(value.kind, 'ecdsa.kind'),
    lp32(encodeEcdsaSigner(value.signer), 'ecdsa.signer'),
    lp32(encodeMaterialActivation(value.materialActivation), 'ecdsa.materialActivation'),
  ]);
}

function encodeEd25519Signer(value: ExactAdministeredEd25519SignerV1): Uint8Array {
  return concat([
    text(value.kind, 'ed25519.signer.kind'),
    text(value.keyFamily, 'ed25519.signer.keyFamily'),
    text(value.walletId, 'ed25519.signer.walletId'),
    text(value.walletKeyId, 'ed25519.signer.walletKeyId'),
    lp32(
      rawPublicKey(value.registeredPublicKeyB64u, 'ed25519.signer.registeredPublicKeyB64u'),
      'ed25519.signer.registeredPublicKeyB64u',
    ),
  ]);
}

function encodeEcdsaSigner(value: ExactAdministeredEcdsaSignerV1): Uint8Array {
  return concat([
    text(value.kind, 'ecdsa.signer.kind'),
    text(value.keyFamily, 'ecdsa.signer.keyFamily'),
    text(value.walletId, 'ecdsa.signer.walletId'),
    text(value.walletKeyId, 'ecdsa.signer.walletKeyId'),
    lp32(
      rawPublicKey(value.thresholdPublicKey33B64u, 'ecdsa.signer.thresholdPublicKey33B64u'),
      'ecdsa.signer.thresholdPublicKey33B64u',
    ),
    text(value.evmAddress, 'ecdsa.signer.evmAddress'),
  ]);
}

function encodeMaterialActivation(value: MpcMaterialActivationRef): Uint8Array {
  return concat([
    text(value.kind, 'materialActivation.kind'),
    text(value.activationId, 'materialActivation.activationId'),
    text(value.capability, 'materialActivation.capability'),
    text(value.materialOwner, 'materialActivation.materialOwner'),
    text(value.keyBinding, 'materialActivation.keyBinding'),
    text(value.lifecycleBinding, 'materialActivation.lifecycleBinding'),
    text(value.signingWorker, 'materialActivation.signingWorker'),
  ]);
}

function encodePrincipal(value: WalletAuthorityPrincipalV1): Uint8Array {
  return concat([text(value.kind, 'principal.kind'), text(value.deviceId, 'principal.deviceId')]);
}

function encodeProvenance(value: WalletAuthorityProvenanceV1): Uint8Array {
  switch (value.kind) {
    case 'wallet_registration':
      return text(value.kind, 'provenance.kind');
    case 'device_link':
      return concat([
        text(value.kind, 'provenance.kind'),
        text(value.enrollmentId, 'provenance.enrollmentId'),
        text(value.sourceAuthorityId, 'provenance.sourceAuthorityId'),
        text(value.linkSessionId, 'provenance.linkSessionId'),
      ]);
    case 'wallet_recovery':
      return concat([
        text(value.kind, 'provenance.kind'),
        text(value.recoveryOperationId, 'provenance.recoveryOperationId'),
        text(value.continuityAuthorityId, 'provenance.continuityAuthorityId'),
      ]);
  }
  return assertNever(value, 'wallet authority provenance');
}

function encodePermissions(value: CanonicalDelegatedWalletPermissionSetV1): Uint8Array {
  const parts: Uint8Array[] = [u32(value.length, 'permissions')];
  for (const permission of value)
    parts.push(lp32(text(permission, 'permissions.item'), 'permissions.item'));
  return concat(parts);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requireRecord(value, label);
  exactFields(record, fields, label);
  return record;
}

function exactFields(
  record: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const expected = new Set(fields);
  const actual = Object.keys(record);
  if (actual.length !== fields.length) throw new Error(`${label} contains unexpected fields`);
  for (const field of actual) {
    if (!expected.has(field)) throw new Error(`${label}.${field} is not allowed`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`${label}.${field} is required`);
    }
  }
}

function sameFamilies(left: readonly unknown[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isEd25519OnlyManifest(
  value: ExactAdministeredSignerManifestV1,
): value is Extract<
  ExactAdministeredSignerManifestV1,
  { readonly keyFamilies: readonly ['ed25519'] }
> {
  return value.keyFamilies.length === 1 && value.keyFamilies[0] === 'ed25519';
}

function isEcdsaOnlyManifest(
  value: ExactAdministeredSignerManifestV1,
): value is Extract<
  ExactAdministeredSignerManifestV1,
  { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
> {
  return value.keyFamilies.length === 1 && value.keyFamilies[0] === 'ecdsa_secp256k1';
}

function isEd25519OnlyActivationSet(
  value: WalletSignerActivationSetV1,
): value is Ed25519WalletSignerActivationSetV1 {
  return value.ed25519 !== undefined && value.ecdsa === undefined;
}
function isEcdsaOnlyActivationSet(
  value: WalletSignerActivationSetV1,
): value is EcdsaWalletSignerActivationSetV1 {
  return value.ecdsa !== undefined && value.ed25519 === undefined;
}
function isBothFamilyActivationSet(
  value: WalletSignerActivationSetV1,
): value is CombinedWalletSignerActivationSetV1 {
  return value.ed25519 !== undefined && value.ecdsa !== undefined;
}

function parseDigestField(raw: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(raw);
  } catch (error) {
    throw new Error(`${label} ${errorMessage(error, 'is invalid')}`);
  }
}

function parseSafeInteger(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return raw;
}

function validateTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function requireParsed<T>(
  result:
    | AuthorizationParseResult<T>
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
  label: string,
): T {
  if (result.ok) return result.value;
  throw new Error(`${label} ${result.error.message}`);
}

function invalidResult<T>(message: string): AuthorizationParseResult<T> {
  return { ok: false, error: { code: 'invalid', message } };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function assertNever(value: never, label: string): never {
  throw new Error(`${label} branch is unsupported: ${String(value)}`);
}

/**
 * Re-seals an authority around its new combined signer activations. Both digests are
 * recomputed; identity, provenance, permissions and lifecycle stay as they were.
 */
async function withSignerActivations<T extends WalletSignerActivationSetV1>(
  authority: ActiveWalletAuthorityV1,
  signerActivations: T,
  now: number,
): Promise<ActiveWalletAuthorityV1 & { readonly signerActivations: T }> {
  const signerActivationSetDigestB64u =
    await computeWalletSignerActivationSetDigestB64u(signerActivations);
  const authorityDigestB64u = await computeWalletAuthorityDigestB64u({
    kind: 'wallet_authority_v1',
    authorityId: authority.authorityId,
    walletId: authority.walletId,
    principal: authority.principal,
    provenance: authority.provenance,
    permissions: authority.permissions,
    signerActivationSetDigestB64u,
    state: 'active',
    revocationEpoch: authority.revocationEpoch,
  });
  const next: ActiveWalletAuthorityV1 & { readonly signerActivations: T } = {
    kind: 'wallet_authority_v1',
    authorityId: authority.authorityId,
    walletId: authority.walletId,
    principal: authority.principal,
    provenance: authority.provenance,
    permissions: authority.permissions,
    signerActivations,
    signerActivationSetDigestB64u,
    authorityDigestB64u,
    revocationEpoch: authority.revocationEpoch,
    createdAtMs: authority.createdAtMs,
    updatedAtMs: Math.max(authority.updatedAtMs, now),
    state: 'active',
    activatedAtMs: authority.activatedAtMs,
  };
  validateWalletAuthorityV1(next);
  return next;
}

export async function extendWalletAuthorityWithMlDsa65SignerV1(input: {
  readonly authority: ActiveWalletAuthorityV1;
  readonly signer: ExactAdministeredMlDsa65SignerV1;
  readonly now: number;
}): Promise<ActiveWalletAuthorityV1> {
  if (input.signer.walletId !== input.authority.walletId)
    throw new Error('ML-DSA activation belongs to another wallet');
  const current = input.authority.signerActivations;
  const added: WalletMlDsa65SignerActivationV1 = {
    kind: 'wallet_ml_dsa_65_signer_activation_v1',
    signer: input.signer,
  };
  const entries = [...(current.mlDsa ?? [])];
  for (const existing of entries) {
    if (
      existing.signer.walletKeyId === added.signer.walletKeyId ||
      existing.signer.mlDsaSigningKeyId === added.signer.mlDsaSigningKeyId
    ) {
      if (!sameMlDsaActivation(existing, added))
        throw new Error('The ML-DSA signing key already names another identity');
      return input.authority;
    }
  }
  entries.push(added);
  entries.sort(compareMlDsaActivation);
  return withSignerActivations(
    input.authority,
    assembleSignerActivations(current.ed25519 ?? null, current.ecdsa ?? null, entries),
    input.now,
  );
}
export async function isMlDsaExtensionOfWalletAuthorityV1(
  current: ActiveWalletAuthorityV1,
  next: ActiveWalletAuthorityV1,
): Promise<boolean> {
  if (
    !(await walletAuthorityDigestsMatchV1(current)) ||
    !(await walletAuthorityDigestsMatchV1(next))
  )
    return false;
  let extended = current;
  for (const entry of next.signerActivations.mlDsa ?? []) {
    try {
      extended = await extendWalletAuthorityWithMlDsa65SignerV1({
        authority: extended,
        signer: entry.signer,
        now: next.updatedAtMs,
      });
    } catch {
      return false;
    }
  }
  return (
    extended.authorityDigestB64u === next.authorityDigestB64u &&
    current.createdAtMs === next.createdAtMs &&
    current.activatedAtMs === next.activatedAtMs &&
    next.updatedAtMs >= current.updatedAtMs
  );
}

function compareMlDsaActivation(
  left: WalletMlDsa65SignerActivationV1,
  right: WalletMlDsa65SignerActivationV1,
): number {
  if (left.signer.walletKeyId < right.signer.walletKeyId) return -1;
  if (left.signer.walletKeyId > right.signer.walletKeyId) return 1;
  return 0;
}
function sameMlDsaActivation(
  left: WalletMlDsa65SignerActivationV1,
  right: WalletMlDsa65SignerActivationV1,
): boolean {
  return (
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.mlDsaSigningKeyId === right.signer.mlDsaSigningKeyId &&
    left.signer.registeredPublicKeyB64u === right.signer.registeredPublicKeyB64u &&
    left.signer.keyManifestDigestB64u === right.signer.keyManifestDigestB64u
  );
}
function sameMlDsaActivationSet(
  left: WalletSignerActivationSetV1,
  right: WalletSignerActivationSetV1,
): boolean {
  const a = left.mlDsa ?? [];
  const b = right.mlDsa ?? [];
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1)
    if (!sameMlDsaActivation(a[index], b[index])) return false;
  return true;
}

export async function extendEcdsaWalletAuthorityWithEd25519(input: {
  readonly authority: ActiveEcdsaWalletAuthorityV1;
  readonly ed25519: WalletEd25519SignerActivationV1;
  readonly now: number;
}): Promise<ActiveCombinedWalletAuthorityV1> {
  if (input.ed25519.signer.walletId !== input.authority.walletId) {
    throw new Error('NEAR signer belongs to a different wallet authority');
  }
  const existingEcdsa = input.authority.signerActivations.ecdsa;
  const signerActivationsCandidate = assembleSignerActivations(
    input.ed25519,
    existingEcdsa,
    input.authority.signerActivations.mlDsa ?? [],
  );
  if (!isCombinedWalletSignerActivationSetV1(signerActivationsCandidate)) {
    throw new Error('Deferred Ed25519 activation did not produce a combined signer activation set');
  }
  return withSignerActivations(input.authority, signerActivationsCandidate, input.now);
}

/**
 * An authority holding only a NEAR signer gains the ECDSA signer its owner
 * added. The NEAR activation, identity and lifecycle stay as they were.
 */
export async function extendEd25519WalletAuthorityWithEcdsa(input: {
  readonly authority: ActiveEd25519WalletAuthorityV1;
  readonly ecdsa: WalletEcdsaSignerActivationV1;
  readonly now: number;
}): Promise<ActiveCombinedWalletAuthorityV1> {
  if (input.ecdsa.signer.walletId !== input.authority.walletId) {
    throw new Error('ECDSA signer belongs to a different wallet authority');
  }
  const existingEd25519 = input.authority.signerActivations.ed25519;
  const signerActivationsCandidate = assembleSignerActivations(
    existingEd25519,
    input.ecdsa,
    input.authority.signerActivations.mlDsa ?? [],
  );
  if (!isCombinedWalletSignerActivationSetV1(signerActivationsCandidate)) {
    throw new Error('Added ECDSA activation did not produce a combined signer activation set');
  }
  return withSignerActivations(input.authority, signerActivationsCandidate, input.now);
}

/** `next` keeps everything of `previous` that an added signer must not change. */
function keepsWalletAuthorityApartFromSigners(
  previous: Omit<ActiveWalletAuthorityV1, 'signerActivations'>,
  next: Omit<ActiveWalletAuthorityV1, 'signerActivations'>,
): boolean {
  return (
    previous.authorityId === next.authorityId &&
    previous.walletId === next.walletId &&
    previous.revocationEpoch === next.revocationEpoch &&
    previous.createdAtMs === next.createdAtMs &&
    previous.activatedAtMs === next.activatedAtMs &&
    base64UrlEncode(encodePrincipal(previous.principal)) ===
      base64UrlEncode(encodePrincipal(next.principal)) &&
    base64UrlEncode(encodeProvenance(previous.provenance)) ===
      base64UrlEncode(encodeProvenance(next.provenance)) &&
    base64UrlEncode(encodePermissions(previous.permissions)) ===
      base64UrlEncode(encodePermissions(next.permissions))
  );
}

/**
 * Whether `next` is `previous` with an added ECDSA signer and nothing else
 * changed. Both projections have already passed digest validation.
 */
export function isEcdsaExtensionOfEd25519WalletAuthority(
  previous: ActiveWalletAuthorityV1,
  next: ActiveWalletAuthorityV1,
): boolean {
  return (
    isActiveEd25519WalletAuthorityV1(previous) &&
    isCombinedWalletSignerActivationSetV1(next.signerActivations) &&
    keepsWalletAuthorityApartFromSigners(previous, next) &&
    sameMlDsaActivationSet(previous.signerActivations, next.signerActivations) &&
    base64UrlEncode(encodeEd25519Activation(previous.signerActivations.ed25519)) ===
      base64UrlEncode(encodeEd25519Activation(next.signerActivations.ed25519))
  );
}

/** Both projections have already passed digest validation at their boundaries. */
export function isEd25519ExtensionOfEcdsaWalletAuthority(
  previous: ActiveWalletAuthorityV1,
  next: ActiveWalletAuthorityV1,
): boolean {
  return (
    isActiveEcdsaWalletAuthorityV1(previous) &&
    isCombinedWalletSignerActivationSetV1(next.signerActivations) &&
    previous.provenance.kind === 'wallet_registration' &&
    keepsWalletAuthorityApartFromSigners(previous, next) &&
    sameMlDsaActivationSet(previous.signerActivations, next.signerActivations) &&
    base64UrlEncode(encodeEcdsaActivation(previous.signerActivations.ecdsa)) ===
      base64UrlEncode(encodeEcdsaActivation(next.signerActivations.ecdsa))
  );
}

/** Signer subjects are identical at server and browser session boundaries. */
export function walletSignerCapabilitySubjectsV1(
  activations: WalletSignerActivationSetV1,
  kind: 'sign' | 'export_keys',
): Extract<WalletCapabilitySubjectV1, { kind: 'sign' | 'export_keys' }>[] {
  const subjects: Extract<WalletCapabilitySubjectV1, { kind: 'sign' | 'export_keys' }>[] = [];
  if (activations.ed25519)
    subjects.push({
      kind,
      keyFamily: 'ed25519',
      materialActivation: activations.ed25519.materialActivation,
    });
  if (activations.ecdsa)
    subjects.push({
      kind,
      keyFamily: 'ecdsa_secp256k1',
      materialActivation: activations.ecdsa.materialActivation,
    });
  for (const activation of activations.mlDsa ?? [])
    subjects.push({
      kind,
      keyFamily: 'ml_dsa_65',
      mlDsaSigningKeyId: activation.signer.mlDsaSigningKeyId,
    });
  return subjects;
}

export function walletSignerManifestV1(
  activations: WalletSignerActivationSetV1,
): ExactAdministeredSignerManifestV1 {
  const signers = [];
  if (activations.ed25519) signers.push(activations.ed25519.signer);
  if (activations.ecdsa) signers.push(activations.ecdsa.signer);
  for (const activation of activations.mlDsa ?? []) signers.push(activation.signer);
  return buildExactAdministeredSignerManifestV1(signers);
}
