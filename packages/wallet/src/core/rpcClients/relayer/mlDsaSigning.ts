import { MinimalNearClient } from '../near/NearClient';
import { base64UrlDecode } from '@shared/utils/base64';
import type { MlDsaSignedTransaction } from '@shared/near/mlDsaSigning';
import {
  parseMlDsaSigningPreparation,
  parseMlDsaSigningFailure,
  parseMlDsaSignedTransaction,
  parseMlDsaSigningRequest,
  parseMlDsaTransactionInspection,
  type MlDsaSigningPreparation,
  type MlDsaSigningPreparationOutcome,
  type MlDsaSigningOutcome,
} from '@shared/near/mlDsaSigning';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { alphabetizeStringify } from '@shared/utils/digests';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '@shared/utils/walletManagementProtocol';
import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import { normalizeAuthenticationCredential } from '@/core/signingEngine/webauthnAuth/credentials/helpers';
import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import initSigner, {
  ml_dsa65_inspect_near_transaction,
  ml_dsa65_finalize_near_transaction,
} from '../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import { buildRelayerJsonPostRequestInit, normalizeRelayerBaseUrl } from './relayerHttp';

export async function initializeMlDsaCodec(): Promise<void> {
  await initSigner({
    module_or_path: resolveWasmUrl('wasm_signer_worker_bg.wasm', 'ML-DSA transaction verifier'),
  });
}
/** Serialize an ordinary assertion without requiring or releasing PRF outputs. */
export function serializeMlDsaWebAuthnApproval(
  credential: PublicKeyCredential,
): WebAuthnAuthenticationCredential {
  return redactCredentialExtensionOutputs(normalizeAuthenticationCredential(credential.toJSON()));
}
async function post(
  relayerUrl: string,
  walletId: string,
  path: 'sign/prepare' | 'sign',
  body: unknown,
): Promise<unknown> {
  const response = await fetch(
    `${normalizeRelayerBaseUrl(relayerUrl)}/wallets/${encodeURIComponent(walletId)}/ml-dsa/${path}`,
    buildRelayerJsonPostRequestInit({
      headers: { [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION },
      body,
    }),
  );
  const raw: unknown = await response.json();
  const result = requireRecord(raw, 'ML-DSA signing response');
  if (!response.ok && result.kind !== 'refused') throw new Error('ML-DSA signing Gateway failed');
  return raw;
}

/** Review preparation. The caller compares the displayed transaction before collecting WebAuthn approval. */
export async function prepareMlDsaNearSigning(input: {
  readonly relayerUrl: string;
  readonly request: unknown;
  readonly publicKeyB64u: string;
}): Promise<MlDsaSigningPreparationOutcome> {
  const request = parseMlDsaSigningRequest(input.request);
  await initializeMlDsaCodec();
  const transaction = parseMlDsaTransactionInspection(
    JSON.parse(
      ml_dsa65_inspect_near_transaction(
        JSON.stringify({
          unsignedTransactionBorshB64u: request.unsignedTransactionBorshB64u,
          publicKeyB64u: input.publicKeyB64u,
        }),
      ),
    ),
  );
  const raw = requireRecord(
    await post(input.relayerUrl, request.walletId, 'sign/prepare', request),
    'ML-DSA approval preparation',
  );
  if (raw.kind === 'refused') return parseMlDsaSigningFailure(raw);
  const prepared = exactRecord(raw, ['kind', 'preparation'], 'ML-DSA approval preparation');
  if (prepared.kind !== 'prepared') throw new Error('Invalid ML-DSA approval preparation');
  const preparation = parseMlDsaSigningPreparation(prepared.preparation);
  if (
    alphabetizeStringify(preparation.request) !== alphabetizeStringify(request) ||
    alphabetizeStringify(preparation.transaction) !== alphabetizeStringify(transaction)
  )
    throw new Error('The Gateway changed the ML-DSA transaction approval');
  return { kind: 'prepared', preparation };
}

/** Exact retries retain this preparation and this assertion. Pool retries do not request a new approval. */
export async function executeMlDsaNearSigning(input: {
  readonly relayerUrl: string;
  readonly preparation: MlDsaSigningPreparation;
  readonly credential: WebAuthnAuthenticationCredential;
}): Promise<MlDsaSigningOutcome> {
  const preparation = input.preparation;
  const raw = requireRecord(
    await post(input.relayerUrl, preparation.request.walletId, 'sign', {
      walletId: preparation.request.walletId,
      operationIdB64u: preparation.request.operationIdB64u,
      credential: redactCredentialExtensionOutputs(input.credential),
    }),
    'ML-DSA signing outcome',
  );
  switch (raw.kind) {
    case 'refused':
      return parseMlDsaSigningFailure(raw);
    case 'retry': {
      const retry = exactRecord(raw, ['kind', 'reason', 'retryAtMs'], 'ML-DSA signing retry');
      if (
        (retry.reason !== 'unavailable' && retry.reason !== 'running') ||
        typeof retry.retryAtMs !== 'number' ||
        !Number.isSafeInteger(retry.retryAtMs) ||
        retry.retryAtMs < 0
      )
        throw new Error('Invalid ML-DSA retry');
      return { kind: 'retry', reason: retry.reason, retryAtMs: retry.retryAtMs };
    }
    case 'signed': {
      const signed = exactRecord(raw, ['kind', 'transaction'], 'ML-DSA signing success');
      const supplied = parseMlDsaSignedTransaction(signed.transaction);
      await initializeMlDsaCodec();
      const verified = parseMlDsaSignedTransaction(
        JSON.parse(
          ml_dsa65_finalize_near_transaction(
            JSON.stringify({
              unsignedTransactionBorshB64u: preparation.request.unsignedTransactionBorshB64u,
              publicKeyB64u: preparation.transaction.publicKeyB64u,
              signatureB64u: supplied.signatureB64u,
            }),
          ),
        ),
      );
      if (alphabetizeStringify(supplied) !== alphabetizeStringify(verified))
        throw new Error('The Gateway changed the signed ML-DSA transaction');
      return { kind: 'signed', transaction: verified };
    }
    default:
      throw new Error('Invalid ML-DSA signing outcome');
  }
}

/** Submission verifies the complete transaction again before using the existing NEAR RPC client. */
export async function submitMlDsaNearTransaction(input: {
  readonly rpcUrl: string;
  readonly preparation: MlDsaSigningPreparation;
  readonly transaction: MlDsaSignedTransaction;
}) {
  await initializeMlDsaCodec();
  const verified = parseMlDsaSignedTransaction(
    JSON.parse(
      ml_dsa65_finalize_near_transaction(
        JSON.stringify({
          unsignedTransactionBorshB64u: input.preparation.request.unsignedTransactionBorshB64u,
          publicKeyB64u: input.preparation.transaction.publicKeyB64u,
          signatureB64u: input.transaction.signatureB64u,
        }),
      ),
    ),
  );
  if (alphabetizeStringify(verified) !== alphabetizeStringify(input.transaction))
    throw new Error('The ML-DSA transaction changed before submission');
  return new MinimalNearClient(input.rpcUrl).sendSignedTransactionBytes(
    base64UrlDecode(verified.signedTransactionBorshB64u),
  );
}
