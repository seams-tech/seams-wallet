import { expect, test } from '@playwright/test';
import { MinimalNearClient, SignedTransaction } from '@/core/rpcClients/near/NearClient';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { parseNearTransactionResult } from '@/core/signingEngine/nearTransactionSubmission';
import {
  beginTransactionActivity,
  observeTransactionActivity,
  retainTransactionActivity,
} from '@/core/signingEngine/uiConfirm/ui/transaction-activity';
import {
  receiptDescription,
  receiptHeading,
  type TransactionReceiptModel,
} from '@/core/signingEngine/uiConfirm/ui/transaction-receipt';
import type { ActionResult } from '@/core/types/seams';
import type { WasmSignature, WasmTransaction } from '@/core/types/signer-worker';
import { walletDisplayText } from '@/core/ui/messages';
import { sendTransaction } from '@/SeamsWeb/operations/near/actions';
import type { NearSigningWebContext } from '@/SeamsWeb/signingSurface/types';
import type {
  ChildToParentEnvelope,
  ParentToChildEnvelope,
} from '@/SeamsWeb/walletIframe/shared/messages';
import {
  FAILED_TRANSACTION_HASH,
  OWNER_ACCOUNT_ID,
  contractPanicResponse,
  notEnoughBalanceResponse,
  successResponse,
  timeoutResponse,
} from './helpers/nearSendTransaction.fixtures';

const RPC_URL = 'https://rpc.testnet.example';
const lease = {
  leaseId: 'lease-1',
  operationId: 'operation-1',
  operationFingerprint: 'fingerprint-1',
  nonce: '276792631000001',
};

type Broadcast = {
  result: ActionResult;
  /** The nonce coordinator calls, in order. */
  leaseCalls: string[];
  requests: number;
  receipt: TransactionReceiptModel | null;
};

let requestNumber = 0;

/** Sends the fixture transaction through the wallet's broadcast path and its receipt. */
async function broadcast(
  responses: readonly unknown[],
  firstBroadcast: boolean,
): Promise<Broadcast> {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    const body = responses[Math.min(requests, responses.length - 1)];
    requests += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const leaseCalls: string[] = [];
  const coordinator = {
    markBroadcastAccepted: async () => void leaseCalls.push('accepted'),
    markFinalized: async () => void leaseCalls.push('finalized'),
    markBroadcastRejected: async () => void leaseCalls.push('rejected'),
  };
  const context = {
    nearClient: new MinimalNearClient(RPC_URL),
    signingEngine: { getNonceCoordinator: () => coordinator },
  } as unknown as NearSigningWebContext;
  const signedTransaction = new SignedTransaction({
    transaction: { signerId: OWNER_ACCOUNT_ID } as unknown as WasmTransaction,
    signature: {} as WasmSignature,
    borsh_bytes: [1, 2, 3],
    transactionHash: FAILED_TRANSACTION_HASH,
    nonceLease: lease,
  });

  // The hosted wallet forwards progress and the final result to the receipt.
  const requestId = `request-${++requestNumber}`;
  const post = (_message: ChildToParentEnvelope) => {};
  let receipt: TransactionReceiptModel | null = null;
  beginTransactionActivity(
    { type: 'PM_SIGN_AND_SEND_TX', requestId } as ParentToChildEnvelope,
    post,
  );
  retainTransactionActivity(requestId, {
    element: { isConnected: true } as HTMLElement,
    showReceipt: (model) => {
      receipt = model;
    },
    dispose: () => {},
  });
  try {
    const result = await sendTransaction({
      context,
      nearAccountId: OWNER_ACCOUNT_ID,
      walletSession: {
        walletId: toWalletId('frost-vermillion-k7p9m2'),
        walletSessionUserId: 'frost-vermillion-k7p9m2',
      },
      signedTransaction,
      options: {
        onEvent: (event) =>
          observeTransactionActivity({
            type: 'PROGRESS',
            requestId,
            payload: event,
          } as ChildToParentEnvelope),
      },
      firstBroadcast,
    });
    // The result crosses postMessage to the application and to the receipt.
    const wire: unknown = structuredClone(result);
    expect(parseNearTransactionResult(wire)).toEqual(result);
    observeTransactionActivity({
      type: 'PM_RESULT',
      requestId,
      payload: { ok: true, result: wire },
    } as ChildToParentEnvelope);
    return { result, leaseCalls, requests, receipt };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function receiptText(receipt: TransactionReceiptModel | null) {
  if (!receipt) throw new Error('The receipt did not show');
  const description = receiptDescription(receipt);
  return {
    heading: receiptHeading(receipt),
    description,
    japanese: walletDisplayText('ja', description),
  };
}

test('a final Failure is a revert that keeps the contract panic', async () => {
  const { result, leaseCalls, requests, receipt } = await broadcast(
    [contractPanicResponse],
    true,
  );

  expect(requests).toBe(1);
  expect(result).toMatchObject({
    success: false,
    kind: 'reverted',
    transactionId: FAILED_TRANSACTION_HASH,
    error: 'The contract refused the call: Smart contract panicked: account is not speakable',
    result: { status: { Failure: contractPanicResponse.result.status.Failure } },
  });
  // The transaction took its nonce, so the lease settles as it does for a success.
  expect(leaseCalls).toEqual(['accepted', 'finalized']);
  expect(receiptText(receipt)).toEqual({
    heading: 'Transaction reverted',
    description:
      'The contract refused the call: Smart contract panicked: account is not speakable',
    japanese:
      'コントラクトが呼び出しを拒否しました：Smart contract panicked: account is not speakable',
  });
});

test('a NotEnoughBalance rejection of the only request is not submitted', async () => {
  const { result, leaseCalls, requests, receipt } = await broadcast(
    [notEnoughBalanceResponse],
    true,
  );

  expect(requests).toBe(1);
  const error =
    'NEAR rejected this transaction before it ran, so nothing was submitted. ' +
    'The account has 0.01 NEAR, and the transaction can cost up to 0.15031 NEAR.';
  expect(result).toEqual({
    success: false,
    kind: 'not_submitted',
    error,
    rejection: {
      error: 'NotEnoughBalance',
      permanence: 'state_dependent',
      fields: {
        signer_id: OWNER_ACCOUNT_ID,
        balance: '10000000000000000000000',
        cost: '150318000000000000000000',
      },
    },
  });
  expect(leaseCalls).toEqual(['rejected']);
  expect(receiptText(receipt)).toEqual({
    heading: 'Transaction failed',
    description: error,
    japanese:
      'NEAR が実行前にこのトランザクションを拒否したため、何も送信されていません。' +
      'アカウントの残高は 0.01 NEAR で、このトランザクションには最大 0.15031 NEAR かかる可能性があります。',
  });
});

test('a rejection after a repeated request stays unresolved with its reason', async () => {
  // A timed-out request may have reached a block, and its cost can explain the low balance.
  const { result, leaseCalls, requests, receipt } = await broadcast(
    [timeoutResponse, notEnoughBalanceResponse],
    true,
  );

  expect(requests).toBe(2);
  expect(result).toMatchObject({
    success: false,
    kind: 'unresolved',
    transactionId: FAILED_TRANSACTION_HASH,
    error:
      'NEAR rejected this transaction. The account has 0.01 NEAR, and the transaction can cost up to 0.15031 NEAR.',
    rejection: { error: 'NotEnoughBalance' },
  });
  expect(leaseCalls).toEqual([]);
  expect(receiptText(receipt)).toMatchObject({
    heading: 'Rejected by NEAR',
    description: result.error,
  });
});

test('a signed transaction sent again keeps a state-dependent rejection unresolved', async () => {
  const { result } = await broadcast([notEnoughBalanceResponse], false);

  expect(result).toMatchObject({ success: false, kind: 'unresolved' });
});

test('a final success is confirmed', async () => {
  const { result, leaseCalls, receipt } = await broadcast([successResponse], true);

  expect(result).toMatchObject({
    success: true,
    transactionId: FAILED_TRANSACTION_HASH,
    result: { status: { SuccessValue: '' } },
  });
  expect(leaseCalls).toEqual(['accepted', 'finalized']);
  expect(receiptText(receipt)).toMatchObject({
    heading: 'Transaction complete',
    description: 'The network confirmed your transaction.',
  });
});

test('a timeout without an outcome stays unresolved', async () => {
  const { result, leaseCalls, requests, receipt } = await broadcast([timeoutResponse], true);

  // The wallet retries a timeout and then reports that the outcome is unknown.
  expect(requests).toBe(5);
  expect(result).toEqual({
    success: false,
    kind: 'unresolved',
    transactionId: FAILED_TRANSACTION_HASH,
    error: 'Send Transaction RPC error: Timeout',
  });
  expect(leaseCalls).toEqual([]);
  expect(receiptText(receipt)).toEqual({
    heading: 'Confirmation unavailable',
    description:
      'Submitted to the network. The response did not include a final execution outcome.',
    japanese: 'ネットワークに送信しました。応答には最終的な実行結果が含まれていません。',
  });
});
