import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import { authorizeRuntimeSource, type RuntimeSourceDirectory } from './walletRelocationSource';

// Eight native segments fit below the existing Runtime request limit.
const TRANSFER_BATCH_SEGMENTS = 8;

type Operation = 'freeze' | 'export' | 'import' | 'status' | 'verify' | 'activate' | 'cleanup';
type Envelope = { readonly wallet: Record<string, unknown>; readonly attempt: Record<string, unknown> };

export function ecdsaRuntimeOperation(operation: string): Operation | null {
  switch (operation) {
    case 'ecdsa-freeze': return 'freeze';
    case 'ecdsa-export': return 'export';
    case 'ecdsa-import': return 'import';
    case 'ecdsa-status': return 'status';
    case 'ecdsa-verify': return 'verify';
    case 'ecdsa-activate': return 'activate';
    case 'ecdsa-cleanup': return 'cleanup';
    default: return null;
  }
}

export async function forwardEcdsaRelocation(
  input: unknown, operation: Operation, router: CloudflareServiceBindingFetcher,
  credential: string, directory: RuntimeSourceDirectory,
): Promise<Response> {
  const fieldCount = operation === 'export' || operation === 'import' ? 3 : 2;
  if (!isPlainObject(input) || Object.keys(input).length !== fieldCount ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt)) return failure('invalid_input', 400);
  const envelope: Envelope = { wallet: input.wallet, attempt: input.attempt };
  try {
    if (operation === 'freeze') {
      const authorization = await authorizeRuntimeSource(input, 'ecdsa-freeze', directory);
      if (!authorization.ok) return failure(authorization.code, authorization.code === 'source_command_denied' ? 409 : 503);
      const source: unknown = JSON.parse(authorization.body);
      if (!isPlainObject(source)) return failure('source_command_unavailable', 503);
      let response = await postRole(router, 'pool/freeze', source, credential);
      let raw: unknown = await response.clone().json();
      // Continue durable local progress without another Console authorization trip.
      // Draining means existing work must settle, so return it immediately.
      for (let step = 1; step < TRANSFER_BATCH_SEGMENTS && response.ok &&
          isPlainObject(raw) && Object.keys(raw).length === 1 &&
          (raw.state === 'invalidating' || raw.state === 'sealing'); step += 1) {
        response = await postRole(router, 'pool/freeze', source, credential);
        raw = await response.clone().json();
      }
      if (!response.ok) return response;
      if (isPlainObject(raw)) {
        if (Object.keys(raw).length === 1 && (raw.state === 'invalidating' || raw.state === 'sealing')) return response;
        if (Object.keys(raw).length === 3 && raw.state === 'draining' &&
            safeCount(raw.pending_effects) && safeCount(raw.pending_linked_sessions)) return response;
      }
      if (!isPlainObject(raw) || Object.keys(raw).length !== 2 || raw.state !== 'frozen')
        return failure('source_receipt_unavailable', 503);
      const receipt = parseReceipt(raw.receipt, envelope);
      if (!receipt || !sameFields(receipt.scope, source.scope) || !sameFields(receipt.request, source.request))
        return failure('source_receipt_unavailable', 503);
      if (!await persistReceipt(directory, 'relocation-ecdsa-receipt', envelope, receipt))
        return failure('source_receipt_unavailable', 503);
      return response;
    }
    const request = operation === 'export' ? { operation, segmentIndex: input.segmentIndex } : { operation };
    const authorized = await postDirectory(directory, 'relocation-ecdsa-transfer', { ...envelope, request });
    if (!authorized.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorized.json();
    const commandFields = operation === 'export' ? 4 : operation === 'status' || operation === 'import' ? 3 : 2;
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command) || result.command.kind !== operation || Object.keys(result.command).length !== commandFields)
      return failure('source_command_unavailable', 503);
    const command = result.command;
    const receipt = parseReceipt(operation === 'cleanup' ? command.activation : command.receipt, envelope);
    if (!receipt) return failure('source_command_unavailable', 503);
    if ((operation === 'export' || operation === 'status' || operation === 'import') && command.chunk_bytes !== 4096)
      return failure('source_command_unavailable', 503);
    if (operation === 'export') {
      if (!safeCount(input.segmentIndex) || input.segmentIndex > 4294967295 || command.segment_index !== input.segmentIndex)
        return failure('source_command_unavailable', 503);
      const chunks: NonNullable<ReturnType<typeof parseChunk>>[] = [];
      let segmentIndex = input.segmentIndex;
      for (let step = 0; step < TRANSFER_BATCH_SEGMENTS; step += 1) {
        const response = await postRole(router, 'ecdsa/export', {
          receipt, segment_index: segmentIndex, chunk_bytes: 4096,
        }, credential);
        if (!response.ok) return response;
        const chunk = parseChunk(await response.json(), receipt);
        if (!chunk || chunk.segment_index !== segmentIndex ||
            (chunks.length > 0 && chunk.segment_count !== chunks[0].segment_count))
          return failure('source_receipt_unavailable', 503);
        chunks.push(chunk);
        segmentIndex += 1;
        if (segmentIndex === chunk.segment_count) break;
      }
      return Response.json({ chunks });
    }
    if (operation === 'import') {
      if (!Array.isArray(input.chunks) || input.chunks.length === 0 ||
          input.chunks.length > TRANSFER_BATCH_SEGMENTS) return failure('invalid_input', 400);
      const chunks: NonNullable<ReturnType<typeof parseChunk>>[] = [];
      for (const raw of input.chunks) {
        const chunk = parseChunk(raw, receipt);
        const previous = chunks.at(-1);
        if (!chunk || (previous && (chunk.segment_index !== previous.segment_index + 1 ||
            chunk.segment_count !== previous.segment_count))) return failure('invalid_input', 400);
        chunks.push(chunk);
      }
      let response: Response = failure('invalid_input', 400);
      for (const chunk of chunks) {
        response = await postRole(router, 'ecdsa/transfer', { kind: 'import', chunk }, credential);
        if (!response.ok) return response;
        const accepted: unknown = await response.clone().json();
        if (!isPlainObject(accepted) || accepted.kind !== 'imported' ||
            accepted.segment_index !== chunk.segment_index || typeof accepted.input_digest_hex !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(accepted.input_digest_hex)) return failure('source_receipt_unavailable', 503);
      }
      return response;
    }
    if (operation === 'cleanup') return await postRole(router, 'ecdsa/transfer', { kind: 'cleanup', activation: receipt }, credential);
    if (operation === 'status') return await postRole(router, 'ecdsa/transfer', { kind: 'status', receipt, chunk_bytes: 4096 }, credential);
    const response = await postRole(router, 'ecdsa/transfer', { kind: operation, receipt }, credential);
    if (operation !== 'activate' || !response.ok) return response;
    const activated: unknown = await response.clone().json();
    if (!isPlainObject(activated) || Object.keys(activated).length !== 2 || activated.kind !== 'activated' ||
        !sameFields(receipt, activated.receipt) ||
        !await persistReceipt(directory, 'relocation-ecdsa-activation', envelope, receipt))
      return failure('activation_receipt_unavailable', 503);
    return response;
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function parseChunk(raw: unknown, receipt: NonNullable<ReturnType<typeof parseReceipt>>) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 5 || !sameFields(raw.receipt, receipt) ||
      raw.chunk_bytes !== 4096 || !safeCount(raw.segment_index) || !safeCount(raw.segment_count) ||
      raw.segment_count === 0 || raw.segment_count > 4294967295 || raw.segment_index >= raw.segment_count ||
      typeof raw.data_b64u !== 'string' || raw.data_b64u.length === 0 || raw.data_b64u.length > 5462 ||
      !/^[A-Za-z0-9_-]+$/u.test(raw.data_b64u)) return null;
  return { receipt, chunk_bytes: 4096, segment_index: raw.segment_index,
    segment_count: raw.segment_count, data_b64u: raw.data_b64u };
}

function parseReceipt(raw: unknown, envelope: Envelope) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 4 ||
      !isPlainObject(raw.scope) || Object.keys(raw.scope).length !== 4 ||
      !isPlainObject(raw.request) || Object.keys(raw.request).length !== 3 ||
      typeof raw.scope.org_id !== 'string' || raw.scope.org_id !== envelope.wallet.organizationId ||
      typeof raw.scope.project_id !== 'string' || raw.scope.project_id !== envelope.wallet.projectId ||
      typeof raw.scope.project_environment_id !== 'string' || raw.scope.project_environment_id !== envelope.wallet.environmentId ||
      typeof raw.scope.wallet_id !== 'string' || raw.scope.wallet_id !== envelope.wallet.walletId ||
      typeof raw.request.move_id !== 'string' || raw.request.move_id !== envelope.attempt.moveId ||
      !safeCount(raw.request.source_generation) || raw.request.source_generation === 0 ||
      !safeCount(raw.request.invalidated_at_ms) || raw.request.invalidated_at_ms === 0 || !safeCount(raw.record_count) ||
      typeof raw.wallet_records_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.wallet_records_digest_hex)) return null;
  return {
    scope: { org_id: raw.scope.org_id, project_id: raw.scope.project_id,
      project_environment_id: raw.scope.project_environment_id, wallet_id: raw.scope.wallet_id },
    request: { move_id: raw.request.move_id, source_generation: raw.request.source_generation, invalidated_at_ms: raw.request.invalidated_at_ms },
    record_count: raw.record_count, wallet_records_digest_hex: raw.wallet_records_digest_hex,
  };
}

function safeCount(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
}

function sameFields(left: unknown, right: unknown): boolean {
  if (!isPlainObject(left) || !isPlainObject(right)) return left === right;
  if (Object.keys(left).length !== Object.keys(right).length) return false;
  for (const key of Object.keys(left)) if (!sameFields(left[key], right[key])) return false;
  return true;
}

async function persistReceipt(directory: RuntimeSourceDirectory, endpoint: string, envelope: Envelope, receipt: unknown): Promise<boolean> {
  const response = await postDirectory(directory, endpoint, { ...envelope, receipt });
  if (!response.ok) return false;
  const result: unknown = await response.json();
  return isPlainObject(result) && Object.keys(result).length === 2 && result.ok === true && sameFields(receipt, result.receipt);
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

function postRole(router: CloudflareServiceBindingFetcher, path: 'pool/freeze' | 'ecdsa/export' | 'ecdsa/transfer', command: unknown, credential: string): Promise<Response> {
  return router.fetch(new Request(`https://mpc-router.router-ab.internal/router-ab/signing-worker/wallet/${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
    body: JSON.stringify(command),
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
