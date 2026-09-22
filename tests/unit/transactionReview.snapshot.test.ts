import { ActionType, toActionArgsWasm } from '@shared/near/actions';
import { expect, test } from '@playwright/test';
import {
  snapshotTransactionInput,
  snapshotTransactionOptions,
  snapshotNearAction,
  reviewedConfirmationConfig,
} from '@/react/transactionReview/snapshot';
import {
  parseTransactionReviewWire,
  parseTransactionReviewState,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';

const modal = { uiMode: 'modal', behavior: 'requireClick' } as const;

test('snapshot isolates nested actions, EVM bytes and Tempo calls while retaining callbacks separately', () => {
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
  expect(copied.actions[0].code.buffer).toBeInstanceOf(ArrayBuffer);
  expect(copied.request.tx.calls).toHaveLength(1);
  expect(copied.request.tx.calls[0].input).toEqual(new Uint8Array([1, 2]));
  expect(Object.isFrozen(copied.actions[0].args.purchase)).toBe(true);
  const onEvent = () => undefined;
  const options = snapshotTransactionOptions({ onEvent, confirmationConfig: modal });
  expect(options.onEvent).toBe(onEvent);
  expect(options.confirmationConfig).not.toBe(modal);
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

test('review wire identity accepts only serializable metadata and complete phase acknowledgements', () => {
  const metadata = {
    kind: 'transaction_review_v1',
    connectionId: 'connection',
    requestId: 'request',
    surfaceId: 'surface',
    generation: 1,
    validity: { kind: 'unbounded' },
  };
  expect(parseTransactionReviewWire(metadata)).toEqual(metadata);
  expect(() => parseTransactionReviewWire({ ...metadata, render: () => null })).toThrow();
  expect(() => parseTransactionReviewWire({ ...metadata, generation: 0 })).toThrow();
  expect(
    parseTransactionReviewState({
      connectionId: 'connection',
      requestId: 'request',
      surfaceId: 'surface',
      generation: 1,
      phase: 'prepared',
    }),
  ).not.toBeNull();
  expect(parseTransactionReviewState({ requestId: 'request', phase: 'prepared' })).toBeNull();
});

test('NEAR function arguments retain the established JSON boundary semantics', () => {
  const action = {
    type: ActionType.FunctionCall as const,
    methodName: 'purchase',
    args: {
      when: new Date('2026-01-01'),
      item: {
        toJSON() {
          return { quantity: 2 };
        },
      },
    },
  };
  const copied = snapshotNearAction(action);
  expect(toActionArgsWasm(copied)).toEqual(toActionArgsWasm(action));
  action.args.when.setFullYear(2030);
  expect(toActionArgsWasm(copied)).not.toEqual(toActionArgsWasm(action));
});
