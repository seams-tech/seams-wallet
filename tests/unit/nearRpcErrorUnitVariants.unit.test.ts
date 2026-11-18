import { expect, test } from '@playwright/test';
import { NearRpcError } from '@/core/rpcClients/near/NearRpcError';
import { nearTransactionRejection } from '@/core/rpcClients/near/nearTransactionRejection';
import { getNearShortErrorMessage } from '@shared/utils/near';
import { NearRpcError as ServerNearRpcError } from '../../packages/wallet-server/src/core/rpcClients/near/NearClient';

function sendTxError(data: unknown) {
  return {
    code: -32000,
    name: 'HANDLER_ERROR',
    message: 'Server error',
    data,
    cause: { name: 'INVALID_TRANSACTION', info: {} },
  };
}

const cases = [
  {
    name: 'a unit InvalidTxError variant',
    data: { TxExecutionError: { InvalidTxError: 'Expired' } },
    type: 'InvalidTxError',
    kind: 'Expired',
    short: 'InvalidTxError: Expired',
  },
  {
    name: 'an InvalidTxError variant with fields',
    data: { TxExecutionError: { InvalidTxError: { InvalidNonce: { tx_nonce: 5, ak_nonce: 6 } } } },
    type: 'InvalidTxError',
    kind: 'InvalidNonce',
    short: 'InvalidTxError: InvalidNonce',
  },
  {
    name: 'a unit ActionsValidation variant',
    data: {
      TxExecutionError: { InvalidTxError: { ActionsValidation: 'DeleteActionMustBeFinal' } },
    },
    type: 'InvalidTxError',
    kind: 'ActionsValidation.DeleteActionMustBeFinal',
    short: 'InvalidTxError: DeleteActionMustBeFinal',
  },
  {
    name: 'an InvalidTxError without the TxExecutionError wrapper',
    data: { InvalidTxError: 'InvalidSignature' },
    type: 'InvalidTxError',
    kind: 'InvalidSignature',
    short: 'InvalidTxError: InvalidSignature',
  },
  {
    name: 'a unit ActionError kind',
    data: { TxExecutionError: { ActionError: { index: 0, kind: 'DelegateActionExpired' } } },
    type: 'ActionError',
    kind: 'DelegateActionExpired',
    short: 'ActionError: DelegateActionExpired',
  },
] as const;

for (const testCase of cases) {
  test(`${testCase.name} is named by the client and the server alike`, () => {
    const client = NearRpcError.fromRpcError('send_tx', sendTxError(testCase.data));
    const server = ServerNearRpcError.fromRpcError('send_tx', sendTxError(testCase.data));
    const expected = { type: testCase.type, kind: testCase.kind, short: testCase.short };
    expect(client).toMatchObject(expected);
    expect(server).toMatchObject(expected);
    expect(client.message).toBe(server.message);
  });
}

test('an Expired unit variant gives a permanent rejection and its short label', () => {
  const error = NearRpcError.fromRpcError('send_tx', sendTxError(cases[0].data));
  expect(error.message).toBe('send_tx failed (InvalidTxError: Expired)');
  expect(nearTransactionRejection(error)).toEqual({
    error: 'Expired',
    permanence: 'permanent',
    fields: {},
  });
  expect(getNearShortErrorMessage({ details: cases[0].data })).toBe('InvalidTxError: Expired');
});

test('the server classifies a unit Expired variant as expired', () => {
  const error = ServerNearRpcError.fromRpcError('send_tx', sendTxError(cases[0].data));
  expect(error.failureKind).toBe('expired');
});
