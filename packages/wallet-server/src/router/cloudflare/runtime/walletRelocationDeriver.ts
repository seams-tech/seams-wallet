import { isPlainObject } from '@shared/utils/validation';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';
import type { RuntimeSourceDirectory } from './walletRelocationSource';

export async function forwardDeriverSourceFence(
  input: unknown,
  role: 'deriver-a' | 'deriver-b',
  source: CloudflareServiceBindingFetcher,
  credential: string,
  directory: RuntimeSourceDirectory,
): Promise<Response> {
  if (!isPlainObject(input) || Object.keys(input).length !== 2 ||
      !isPlainObject(input.wallet) || !isPlainObject(input.attempt)) return failure('invalid_input', 400);
  const version = directory.CF_VERSION_METADATA.id;
  if (typeof version !== 'string' || !version) return failure('source_command_unavailable', 503);
  try {
    const contextResponse = await postRole(source, role, 'relocation-context', {}, credential);
    if (!contextResponse.ok) return failure('source_command_unavailable', 503);
    const context: unknown = await contextResponse.json();
    if (!isPlainObject(context) || Object.keys(context).length !== 2 ||
        context.kind !== 'deriver_cipher_context' || typeof context.digest_hex !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(context.digest_hex)) return failure('source_command_unavailable', 503);
    const authorization = await directory.WALLET_CONSOLE.fetch(new Request(
      'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-deriver-source', {
        method: 'POST', headers: {
          'content-type': 'application/json',
          'x-seams-writer-role': 'walletRuntime',
          'x-seams-writer-version': version,
          'x-seams-writer-account': directory.SEAMS_D1_HOME_ACCOUNT_ID,
          'x-seams-writer-database': directory.SEAMS_D1_HOME_DATABASE_ID,
        },
        body: JSON.stringify({ wallet: input.wallet, attempt: input.attempt,
          role: role === 'deriver-a' ? 'deriverA' : 'deriverB', cipherContextDigest: context.digest_hex }),
      },
    ));
    if (!authorization.ok) return failure('source_command_denied', 409);
    const result: unknown = await authorization.json();
    if (!isPlainObject(result) || Object.keys(result).length !== 2 || result.ok !== true ||
        !isPlainObject(result.command)) return failure('source_command_unavailable', 503);
    const command = result.command;
    if (Object.keys(command).length !== 6 || !isPlainObject(command.owner) ||
        Object.keys(command.owner).length !== 4 ||
        command.owner.org_id !== input.wallet.organizationId || command.owner.project_id !== input.wallet.projectId ||
        command.owner.env_id !== input.wallet.environmentId || command.owner.wallet_id !== input.wallet.walletId ||
        command.move_id !== input.attempt.moveId || command.cipher_context_digest_hex !== context.digest_hex ||
        typeof command.request_digest_hex !== 'string' || !/^[a-f0-9]{64}$/u.test(command.request_digest_hex) ||
        typeof command.source_generation !== 'number' || !Number.isSafeInteger(command.source_generation) ||
        command.source_generation < 1 || command.source_generation >= Number.MAX_SAFE_INTEGER ||
        command.destination_generation !== command.source_generation + 1) {
      return failure('source_command_unavailable', 503);
    }
    return await postRole(source, role, 'fence-relocation', command, credential);
  } catch {
    return failure('source_command_unavailable', 503);
  }
}

function postRole(
  source: CloudflareServiceBindingFetcher,
  role: 'deriver-a' | 'deriver-b',
  operation: 'relocation-context' | 'fence-relocation',
  body: unknown,
  credential: string,
): Promise<Response> {
  return source.fetch(new Request(`https://${role}.router-ab.internal/router-ab/internal/${role}/wallet/${operation}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', [ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1]: credential },
    body: JSON.stringify(body),
  }));
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}
