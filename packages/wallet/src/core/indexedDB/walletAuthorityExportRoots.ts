import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import type { WalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { WalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { WalletAuthorityExportRootRecordV1 } from './passkeyClientDB.types';

/** Validate the complete root set before installation or unlock. */
export function assertWalletAuthorityExportRoots(
  authority: WalletAuthorityV1,
  authMethod: WalletAuthMethodRecordV2,
  roots: readonly WalletAuthorityExportRootRecordV1[],
): void {
  const expected = new Map<string, 'ed25519' | 'ml_dsa_65'>();
  if (authority.permissions.includes('export_keys')) {
    if (authority.signerActivations.ed25519)
      expected.set(authority.signerActivations.ed25519.signer.walletKeyId, 'ed25519');
    for (const key of authority.signerActivations.mlDsa ?? [])
      expected.set(key.signer.walletKeyId, 'ml_dsa_65');
  }
  if (roots.length !== expected.size)
    throw new Error('The export roots do not cover the authority signer set');
  for (const root of roots) {
    const family = expected.get(root.walletKeyId);
    if (!family) throw new Error('An export root is duplicated or unexpected');
    expected.delete(root.walletKeyId);
    const envelope = root.envelope;
    const binding = envelope.binding;
    if (
      (binding.kind !== 'ed25519_yao_client_root_v1' &&
        binding.kind !== 'ml_dsa_65_owner_root_v1') ||
      root.authorityId !== authority.authorityId ||
      root.walletAuthMethodId !== authMethod.walletAuthMethodId ||
      envelope.walletId !== authority.walletId ||
      binding.walletKeyId !== root.walletKeyId ||
      envelope.lifecycle.state !== 'active' ||
      authority.principal.kind !== 'owner_device' ||
      String(binding.deviceId) !== String(authority.principal.deviceId) ||
      envelope.ownership.kind !== 'method_bound' ||
      envelope.ownership.walletAuthMethodId !== authMethod.walletAuthMethodId ||
      authority.provenance.kind !== 'device_link' ||
      binding.linkSessionId !== authority.provenance.linkSessionId ||
      binding.enrollmentId !== authority.provenance.enrollmentId ||
      binding.revocationEpoch !== authority.revocationEpoch
    )
      throw new Error('An export root differs from its device authority');
    if (authMethod.kind === 'passkey') {
      if (
        envelope.factor.kind !== 'passkey' ||
        binding.targetFactor.kind !== 'passkey_prf' ||
        envelope.factor.rpId !== authMethod.rpId ||
        envelope.factor.credentialIdB64u !== authMethod.credentialIdB64u
      )
        throw new Error('An export root belongs to another passkey');
    } else if (envelope.factor.kind !== 'email_otp' || binding.targetFactor.kind !== 'email_otp')
      throw new Error('An export root has the wrong factor');
    if (family === 'ed25519') {
      if (
        binding.kind !== 'ed25519_yao_client_root_v1' ||
        binding.registeredPublicKeyB64u !==
          authority.signerActivations.ed25519?.signer.registeredPublicKeyB64u
      )
        throw new Error('The Ed25519 export root names another signer');
    } else {
      let matches = false;
      for (const key of authority.signerActivations.mlDsa ?? []) {
        if (
          key.signer.walletKeyId === root.walletKeyId &&
          binding.kind === 'ml_dsa_65_owner_root_v1' &&
          binding.mlDsaSigningKeyId === key.signer.mlDsaSigningKeyId &&
          binding.registeredPublicKeyB64u === key.signer.registeredPublicKeyB64u &&
          binding.keyManifestDigestB64u === key.signer.keyManifestDigestB64u
        )
          matches = true;
      }
      if (!matches) throw new Error('The ML-DSA export root names another signer');
    }
  }
}

export function exportRootEnvelope(root: WalletAuthorityExportRootRecordV1): PasskeyCustodyEnvelopeRecord {
  return root.envelope;
}
