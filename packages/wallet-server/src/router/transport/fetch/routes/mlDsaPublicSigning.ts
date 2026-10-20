import type { MlDsaSigningExecuteRequest } from '../../../cloudflare/d1/wallet/d1WalletMlDsaSigning';
import type { MlDsaSigningRequest } from '@shared/near/mlDsaSigning';
import type { SessionOrigin } from '../../../../authorization/domain';
import type { WalletId } from '@shared/utils/domainIds';
import { errorMessage } from '@shared/utils/errors';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { parseMlDsaSigningRequest, type MlDsaSigningFailure } from '@shared/near/mlDsaSigning';
import { exactRecord } from '@shared/utils/exactRecord';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseWalletId } from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { parseSessionOrigin } from '../../../../authorization/domain';
import { parseWebAuthnAuthenticationCredential } from '../../../auth/webAuthnCredentialCodecs';
import { json, readJson } from '../../../framework/http';
import {
  findRouteDefinitionById,
  matchesRouteDefinitionRequest,
} from '../../../framework/routeDefinitions';
import {
  WALLET_MANAGEMENT_PROTOCOL_HEADER,
  WALLET_MANAGEMENT_PROTOCOL_VERSION,
} from '@shared/utils/walletManagementProtocol';
import { requireRecord } from '@shared/utils/validation';

function failure(status: number, code: MlDsaSigningFailure['code'], message: string): Response {
  return json({ kind: 'refused', code, message }, { status });
}
export async function handlePublicMlDsaSigning(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const prepare = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_signing_prepare');
  const execute = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_signing_execute');
  const isPrepare = prepare && matchesRouteDefinitionRequest(prepare, ctx.method, ctx.pathname);
  const isExecute = execute && matchesRouteDefinitionRequest(execute, ctx.method, ctx.pathname);
  if (!isPrepare && !isExecute) return null;
  if (
    ctx.request.headers.get(WALLET_MANAGEMENT_PROTOCOL_HEADER) !==
    WALLET_MANAGEMENT_PROTOCOL_VERSION
  )
    return failure(409, 'invalid_body', 'The Wallet management protocol version differs');
  const originText = ctx.request.headers.get('origin');
  if (!originText || !(ctx.opts.hostedWalletOrigins ?? []).includes(originText))
    return failure(403, 'unauthorized', 'A configured Wallet origin is required');
  let command: PublicSigningCommand;
  let origin: SessionOrigin;
  let pathWalletId: WalletId;
  try {
    origin = parseSessionOrigin(originText);
    pathWalletId = requireParsed(
      parseWalletId(decodeURIComponent(ctx.pathname.split('/')[2] ?? '')),
      'walletId',
    );
    command = parseCommand(await readJson(ctx.request), Boolean(isPrepare));
  } catch {
    return failure(400, 'invalid_body', 'Invalid ML-DSA signing request');
  }
  if (command.request.walletId !== pathWalletId)
    return failure(403, 'unauthorized', 'The path wallet differs');
  try {
    const outcome =
      command.kind === 'prepare'
        ? await ctx.service.walletAuthMethods.prepareMlDsaSigning(command.request, origin)
        : await ctx.service.walletAuthMethods.signMlDsaTransaction(command.request, origin);
    return json(outcome, {
      status: outcome.kind === 'refused' ? refusalStatus(outcome) : 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
    ctx.logger.error('ML-DSA public signing failed', { message: errorMessage(error) });
    return failure(503, 'protocol_failed', 'ML-DSA signing is temporarily unavailable');
  }
}

type PublicSigningCommand =
  | { readonly kind: 'prepare'; readonly request: MlDsaSigningRequest }
  | { readonly kind: 'execute'; readonly request: MlDsaSigningExecuteRequest };
function parseCommand(raw: unknown, isPrepare: boolean): PublicSigningCommand {
  if (isPrepare) return { kind: 'prepare', request: parseMlDsaSigningRequest(raw) };
  const r = exactRecord(
    raw,
    ['walletId', 'operationIdB64u', 'credential'],
    'ML-DSA signing execution',
  );
  const credential = parseWebAuthnAuthenticationCredential(r.credential);
  if (!credential) throw new Error('Invalid WebAuthn signing approval');
  const extensions =
    credential.clientExtensionResults === null || credential.clientExtensionResults === undefined
      ? {}
      : requireRecord(credential.clientExtensionResults, 'WebAuthn extensions');
  if (Object.keys(extensions).length !== 0)
    throw new Error('Signing approval must omit extension outputs');
  return {
    kind: 'execute',
    request: {
      walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
      operationIdB64u: parseDigestB64u(r.operationIdB64u),
      credential,
    },
  };
}

function refusalStatus(outcome: MlDsaSigningFailure): number {
  switch (outcome.code) {
    case 'unauthorized':
      return 403;
    case 'not_found':
      return 404;
    case 'expired':
    case 'conflict':
    case 'idempotency_conflict':
      return 409;
    case 'not_configured':
      return 501;
    case 'protocol_failed':
    case 'invalid_signature':
      return 502;
    case 'invalid_body':
      return 400;
    default:
      return assertNever(outcome.code);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown ML-DSA refusal: ${String(value)}`);
}
