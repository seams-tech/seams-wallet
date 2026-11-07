import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { functionCall } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import { isPlainObject } from '@shared/utils/validation';
import type {
  SpeakToSignHostOperations,
  SpeakToSignSubmission,
  SpeakToSignVaultTransferArgs,
  SpeakToSignVaultView,
  SpeakToSignVerifyReply,
} from './hostPlugin';
import type { SpeakToSignFeaturePlugin } from './plugins';

const VERIFY_PATH = '/speak-to-sign/v1/verify';
/** The demo client measured `transfer_with_verdict` well below this. */
const TRANSFER_GAS = '50000000000000';

export type SpeakToSignHostOperationsInput = Readonly<{
  feature: SpeakToSignFeaturePlugin;
  ownerAccountId: string;
  /** The Seams server that serves the verify route. */
  serverUrl: string;
  nearClient: Pick<NearClient, 'view'>;
  /** The bearer Wallet Session operation credential that the verify route admits. */
  operationCredential: (signal: AbortSignal) => Promise<string>;
  /** The owner's existing NEAR signing path, bound to the wallet session and the owner account. */
  signAndSendTransaction: (
    transaction: TransactionInput,
    signal: AbortSignal,
  ) => Promise<ActionResult>;
  fetch: typeof fetch;
}>;

/**
 * Builds the scoped operations for one spoken payment. Every transaction goes to the
 * configured vault, calls only `transfer_with_verdict` and attaches no deposit.
 */
export function createSpeakToSignHostOperations(
  input: SpeakToSignHostOperationsInput,
): SpeakToSignHostOperations {
  return {
    viewVault: viewVault.bind(null, input),
    verify: verify.bind(null, input),
    submitTransfer: submitTransfer.bind(null, input),
  };
}

async function viewVault(
  input: SpeakToSignHostOperationsInput,
  view: SpeakToSignVaultView,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  const value = await input.nearClient.view({
    account: input.feature.vault,
    method: view,
    args: view === 'get_verifier' ? {} : { owner_id: input.ownerAccountId },
    decodeResult: identity,
  });
  signal.throwIfAborted();
  return value;
}

async function verify(
  input: SpeakToSignHostOperationsInput,
  verifierInput: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<SpeakToSignVerifyReply> {
  const credential = await input.operationCredential(signal);
  const url = new URL(VERIFY_PATH, input.serverUrl);
  let response: Response;
  try {
    response = await input.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ input: verifierInput }),
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'failed', code: error instanceof Error ? error.name : 'network' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed', code: `http_${response.status}` };
  }
  if (response.ok && isPlainObject(body) && body.ok === true && 'output' in body) {
    return { kind: 'output', output: body.output };
  }
  const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : '';
  return { kind: 'failed', code: code || `http_${response.status}` };
}

async function submitTransfer(
  input: SpeakToSignHostOperationsInput,
  args: SpeakToSignVaultTransferArgs,
  signal: AbortSignal,
): Promise<SpeakToSignSubmission> {
  signal.throwIfAborted();
  const result = await input.signAndSendTransaction(
    {
      receiverId: input.feature.vault,
      actions: [
        functionCall({
          method: 'transfer_with_verdict',
          args: {
            receiver_id: args.receiver_id,
            amount: args.amount,
            nonce: args.nonce,
            verdict_json: args.verdict_json,
            signature_b64: args.signature_b64,
          },
          gas: TRANSFER_GAS,
          deposit: '0',
        }),
      ],
    },
    signal,
  );
  if (!result.success) {
    return result.kind === 'not_submitted'
      ? { kind: 'not_submitted', error: result.error }
      : { kind: 'submission_unknown', error: result.error };
  }
  const failure = executionFailure(result.result);
  return failure === null
    ? { kind: 'executed', transactionHash: result.transactionId }
    : { kind: 'reverted', transactionHash: result.transactionId, error: failure };
}

/** The first failure in the outcome or its receipts, as JSON text, or null. */
function executionFailure(outcome: unknown): string | null {
  if (!isPlainObject(outcome)) return 'missing outcome';
  const statuses: unknown[] = [outcome.status];
  if (Array.isArray(outcome.receipts_outcome)) {
    for (const receipt of outcome.receipts_outcome) {
      if (isPlainObject(receipt) && isPlainObject(receipt.outcome)) {
        statuses.push(receipt.outcome.status);
      }
    }
  }
  for (const status of statuses) {
    if (isPlainObject(status) && 'Failure' in status) {
      return JSON.stringify(status.Failure).slice(0, 400);
    }
  }
  return null;
}

function identity(value: unknown): unknown {
  return value;
}
