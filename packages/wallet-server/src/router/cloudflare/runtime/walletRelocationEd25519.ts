import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import { authorizeRuntimeSource, type RuntimeSourceDirectory } from './walletRelocationSource';

type Operation = 'capture' | 'export' | 'import' | 'status' | 'verify' | 'activate' | 'cleanup';
type Envelope = { readonly wallet: Record<string, unknown>; readonly attempt: Record<string, unknown> };

export function ed25519RuntimeOperation(operation: string): Operation | null {
  switch (operation) {
    case 'ed25519-capture': return 'capture';
    case 'ed25519-export': return 'export';
    case 'ed25519-import': return 'import';
    case 'ed25519-status': return 'status';
    case 'ed25519-verify': return 'verify';
    case 'ed25519-activate': return 'activate';
    case 'ed25519-cleanup': return 'cleanup';
    default: return null;
  }
}

export async function forwardEd25519Snapshot(
  input: unknown, operation: Operation, router: CloudflareServiceBindingFetcher,
  credential: string, directory: RuntimeSourceDirectory,
): Promise<Response> {
  const fieldCount = operation === 'export' || operation === 'import' ? 3 : 2;
  if (!isPlainObject(input) || Object.keys(input).length !== fieldCount ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt)) return failure('invalid_input', 400);
  const envelope: Envelope = { wallet: input.wallet, attempt: input.attempt };
  try {
    if (operation === 'capture') {
      const authorization = await authorizeRuntimeSource(input, 'ed25519-capture', directory);
      if (!authorization.ok) return failure(authorization.code, authorization.code === 'source_command_denied' ? 409 : 503);
      const command: unknown = JSON.parse(authorization.body);
      if (!isPlainObject(command)) return failure('source_command_unavailable', 503);
      const response = await postSnapshot(router, command, credential);
      if (!response.ok) return response;
      const raw: unknown = await response.clone().json();
      if (isPlainObject(raw) && Object.keys(raw).length === 1 && raw.state === 'capturing') return response;
      if (!isPlainObject(raw) || Object.keys(raw).length !== 2 || raw.state !== 'frozen')
        return failure('source_receipt_unavailable', 503);
      const receipt = parseReceipt(raw.receipt, envelope);
      if (!receipt || !sameFields(receipt.source, command.source)) return failure('source_receipt_unavailable', 503);
      const recorded = await postDirectory(directory, 'relocation-ed25519-receipt', { ...envelope, receipt });
      if (!recorded.ok) return failure('source_receipt_unavailable', 503);
      const result: unknown = await recorded.json();
      if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
          !sameFields(receipt, result.receipt)) return failure('source_receipt_unavailable', 503);
      return response;
    }
    const request = operation === 'export' ? { operation, segmentIndex: input.segmentIndex } : { operation };
    const authorized = await postDirectory(directory, 'relocation-ed25519-transfer', { ...envelope, request });
    if (!authorized.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorized.json();
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command) || result.command.command !== operation ||
        Object.keys(result.command).length !== (operation === 'export' ? 3 : 2))
      return failure('source_command_unavailable', 503);
    const receipt = parseReceipt(operation === 'cleanup' ? result.command.activation : result.command.receipt, envelope);
    if (!receipt) return failure('source_command_unavailable', 503);
    if (operation === 'cleanup') return await postSnapshot(router, { command: 'cleanup', activation: receipt }, credential);
    if (operation === 'activate') {
      const response = await postSnapshot(router, { command: 'activate', receipt }, credential);
      if (!response.ok) return response;
      const activated: unknown = await response.clone().json();
      if (!isPlainObject(activated) || Object.keys(activated).length !== 2 || activated.state !== 'activated' ||
          !sameFields(receipt, activated.receipt)) return failure('activation_receipt_unavailable', 503);
      const recorded = await postDirectory(directory, 'relocation-ed25519-activation', { ...envelope, receipt });
      if (!recorded.ok) return failure('activation_receipt_unavailable', 503);
      const confirmed: unknown = await recorded.json();
      if (!isPlainObject(confirmed) || Object.keys(confirmed).length !== 2 || confirmed.ok !== true ||
          !sameFields(receipt, confirmed.receipt)) return failure('activation_receipt_unavailable', 503);
      return response;
    }
    if (operation === 'export') {
      if (!count(input.segmentIndex) || input.segmentIndex >= receipt.segment_count || result.command.segment_index !== input.segmentIndex)
        return failure('source_command_unavailable', 503);
      return await postSnapshot(router, { command: 'export', receipt, segment_index: input.segmentIndex }, credential);
    }
    if (operation === 'import') {
      // The participant parses the segment and commits it with its acknowledgement.
      return await postSnapshot(router, { command: 'import', receipt, segment: input.segment }, credential);
    }
    return await postSnapshot(router, { command: operation, receipt }, credential);
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function parseReceipt(raw: unknown, envelope: Envelope) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 4 ||
      !isPlainObject(raw.source) || Object.keys(raw.source).length !== 2 ||
      !isPlainObject(raw.source.scope) || Object.keys(raw.source.scope).length !== 4 ||
      !isPlainObject(raw.source.request) || Object.keys(raw.source.request).length !== 3 ||
      typeof raw.source.scope.org_id !== 'string' || raw.source.scope.org_id !== envelope.wallet.organizationId ||
      typeof raw.source.scope.project_id !== 'string' || raw.source.scope.project_id !== envelope.wallet.projectId ||
      typeof raw.source.scope.project_environment_id !== 'string' || raw.source.scope.project_environment_id !== envelope.wallet.environmentId ||
      typeof raw.source.scope.wallet_id !== 'string' || raw.source.scope.wallet_id !== envelope.wallet.walletId ||
      typeof raw.source.request.move_id !== 'string' || raw.source.request.move_id !== envelope.attempt.moveId ||
      typeof raw.source.request.source_generation !== 'number' || !Number.isSafeInteger(raw.source.request.source_generation) || raw.source.request.source_generation < 1 ||
      typeof raw.source.request.invalidated_at_ms !== 'number' || !Number.isSafeInteger(raw.source.request.invalidated_at_ms) || raw.source.request.invalidated_at_ms <= 0 ||
      !count(raw.record_count) || !count(raw.segment_count) || raw.record_count > raw.segment_count ||
      (raw.record_count === 0) !== (raw.segment_count === 0) ||
      typeof raw.digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.digest_hex)) return null;
  return {
    source: {
      scope: { org_id: raw.source.scope.org_id, project_id: raw.source.scope.project_id,
        project_environment_id: raw.source.scope.project_environment_id, wallet_id: raw.source.scope.wallet_id },
      request: { move_id: raw.source.request.move_id, source_generation: raw.source.request.source_generation,
        invalidated_at_ms: raw.source.request.invalidated_at_ms },
    },
    record_count: raw.record_count, segment_count: raw.segment_count, digest_hex: raw.digest_hex,
  };
}

function count(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4294967295;
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

function postSnapshot(router: CloudflareServiceBindingFetcher, command: unknown, credential: string): Promise<Response> {
  return router.fetch(new Request('https://mpc-router.router-ab.internal/router-ab/signing-worker/wallet/ed25519/snapshot', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
    body: JSON.stringify(command),
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
