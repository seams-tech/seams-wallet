import { isPlainObject, requireNonEmptyString, requireRecord } from '@shared/utils/validation';
import { NearRpcError } from './NearRpcError';

/** NEAR refused a signed transaction when it was sent, before any block included it. */
export type NearTransactionRejection = Readonly<{
  /** The `InvalidTxError` variant, such as `NotEnoughBalance` or `InvalidAccessKeyError.AccessKeyNotFound`. */
  error: string;
  /**
   * `permanent`: the signed bytes themselves are invalid, so NEAR can never include them.
   * `state_dependent`: the rejection depends on account or chain state. That state can
   * change, and a retried request can report it for a transaction that an earlier attempt
   * already included, so it never proves non-execution.
   */
  permanence: 'permanent' | 'state_dependent';
  /** The variant's fields as NEAR returned them, such as `signer_id`, `balance` and `cost`. */
  fields: Readonly<Record<string, string>>;
}>;

// Each depends only on the signed bytes and the chain they name, never on account state.
const PERMANENT_REJECTIONS = new Set([
  'InvalidSignature',
  'InvalidChain',
  'Expired',
  'InvalidSignerId',
  'InvalidReceiverId',
  'TransactionSizeExceeded',
  'InvalidTransactionVersion',
  'CostOverflow',
]);

/** Reads an `InvalidTxError` from a `send_tx` failure. Any other failure returns `null`. */
export function nearTransactionRejection(error: unknown): NearTransactionRejection | null {
  // A unit variant arrives as a string, which `NearRpcError.type` does not classify.
  if (!(error instanceof NearRpcError)) return null;
  const details = isPlainObject(error.details) ? error.details : null;
  const execution = details && isPlainObject(details.TxExecutionError) ? details.TxExecutionError : null;
  const invalid = execution?.InvalidTxError;
  const [name, value] = variant(invalid);
  if (!name) return null;
  // Nested variants name their inner case, such as `InvalidAccessKeyError.AccessKeyNotFound`.
  const [inner, innerValue] =
    name === 'InvalidAccessKeyError' || name === 'ActionsValidation' ? variant(value) : [null, value];
  const kind = inner ? `${name}.${inner}` : name;
  return {
    error: kind,
    permanence:
      PERMANENT_REJECTIONS.has(name) || name === 'ActionsValidation' ? 'permanent' : 'state_dependent',
    fields: rejectionFields(innerValue),
  };
}

export function parseNearTransactionRejection(raw: unknown): NearTransactionRejection {
  const value = requireRecord(raw, 'NEAR transaction rejection');
  if (value.permanence !== 'permanent' && value.permanence !== 'state_dependent')
    throw new Error('Invalid NEAR transaction rejection.');
  const fields = requireRecord(value.fields, 'NEAR transaction rejection fields');
  const parsed: Record<string, string> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (typeof field !== 'string') throw new Error('Invalid NEAR transaction rejection field.');
    parsed[key] = field;
  }
  return {
    error: requireNonEmptyString(value.error, 'NEAR transaction rejection error'),
    permanence: value.permanence,
    fields: parsed,
  };
}

/** A short sentence for the person, such as "NEAR rejected this transaction: NotEnoughBalance." */
export function nearTransactionRejectionMessage(rejection: NearTransactionRejection): string {
  return `NEAR rejected this transaction: ${rejection.error}.`;
}

/** NEAR serializes a unit variant as a string and a variant with fields as a one-key object. */
function variant(value: unknown): [string | null, unknown] {
  if (typeof value === 'string' && value) return [value, null];
  if (!isPlainObject(value)) return [null, null];
  const [key] = Object.keys(value);
  return key ? [key, value[key]] : [null, null];
}

function rejectionFields(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const fields: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === null || field === undefined) continue;
    fields[key] =
      typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean'
        ? String(field)
        : JSON.stringify(field);
  }
  return fields;
}
