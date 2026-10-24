import { WALLET_EMAIL_OTP_EXPORT_OPERATION } from '@shared/utils/emailOtpDomain';
import type {
  MlDsaSeedExportWorkerPayload,
  ExportPrivateKeysWithUiWorkerResult,
} from '@/core/types/secure-confirm-worker';
import { requireCanonicalString } from '@shared/utils/validation';
import { exactRecord } from '@shared/utils/exactRecord';
import { base64UrlDecode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import { parseWalletId } from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import {
  readMlDsaSignerMetadata,
  prepareMlDsaSignerInventory,
  fetchMlDsaSignerInventory,
} from '@/core/rpcClients/relayer/mlDsaInventory';
import { initializeMlDsaCodec } from '@/core/rpcClients/relayer/mlDsaSigning';
import { mlDsaCustodyEnvelopeWire } from './mlDsaRootLinking';
import { awaitUserConfirmationV2 } from '../../uiConfirm/awaitUserConfirmation';
import {
  UserConfirmationType,
  type ExportPrivateKeyDisplayEntry,
} from '../../stepUpConfirmation/channel/confirmTypes';
import { normalizeAuthenticationCredential } from '../../webauthnAuth/credentials/helpers';
import { redactCredentialExtensionOutputs } from '../../webauthnAuth/credentials/credentialExtensions';
import {
  ml_dsa65_export_linked_seed_v1,
  passkey_custody_open_wallet_seed_v1,
} from '../../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';

export async function exportMlDsaSeedWithUi(
  payload: MlDsaSeedExportWorkerPayload,
): Promise<ExportPrivateKeysWithUiWorkerResult> {
  const subject = { kind: 'near_wallet' as const, nearAccountId: payload.nearAccountId };
  const publicKey = `ml-dsa-65:${base58Encode(base64UrlDecode(payload.signer.publicKeyB64u))}`;
  const summary = {
    operation: 'Export Private Key' as const,
    accountId: payload.nearAccountId,
    publicKey,
    warning: 'Anyone with this seed can sign without the wallet service.',
  };
  const authorization = await authorizeExport(payload, summary);
  if (authorization.kind === 'cancelled')
    return {
      kind: 'cancelled',
      accountId: payload.nearAccountId,
      exportedSchemes: [],
      error: authorization.message,
    };
  const factor = authorization.factor;
  const requestId = `ml-dsa-export:${authorization.challenge}`;
  const keys: ExportPrivateKeyDisplayEntry[] = [];
  try {
    const envelope = mlDsaCustodyEnvelopeWire(payload.envelope);
    await initializeMlDsaCodec();
    const exportedJson = exportSeed(payload, factor, envelope);
    const exported = exactRecord(
      JSON.parse(exportedJson),
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
        intentDigest: authorization.challenge,
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

function exportSeed(
  payload: MlDsaSeedExportWorkerPayload,
  factor: Uint8Array,
  envelope: ReturnType<typeof mlDsaCustodyEnvelopeWire>,
): string {
  if (payload.envelope.binding.kind === 'ml_dsa_65_owner_root_v1')
    return ml_dsa65_export_linked_seed_v1(
      factor,
      JSON.stringify(envelope),
      payload.walletId,
      payload.signer.signingKeyId,
      payload.signer.publicKeyB64u,
    );
  const handle = passkey_custody_open_wallet_seed_v1(
    factor,
    envelope.bindingJson,
    base64UrlDecode(envelope.nonceB64u),
    envelope.ciphertextB64u,
    envelope.aadHashB64u,
    envelope.ciphertextDigestB64u,
  );
  // The Rust export method consumes and clears the handle, including on failure.
  return handle.export_ml_dsa65_seed(
    payload.walletId,
    payload.signer.signingKeyId,
    payload.signer.publicKeyB64u,
  );
}

type ExportAuthorization =
  | { readonly kind: 'authorized'; readonly factor: Uint8Array; readonly challenge: string }
  | { readonly kind: 'cancelled'; readonly message: string };
async function authorizeExport(
  payload: MlDsaSeedExportWorkerPayload,
  summary: {
    operation: 'Export Private Key';
    accountId: string;
    publicKey: string;
    warning: string;
  },
): Promise<ExportAuthorization> {
  const walletId = requireParsed(parseWalletId(payload.walletId), 'walletId');
  const auth = payload.auth;
  if (auth.kind === 'email_otp') {
    const before = await readMlDsaSignerMetadata({
      relayerUrl: payload.relayerUrl,
      walletId,
      credential: auth.sessionAuth,
    });
    assertPublishedExportKey(payload, before);
    const { releaseEmailOtpFactorSecret } = await import('./email-otp/otpVerification');
    const released = await releaseEmailOtpFactorSecret({
      kind: 'email_otp',
      relayUrl: payload.relayerUrl,
      walletId,
      authoritySelector: {
        kind: 'wallet_auth_method',
        walletAuthMethodId: auth.walletAuthMethodId,
      },
      challengeId: auth.challengeId,
      otpCode: auth.otpCode,
      operation: WALLET_EMAIL_OTP_EXPORT_OPERATION,
      sessionAuth: auth.sessionAuth,
    });
    try {
      const factor = payload.envelope.factor;
      if (
        factor.kind !== 'email_otp' ||
        factor.enrollmentId !== released.enrollmentId ||
        factor.enrollmentSealKeyVersion !== released.enrollmentSealKeyVersion
      )
        throw new Error('The export envelope differs from the released Email OTP factor');
      const current = await readMlDsaSignerMetadata({
        relayerUrl: payload.relayerUrl,
        walletId,
        credential: auth.sessionAuth,
      });
      assertPublishedExportKey(payload, current);
      return { kind: 'authorized', factor: released.factorSecret32, challenge: auth.challengeId };
    } catch (error) {
      released.factorSecret32.fill(0);
      throw error;
    }
  }
  const preparation = await prepareMlDsaSignerInventory({
    relayerUrl: payload.relayerUrl,
    walletId,
    rpId: auth.rpId,
    credentialIdB64u: auth.credentialIdB64u,
    origin: location.origin,
  });
  if (preparation.kind !== 'prepared') throw new Error(preparation.message);
  const decision = await awaitUserConfirmationV2({
    kind: 'export_request',
    request: {
      requestId: `ml-dsa-export:${preparation.preparation.nonceB64u}`,
      type: UserConfirmationType.AUTHORIZE_KEY_EXPORT,
      summary,
      intentDigest: preparation.challengeB64u,
      payload: {
        subject: { kind: 'near_wallet', nearAccountId: payload.nearAccountId },
        publicKey: summary.publicKey,
        credentialIdB64u: auth.credentialIdB64u,
        challengeB64u: preparation.challengeB64u,
      },
    },
  });
  if (!decision.confirmed || !decision.credential)
    return { kind: 'cancelled', message: decision.error || 'ML-DSA export was cancelled' };
  const credential = normalizeAuthenticationCredential(decision.credential);
  const prf = credential.clientExtensionResults?.prf?.results?.first;
  if (credential.id !== auth.credentialIdB64u || typeof prf !== 'string')
    throw new Error('The selected owner passkey PRF is required');
  const factor = Uint8Array.from(base64UrlDecode(prf));
  credential.clientExtensionResults.prf.results.first = undefined;
  credential.clientExtensionResults.prf.results.second = undefined;
  try {
    const inventory = await fetchMlDsaSignerInventory({
      relayerUrl: payload.relayerUrl,
      preparation: preparation.preparation,
      credential: redactCredentialExtensionOutputs(credential),
    });
    assertPublishedExportKey(payload, inventory);
    return { kind: 'authorized', factor, challenge: preparation.challengeB64u };
  } catch (error) {
    factor.fill(0);
    throw error;
  }
}
function assertPublishedExportKey(
  payload: MlDsaSeedExportWorkerPayload,
  inventory: import('@shared/near/mlDsaInventory').MlDsaSignerInventoryOutcome,
): void {
  if (inventory.kind !== 'inventory') throw new Error(inventory.message);
  if (!inventory.entries.some(matchesPublishedSigner.bind(undefined, payload)))
    throw new Error('The ML-DSA signer publication changed before export');
}
