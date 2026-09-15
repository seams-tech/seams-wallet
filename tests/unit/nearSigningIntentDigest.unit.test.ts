import { expect, test } from '@playwright/test';
import { ActionType, type TransactionInputWasm } from '@/core/types/actions';
import { toAccountId } from '@/core/types/accountIds';
import { computeUiIntentDigestFromTxs } from '@/utils/intentDigest';
import { orchestrateSigningConfirmation } from '@/core/signingEngine/uiConfirm/handlers/flowOrchestrator';
import {
  SigningAuthPlanKind,
  type UserConfirmDecision,
} from '@/core/signingEngine/stepUpConfirmation/types';
import {
  SigningOperationIntent,
  SigningSessionIds,
} from '@/core/signingEngine/session/operationState/types';
import {
  UserConfirmationType,
  type UserConfirmRequest,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import { parseWalletId } from '@shared/utils/domainIds';

test('warm NEAR confirmation carries one final digest for the exact displayed transaction', async () => {
  const nearAccountId = toAccountId('alice.testnet');
  const parsedWalletId = parseWalletId('wallet-1');
  if (!parsedWalletId.ok) throw new Error(parsedWalletId.error.message);

  const transaction: TransactionInputWasm = {
    receiverId: 'seams-v1.testnet',
    actions: [
      {
        action_type: ActionType.FunctionCall,
        method_name: 'set_greeting',
        args: JSON.stringify({ greeting: 'Hello from Seams! 23' }),
        gas: '10000000000000',
        deposit: '0',
      },
    ],
  };
  let capturedRequest: UserConfirmRequest | undefined;

  await expect(
    orchestrateSigningConfirmation({
      ctx: {
        touchConfirm: {
          requestUserConfirmation: async (request): Promise<UserConfirmDecision> => {
            capturedRequest = request;
            return {
              requestId: request.requestId,
              confirmed: false,
              error: 'test_cancelled',
            };
          },
        },
      },
      sessionId: 'threshold-session-1',
      chain: 'near',
      kind: 'transaction',
      signingAuthPlan: {
        kind: SigningAuthPlanKind.WarmSession,
        method: 'passkey',
        accountId: nearAccountId,
        intent: 'transaction_sign',
        expiresAtMs: Date.now() + 60_000,
        remainingUses: 1,
        curve: 'ed25519',
        thresholdSessionId: 'threshold-session-1',
      },
      walletId: parsedWalletId.value,
      txSigningRequests: [transaction],
      rpcCall: {
        nearRpcUrl: 'https://rpc.testnet.near.org',
        nearAccountId,
      },
      nearPublicKeyStr: 'ed25519:test-public-key',
      nearFundingRequest: {
        subject: {
          walletId: parsedWalletId.value,
          nearAccountId,
          nearPublicKeyStr: 'ed25519:test-public-key',
        },
        operation: {
          operationId: SigningSessionIds.signingOperation('operation-1'),
          operationFingerprint:
            SigningSessionIds.signingOperationFingerprint('fingerprint-1'),
          intent: SigningOperationIntent.TransactionSign,
          accountId: nearAccountId,
        },
        signatureUses: 1,
      },
    }),
  ).rejects.toThrow('test_cancelled');

  expect(capturedRequest?.type).toBe(UserConfirmationType.SIGN_TRANSACTION);
  if (capturedRequest?.type !== UserConfirmationType.SIGN_TRANSACTION) {
    throw new Error('Expected a NEAR transaction confirmation request');
  }

  const expectedDigest = await computeUiIntentDigestFromTxs([transaction]);
  expect(capturedRequest.intentDigest).toBe(expectedDigest);
  expect(capturedRequest.summary.intentDigest).toBe(expectedDigest);
  expect(capturedRequest.payload.intentDigest).toBe(expectedDigest);
  expect(capturedRequest.payload.txSigningRequests).toEqual([transaction]);
});
