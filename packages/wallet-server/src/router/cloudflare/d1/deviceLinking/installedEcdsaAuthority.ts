import { base64UrlEncode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual, type MpcMaterialActivationRef } from '@shared/utils/domainIds';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type {
  InstalledLinkedDeviceEcdsaAuthorityProjectionV1,
  StoredInstallationRow,
} from './d1LinkedDeviceAuthorityInstallService';

const LINKED_ECDSA_CUSTODY_CHAIN_MAX_DEPTH = 16;

export function findInstalledEcdsaAuthority(
  rows: readonly StoredInstallationRow[],
  materialActivation: MpcMaterialActivationRef,
): InstalledLinkedDeviceEcdsaAuthorityProjectionV1 | null {
  let match: StoredInstallationRow | null = null;
  for (const row of rows) {
    const material = row.packages.signerPackages.ecdsa?.materialActivation;
    if (!material || !mpcMaterialActivationRefsEqual(material, materialActivation)) continue;
    if (match) return null;
    match = row;
  }
  return match ? projectInstalledEcdsaAuthority(match) : null;
}

/** Every hop observes the same verified installation set from one database read. */
export function installedEcdsaAuthorityChain(
  rows: readonly StoredInstallationRow[],
  materialActivation: MpcMaterialActivationRef,
): readonly InstalledLinkedDeviceEcdsaAuthorityProjectionV1[] {
  const chain: InstalledLinkedDeviceEcdsaAuthorityProjectionV1[] = [];
  let activation = materialActivation;
  for (let depth = 0; depth < LINKED_ECDSA_CUSTODY_CHAIN_MAX_DEPTH; depth += 1) {
    let projection: InstalledLinkedDeviceEcdsaAuthorityProjectionV1 | null;
    try {
      projection = findInstalledEcdsaAuthority(rows, activation);
    } catch {
      break;
    }
    if (!projection) break;
    chain.push(projection);
    activation = projection.activationReceipt.binding.source.activation;
  }
  return chain;
}

export function projectInstalledEcdsaAuthority(
  stored: StoredInstallationRow,
): InstalledLinkedDeviceEcdsaAuthorityProjectionV1 | null {
  if (stored.activatedAtMs === null || stored.installedRecordSetDigestB64u === null) return null;
  const packages = stored.packages;
  if (
    packages.authority.authorityId !== stored.authorityId ||
    packages.authority.walletId !== stored.walletId ||
    packages.authMethod.walletAuthMethodId !== stored.authMethodId ||
    packages.authMethod.walletId !== stored.walletId ||
    packages.authMethod.walletAuthorityId !== stored.authorityId ||
    packages.authority.provenance.kind !== 'device_link' ||
    packages.authority.provenance.linkSessionId !== stored.linkSessionId ||
    packages.authority.principal.deviceId !== stored.deviceId
  ) {
    return null;
  }
  const signerPackage = packages.signerPackages.ecdsa;
  const authorityActivation = packages.authority.signerActivations.ecdsa;
  if (!signerPackage || !authorityActivation) return null;

  const receipt = signerPackage.activationReceipt;
  const source = receipt.binding.source;
  const target = receipt.binding.target;
  const sourceScope = receipt.sourceDerivation.sourceNormalSigning.scope;
  const targetScope = receipt.normalSigning.scope;
  const authorityEthereumAddress = ecdsaAuthorityEvmAddressB64u(
    authorityActivation.signer.evmAddress,
  );
  if (
    authorityEthereumAddress === null ||
    !mpcMaterialActivationRefsEqual(
      signerPackage.materialActivation,
      authorityActivation.materialActivation,
    ) ||
    !mpcMaterialActivationRefsEqual(signerPackage.materialActivation, target.activation) ||
    !mpcMaterialActivationRefsEqual(
      signerPackage.materialActivation,
      routerAbMpcMaterialActivationRefFromWire(targetScope.material_activation),
    ) ||
    String(receipt.binding.linkSessionId) !== String(stored.linkSessionId) ||
    String(receipt.binding.enrollmentId) !== String(packages.authority.provenance.enrollmentId) ||
    String(receipt.binding.sourceAuthorityId) !==
      String(packages.authority.provenance.sourceAuthorityId) ||
    target.targetDeviceId !== stored.deviceId ||
    target.targetFactorVerificationDigestB64u !== stored.targetFactorVerificationDigestB64u ||
    signerPackage.encryptedTargetClientShare.recipientPublicKeyB64u !==
      target.clientRecipientPublicKeyB64u ||
    sourceScope.wallet_id !== String(stored.walletId) ||
    targetScope.wallet_id !== String(stored.walletId) ||
    !mpcMaterialActivationRefsEqual(
      routerAbMpcMaterialActivationRefFromWire(sourceScope.material_activation),
      source.activation,
    ) ||
    sourceScope.public_identity.client_share_retry_counter !==
      targetScope.public_identity.client_share_retry_counter ||
    sourceScope.public_identity.server_share_retry_counter !==
      targetScope.public_identity.server_share_retry_counter ||
    targetScope.signing_worker.server_id !== target.activation.signingWorker ||
    targetScope.public_identity.derivation_client_share_public_key33_b64u !==
      receipt.binding.targetClientPublicKey33B64u ||
    targetScope.public_identity.server_public_key33_b64u !== receipt.targetRelayerPublicKey33B64u ||
    targetScope.public_identity.threshold_public_key33_b64u !== receipt.thresholdPublicKey33B64u ||
    targetScope.public_identity.ethereum_address20_b64u !==
      receipt.thresholdEthereumAddress20B64u ||
    authorityActivation.signer.walletId !== stored.walletId ||
    authorityActivation.signer.thresholdPublicKey33B64u !== receipt.thresholdPublicKey33B64u ||
    authorityEthereumAddress !== receipt.thresholdEthereumAddress20B64u
  ) {
    return null;
  }
  return {
    walletId: stored.walletId,
    authorityId: stored.authorityId,
    walletAuthMethodId: stored.authMethodId,
    linkSessionId: stored.linkSessionId,
    deviceId: stored.deviceId,
    materialActivation: signerPackage.materialActivation,
    signer: authorityActivation.signer,
    activationReceipt: receipt,
    installedRecordSetDigestB64u: stored.installedRecordSetDigestB64u,
    activatedAtMs: stored.activatedAtMs,
  };
}

function ecdsaAuthorityEvmAddressB64u(value: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  const bytes = new Uint8Array(20);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return base64UrlEncode(bytes);
}
