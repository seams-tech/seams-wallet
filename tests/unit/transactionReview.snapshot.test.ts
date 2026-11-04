import { ActionType, toActionArgsWasm } from '@shared/near/actions';
import { expect, test } from '@playwright/test';
import {
  snapshotTransactionInput,
  snapshotTransactionOptions,
  snapshotNearAction,
  reviewedConfirmationConfig,
} from '@/react/transactionReview/snapshot';

const modal = { uiMode: 'modal', behavior: 'requireClick' } as const;

test('a mutation after review does not change the reviewed actions, EVM bytes or Tempo calls', () => {
  const sharedCode = new Uint8Array(new SharedArrayBuffer(8), 2, 2);
  sharedCode.set([3, 4]);
  const data = {
    actions: [{ args: { purchase: { quantity: 1 } }, code: sharedCode }],
    request: { tx: { calls: [{ input: new Uint8Array([1, 2]), value: 3n }] } },
  };
  const copied = snapshotTransactionInput(data);
  data.actions[0].args.purchase.quantity = 50;
  sharedCode[0] = 99;
  data.request.tx.calls[0].input[0] = 99;
  data.request.tx.calls.push({ input: new Uint8Array([9]), value: 5n });
  expect(copied.actions[0].args.purchase.quantity).toBe(1);
  expect(copied.actions[0].code).toEqual(new Uint8Array([3, 4]));
  expect(copied.request.tx.calls).toHaveLength(1);
  expect(copied.request.tx.calls[0].input).toEqual(new Uint8Array([1, 2]));
});

test('effective confirmation configuration rejects inherited and explicit incompatible modes', () => {
  expect(reviewedConfirmationConfig(modal, undefined)).toEqual(modal);
  expect(() => reviewedConfirmationConfig(modal, { autoProceedDelay: 0 })).toThrow();
  for (const uiMode of ['drawer', 'none'] as const) {
    expect(() =>
      reviewedConfirmationConfig({ uiMode, behavior: 'requireClick' }, undefined),
    ).toThrow();
    expect(() => reviewedConfirmationConfig(modal, { uiMode })).toThrow();
  }
  expect(() =>
    reviewedConfirmationConfig({ uiMode: 'modal', behavior: 'skipClick' }, undefined),
  ).toThrow();
  expect(() => reviewedConfirmationConfig(modal, { behavior: 'skipClick' })).toThrow();
});

test('snapshot preserves own __proto__ keys without changing record prototypes', () => {
  const args = JSON.parse('{"__proto__":{"quantity":2},"item":"purchase"}');
  const action = { type: ActionType.FunctionCall as const, methodName: 'purchase', args };
  const copied = snapshotNearAction(action);
  expect(toActionArgsWasm(copied)).toEqual(toActionArgsWasm(action));
  const options = snapshotTransactionOptions(args);
  expect(Object.hasOwn(options, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
});
