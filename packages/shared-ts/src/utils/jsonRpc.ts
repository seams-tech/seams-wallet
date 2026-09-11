export type JsonRpcId = string | number | null;

export type JsonRpcErrorDetails = {
  code?: number | string;
  name?: string;
  message: string;
  data?: unknown;
  cause?: unknown;
};

export type JsonRpcEnvelope =
  | {
      kind: 'success';
      id: JsonRpcId;
      result: unknown;
      error?: never;
    }
  | {
      kind: 'failure';
      id: JsonRpcId;
      error: JsonRpcErrorDetails;
      result?: never;
    };

export type JsonRpcEnvelopeDecodeResult =
  | { ok: true; value: JsonRpcEnvelope; error?: never }
  | { ok: false; error: string; value?: never };

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function decodeJsonRpcError(value: unknown): JsonRpcErrorDetails | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (!message) return null;
  if (
    record.code !== undefined &&
    (typeof record.code !== 'number' || !Number.isFinite(record.code)) &&
    typeof record.code !== 'string'
  ) {
    return null;
  }
  if (record.name !== undefined && typeof record.name !== 'string') return null;
  return {
    message,
    ...(record.code !== undefined ? { code: record.code } : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...('data' in record ? { data: record.data } : {}),
    ...('cause' in record ? { cause: record.cause } : {}),
  };
}

export function decodeJsonRpcEnvelope(value: unknown): JsonRpcEnvelopeDecodeResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'expected an object' };
  }
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') {
    return { ok: false, error: 'jsonrpc must equal 2.0' };
  }
  if (!isJsonRpcId(record.id)) {
    return { ok: false, error: 'id must be a string, number, or null' };
  }
  const hasResult = Object.prototype.hasOwnProperty.call(record, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(record, 'error');
  if (hasResult === hasError) {
    return { ok: false, error: 'response must contain exactly one of result or error' };
  }
  if (hasResult) {
    return { ok: true, value: { kind: 'success', id: record.id, result: record.result } };
  }
  const error = decodeJsonRpcError(record.error);
  if (!error) {
    return { ok: false, error: 'error must contain a non-empty message' };
  }
  return { ok: true, value: { kind: 'failure', id: record.id, error } };
}
