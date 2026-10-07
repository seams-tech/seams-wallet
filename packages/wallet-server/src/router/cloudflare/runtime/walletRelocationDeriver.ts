import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import type { RuntimeSourceDirectory } from './walletRelocationSource';

type Role = 'deriver-a' | 'deriver-b';
type Operation = 'fence' | 'capture' | 'export' | 'import' | 'status' | 'verify' | 'activate' | 'cleanup';
type Envelope = { wallet: Record<string, unknown>; attempt: Record<string, unknown> };
type Source = {
  owner: { org_id: string; project_id: string; env_id: string; wallet_id: string };
  move_id: string; request_digest_hex: string; cipher_context_digest_hex: string;
  source_generation: number; destination_generation: number;
};
type Receipt = { source: Source; source_object: string; record_count: number; segment_count: number; digest_hex: string };

export function deriverRuntimeOperation(value: string): { role: Role; operation: Operation } | null {
  let role: Role;
  if (value.startsWith('deriver-a-')) role = 'deriver-a';
  else if (value.startsWith('deriver-b-')) role = 'deriver-b';
  else return null;
  const operation = value.slice(role.length + 1);
  switch (operation) {
    case 'fence': case 'capture': case 'export': case 'import': case 'status': case 'verify': case 'activate': case 'cleanup':
      return { role, operation };
    default: return null;
  }
}

export async function forwardDeriverRelocation(
  input: unknown, role: Role, operation: Operation, binding: CloudflareServiceBindingFetcher,
  credential: string, directory: RuntimeSourceDirectory,
): Promise<Response> {
  const fields = operation === 'export' || operation === 'import' ? 3 : 2;
  if (!isPlainObject(input) || Object.keys(input).length !== fields ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt)) return failure('invalid_input', 400);
  if (operation === 'export' && !count(input.segmentIndex)) return failure('invalid_input', 400);
  const envelope: Envelope = { wallet: input.wallet, attempt: input.attempt };
  const journalRole = role === 'deriver-a' ? 'deriverA' : 'deriverB';
  try {
    const contextResponse = await postRole(binding, role, 'relocation-context', { kind: 'cipher' }, credential);
    if (!contextResponse.ok) return failure('source_command_unavailable', 503);
    const context: unknown = await contextResponse.json();
    if (!isPlainObject(context) || Object.keys(context).length !== 2 ||
        context.kind !== 'deriver_cipher_context' || !digest(context.digest_hex)) return failure('source_command_unavailable', 503);
    const freezing = operation === 'fence' || operation === 'capture';
    const request = operation === 'export' ? { operation, segmentIndex: input.segmentIndex } : { operation };
    const authorization = await postDirectory(directory,
      freezing ? 'relocation-deriver-source' : 'relocation-deriver-transfer',
      freezing
        ? { wallet: envelope.wallet, attempt: envelope.attempt, role: journalRole, cipherContextDigest: context.digest_hex }
        : { wallet: envelope.wallet, attempt: envelope.attempt, role: journalRole, request });
    if (!authorization.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorization.json();
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command)) return failure('source_command_unavailable', 503);
    const authorized = result.command;
    let source: Source | null;
    let body: unknown;
    if (freezing) {
      source = parseSource(authorized, envelope, context.digest_hex);
      if (!source) return failure('source_command_unavailable', 503);
      body = operation === 'fence' ? source : { operation: 'capture', source };
    } else if (operation === 'cleanup') {
      const activation = parseActivation(authorized.activation, role, envelope, context.digest_hex);
      if (!activation || Object.keys(authorized).length !== 2 || authorized.operation !== 'cleanup')
        return failure('source_command_unavailable', 503);
      return await postRole(binding, role, 'snapshot', { operation: 'cleanup', activation }, credential);
    } else if (operation === 'export') {
      source = parseSource(authorized.source, envelope, context.digest_hex);
      if (!source || Object.keys(authorized).length !== 3 || authorized.operation !== 'export' ||
          authorized.segment_index !== input.segmentIndex) return failure('source_command_unavailable', 503);
      body = { operation: 'export', source, segment_index: input.segmentIndex };
    } else {
      const receipt = parseReceipt(authorized.receipt, role, envelope, context.digest_hex);
      if (!receipt || Object.keys(authorized).length !== 2 || authorized.operation !== operation)
        return failure('source_command_unavailable', 503);
      source = receipt.source;
      if (operation === 'activate') {
        const response = await postRole(binding, role, 'snapshot', { operation: 'activate', receipt }, credential);
        return await confirmActivation(response, receipt, role, envelope, context.digest_hex, directory);
      }
      if (operation === 'import') {
        const segment = parseSegment(input.segment, receipt);
        if (!segment) return failure('invalid_input', 400);
        body = { operation: 'import', receipt, segment };
      } else body = { operation, receipt };
    }
    const response = await postRole(binding, role, operation === 'fence' ? 'fence-relocation' : 'snapshot', body, credential);
    if (operation !== 'capture' || !response.ok) return response;
    const captured: unknown = await response.clone().json();
    if (isPlainObject(captured) && Object.keys(captured).length === 2 && captured.kind === 'capturing' && count(captured.segment_count)) return response;
    if (!isPlainObject(captured) || Object.keys(captured).length !== 2 || captured.kind !== 'frozen')
      return failure('source_receipt_unavailable', 503);
    const receipt = parseReceipt(captured.receipt, role, envelope, context.digest_hex);
    if (!receipt || JSON.stringify(receipt.source) !== JSON.stringify(source)) return failure('source_receipt_unavailable', 503);
    const stored = await postDirectory(directory, 'relocation-deriver-receipt', {
      wallet: envelope.wallet, attempt: envelope.attempt, role: journalRole, receipt,
    });
    if (!stored.ok) return failure('source_receipt_unavailable', 503);
    const acknowledgement: unknown = await stored.json();
    if (!isPlainObject(acknowledgement) || Object.keys(acknowledgement).length !== 2 || acknowledgement.ok !== true)
      return failure('source_receipt_unavailable', 503);
    const confirmed = parseReceipt(acknowledgement.receipt, role, envelope, context.digest_hex);
    if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(receipt)) return failure('source_receipt_unavailable', 503);
    return response;
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function parseSource(raw: unknown, envelope: Envelope, contextDigest: string): Source | null {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 6 || !isPlainObject(raw.owner) ||
      Object.keys(raw.owner).length !== 4 ||
      typeof raw.owner.org_id !== 'string' || raw.owner.org_id !== envelope.wallet.organizationId ||
      typeof raw.owner.project_id !== 'string' || raw.owner.project_id !== envelope.wallet.projectId ||
      typeof raw.owner.env_id !== 'string' || raw.owner.env_id !== envelope.wallet.environmentId ||
      typeof raw.owner.wallet_id !== 'string' || raw.owner.wallet_id !== envelope.wallet.walletId ||
      typeof raw.move_id !== 'string' || raw.move_id !== envelope.attempt.moveId ||
      raw.cipher_context_digest_hex !== contextDigest || !digest(raw.request_digest_hex) ||
      typeof raw.source_generation !== 'number' || !Number.isSafeInteger(raw.source_generation) ||
      raw.source_generation < 1 || raw.source_generation >= Number.MAX_SAFE_INTEGER ||
      raw.destination_generation !== raw.source_generation + 1) return null;
  return { owner: { org_id: raw.owner.org_id, project_id: raw.owner.project_id, env_id: raw.owner.env_id, wallet_id: raw.owner.wallet_id },
    move_id: raw.move_id, request_digest_hex: raw.request_digest_hex, cipher_context_digest_hex: contextDigest,
    source_generation: raw.source_generation, destination_generation: raw.source_generation + 1 };
}

function parseReceipt(raw: unknown, role: Role, envelope: Envelope, contextDigest: string): Receipt | null {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 5 || typeof raw.source_object !== 'string' ||
      !raw.source_object.startsWith(`${role}-wallet-`) || !digest(raw.source_object.slice(`${role}-wallet-`.length)) ||
      !count(raw.record_count) || !count(raw.segment_count) || raw.record_count > raw.segment_count ||
      (raw.record_count === 0) !== (raw.segment_count === 0) || !digest(raw.digest_hex)) return null;
  const source = parseSource(raw.source, envelope, contextDigest);
  if (!source) return null;
  return { source, source_object: raw.source_object, record_count: raw.record_count,
    segment_count: raw.segment_count, digest_hex: raw.digest_hex };
}

function parseSegment(raw: unknown, receipt: Receipt) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 5 || !count(raw.segment_index) || !count(raw.record_index) ||
      !count(raw.part_index) || !count(raw.part_count) || raw.part_count === 0 || raw.part_count > 512 ||
      raw.segment_index >= receipt.segment_count || raw.record_index >= receipt.record_count || raw.part_index >= raw.part_count ||
      typeof raw.data_b64u !== 'string' || raw.data_b64u.length === 0 || raw.data_b64u.length > 5462 ||
      !/^[A-Za-z0-9_-]+$/u.test(raw.data_b64u)) return null;
  return { segment_index: raw.segment_index, record_index: raw.record_index,
    part_index: raw.part_index, part_count: raw.part_count, data_b64u: raw.data_b64u };
}

function digest(raw: unknown): raw is string { return typeof raw === 'string' && /^[a-f0-9]{64}$/u.test(raw); }
function count(raw: unknown): raw is number { return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4294967295; }

function postDirectory(directory: RuntimeSourceDirectory, endpoint: string, body: unknown): Promise<Response> {
  const version = directory.CF_VERSION_METADATA.id;
  if (typeof version !== 'string' || !version) throw new Error('Runtime version is unavailable');
  return directory.WALLET_CONSOLE.fetch(new Request(`https://wallet-placement.internal/internal/wallet-placement/v1/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-seams-writer-role': 'walletRuntime',
      'x-seams-writer-version': version, 'x-seams-writer-account': directory.SEAMS_D1_HOME_ACCOUNT_ID,
      'x-seams-writer-database': directory.SEAMS_D1_HOME_DATABASE_ID }, body: JSON.stringify(body),
  }));
}

function postRole(binding: CloudflareServiceBindingFetcher, role: Role,
  operation: 'relocation-context' | 'fence-relocation' | 'snapshot', body: unknown, credential: string): Promise<Response> {
  return binding.fetch(new Request(`https://${role}.router-ab.internal/router-ab/internal/${role}/wallet/${operation}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
    body: JSON.stringify(body),
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}


function parseActivation(raw: unknown, role: Role, envelope: Envelope, contextDigest: string) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 2) return null;
  const source = parseReceipt(raw.source, role, envelope, contextDigest);
  if (!source || raw.destination_object !== source.source_object) return null;
  return { source, destination_object: source.source_object };
}

async function confirmActivation(response: Response, expected: Receipt, role: Role, envelope: Envelope,
  contextDigest: string, directory: RuntimeSourceDirectory): Promise<Response> {
  if (!response.ok) return response;
  const raw: unknown = await response.clone().json();
  if (!isPlainObject(raw) || Object.keys(raw).length !== 2 || raw.kind !== 'activated') return failure('activation_receipt_unavailable', 503);
  const receipt = parseActivation(raw.receipt, role, envelope, contextDigest);
  if (!receipt || JSON.stringify(receipt.source) !== JSON.stringify(expected)) return failure('activation_receipt_unavailable', 503);
  const stored = await postDirectory(directory, 'relocation-deriver-activation', {
    wallet: envelope.wallet, attempt: envelope.attempt, role: role === 'deriver-a' ? 'deriverA' : 'deriverB', receipt,
  });
  if (!stored.ok) return failure('activation_receipt_unavailable', 503);
  const result: unknown = await stored.json();
  if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true) return failure('activation_receipt_unavailable', 503);
  const confirmed = parseActivation(result.receipt, role, envelope, contextDigest);
  if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(receipt)) return failure('activation_receipt_unavailable', 503);
  return response;
}
