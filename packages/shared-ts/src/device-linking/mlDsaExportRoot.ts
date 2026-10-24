import { exactRecord } from '../utils/exactRecord';
import { requireCanonicalString } from '../utils/validation';
import { parseDigestB64u, sha256DigestB64u, type DigestB64u } from '../utils/canonicalPrimitives';
import { concat, text } from '../utils/digestEncoding';
import {
  parseWalletId,
  parseWalletAuthMethodId,
  type WalletId,
  type WalletAuthMethodId,
} from '../utils/domainIds';
import {
  requireParsed,
  parseX25519PublicKeyB64u,
  type X25519PublicKeyB64u,
  parseEnvelopeCiphertextB64u,
  type EnvelopeCiphertextB64u,
} from '../passkey-custody/primitives';
import {
  buildMlDsa65OwnerRootBindingV1,
  parsePasskeyCustodySecretBinding,
  type MlDsa65OwnerRootBindingV1,
} from '../passkey-custody/custodySecretBinding';
import type { ExactAdministeredMlDsa65SignerV1 } from './delegatedActivationPlan';
import type { LinkedDeviceTargetPreparationV1 } from './contracts';

export type MlDsaRootTransferBindingV1 = {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly root: Omit<MlDsa65OwnerRootBindingV1, 'kind'>;
  readonly recipientPublicKeyB64u: X25519PublicKeyB64u;
};
export type SealedMlDsaRootTransferV1 = {
  readonly encapsulatedKeyB64u: X25519PublicKeyB64u;
  readonly ciphertextB64u: EnvelopeCiphertextB64u;
  readonly bindingDigestB64u: DigestB64u;
  readonly ciphertextDigestB64u: DigestB64u;
};
export type LinkedDeviceMlDsaExportRootPackageV1 = {
  readonly kind: 'linked_device_ml_dsa_65_export_root_package_v1';
  readonly binding: MlDsaRootTransferBindingV1;
  readonly sealed: SealedMlDsaRootTransferV1;
};

export async function buildMlDsaRootTransferBindingV1(input: {
  readonly signer: ExactAdministeredMlDsa65SignerV1;
  readonly target: Pick<
    LinkedDeviceTargetPreparationV1,
    | 'walletId'
    | 'linkSessionId'
    | 'walletAuthMethodId'
    | 'enrollmentId'
    | 'deviceId'
    | 'targetFactor'
  >;
  readonly revocationEpoch: number;
  readonly recipientPublicKeyB64u: X25519PublicKeyB64u;
}): Promise<MlDsaRootTransferBindingV1> {
  const { signer, target } = input;
  if (signer.walletId !== target.walletId) throw new Error('The target belongs to another wallet');
  const applicationBindingDigestB64u = await sha256DigestB64u(
    concat([
      new TextEncoder().encode('seams/wallet-custody/ml-dsa-65/application-binding/v1'),
      text('walletId', 'wallet label'),
      text(signer.walletId, 'walletId'),
      text('mlDsa65SigningKeyId', 'key label'),
      text(signer.mlDsaSigningKeyId, 'signingKeyId'),
    ]),
  );
  return {
    walletId: signer.walletId,
    walletAuthMethodId: target.walletAuthMethodId,
    root: {
      linkSessionId: target.linkSessionId,
      walletKeyId: signer.walletKeyId,
      mlDsaSigningKeyId: signer.mlDsaSigningKeyId,
      targetFactor: { kind: target.targetFactor.kind },
      applicationBindingDigestB64u,
      registeredPublicKeyB64u: signer.registeredPublicKeyB64u,
      keyManifestDigestB64u: signer.keyManifestDigestB64u,
      enrollmentId: target.enrollmentId,
      deviceId: target.deviceId,
      revocationEpoch: input.revocationEpoch,
    },
    recipientPublicKeyB64u: input.recipientPublicKeyB64u,
  };
}

export function parseMlDsaRootTransferBindingV1(raw: unknown): MlDsaRootTransferBindingV1 {
  const r = exactRecord(
    raw,
    ['walletId', 'walletAuthMethodId', 'root', 'recipientPublicKeyB64u'],
    'ML-DSA root transfer binding',
  );
  const fields = exactRecord(
    r.root,
    [
      'linkSessionId',
      'walletKeyId',
      'mlDsaSigningKeyId',
      'targetFactor',
      'applicationBindingDigestB64u',
      'registeredPublicKeyB64u',
      'keyManifestDigestB64u',
      'enrollmentId',
      'deviceId',
      'revocationEpoch',
    ],
    'ML-DSA transfer root',
  );
  const binding = parsePasskeyCustodySecretBinding({ kind: 'ml_dsa_65_owner_root_v1', ...fields });
  if (binding.kind !== 'ml_dsa_65_owner_root_v1') throw new Error('The transfer root kind differs');
  return {
    walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
    walletAuthMethodId: requireParsed(
      parseWalletAuthMethodId(r.walletAuthMethodId),
      'walletAuthMethodId',
    ),
    recipientPublicKeyB64u: parseX25519PublicKeyB64u(r.recipientPublicKeyB64u),
    root: {
      linkSessionId: binding.linkSessionId,
      walletKeyId: binding.walletKeyId,
      mlDsaSigningKeyId: binding.mlDsaSigningKeyId,
      targetFactor: binding.targetFactor,
      applicationBindingDigestB64u: binding.applicationBindingDigestB64u,
      registeredPublicKeyB64u: binding.registeredPublicKeyB64u,
      keyManifestDigestB64u: binding.keyManifestDigestB64u,
      enrollmentId: binding.enrollmentId,
      deviceId: binding.deviceId,
      revocationEpoch: binding.revocationEpoch,
    },
  };
}
export function mlDsaRootEnvelopeBindingV1(
  binding: MlDsaRootTransferBindingV1,
): MlDsa65OwnerRootBindingV1 {
  return buildMlDsa65OwnerRootBindingV1(binding.root);
}
export function parseSealedMlDsaRootTransferV1(raw: unknown): SealedMlDsaRootTransferV1 {
  const r = exactRecord(
    raw,
    ['encapsulatedKeyB64u', 'ciphertextB64u', 'bindingDigestB64u', 'ciphertextDigestB64u'],
    'ML-DSA sealed root',
  );
  const ciphertext = requireCanonicalString(r.ciphertextB64u, 'root ciphertext');
  if (ciphertext.length !== 64) throw new Error('The sealed root must contain 48 bytes');
  return {
    encapsulatedKeyB64u: parseX25519PublicKeyB64u(r.encapsulatedKeyB64u),
    ciphertextB64u: parseEnvelopeCiphertextB64u(ciphertext),
    bindingDigestB64u: parseDigestB64u(r.bindingDigestB64u),
    ciphertextDigestB64u: parseDigestB64u(r.ciphertextDigestB64u),
  };
}
export function parseLinkedDeviceMlDsaExportRootPackageV1(
  raw: unknown,
): LinkedDeviceMlDsaExportRootPackageV1 {
  const r = exactRecord(raw, ['kind', 'binding', 'sealed'], 'ML-DSA export-root package');
  if (r.kind !== 'linked_device_ml_dsa_65_export_root_package_v1')
    throw new Error('Invalid ML-DSA export-root package kind');
  return {
    kind: 'linked_device_ml_dsa_65_export_root_package_v1',
    binding: parseMlDsaRootTransferBindingV1(r.binding),
    sealed: parseSealedMlDsaRootTransferV1(r.sealed),
  };
}
