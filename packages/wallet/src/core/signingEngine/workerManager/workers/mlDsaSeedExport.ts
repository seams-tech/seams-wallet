import type {
  MlDsaSeedExportWorkerPayload,
  ExportPrivateKeysWithUiWorkerResult,
} from '@/core/types/secure-confirm-worker';
import { requireCanonicalString } from '@shared/utils/validation';
import { exactRecord } from '@shared/utils/exactRecord';
import { base64UrlDecode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import {
  parseWalletId,
} from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import {
  prepareMlDsaSignerInventory,
  fetchMlDsaSignerInventory,
} from '@/core/rpcClients/relayer/mlDsaInventory';
import { initializeMlDsaCodec } from '@/core/rpcClients/relayer/mlDsaSigning';
import { walletCustodyCacheEnvelopeFromRecordV1 } from '../../walletCustody/openCustodyCache';
import { awaitUserConfirmationV2 } from '../../uiConfirm/awaitUserConfirmation';
import {
  UserConfirmationType,
  type ExportPrivateKeyDisplayEntry,
} from '../../stepUpConfirmation/channel/confirmTypes';
import { normalizeAuthenticationCredential } from '../../webauthnAuth/credentials/helpers';
import { redactCredentialExtensionOutputs } from '../../webauthnAuth/credentials/credentialExtensions';
import { passkey_custody_open_wallet_seed_v1 } from '../../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';

export async function exportMlDsaSeedWithUi(
  payload: MlDsaSeedExportWorkerPayload,
): Promise<ExportPrivateKeysWithUiWorkerResult> {
  const walletId = requireParsed(parseWalletId(payload.walletId), 'walletId');
  const preparation = await prepareMlDsaSignerInventory({
    relayerUrl: payload.relayerUrl,
    walletId,
    rpId: payload.rpId,
    credentialIdB64u: payload.credentialIdB64u,
    origin: location.origin,
  });
  if (preparation.kind !== 'prepared') throw new Error(preparation.message);
  const subject = { kind: 'near_wallet' as const, nearAccountId: payload.nearAccountId };
  const requestId = `ml-dsa-export:${preparation.preparation.nonceB64u}`;
  const publicKey = `ml-dsa-65:${base58Encode(base64UrlDecode(payload.signer.publicKeyB64u))}`;
  const summary = {
    operation: 'Export Private Key' as const,
    accountId: payload.nearAccountId,
    publicKey,
    warning: 'Anyone with this seed can sign without the wallet service.',
  };
  const decision = await awaitUserConfirmationV2({
    kind: 'export_request',
    request: {
      requestId,
      type: UserConfirmationType.AUTHORIZE_KEY_EXPORT,
      summary,
      intentDigest: preparation.challengeB64u,
      payload: {
        subject,
        publicKey,
        credentialIdB64u: payload.credentialIdB64u,
        challengeB64u: preparation.challengeB64u,
      },
    },
  });
  if (!decision.confirmed || !decision.credential)
    return {
      kind: 'cancelled',
      accountId: payload.nearAccountId,
      exportedSchemes: [],
      error: decision.error || 'ML-DSA export was cancelled',
    };
  const credential = normalizeAuthenticationCredential(decision.credential);
  const prf = credential.clientExtensionResults?.prf?.results?.first;
  if (credential.id !== payload.credentialIdB64u || typeof prf !== 'string')
    throw new Error('ML-DSA export requires the selected owner’s passkey PRF');
  const factor = Uint8Array.from(base64UrlDecode(prf));
  credential.clientExtensionResults.prf.results.first = undefined;
  credential.clientExtensionResults.prf.results.second = undefined;
  const keys: ExportPrivateKeyDisplayEntry[] = [];
  try {
    const inventory = await fetchMlDsaSignerInventory({
      relayerUrl: payload.relayerUrl,
      preparation: preparation.preparation,
      credential: redactCredentialExtensionOutputs(credential),
    });
    if (inventory.kind !== 'inventory') throw new Error(inventory.message);
    const entry = inventory.entries.find(matchesPublishedSigner.bind(undefined, payload));
    if (!entry) throw new Error('The ML-DSA signer publication changed before export');
    const envelope = walletCustodyCacheEnvelopeFromRecordV1(payload.envelope);
    await initializeMlDsaCodec();
    const handle = passkey_custody_open_wallet_seed_v1(
      factor,
      envelope.bindingJson,
      base64UrlDecode(envelope.nonceB64u),
      envelope.ciphertextB64u,
      envelope.aadHashB64u,
      envelope.ciphertextDigestB64u,
    );
    const exported = exactRecord(
      JSON.parse(
        handle.export_ml_dsa65_seed(
          walletId,
          payload.signer.signingKeyId,
          payload.signer.publicKeyB64u,
        ),
      ),
      ['format', 'publicKeyB64u', 'seedB64u'],
      'ML-DSA seed export',
    );
    keys.push({
      scheme: 'ml_dsa_65',
      label: 'ML-DSA-65 canonical FIPS seed (base64url)',
      publicKey,
      privateKey: requireCanonicalString(exported.seedB64u, 'ML-DSA seed'),
    });
    exported.seedB64u = '';
    await awaitUserConfirmationV2({
      kind: 'export_request',
      request: {
        requestId: `${requestId}:viewer`,
        type: UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI,
        summary,
        intentDigest: preparation.challengeB64u,
        payload: {
          subject,
          viewerSessionId: payload.viewerSessionId,
          publicKey,
          keys,
          variant: payload.variant,
          theme: payload.theme,
          loading: false,
        },
      },
    });
    return { kind: 'completed', accountId: payload.nearAccountId, exportedSchemes: ['ml_dsa_65'] };
  } finally {
    factor.fill(0);
    for (const key of keys) key.privateKey = '';
    keys.length = 0;
  }
}

function matchesPublishedSigner(
  payload: MlDsaSeedExportWorkerPayload,
  entry: import('@shared/near/mlDsaInventory').MlDsaSignerInventoryEntry,
): boolean {
  return (
    entry.kind === 'published' &&
    entry.key.signingKeyId === payload.signer.signingKeyId &&
    entry.key.publicKeyB64u === payload.signer.publicKeyB64u &&
    entry.key.keyManifestDigestB64u === payload.signer.keyManifestDigestB64u &&
    entry.key.materialEpoch === payload.signer.materialEpoch
  );
}
