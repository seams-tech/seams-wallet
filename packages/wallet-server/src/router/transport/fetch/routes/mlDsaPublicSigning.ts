import { parseMlDsaEmailOtpProof } from '@shared/near/mlDsaEmailOtp';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import type {
  MlDsaSigningExecuteRequest,
  MlDsaInventoryRequest,
} from '../../../cloudflare/d1/wallet/d1WalletMlDsaSigning';
import {
  parseMlDsaInventoryActor,
  parseMlDsaInventoryPreparation,
  type MlDsaInventoryActor,
} from '@shared/near/mlDsaInventory';
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
import {
  parseMlDsaSigningSessionRequest,
  parseMlDsaSigningSessionCredential,
  type MlDsaSigningSessionRequest,
  type MlDsaSigningSessionCredential,
} from '@shared/near/mlDsaSigningSession';

function failure(status: number, code: MlDsaSigningFailure['code'], message: string): Response {
  return json({ kind: 'refused', code, message }, { status });
}
export async function handlePublicMlDsaSigning(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const metadata = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_metadata');
  const isMetadata = metadata && matchesRouteDefinitionRequest(metadata, ctx.method, ctx.pathname);
  const activity = findRouteDefinitionById(
    ctx.routeDefinitions,
    'wallet_ml_dsa_registration_activity',
  );
  const isActivity = activity && matchesRouteDefinitionRequest(activity, ctx.method, ctx.pathname);
  const prepare = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_signing_prepare');
  const execute = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_signing_execute');
  const session = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_session_prepare');
  const sessionRevoke = findRouteDefinitionById(
    ctx.routeDefinitions,
    'wallet_ml_dsa_session_revoke',
  );
  const inventory = findRouteDefinitionById(ctx.routeDefinitions, 'wallet_ml_dsa_inventory');
  const inventoryPrepare = findRouteDefinitionById(
    ctx.routeDefinitions,
    'wallet_ml_dsa_inventory_prepare',
  );
  const isPrepare = prepare && matchesRouteDefinitionRequest(prepare, ctx.method, ctx.pathname);
  const isExecute = execute && matchesRouteDefinitionRequest(execute, ctx.method, ctx.pathname);
  const isSession = session && matchesRouteDefinitionRequest(session, ctx.method, ctx.pathname);
  const isSessionRevoke =
    sessionRevoke && matchesRouteDefinitionRequest(sessionRevoke, ctx.method, ctx.pathname);
  const isInventory =
    inventory && matchesRouteDefinitionRequest(inventory, ctx.method, ctx.pathname);
  const isInventoryPrepare =
    inventoryPrepare && matchesRouteDefinitionRequest(inventoryPrepare, ctx.method, ctx.pathname);
  if (
    !isMetadata &&
    !isActivity &&
    !isPrepare &&
    !isExecute &&
    !isInventory &&
    !isInventoryPrepare &&
    !isSession &&
    !isSessionRevoke
  )
    return null;
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
    const body = await readJson(ctx.request);
    if (isMetadata || isActivity) {
      const record = exactRecord(body, ['walletId'], 'Signer metadata request');
      const token = extractBearerCredential(ctx.request.headers);
      if (!token)
        return failure(401, 'unauthorized', 'Unlock this wallet to read its signing keys');
      command = {
        kind: isMetadata ? 'metadata' : 'registration_activity',
        request: { walletId: requireParsed(parseWalletId(record.walletId), 'walletId'), token },
      };
    } else if (isPrepare) command = parseCommand(body, 'prepare');
    else if (isSession)
      command = { kind: 'session_prepare', request: parseMlDsaSigningSessionRequest(body) };
    else if (isSessionRevoke)
      command = { kind: 'session_revoke', request: parseMlDsaSigningSessionCredential(body) };
    else if (isInventoryPrepare) command = parseCommand(body, 'prepare_inventory');
    else if (isInventory) command = parseCommand(body, 'inventory');
    else command = parseCommand(body, 'execute');
  } catch {
    return failure(400, 'invalid_body', 'Invalid ML-DSA signing request');
  }
  const walletId =
    command.kind === 'inventory' ? command.request.preparation.walletId : command.request.walletId;
  if (walletId !== pathWalletId) return failure(403, 'unauthorized', 'The path wallet differs');
  const background = ctx.runtime.kind === 'background' ? ctx.runtime.waitUntil : undefined;
  try {
    let outcome;
    switch (command.kind) {
      case 'metadata':
        outcome = await ctx.service.walletAuthMethods.readMlDsaSignerMetadata(command.request);
        break;
      case 'registration_activity':
        outcome = await ctx.service.walletAuthMethods.recordMlDsaRegistrationActivity(
          command.request,
        );
        break;
      case 'session_prepare':
        outcome = await ctx.service.walletAuthMethods.prepareMlDsaSigningSession(
          command.request,
          origin,
        );
        break;
      case 'session_revoke':
        outcome = await ctx.service.walletAuthMethods.revokeMlDsaSigningSession(
          command.request,
          origin,
        );
        break;
      case 'prepare':
        if (command.request.actor.kind === 'email_otp') {
          const token = extractBearerCredential(ctx.request.headers);
          if (!token) return failure(401, 'unauthorized', 'Unlock this wallet to prepare signing');
          outcome = await ctx.service.walletAuthMethods.prepareMlDsaSigning(
            command.request,
            origin,
            { kind: 'email_otp', token },
            ctx.service,
            background,
          );
        } else {
          outcome = await ctx.service.walletAuthMethods.prepareMlDsaSigning(
            command.request,
            origin,
            { kind: 'passkey' },
            ctx.service,
            background,
          );
        }
        break;
      case 'execute':
        outcome = await ctx.service.walletAuthMethods.signMlDsaTransaction(
          command.request,
          origin,
          ctx.service,
        );
        break;
      case 'inventory':
        outcome = await ctx.service.walletAuthMethods.readMlDsaSignerInventory(
          command.request,
          origin,
        );
        break;
      case 'prepare_inventory':
        outcome = await ctx.service.walletAuthMethods.prepareMlDsaSignerInventory(
          command.request,
          origin,
        );
        break;
      default:
        return assertNever(command);
    }
    return json(outcome, {
      status: outcome.kind === 'refused' ? refusalStatus(outcome) : 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
    ctx.logger.error('ML-DSA public operation failed', { message: errorMessage(error) });
    return failure(503, 'protocol_failed', 'ML-DSA service is temporarily unavailable');
  }
}

type PublicSigningCommand =
  | {
      readonly kind: 'metadata' | 'registration_activity';
      readonly request: { readonly walletId: WalletId; readonly token: string };
    }
  | { readonly kind: 'session_prepare'; readonly request: MlDsaSigningSessionRequest }
  | { readonly kind: 'session_revoke'; readonly request: MlDsaSigningSessionCredential }
  | { readonly kind: 'prepare'; readonly request: MlDsaSigningRequest }
  | { readonly kind: 'execute'; readonly request: MlDsaSigningExecuteRequest }
  | { readonly kind: 'inventory'; readonly request: MlDsaInventoryRequest }
  | { readonly kind: 'prepare_inventory'; readonly request: MlDsaInventoryActor };
function parseCommand(
  raw: unknown,
  kind: Exclude<
    PublicSigningCommand['kind'],
    'metadata' | 'registration_activity' | 'session_prepare' | 'session_revoke'
  >,
): PublicSigningCommand {
  if (kind === 'prepare') return { kind: 'prepare', request: parseMlDsaSigningRequest(raw) };
  if (kind === 'prepare_inventory') return { kind, request: parseMlDsaInventoryActor(raw) };
  if (kind === 'inventory') {
    const r = exactRecord(raw, ['preparation', 'credential'], 'ML-DSA inventory request');
    return {
      kind: 'inventory',
      request: {
        preparation: parseMlDsaInventoryPreparation(r.preparation),
        credential: approvalCredential(r.credential),
      },
    };
  }
  const r = exactRecord(
    raw,
    ['walletId', 'operationIdB64u', 'authorization'],
    'ML-DSA signing execution',
  );
  return {
    kind: 'execute',
    request: {
      walletId: requireParsed(parseWalletId(r.walletId), 'walletId'),
      operationIdB64u: parseDigestB64u(r.operationIdB64u),
      authorization: parseSigningAuthorization(r.authorization),
    },
  };
}
function parseSigningAuthorization(raw: unknown): MlDsaSigningExecuteRequest['authorization'] {
  const authorization = requireRecord(raw, 'ML-DSA signing authorization');
  switch (authorization.kind) {
    case 'passkey':
      exactRecord(authorization, ['kind', 'credential'], 'ML-DSA passkey approval');
      return { kind: 'passkey', credential: approvalCredential(authorization.credential) };
    case 'email_otp':
      exactRecord(authorization, ['kind', 'proof'], 'ML-DSA Email OTP approval');
      return { kind: 'email_otp', proof: parseMlDsaEmailOtpProof(authorization.proof) };
    case 'email_otp_session_start':
      exactRecord(
        authorization,
        ['kind', 'proof', 'sessionIdB64u', 'tokenB64u'],
        'ML-DSA Email OTP session approval',
      );
      return {
        kind: 'email_otp_session_start',
        proof: parseMlDsaEmailOtpProof(authorization.proof),
        sessionIdB64u: parseDigestB64u(authorization.sessionIdB64u),
        tokenB64u: parseDigestB64u(authorization.tokenB64u),
      };
    case 'session_start':
      exactRecord(
        authorization,
        ['kind', 'credential', 'sessionIdB64u', 'tokenB64u'],
        'ML-DSA session approval',
      );
      return {
        kind: 'session_start',
        credential: approvalCredential(authorization.credential),
        sessionIdB64u: parseDigestB64u(authorization.sessionIdB64u),
        tokenB64u: parseDigestB64u(authorization.tokenB64u),
      };
    case 'session':
      exactRecord(
        authorization,
        ['kind', 'sessionIdB64u', 'tokenB64u'],
        'ML-DSA session credential',
      );
      return {
        kind: 'session',
        sessionIdB64u: parseDigestB64u(authorization.sessionIdB64u),
        tokenB64u: parseDigestB64u(authorization.tokenB64u),
      };
    default:
      throw new Error('Unsupported ML-DSA signing authorization');
  }
}
function approvalCredential(raw: unknown) {
  const credential = parseWebAuthnAuthenticationCredential(raw);
  if (!credential) throw new Error('Invalid WebAuthn signing approval');
  const extensions =
    credential.clientExtensionResults === null || credential.clientExtensionResults === undefined
      ? {}
      : requireRecord(credential.clientExtensionResults, 'WebAuthn extensions');
  if (Object.keys(extensions).length !== 0)
    throw new Error('Signing approval must omit extension outputs');
  return credential;
}

function refusalStatus(outcome: MlDsaSigningFailure): number {
  switch (outcome.code) {
    case 'unauthorized':
      return 403;
    case 'not_found':
      return 404;
    case 'candidates_exhausted':
    case 'deadline_exceeded':
    case 'key_changed':
    case 'cancelled':
    case 'admission_rejected':
    case 'expired':
    case 'conflict':
    case 'idempotency_conflict':
      return 409;
    case 'not_configured':
      return 501;
    case 'transport_interrupted':
    case 'participant_unavailable':
    case 'material_unavailable':
    case 'clock_unavailable':
      return 503;
    case 'participant_rejected':
    case 'invalid_participant_response':
    case 'invalid_material':
    case 'configuration_invalid':
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
  throw new Error(`Unknown ML-DSA command or refusal: ${String(value)}`);
}
