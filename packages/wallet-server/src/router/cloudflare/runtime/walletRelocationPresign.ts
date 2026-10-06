import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import type { RuntimeSourceDirectory } from './walletRelocationSource';

type Operation = 'inventory' | 'fence' | 'freeze' | 'export' | 'import' | 'verify' | 'status' | 'cleanup';

export function presignSourceOperation(operation: string): Operation | null {
  switch (operation) {
    case 'presign-inventory': return 'inventory';
    case 'presign-fence': return 'fence';
    case 'presign-freeze': return 'freeze';
    case 'presign-export': return 'export';
    case 'presign-import': return 'import';
    case 'presign-verify': return 'verify';
    case 'presign-status': return 'status';
    case 'presign-cleanup': return 'cleanup';
    default: return null;
  }
}

export async function forwardPresignSource(
  input: unknown, operation: Operation, router: CloudflareServiceBindingFetcher,
  credential: string, directory: RuntimeSourceDirectory,
): Promise<Response> {
  if (operation === 'export' || operation === 'import' || operation === 'verify' || operation === 'status' || operation === 'cleanup')
    return forwardPresignTransfer(input, operation, router, credential, directory);
  if (!isPlainObject(input) || Object.keys(input).length !== (operation === 'inventory' ? 4 : 3) ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt)) return failure('invalid_input', 400);
  const request = operation === 'inventory'
    ? { operation, cursor: input.cursor, limit: input.limit }
    : { operation, session: input.session };
  try {
    const authorized = await postDirectory(directory, 'relocation-presign-source', {
      wallet: input.wallet, attempt: input.attempt, request,
    });
    if (!authorized.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorized.json();
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command) || Object.keys(result.command).length !== 2 ||
        result.command.operation !== operation || !isPlainObject(result.command.payload))
      return failure('source_command_unavailable', 503);
    const payload = result.command.payload;
    const scope = operation === 'inventory' ? payload.scope : payload.wallet_scope;
    if (Object.keys(payload).length !== 4 || !isPlainObject(scope) || Object.keys(scope).length !== 4 ||
        typeof scope.org_id !== 'string' || scope.org_id !== input.wallet.organizationId ||
        typeof scope.project_id !== 'string' || scope.project_id !== input.wallet.projectId ||
        typeof scope.project_environment_id !== 'string' || scope.project_environment_id !== input.wallet.environmentId ||
        typeof scope.wallet_id !== 'string' || scope.wallet_id !== input.wallet.walletId ||
        !isPlainObject(payload.request) || Object.keys(payload.request).length !== 3 ||
        typeof payload.request.move_id !== 'string' || payload.request.move_id !== input.attempt.moveId ||
        !positiveInteger(payload.request.source_generation) || !positiveInteger(payload.request.invalidated_at_ms))
      return failure('source_command_unavailable', 503);
    let path: string;
    if (operation === 'inventory') {
      if (!sameFields(payload.cursor, input.cursor) || payload.limit !== input.limit ||
          !positiveInteger(payload.limit) || payload.limit > 128) return failure('source_command_unavailable', 503);
      path = '/router-ab/signing-worker/wallet/linked-presign-inventory';
    } else {
      if (!isPlainObject(input.session) || Object.keys(input.session).length !== 2 ||
          typeof input.session.presignSessionId !== 'string' || !input.session.presignSessionId.trim() ||
          typeof input.session.serverPresignatureId !== 'string' || !input.session.serverPresignatureId.trim() ||
          payload.presign_session_id !== input.session.presignSessionId || payload.server_presignature_id !== input.session.serverPresignatureId)
        return failure('source_command_unavailable', 503);
      path = `/router-ab/signing-worker/linked-presign-session/${operation}`;
    }
    const response = await router.fetch(new Request(`https://mpc-router.router-ab.internal${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
      body: JSON.stringify(payload),
    }));
    if (operation !== 'freeze' || !response.ok) return response;
    const raw: unknown = await response.clone().json();
    if (!isPlainObject(raw) || Object.keys(raw).length !== 3 || !sameFields(raw.command, payload) ||
        !positiveInteger(raw.record_count) || typeof raw.records_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.records_digest_hex))
      return failure('source_receipt_unavailable', 503);
    const receipt = { command: payload, record_count: raw.record_count, records_digest_hex: raw.records_digest_hex };
    const recorded = await postDirectory(directory, 'relocation-presign-receipt', {
      wallet: input.wallet, attempt: input.attempt, receipt,
    });
    if (!recorded.ok) return failure('source_receipt_unavailable', 503);
    const confirmed: unknown = await recorded.json();
    if (!isPlainObject(confirmed) || Object.keys(confirmed).length !== 2 || confirmed.ok !== true || !sameFields(confirmed.receipt, receipt))
      return failure('source_receipt_unavailable', 503);
    return response;
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function positiveInteger(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0;
}

function sameFields(left: unknown, right: unknown): boolean {
  if (!isPlainObject(left) || !isPlainObject(right)) return left === right;
  if (Object.keys(left).length !== Object.keys(right).length) return false;
  for (const key of Object.keys(left)) if (!sameFields(left[key], right[key])) return false;
  return true;
}

function postDirectory(directory: RuntimeSourceDirectory, endpoint: string, body: unknown): Promise<Response> {
  const version = directory.CF_VERSION_METADATA.id;
  if (typeof version !== 'string' || !version) throw new Error('Runtime version is unavailable');
  return directory.WALLET_CONSOLE.fetch(new Request(`https://wallet-placement.internal/internal/wallet-placement/v1/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-seams-writer-role': 'walletRuntime',
      'x-seams-writer-version': version, 'x-seams-writer-account': directory.SEAMS_D1_HOME_ACCOUNT_ID,
      'x-seams-writer-database': directory.SEAMS_D1_HOME_DATABASE_ID }, body: JSON.stringify(body),
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function forwardPresignTransfer(
  input: unknown, operation: 'export' | 'import' | 'verify' | 'status' | 'cleanup', router: CloudflareServiceBindingFetcher,
  credential: string, directory: RuntimeSourceDirectory,
): Promise<Response> {
  if (!isPlainObject(input) || Object.keys(input).length !== (operation === 'verify' || operation === 'status' || operation === 'cleanup' ? 3 : 4) ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt) || !isPlainObject(input.session) ||
      Object.keys(input.session).length !== 2 || typeof input.session.presignSessionId !== 'string' ||
      !input.session.presignSessionId.trim() || typeof input.session.serverPresignatureId !== 'string' ||
      !input.session.serverPresignatureId.trim()) return failure('invalid_input', 400);
  if (operation === 'export' && !segmentIndex(input.segmentIndex)) return failure('invalid_input', 400);
  const request = operation === 'export'
    ? { operation, session: input.session, segmentIndex: input.segmentIndex }
    : { operation, session: input.session };
  try {
    const authorized = await postDirectory(directory, 'relocation-presign-transfer', {
      wallet: input.wallet, attempt: input.attempt, request,
    });
    if (!authorized.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorized.json();
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command) || result.command.kind !== operation ||
        Object.keys(result.command).length !== (operation === 'export' ? 4 : operation === 'import' || operation === 'status' ? 3 : 2))
      return failure('source_command_unavailable', 503);
    const command = result.command;
    const receipt = command.receipt;
    if (!isPlainObject(receipt) || Object.keys(receipt).length !== 3 || !positiveInteger(receipt.record_count) ||
        typeof receipt.records_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.records_digest_hex) ||
        !isPlainObject(receipt.command) || Object.keys(receipt.command).length !== 4)
      return failure('source_command_unavailable', 503);
    const source = receipt.command;
    const scope = source.wallet_scope;
    const move = source.request;
    if (!isPlainObject(scope) || Object.keys(scope).length !== 4 ||
        scope.org_id !== input.wallet.organizationId || scope.project_id !== input.wallet.projectId ||
        scope.project_environment_id !== input.wallet.environmentId || scope.wallet_id !== input.wallet.walletId ||
        !isPlainObject(move) || Object.keys(move).length !== 3 || move.move_id !== input.attempt.moveId ||
        !positiveInteger(move.source_generation) || !positiveInteger(move.invalidated_at_ms) ||
        source.presign_session_id !== input.session.presignSessionId ||
        source.server_presignature_id !== input.session.serverPresignatureId ||
        (operation !== 'verify' && operation !== 'cleanup' && command.chunk_bytes !== 4096))
      return failure('source_command_unavailable', 503);
    let payload: unknown;
    if (operation === 'export') {
      if (command.segment_index !== input.segmentIndex) return failure('source_command_unavailable', 503);
      payload = { receipt, segment_index: command.segment_index, chunk_bytes: 4096 };
    } else if (operation === 'import') {
      const chunk = input.chunk;
      if (!isPlainObject(chunk) || Object.keys(chunk).length !== 5 || !sameFields(chunk.receipt, receipt) ||
          !segmentIndex(chunk.segment_index) || !positiveInteger(chunk.segment_count) ||
          chunk.segment_count > 4294967295 || chunk.segment_index >= chunk.segment_count ||
          chunk.chunk_bytes !== 4096 || typeof chunk.data_b64u !== 'string' ||
          chunk.data_b64u.length > 5462 || !/^[A-Za-z0-9_-]+$/u.test(chunk.data_b64u))
        return failure('invalid_input', 400);
      payload = { kind: 'import', chunk };
    } else if (operation === 'status') {
      payload = { kind: 'status', receipt, chunk_bytes: 4096 };
    } else {
      payload = { kind: operation, receipt };
    }
    const path = operation === 'export' ? 'export' : 'transfer';
    return await router.fetch(new Request(`https://mpc-router.router-ab.internal/router-ab/signing-worker/linked-presign-session/${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
      body: JSON.stringify(payload),
    }));
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function segmentIndex(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4294967295;
}
