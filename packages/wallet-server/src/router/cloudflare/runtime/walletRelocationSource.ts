import { isPlainObject } from '@shared/utils/validation';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

export type RuntimeSourceOperation =
  | 'ed25519-settle'
  | 'ed25519-capture'
  | 'ecdsa-freeze'
  | 'router-freeze';
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
    Object.keys(input).length !== 2 ||
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
        'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-runtime-source',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-seams-writer-role': 'walletRuntime',
            'x-seams-writer-version': version,
            'x-seams-writer-account': env.SEAMS_D1_HOME_ACCOUNT_ID,
            'x-seams-writer-database': env.SEAMS_D1_HOME_DATABASE_ID,
          },
          body: JSON.stringify({ wallet: input.wallet, attempt: input.attempt, operation }),
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
    result.command.operation !== operation ||
    !isPlainObject(result.command.payload)
  )
    return { ok: false, code: 'source_command_unavailable' };
  const payload = result.command.payload;
  if (operation === 'router-freeze') {
    if (
      Object.keys(payload).length !== 5 ||
      !isPlainObject(payload.owner) ||
      Object.keys(payload.owner).length !== 4 ||
      payload.owner.org_id !== input.wallet.organizationId ||
      payload.owner.project_id !== input.wallet.projectId ||
      payload.owner.env_id !== input.wallet.environmentId ||
      payload.owner.wallet_id !== input.wallet.walletId ||
      payload.move_id !== input.attempt.moveId ||
      typeof payload.request_digest_hex !== 'string' ||
      !/^[0-9a-f]{64}$/.test(payload.request_digest_hex) ||
      typeof payload.source_generation !== 'number' ||
      !Number.isSafeInteger(payload.source_generation) ||
      payload.source_generation < 1 ||
      typeof payload.destination_generation !== 'number' ||
      !Number.isSafeInteger(payload.destination_generation) ||
      payload.destination_generation !== payload.source_generation + 1
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
