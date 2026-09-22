import { ActionType, toActionArgsWasm, type ActionArgs } from '../../core/types/actions';
import { TransactionReviewError } from './contract';

// Snapshot data without serializing callbacks or application React values.
export function snapshotTransactionInput<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    if (typeof input === 'function')
      throw new TransactionReviewError(
        'review_invalid_input',
        'Transaction data cannot contain functions',
      );
    return input;
  }
  // Byte intents must own their storage, including views backed by shared memory.
  if (input instanceof Uint8Array) return Uint8Array.from(input) as T;
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return structuredClone(input);
  if (Array.isArray(input)) return Object.freeze(input.map(snapshotTransactionInput)) as T;
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
    throw new TransactionReviewError(
      'review_invalid_input',
      'Transaction data must use plain records and byte buffers',
    );
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    Object.defineProperty(copy, key, {
      value: snapshotTransactionInput(value),
      enumerable: true,
    });
  }
  return Object.freeze(copy) as T;
}

export function snapshotTransactionOptions<T extends object>(options: T): T {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    Object.defineProperty(copy, key, {
      value: typeof value === 'function' ? value : snapshotTransactionInput(value),
      enumerable: true,
    });
  }
  return Object.freeze(copy) as T;
}

export { reviewedConfirmationConfig } from '../../SeamsWeb/walletIframe/shared/transactionReview';

/** Preserve the existing JSON argument boundary before taking the private copy. */
export function snapshotNearAction(action: ActionArgs): ActionArgs {
  if (action.type === ActionType.FunctionCall) {
    const encoded = toActionArgsWasm(action);
    if (encoded.action_type !== ActionType.FunctionCall)
      throw new Error('Invalid function-call encoding');
    return snapshotTransactionInput({ ...action, args: JSON.parse(encoded.args) });
  }
  return snapshotTransactionInput(action);
}
