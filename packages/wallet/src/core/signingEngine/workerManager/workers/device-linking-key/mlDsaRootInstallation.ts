import { initializeMlDsaCodec } from '@/core/rpcClients/relayer/mlDsaSigning';
import {
  ml_dsa65_link_recipient_v1,
  ml_dsa65_accept_linked_root_v1,
  type WasmMlDsa65LinkRecipientV1,
} from '../../../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';
import {
  parseX25519PublicKeyB64u,
  parseEnvelopeNonceB64u,
  parseEnvelopeCiphertextB64u,
  parseEnvelopeRevision,
} from '@shared/passkey-custody/primitives';
import { parsePasskeyEnvelopeId, type WalletKeyId } from '@shared/utils/domainIds';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { exactRecord } from '@shared/utils/exactRecord';
import {
  buildActiveEnvelopeLifecycle,
  buildMethodBoundEnvelopeOwnership,
  buildPasskeyCustodyEnvelopeRecord,
  custodyEnvelopeBindingJsonV1,
  type WalletCustodyEnvelopeFactor,
} from '@shared/passkey-custody';
import { mlDsaRootEnvelopeBindingV1 } from '@shared/device-linking/mlDsaExportRoot';
import type {
  CommittedAuthorityPackagesV1,
  CommittedMlDsaSignerPackageV1,
} from '@shared/device-linking/committedSignerPackages';
import type { WalletAuthorityExportRootRecordV1 } from '@/core/indexedDB';

const recipients = new Map<
  string,
  { readonly recipient: WasmMlDsa65LinkRecipientV1; readonly walletKeyId: WalletKeyId }
>();

export async function createMlDsaRootRecipient(walletKeyId: WalletKeyId) {
  await initializeMlDsaCodec();
  if (recipients.size >= 128) throw new Error('Too many ML-DSA link recipients');
  const recipient = ml_dsa65_link_recipient_v1();
  const recipientHandleId = crypto.randomUUID();
  recipients.set(recipientHandleId, { recipient, walletKeyId });
  return {
    recipientHandleId,
    recipientPublicKeyB64u: parseX25519PublicKeyB64u(recipient.public_key_b64u()),
  };
}

export function discardMlDsaRootRecipient(recipientHandleId: string): void {
  const entry = recipients.get(recipientHandleId);
  recipients.delete(recipientHandleId);
  entry?.recipient.free();
}

export async function installMlDsaRoot(input: {
  readonly recipientHandleId: string;
  readonly packageValue: CommittedMlDsaSignerPackageV1;
  readonly committed: CommittedAuthorityPackagesV1;
  readonly factor: WalletCustodyEnvelopeFactor;
  readonly factorSecret: Uint8Array;
}): Promise<WalletAuthorityExportRootRecordV1> {
  const entry = recipients.get(input.recipientHandleId);
  recipients.delete(input.recipientHandleId);
  if (!entry) throw new Error('The ML-DSA recipient is consumed or unavailable');
  try {
    const transfer = input.packageValue.exportRoot;
    const binding = transfer.binding;
    const authMethod = input.committed.authMethod;
    if (
      entry.walletKeyId !== input.packageValue.signer.walletKeyId ||
      binding.walletAuthMethodId !== authMethod.walletAuthMethodId ||
      input.factor.kind !== authMethod.kind
    )
      throw new Error('The ML-DSA recipient belongs to another key or factor');
    if (
      input.factor.kind === 'passkey' &&
      (authMethod.kind !== 'passkey' ||
        input.factor.rpId !== authMethod.rpId ||
        input.factor.credentialIdB64u !== authMethod.credentialIdB64u)
    )
      throw new Error('The ML-DSA root factor differs from the approved passkey');
    const parsedId = parsePasskeyEnvelopeId(`ml-dsa-root:${crypto.randomUUID()}`);
    if (!parsedId.ok) throw new Error(parsedId.error.message);
    const envelopeId = parsedId.value;
    const ownership = buildMethodBoundEnvelopeOwnership(authMethod.walletAuthMethodId);
    const root = mlDsaRootEnvelopeBindingV1(binding);
    const envelopeRevision = parseEnvelopeRevision(1);
    const bindingJson = custodyEnvelopeBindingJsonV1({
      walletId: binding.walletId,
      envelopeId,
      ownership,
      binding: root,
      factor: input.factor,
      envelopeRevision,
    });
    const sealed = exactRecord(
      JSON.parse(
        ml_dsa65_accept_linked_root_v1(
          entry.recipient,
          input.factorSecret,
          JSON.stringify(binding),
          JSON.stringify(transfer.sealed),
          bindingJson,
        ),
      ),
      ['nonceB64u', 'sealedCustodySecretB64u', 'aadHashB64u', 'ciphertextDigestB64u'],
      'ML-DSA sealed root',
    );
    const now = Date.now();
    return {
      kind: 'wallet_authority_export_root_v1',
      authorityId: input.committed.authority.authorityId,
      walletAuthMethodId: authMethod.walletAuthMethodId,
      walletKeyId: input.packageValue.signer.walletKeyId,
      envelope: buildPasskeyCustodyEnvelopeRecord({
        walletId: binding.walletId,
        envelopeId,
        ownership,
        binding: root,
        factor: input.factor,
        envelopeRevision,
        nonceB64u: parseEnvelopeNonceB64u(sealed.nonceB64u),
        sealedCustodySecretB64u: parseEnvelopeCiphertextB64u(sealed.sealedCustodySecretB64u),
        aadHashB64u: parseDigestB64u(sealed.aadHashB64u),
        ciphertextDigestB64u: parseDigestB64u(sealed.ciphertextDigestB64u),
        lifecycle: buildActiveEnvelopeLifecycle({ activatedAtMs: now }),
        createdAtMs: now,
        updatedAtMs: now,
      }),
    };
  } finally {
    entry.recipient.free();
  }
}
