/**
 * NEAR signer worker.
 *
 * Numeric request types go to the Rust message handler, which returns one result per request.
 * String request types call the transaction, delegate and NEP-413 helpers exported by the
 * same WASM module directly.
 */

import {
  NearSignerWorkerCustomRequestType,
  WorkerRequestType,
  type SignerWorkerRequestType,
} from '@/core/types/signer-worker';
// Import WASM binary directly
import init, {
  handle_signer_message,
  threshold_ed25519_build_delegate_signing_payload,
  threshold_ed25519_build_near_tx_unsigned_borsh,
  threshold_ed25519_compute_delegate_signing_digest,
  threshold_ed25519_compute_nep413_signing_digest,
  threshold_ed25519_decode_signed_near_tx_borsh,
  threshold_ed25519_finalize_delegate_from_signature,
  threshold_ed25519_finalize_near_tx_from_signature,
} from '../../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import { base64UrlEncode } from '@shared/utils/base64';
import { errorLogSummary, safeErrorMessage } from '@shared/utils/errors';
import { WorkerControlMessage } from '../workerTypes';

/**
 * WASM Asset Path Resolution for Signer Worker
 *
 * Uses centralized path resolution strategy from walletRuntimePaths/wasm-loader.ts
 * See walletRuntimePaths/wasm-loader.ts for detailed documentation on how paths work across:
 * - SDK building (Rolldown)
 * - Playwright E2E tests
 * - Frontend dev installing from npm
 */

// Resolve WASM URL using the centralized resolution strategy
const wasmUrl = resolveWasmUrl('wasm_signer_worker_bg.wasm', 'Signer Worker');
// UserConfirm bridge removed: signer no longer initiates confirmations

let wasmInitPromise: Promise<void> | null = null;
let messageQueue: Promise<void> = Promise.resolve();

/**
 * Initialize WASM module
 */
async function initializeWasm(): Promise<void> {
  if (wasmInitPromise) return wasmInitPromise;
  wasmInitPromise = (async () => {
    try {
      await init({ module_or_path: wasmUrl });
    } catch (error: unknown) {
      // Allow retry if init fails (e.g., transient path/config issues during dev).
      wasmInitPromise = null;
      console.error('[signer-worker]: WASM initialization failed:', errorLogSummary(error));
      throw new Error(`WASM initialization failed: ${safeErrorMessage(error)}`);
    }
  })();
  return wasmInitPromise;
}

async function prewarmWasmAndSignalWorkerReady(): Promise<void> {
  try {
    await initializeWasm();
  } catch {
    // The operation path reports initialization failures with request context.
  }
  self.postMessage({ type: WorkerControlMessage.WORKER_READY, ready: true });
}

void prewarmWasmAndSignalWorkerReady();

/**
 * Process a WASM worker message (main operation)
 */
async function processWorkerMessage(event: MessageEvent): Promise<void> {
  const requestId = String((event.data as { id?: unknown })?.id || '').trim();
  if (!requestId) {
    throw new Error('Signer worker request is missing RPC id');
  }

  try {
    const requestType = (event.data as { type?: unknown })?.type;
    // Guardrail: raw PRF fields must never traverse into signer payloads
    assertNoPrfSecretsInSignerPayload(event.data, requestType);
    await initializeWasm();
    const response =
      typeof requestType === 'string'
        ? await handleCustomNearSignerRequest(
            requestType,
            (event.data as { payload?: unknown }).payload,
          )
        : await handle_signer_message(event.data);
    self.postMessage({
      id: requestId,
      ok: true,
      result: response,
    });
  } catch (error: unknown) {
    console.error('[signer-worker]: Message processing failed:', errorLogSummary(error));
    self.postMessage({
      id: requestId,
      ok: false,
      error: safeErrorMessage(error),
      code: 'WORKER_RUNTIME_ERROR',
    });
  }
}

type SignerWorkerRpcRequest = {
  id: string;
  type: SignerWorkerRequestType;
  payload: unknown;
};

self.onmessage = async (event: MessageEvent<SignerWorkerRpcRequest>): Promise<void> => {
  const requestId = String((event.data as { id?: unknown })?.id || '').trim();
  if (!requestId) {
    console.warn('[signer-worker]: Ignoring message without request id');
    return;
  }
  const eventType = event.data?.type;

  if (typeof eventType !== 'number' && typeof eventType !== 'string') {
    console.warn('[signer-worker]: Ignoring message with invalid type:', eventType);
    return;
  }

  // Serialize worker operations to keep WASM state predictable and to avoid
  // overlapping accesses to PRF-derived material and relayer state.
  messageQueue = messageQueue.catch(() => undefined).then(() => processWorkerMessage(event));
  await messageQueue;
};

async function handleCustomNearSignerRequest(type: string, payload: unknown): Promise<unknown> {
  switch (type) {
    case NearSignerWorkerCustomRequestType.ThresholdEd25519ComputeNep413SigningDigest:
      return {
        signingDigestB64u: base64UrlEncode(
          threshold_ed25519_compute_nep413_signing_digest(payload),
        ),
      };
    case NearSignerWorkerCustomRequestType.ThresholdEd25519ComputeDelegateSigningDigest:
      return {
        signingDigestB64u: base64UrlEncode(
          threshold_ed25519_compute_delegate_signing_digest(payload),
        ),
      };
    case NearSignerWorkerCustomRequestType.ThresholdEd25519BuildDelegateSigningPayload:
      return requireDelegateSigningPayloadOutput(
        threshold_ed25519_build_delegate_signing_payload(payload),
      );
    case NearSignerWorkerCustomRequestType.ThresholdEd25519FinalizeDelegateFromSignature:
      return requireSignedDelegateOutput(
        threshold_ed25519_finalize_delegate_from_signature(payload),
      );
    case NearSignerWorkerCustomRequestType.ThresholdEd25519FinalizeNearTxFromSignature:
      return requireFinalizeNearTxFromSignatureOutput(
        threshold_ed25519_finalize_near_tx_from_signature(payload),
      );
    case NearSignerWorkerCustomRequestType.ThresholdEd25519BuildNearTxUnsignedBorsh:
      return requireNearTxUnsignedBorshOutput(
        threshold_ed25519_build_near_tx_unsigned_borsh(payload),
      );
    case NearSignerWorkerCustomRequestType.ThresholdEd25519DecodeSignedNearTxBorsh:
      return requireSignedNearTxOutput(threshold_ed25519_decode_signed_near_tx_borsh(payload));
    default:
      throw new Error(`Unsupported near signer custom request type: ${type}`);
  }
}

function secretB64uField(prefix: string): string {
  return `${prefix}B64u`;
}

function requireSignedDelegateOutput(output: unknown): unknown {
  const parsed = output as { delegateAction?: unknown; signature?: unknown; borshBytes?: unknown };
  if (!parsed?.delegateAction || !parsed.signature || !parsed.borshBytes) {
    throw new Error('threshold_ed25519_finalize_delegate_from_signature returned invalid output');
  }
  return output;
}

function requireDelegateSigningPayloadOutput(output: unknown): {
  canonicalDelegateBorshB64u: string;
  signingDigestB64u: string;
} {
  const parsed = output as {
    canonicalDelegateBorshB64u?: unknown;
    signingDigestB64u?: unknown;
  };
  const canonicalDelegateBorshB64u = String(parsed?.canonicalDelegateBorshB64u || '').trim();
  const signingDigestB64u = String(parsed?.signingDigestB64u || '').trim();
  if (!canonicalDelegateBorshB64u || !signingDigestB64u) {
    throw new Error('threshold_ed25519_build_delegate_signing_payload returned invalid output');
  }
  return { canonicalDelegateBorshB64u, signingDigestB64u };
}

function requireFinalizeNearTxFromSignatureOutput(output: unknown): {
  signedTransactionBorshB64u: string;
  transactionHash: string;
} {
  const parsed = output as {
    signedTransactionBorshB64u?: unknown;
    transactionHash?: unknown;
  };
  const signedTransactionBorshB64u = String(parsed?.signedTransactionBorshB64u || '').trim();
  const transactionHash = String(parsed?.transactionHash || '').trim();
  if (!signedTransactionBorshB64u || !transactionHash) {
    throw new Error('threshold_ed25519_finalize_near_tx_from_signature returned invalid output');
  }
  return { signedTransactionBorshB64u, transactionHash };
}

function requireNearTxUnsignedBorshOutput(output: unknown): {
  unsignedTransactionBorshB64u: string;
  signingDigestB64u: string;
}[] {
  if (!Array.isArray(output)) {
    throw new Error('threshold_ed25519_build_near_tx_unsigned_borsh returned invalid output');
  }
  return output.map((item) => {
    const parsed = item as {
      unsignedTransactionBorshB64u?: unknown;
      signingDigestB64u?: unknown;
    };
    const unsignedTransactionBorshB64u = String(parsed?.unsignedTransactionBorshB64u || '').trim();
    const signingDigestB64u = String(parsed?.signingDigestB64u || '').trim();
    if (!unsignedTransactionBorshB64u || !signingDigestB64u) {
      throw new Error('threshold_ed25519_build_near_tx_unsigned_borsh returned invalid item');
    }
    return { unsignedTransactionBorshB64u, signingDigestB64u };
  });
}

function requireSignedNearTxOutput(output: unknown): unknown {
  const parsed = output as {
    signedTransaction?: { transaction?: unknown; signature?: unknown; borshBytes?: unknown };
    transactionHash?: unknown;
  };
  if (
    !parsed?.signedTransaction?.transaction ||
    !parsed.signedTransaction.signature ||
    !parsed.signedTransaction.borshBytes ||
    !String(parsed.transactionHash || '').trim()
  ) {
    throw new Error('threshold_ed25519_decode_signed_near_tx_borsh returned invalid output');
  }
  return output;
}

function assertNoPrfSecretsInSignerPayload(data: unknown, requestType: unknown): void {
  const payload =
    data && typeof data === 'object' ? (data as { payload?: unknown }).payload : undefined;
  if (!payload || typeof payload !== 'object') return;
  const payloadRecord = payload as Record<string, unknown>;
  const forbiddenKeys = [
    'prfOutput',
    'prf_output',
    'prfFirst',
    'prf_first',
    secretB64uField('prfFirst'),
    'prf_first_b64u',
    'prf',
    'nearPrivateKey',
    'privateKey',
    secretB64uField('xClientBase'),
    secretB64uField('clientOutputMask'),
    secretB64uField('canonicalSeed'),
    secretB64uField('seed'),
    secretB64uField('signingShare32'),
  ];
  const requestForbiddenKeys =
    requestType === WorkerRequestType.DeriveThresholdEd25519ClientVerifyingShare
      ? forbiddenKeys.filter((key) => key !== secretB64uField('prfFirst'))
      : forbiddenKeys;
  for (const key of requestForbiddenKeys) {
    if (payloadRecord[key] !== undefined) {
      throw new Error(`Forbidden secret field in signer payload: ${key}`);
    }
  }
}

self.onerror = (message, filename, lineno, colno, error) => {
  console.error('[signer-worker]: error:', {
    message: safeErrorMessage(typeof message === 'string' ? message : 'Unknown error'),
    filename: filename || 'unknown',
    lineno: lineno || 0,
    colno: colno || 0,
    error: errorLogSummary(error),
  });
};

self.onunhandledrejection = (event) => {
  console.error('[signer-worker]: Unhandled promise rejection:', errorLogSummary(event.reason));
  event.preventDefault();
};
