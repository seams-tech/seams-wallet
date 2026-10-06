import { isPlainObject } from '@shared/utils/validation';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

export type RuntimeSourceOperation =
  | 'ed25519-settle'
  | 'ed25519-capture'
  | 'ecdsa-freeze'
  | 'router-freeze'
  | 'router-export';
export type RuntimeSourceDirectory = {
  readonly WALLET_CONSOLE: WalletConsoleServiceBinding;
  readonly CF_VERSION_METADATA: { readonly id: unknown };
  readonly SEAMS_D1_HOME_ACCOUNT_ID: string;
  readonly SEAMS_D1_HOME_DATABASE_ID: string;
};

type SourceAuthorization =
  | { readonly ok: true; readonly body: string; readonly code?: never }
  | {
      readonly ok: false;
      readonly code: 'invalid_input' | 'source_command_unavailable' | 'source_command_denied';
      readonly body?: never;
    };

export async function authorizeRuntimeSource(
  input: unknown,
  operation: RuntimeSourceOperation,
  env: RuntimeSourceDirectory,
): Promise<SourceAuthorization> {
  if (
    !isPlainObject(input) ||
    Object.keys(input).length !== (operation === 'router-export' ? 4 : 2) ||
    !isPlainObject(input.wallet) ||
    !isPlainObject(input.attempt)
  )
    return { ok: false, code: 'invalid_input' };
  const version = env.CF_VERSION_METADATA.id;
  if (typeof version !== 'string' || !version)
    return { ok: false, code: 'source_command_unavailable' };
  let response: Response;
  let result: unknown;
  try {
    response = await env.WALLET_CONSOLE.fetch(
      new Request(
        `https://wallet-placement.internal/internal/wallet-placement/v1/${operation === 'router-export' ? 'relocation-router-export' : 'relocation-runtime-source'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-seams-writer-role': 'walletRuntime',
            'x-seams-writer-version': version,
            'x-seams-writer-account': env.SEAMS_D1_HOME_ACCOUNT_ID,
            'x-seams-writer-database': env.SEAMS_D1_HOME_DATABASE_ID,
          },
          body: JSON.stringify(
            operation === 'router-export'
              ? {
                  wallet: input.wallet,
                  attempt: input.attempt,
                  recordIndex: input.recordIndex,
                  segmentIndex: input.segmentIndex,
                }
              : { wallet: input.wallet, attempt: input.attempt, operation },
          ),
        },
      ),
    );
    if (!response.ok) return { ok: false, code: 'source_command_denied' };
    result = await response.json();
  } catch {
    return { ok: false, code: 'source_command_unavailable' };
  }
  if (
    !isPlainObject(result) ||
    result.ok !== true ||
    !isPlainObject(result.command) ||
    (operation !== 'router-export' &&
      (result.command.operation !== operation || !isPlainObject(result.command.payload)))
  )
    return { ok: false, code: 'source_command_unavailable' };
  const payload = operation === 'router-export' ? result.command : result.command.payload;
  if (!isPlainObject(payload)) return { ok: false, code: 'source_command_unavailable' };
  if (operation === 'router-freeze' || operation === 'router-export') {
    let request = payload;
    if (operation === 'router-export') {
      if (
        Object.keys(payload).length !== 5 ||
        payload.kind !== 'export' ||
        payload.record_index !== input.recordIndex ||
        payload.segment_index !== input.segmentIndex ||
        payload.chunk_bytes !== 4096 ||
        !isPlainObject(payload.receipt) ||
        Object.keys(payload.receipt).length !== 3 ||
        !isPlainObject(payload.receipt.request) ||
        typeof payload.receipt.records_digest_hex !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(payload.receipt.records_digest_hex) ||
        typeof payload.receipt.record_count !== 'number' ||
        !Number.isSafeInteger(payload.receipt.record_count) ||
        typeof input.recordIndex !== 'number' ||
        !Number.isSafeInteger(input.recordIndex) ||
        input.recordIndex < 0 ||
        input.recordIndex >= payload.receipt.record_count ||
        typeof input.segmentIndex !== 'number' ||
        !Number.isSafeInteger(input.segmentIndex) ||
        input.segmentIndex < 0 ||
        input.segmentIndex > 4294967295
      )
        return { ok: false, code: 'source_command_unavailable' };
      request = payload.receipt.request;
    }
    if (
      Object.keys(request).length !== 5 ||
      !isPlainObject(request.owner) ||
      Object.keys(request.owner).length !== 4 ||
      request.owner.org_id !== input.wallet.organizationId ||
      request.owner.project_id !== input.wallet.projectId ||
      request.owner.env_id !== input.wallet.environmentId ||
      request.owner.wallet_id !== input.wallet.walletId ||
      request.move_id !== input.attempt.moveId ||
      typeof request.request_digest_hex !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.request_digest_hex) ||
      typeof request.source_generation !== 'number' ||
      !Number.isSafeInteger(request.source_generation) ||
      request.source_generation < 1 ||
      typeof request.destination_generation !== 'number' ||
      !Number.isSafeInteger(request.destination_generation) ||
      request.destination_generation !== request.source_generation + 1
    )
      return { ok: false, code: 'source_command_unavailable' };
    return { ok: true, body: JSON.stringify(payload) };
  }
  const source = operation === 'ed25519-capture' ? payload.source : payload;
  if (
    (operation === 'ed25519-capture' &&
      (payload.command !== 'capture' || Object.keys(payload).length !== 2)) ||
    !isPlainObject(source) ||
    Object.keys(source).length !== 2 ||
    !isPlainObject(source.scope) ||
    !isPlainObject(source.request) ||
    Object.keys(source.scope).length !== 4 ||
    Object.keys(source.request).length !== 3 ||
    source.scope.org_id !== input.wallet.organizationId ||
    source.scope.project_id !== input.wallet.projectId ||
    source.scope.project_environment_id !== input.wallet.environmentId ||
    source.scope.wallet_id !== input.wallet.walletId ||
    source.request.move_id !== input.attempt.moveId ||
    typeof source.request.source_generation !== 'number' ||
    !Number.isSafeInteger(source.request.source_generation) ||
    source.request.source_generation < 1 ||
    typeof source.request.invalidated_at_ms !== 'number' ||
    !Number.isSafeInteger(source.request.invalidated_at_ms) ||
    source.request.invalidated_at_ms < 1
  )
    return { ok: false, code: 'source_command_unavailable' };
  return { ok: true, body: JSON.stringify(payload) };
}

// A frozen participant is durable even when Console is unavailable. Return a
// retryable failure until Console confirms the same receipt is in its journal.
export async function recordRuntimeRouterReceipt(
  input: unknown,
  response: Response,
  env: RuntimeSourceDirectory,
): Promise<Response> {
  if (!response.ok) return response;
  try {
    const result: unknown = await response.clone().json();
    if (isPlainObject(result) && result.state === 'draining') return response;
    if (
      !isPlainObject(input) ||
      !isPlainObject(result) ||
      result.state !== 'frozen' ||
      !isPlainObject(result.receipt)
    )
      return receiptUnavailable();
    const version = env.CF_VERSION_METADATA.id;
    if (typeof version !== 'string' || !version) return receiptUnavailable();
    const recorded = await env.WALLET_CONSOLE.fetch(
      new Request(
        'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-router-receipt',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-seams-writer-role': 'walletRuntime',
            'x-seams-writer-version': version,
            'x-seams-writer-account': env.SEAMS_D1_HOME_ACCOUNT_ID,
            'x-seams-writer-database': env.SEAMS_D1_HOME_DATABASE_ID,
          },
          body: JSON.stringify({
            wallet: input.wallet,
            attempt: input.attempt,
            receipt: result.receipt,
          }),
        },
      ),
    );
    if (!recorded.ok) return receiptUnavailable();
    const acknowledgement: unknown = await recorded.json();
    if (
      !isPlainObject(acknowledgement) ||
      acknowledgement.ok !== true ||
      !isPlainObject(acknowledgement.receipt)
    )
      return receiptUnavailable();
    // Console canonicalizes the request fields. Compare values without relying
    // on object key order in either service's serializer.
    if (!sameReceipt(result.receipt, acknowledgement.receipt)) return receiptUnavailable();
    return response;
  } catch {
    return receiptUnavailable();
  }
}

function sameReceipt(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  if (Object.keys(expected).length !== Object.keys(actual).length) return false;
  for (const key of Object.keys(expected)) {
    const left = expected[key];
    const right = actual[key];
    if (isPlainObject(left) && isPlainObject(right)) {
      if (!sameReceipt(left, right)) return false;
    } else if (left !== right) return false;
  }
  return true;
}

function receiptUnavailable(): Response {
  return Response.json(
    { ok: false, code: 'source_receipt_unavailable' },
    {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
