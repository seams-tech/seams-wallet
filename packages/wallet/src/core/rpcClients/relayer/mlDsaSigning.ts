import { MinimalNearClient } from '../near/NearClient';
import { base64UrlDecode } from '@shared/utils/base64';
import type { MlDsaSignedTransaction } from '@shared/near/mlDsaSigning';
import {
  parseMlDsaSigningPreparation,
  parseMlDsaSigningFailure,
  parseMlDsaSignedTransaction,
  parseMlDsaSigningRequest,
  parseMlDsaTransactionInspection,
  parseMlDsaStockProgress,
  type MlDsaSigningPreparation,
  type MlDsaSigningPreparationOutcome,
  type MlDsaSigningOutcome,
} from '@shared/near/mlDsaSigning';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { alphabetizeStringify } from '@shared/utils/digests';
import {
  type MlDsaSigningAuthorization,
  type MlDsaSigningSessionRequest,
  type MlDsaSigningSessionCredential,
  parseMlDsaSigningSessionPreparation,
} from '@shared/near/mlDsaSigningSession';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '@shared/utils/walletManagementProtocol';
import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import { normalizeAuthenticationCredential } from '@/core/signingEngine/webauthnAuth/credentials/helpers';
import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import { buildRelayerJsonPostRequestInit, normalizeRelayerBaseUrl } from './relayerHttp';

export async function loadMlDsaCodec() {
  const codec = await import('../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js');
  await codec.default({
    module_or_path: resolveWasmUrl('ml_dsa_signer_bg.wasm', 'ML-DSA transaction verifier'),
  });
  return codec;
}

export async function initializeMlDsaCodec(): Promise<void> {
  await loadMlDsaCodec();
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
  path: 'sign/prepare' | 'sign' | 'session/prepare' | 'session/revoke',
  body: unknown,
  access: { readonly kind: 'public' } | { readonly kind: 'wallet_session'; readonly token: string },
): Promise<unknown> {
  const response = await fetch(
    `${normalizeRelayerBaseUrl(relayerUrl)}/wallets/${encodeURIComponent(walletId)}/ml-dsa/${path}`,
    buildRelayerJsonPostRequestInit({
      headers: {
        [WALLET_MANAGEMENT_PROTOCOL_HEADER]: WALLET_MANAGEMENT_PROTOCOL_VERSION,
        ...(access.kind === 'wallet_session' ? { authorization: `Bearer ${access.token}` } : {}),
      },
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
  readonly access:
    | { readonly kind: 'public' }
    | { readonly kind: 'wallet_session'; readonly token: string };
  readonly publicKeyB64u: string;
}): Promise<MlDsaSigningPreparationOutcome> {
  const request = parseMlDsaSigningRequest(input.request);
  const codec = await loadMlDsaCodec();
  const transaction = parseMlDsaTransactionInspection(
    JSON.parse(
      codec.ml_dsa65_inspect_near_transaction(
        JSON.stringify({
          unsignedTransactionBorshB64u: request.unsignedTransactionBorshB64u,
          publicKeyB64u: input.publicKeyB64u,
        }),
      ),
    ),
  );
  const raw = requireRecord(
    await post(input.relayerUrl, request.walletId, 'sign/prepare', request, input.access),
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
  readonly authorization: MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>;
}): Promise<MlDsaSigningOutcome> {
  const preparation = input.preparation;
  const raw = requireRecord(
    await post(
      input.relayerUrl,
      preparation.request.walletId,
      'sign',
      {
        walletId: preparation.request.walletId,
        operationIdB64u: preparation.request.operationIdB64u,
        authorization: encodedAuthorization(input.authorization),
      },
      { kind: 'public' },
    ),
    'ML-DSA signing outcome',
  );
  switch (raw.kind) {
    case 'refused':
      return parseMlDsaSigningFailure(raw);
    case 'retry': {
      const retry = exactRecord(
        raw,
        raw.reason === 'empty_pool'
          ? ['kind', 'reason', 'retryAfterMs', 'stock']
          : ['kind', 'reason', 'retryAfterMs'],
        'ML-DSA signing retry',
      );
      if (
        (retry.reason !== 'empty_pool' &&
          retry.reason !== 'service_capacity' &&
          retry.reason !== 'wallet_cooldown' &&
          retry.reason !== 'running') ||
        typeof retry.retryAfterMs !== 'number' ||
        !Number.isSafeInteger(retry.retryAfterMs) ||
        retry.retryAfterMs < 0
      )
        throw new Error('Invalid ML-DSA retry');
      if (retry.reason === 'empty_pool')
        return {
          kind: 'retry',
          reason: 'empty_pool',
          retryAfterMs: retry.retryAfterMs,
          stock: retry.stock === null ? null : parseMlDsaStockProgress(retry.stock),
        };
      return { kind: 'retry', reason: retry.reason, retryAfterMs: retry.retryAfterMs };
    }
    case 'signed': {
      const signed = exactRecord(raw, ['kind', 'transaction'], 'ML-DSA signing success');
      const supplied = parseMlDsaSignedTransaction(signed.transaction);
      const codec = await loadMlDsaCodec();
      const verified = parseMlDsaSignedTransaction(
        JSON.parse(
          codec.ml_dsa65_finalize_near_transaction(
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

function encodedAuthorization(
  authorization: MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>,
) {
  switch (authorization.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        credential: redactCredentialExtensionOutputs(authorization.credential),
      };
    case 'email_otp':
      return { kind: 'email_otp', proof: authorization.proof };
    case 'email_otp_session_start':
      return {
        kind: 'email_otp_session_start',
        proof: authorization.proof,
        sessionIdB64u: authorization.sessionIdB64u,
        tokenB64u: authorization.tokenB64u,
      };
    case 'session_start':
      return {
        kind: 'session_start',
        credential: redactCredentialExtensionOutputs(authorization.credential),
        sessionIdB64u: authorization.sessionIdB64u,
        tokenB64u: authorization.tokenB64u,
      };
    case 'session':
      return {
        kind: 'session',
        sessionIdB64u: authorization.sessionIdB64u,
        tokenB64u: authorization.tokenB64u,
      };
    default:
      return assertNever(authorization);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unknown ML-DSA signing authorization: ${String(value)}`);
}

export async function prepareMlDsaSigningSession(input: {
  readonly relayerUrl: string;
  readonly request: MlDsaSigningSessionRequest;
}) {
  const response = requireRecord(
    await post(input.relayerUrl, input.request.walletId, 'session/prepare', input.request, {
      kind: 'public',
    }),
    'ML-DSA session preparation',
  );
  if (response.kind === 'refused') return parseMlDsaSigningFailure(response);
  const prepared = exactRecord(response, ['kind', 'preparation'], 'ML-DSA session preparation');
  if (prepared.kind !== 'prepared') throw new Error('Invalid ML-DSA session preparation');
  return {
    kind: 'prepared' as const,
    preparation: parseMlDsaSigningSessionPreparation(prepared.preparation),
  };
}

export async function revokeMlDsaSigningSession(input: {
  readonly relayerUrl: string;
  readonly credential: MlDsaSigningSessionCredential;
}) {
  const response = requireRecord(
    await post(input.relayerUrl, input.credential.walletId, 'session/revoke', input.credential, {
      kind: 'public',
    }),
    'ML-DSA session revocation',
  );
  if (response.kind === 'refused') return parseMlDsaSigningFailure(response);
  exactRecord(response, ['kind'], 'ML-DSA session revocation');
  if (response.kind !== 'revoked') throw new Error('Invalid ML-DSA session revocation');
  return { kind: 'revoked' as const };
}

/** Submission verifies the complete transaction again before using the existing NEAR RPC client. */
export async function submitMlDsaNearTransaction(input: {
  readonly rpcUrl: string;
  readonly preparation: MlDsaSigningPreparation;
  readonly transaction: MlDsaSignedTransaction;
}) {
  const codec = await loadMlDsaCodec();
  const verified = parseMlDsaSignedTransaction(
    JSON.parse(
      codec.ml_dsa65_finalize_near_transaction(
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
