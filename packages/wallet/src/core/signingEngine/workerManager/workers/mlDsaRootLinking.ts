import { initializeMlDsaCodec } from '@/core/rpcClients/relayer/mlDsaSigning';
import {
  ml_dsa65_verify_linked_root_v1,
  ml_dsa65_forward_linked_root_v1,
  passkey_custody_open_wallet_seed_v1,
} from '../../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';
import { custodyEnvelopeBindingJsonV1 } from '@shared/passkey-custody';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import type { MlDsaRootTransferBindingV1 } from '@shared/device-linking/mlDsaExportRoot';
import { base64UrlDecode } from '@shared/utils/base64';

export async function verifyLinkedRoot(
  envelope: PasskeyCustodyEnvelopeRecord,
  factor: Uint8Array,
): Promise<void> {
  if (envelope.binding.kind !== 'ml_dsa_65_owner_root_v1')
    throw new Error('Expected an ML-DSA root');
  await initializeMlDsaCodec();
  ml_dsa65_verify_linked_root_v1(
    factor,
    JSON.stringify(mlDsaCustodyEnvelopeWire(envelope)),
    envelope.walletId,
    envelope.binding.mlDsaSigningKeyId,
    envelope.binding.registeredPublicKeyB64u,
  );
}

export async function sealLinkedRoot(
  envelope: PasskeyCustodyEnvelopeRecord,
  factor: Uint8Array,
  binding: MlDsaRootTransferBindingV1,
): Promise<unknown> {
  await initializeMlDsaCodec();
  const wire = mlDsaCustodyEnvelopeWire(envelope);
  if (envelope.binding.kind === 'ml_dsa_65_owner_root_v1')
    return JSON.parse(
      ml_dsa65_forward_linked_root_v1(factor, JSON.stringify(wire), JSON.stringify(binding)),
    );
  if (envelope.binding.kind !== 'wallet_custody_seed_v1')
    throw new Error('This envelope cannot derive an ML-DSA root');
  const handle = passkey_custody_open_wallet_seed_v1(
    factor,
    wire.bindingJson,
    base64UrlDecode(wire.nonceB64u),
    wire.ciphertextB64u,
    wire.aadHashB64u,
    wire.ciphertextDigestB64u,
  );
  try {
    return JSON.parse(handle.seal_ml_dsa65_root_for_linked_device_v1(JSON.stringify(binding)));
  } finally {
    handle.destroy();
    handle.free();
  }
}

export function mlDsaCustodyEnvelopeWire(envelope: PasskeyCustodyEnvelopeRecord) {
  if (
    envelope.binding.kind !== 'wallet_custody_seed_v1' &&
    envelope.binding.kind !== 'ml_dsa_65_owner_root_v1'
  )
    throw new Error('An ML-DSA root or wallet seed envelope is required');
  return {
    bindingJson: custodyEnvelopeBindingJsonV1(envelope),
    nonceB64u: envelope.nonceB64u,
    ciphertextB64u: envelope.sealedCustodySecretB64u,
    aadHashB64u: envelope.aadHashB64u,
    ciphertextDigestB64u: envelope.ciphertextDigestB64u,
  };
}
