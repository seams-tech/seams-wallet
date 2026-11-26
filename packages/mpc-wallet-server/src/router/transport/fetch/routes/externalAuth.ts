import type { ExternalOwnerAttemptBinding } from '../../../../auth/externalAuthStore';
import { externalOwnerChallenge, readExternalOwnerOperation } from '../../../../auth/externalOwnerOperations';
import { prepareWalletOwnerOperation, walletOwnerOperationAuthorizationId } from '../walletOwnerOperationAuthorization';
import {
  EXTERNAL_AUTH_PATH,
  externalAuthFailure,
  parseExternalAuthConfiguration,
  type ExternalIdentityProof,
  type ExternalAuthConfiguration,
} from '@shared/auth/externalAuth';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { ExternalAuthService } from '../../../../auth/externalAuthService';
import {
  extractBearerCredential,
  resolveSourceIpFromFetchHeaders,
} from '../../../auth/routerApiKeyAuth';
import { json, readJson } from '../../../framework/http';
import type { FetchRouterApiContext } from '../fetchRouter.types';
import type { RouteDefinition } from '../../../framework/routeDefinitions';

const ACTIONS = [
  'associate',
  'unlink',
  'prepare',
  'prepare-association',
  'prepare-unlink',
  'owner-challenge',
  'exchange',
  'backend-exchange',
  'redeem',
  'settings',
  'logout',
] as const;
type Action = (typeof ACTIONS)[number];

type BrowserCommand = { readonly appOrigin: string } & ReadonlyExclusiveUnion<
  | { action: 'associate' | 'unlink'; attemptId: string; binding: string; sessionToken: string; code: string; factorProof: unknown }
  | { action: 'owner-challenge'; attemptId: string; binding: string; sessionToken: string; code: string }
  | { action: 'prepare-unlink'; associationId: string; binding: string; sessionToken: string }
  | { action: 'prepare' | 'prepare-association'; binding: string; sessionToken: string }
  | { action: 'exchange'; attemptId: string; idToken: string }
  | { action: 'redeem'; attemptId: string; binding: string; sessionToken: string; code: string }
  | { action: 'settings' | 'logout'; sessionToken: string }
>;
type Command = { readonly walletId: WalletId } & ReadonlyExclusiveUnion<
  BrowserCommand | { action: 'backend-exchange'; attemptId: string; proof: ExternalIdentityProof }
>;

function parseIdentityProof(value: unknown): ExternalIdentityProof {
  const proof = requireRecord(value, 'external identity proof');
  switch (proof.kind) {
    case 'google':
      return { kind: 'google', idToken: requireCanonicalString(proof.idToken, 'idToken') };
    case 'application':
      return { kind: 'application', assertion: requireCanonicalString(proof.assertion, 'assertion') };
    default:
      throw new Error('Unsupported external identity proof');
  }
}

function parseCommand(action: Action, body: Record<string, unknown>): Command {
  const wallet = parseWalletId(body.walletId);
  if (!wallet.ok) throw new Error('Wallet ID is invalid');
  const walletId = wallet.value;
  if (action === 'backend-exchange')
    return {
      action,
      walletId,
      attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
      proof: parseIdentityProof(body.proof),
    };
  const appOrigin = requireCanonicalString(body.appOrigin, 'appOrigin');
  if (new URL(appOrigin).origin !== appOrigin) throw new Error('Application origin is invalid');
  switch (action) {
    case 'associate':
    case 'unlink':
      return {
        action, walletId, appOrigin,
        attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
        binding: secret(body.binding, 'binding'), sessionToken: secret(body.sessionToken, 'sessionToken'),
        code: secret(body.code, 'code'), factorProof: body.factorProof,
      };
    case 'owner-challenge':
      return {
        action, walletId, appOrigin,
        attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
        binding: secret(body.binding, 'binding'), sessionToken: secret(body.sessionToken, 'sessionToken'),
        code: secret(body.code, 'code'),
      };
    case 'prepare-unlink':
      return {
        action, walletId, appOrigin,
        associationId: requireCanonicalString(body.associationId, 'associationId'),
        binding: secret(body.binding, 'binding'), sessionToken: secret(body.sessionToken, 'sessionToken'),
      };
    case 'prepare':
    case 'prepare-association':
      return {
        action,
        walletId,
        appOrigin,
        binding: secret(body.binding, 'binding'),
        sessionToken: secret(body.sessionToken, 'sessionToken'),
      };
    case 'exchange':
      return {
        action,
        walletId,
        appOrigin,
        attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
        idToken: requireCanonicalString(body.idToken, 'idToken'),
      };
    case 'redeem':
      return {
        action,
        walletId,
        appOrigin,
        attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
        binding: secret(body.binding, 'binding'),
        sessionToken: secret(body.sessionToken, 'sessionToken'),
        code: secret(body.code, 'code'),
      };
    case 'settings':
    case 'logout':
      return {
        action,
        walletId,
        appOrigin,
        sessionToken: secret(body.sessionToken, 'sessionToken'),
      };
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported external authentication action: ${String(value)}`);
}

export function externalAuthRoutes(): RouteDefinition[] {
  return ACTIONS.map(externalAuthRoute);
}

function externalAuthRoute(action: Action): RouteDefinition {
  return {
    id: `external_auth_${action}`,
    surface: 'relay',
    method: 'POST',
    path: `${EXTERNAL_AUTH_PATH}/${action}`,
    auth: {
      plane: 'public',
      proof: 'challenge_exchange',
      rationale:
        'Application credentials and scoped external identity evidence are verified by the handler.',
    },
    metering: { kind: 'none' },
    summary: 'External authentication for wallet settings',
  };
}

function parseAction(pathname: string): Action | null {
  for (const action of ACTIONS) {
    if (pathname === `${EXTERNAL_AUTH_PATH}/${action}`) return action;
  }
  return null;
}

function secret(value: unknown, label: string): string {
  const text = requireCanonicalString(value, label);
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error(`${label} must contain 32 random bytes`);
  return text;
}

function failure(status: number, code: Parameters<typeof externalAuthFailure>[0]): Response {
  return json(externalAuthFailure(code), { status, headers: { 'Cache-Control': 'no-store' } });
}

async function resolveApplicationTrust(
  ctx: FetchRouterApiContext,
  service: ExternalAuthService,
  command: Command,
): Promise<ExternalAuthConfiguration | null> {
  const credential = extractBearerCredential(ctx.request.headers);
  if (!credential) return null;
  const scope = service.store.scope;
  if (ctx.request.headers.get('x-seams-environment-id') !== scope.envId) return null;
  const result =
    command.action === 'backend-exchange'
      ? await ctx.opts.apiKeyAuth?.authenticate({
          secret: credential,
          endpoint: ctx.pathname,
          requiredScopes: ['wallets.read'],
          environmentId: scope.envId,
        })
      : await ctx.opts.publishableKeyAuth?.authenticate({
          secret: credential,
          origin: ctx.request.headers.get('origin') || '',
          environmentId: scope.envId,
        });
  if (
    !result?.ok ||
    result.principal.orgId !== scope.orgId ||
    result.principal.projectId !== scope.projectId ||
    result.principal.environmentId !== scope.envId
  )
    return null;
  if (command.action !== 'backend-exchange') {
    const parent = await ctx.opts.publishableKeyAuth?.authenticate({
      secret: credential,
      origin: command.appOrigin,
      environmentId: scope.envId,
    });
    if (!parent?.ok || parent.principal.apiKeyId !== result.principal.apiKeyId) return null;
  }
  const environments = await ctx.opts.orgProjectEnv?.listEnvironments(
    {
      orgId: scope.orgId,
      projectId: scope.projectId,
      environmentId: scope.envId,
      actorUserId: result.principal.apiKeyId,
      roles: [],
    },
    { status: 'ACTIVE' },
  );
  const environment = environments?.find(matchesEnvironment.bind(null, scope.envId));
  const configuration = parseExternalAuthConfiguration(
    environment?.externalAuth ?? { kind: 'disabled', revision: 0 },
  );
  return configuration;
}

function matchesEnvironment(environmentId: string, environment: { id: string }): boolean {
  return environment.id === environmentId;
}

export async function handleExternalAuth(ctx: FetchRouterApiContext): Promise<Response | null> {
  const action = parseAction(ctx.pathname);
  if (!action) return null;
  if (ctx.method !== 'POST') return failure(405, 'invalid_request');
  const service = ctx.service.externalAuth;
  if (!service) return failure(503, 'unavailable');
  let command: Command;
  try {
    command = parseCommand(
      action,
      requireRecord(await readJson(ctx.request), 'external authentication request'),
    );
  } catch {
    return failure(400, 'invalid_request');
  }
  try {
    const trust = await resolveApplicationTrust(ctx, service, command);
    if (!trust) return failure(403, 'access_denied');
    return await dispatch(ctx, service, trust, command);
  } catch {
    return failure(503, 'unavailable');
  }
}

async function dispatch(
  ctx: FetchRouterApiContext,
  service: ExternalAuthService,
  trust: ExternalAuthConfiguration,
  command: Command,
): Promise<Response> {
  const walletId = command.walletId;
  if (
    command.action === 'prepare' || command.action === 'prepare-association' || command.action === 'prepare-unlink' ||
    command.action === 'exchange' ||
    command.action === 'backend-exchange' ||
    command.action === 'associate'
  ) {
    const rateKey = await sha256HexUtf8(
      resolveSourceIpFromFetchHeaders(ctx.request.headers) || 'unknown',
    );
    if (!(await service.store.consumeAuthenticationAllowance(rateKey, Date.now())))
      return failure(429, 'rate_limited');
  }
  if (command.action === 'backend-exchange') {
    if (trust.kind === 'disabled') return failure(403, 'access_denied');
    return json(await service.exchange({
      walletId, attemptId: command.attemptId, proof: command.proof, trust,
    }));
  }
  const originBinding = JSON.stringify([ctx.request.headers.get('origin') || '', command.appOrigin]);
  if (command.action === 'prepare-unlink') {
    return json(await service.prepareUnlink({
      walletId, associationId: command.associationId, originBinding,
      binding: command.binding, sessionToken: command.sessionToken, trustRevision: trust.revision,
    }));
  }
  if (command.action === 'owner-challenge' || command.action === 'associate' || command.action === 'unlink') {
    const binding: ExternalOwnerAttemptBinding = {
      walletId,
      attemptId: command.attemptId,
      originBinding,
      bindingHash: await sha256HexUtf8(command.binding),
      sessionTokenHash: await sha256HexUtf8(command.sessionToken),
      codeHash: await sha256HexUtf8(command.code),
      trustRevision: trust.revision,
      nowMs: Date.now(),
    };
    const result = await readExternalOwnerOperation({
      store: service.store,
      binding,
      requestOrigin: ctx.request.headers.get('origin') || '',
      phase: command.action === 'owner-challenge' ? 'prepare' : 'complete',
    });
    if (!result.ok) return json(result, { status: 403 });
    const ownerOperation = result.value;
    if (command.action === 'owner-challenge')
      return json({ ok: true, value: externalOwnerChallenge(ownerOperation) });
    if (command.action !== ownerOperation.attempt.purpose) return failure(403, 'access_denied');
    if (ownerOperation.attempt.status === 'consumed') {
      const stored = await ctx.service.authorizedOperations.readAuthorizedOperationById({
        tenantId: ctx.service.authorizedOperations.tenantId,
        authorizedOperationId: walletOwnerOperationAuthorizationId(
          ownerOperation.operation,
          ownerOperation.challengeB64u,
        ),
      });
      if (
        !stored ||
        stored.authorization.kind !== 'verified_step_up' ||
        stored.quota.kind !== 'quota_neutral' ||
        stored.lifecycle !== 'completed'
      ) {
        return failure(503, 'unavailable');
      }
      return new Response(stored.response.bodyText, {
        status: stored.response.status,
        headers: { 'Content-Type': stored.response.contentType, 'Cache-Control': 'no-store' },
      });
    }
    const authorized = await prepareWalletOwnerOperation({
      ctx,
      walletId,
      operation: ownerOperation.operation,
      payload: ownerOperation.payload,
      factorProof: command.factorProof,
    });
    if (!authorized.ok) return authorized.response;
    const admission = await ctx.service.authorizedOperations.prepareAuthorizedOperationAdmission({
      operation: authorized.operation,
    });
    switch (admission.kind) {
      case 'prepared':
        break;
      case 'replayed':
        if (admission.operation.lifecycle !== 'completed') return failure(503, 'unavailable');
        return new Response(admission.operation.response.bodyText, {
          status: admission.operation.response.status,
          headers: {
            'Content-Type': admission.operation.response.contentType,
            'Cache-Control': 'no-store',
          },
        });
      case 'operation_in_progress':
        return failure(503, 'unavailable');
      case 'authorization_grant_rejected':
      case 'verified_step_up_rejected':
      case 'billing_credit_exhausted':
      case 'wallet_session_quota_exhausted':
      case 'material_mismatch':
        return failure(403, 'access_denied');
      default:
        return assertNever(admission);
    }
    try {
      await service.store.commitOwnerOperation({
        binding: {
          walletId: binding.walletId,
          attemptId: binding.attemptId,
          originBinding: binding.originBinding,
          bindingHash: binding.bindingHash,
          sessionTokenHash: binding.sessionTokenHash,
          codeHash: binding.codeHash,
          trustRevision: binding.trustRevision,
          nowMs: Date.now(),
        },
        attempt: ownerOperation.attempt,
        owner: authorized.ownerAuthority,
        operation: authorized.operation,
        admission,
      });
    } catch (error) {
      // A concurrent commit or a lost D1 response can already have stored the result.
      const stored = await ctx.service.authorizedOperations.readAuthorizedOperationById({
        tenantId: authorized.operation.tenantId,
        authorizedOperationId: authorized.operation.authorizedOperationId,
      });
      if (
        stored?.lifecycle === 'completed' &&
        stored.authorization.kind === 'verified_step_up' &&
        stored.quota.kind === 'quota_neutral'
      ) {
        return new Response(stored.response.bodyText, {
          status: stored.response.status,
          headers: { 'Content-Type': stored.response.contentType, 'Cache-Control': 'no-store' },
        });
      }
      if (ctx.service.authorizedOperations.classifyAuthorizedOperationAdmissionFailure(error)) {
        return failure(403, 'access_denied');
      }
      throw error;
    }
    return json({ ok: true, value: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (trust.kind === 'disabled') return failure(403, 'access_denied');
  if (command.action === 'prepare' || command.action === 'prepare-association') {
    return json(
      await service.prepare({
        purpose: command.action === 'prepare' ? 'authenticate' : 'associate',
        walletId,
        originBinding,
        binding: command.binding,
        sessionToken: command.sessionToken,
      }),
    );
  }
  if (command.action === 'exchange') {
    return json(
      await service.exchange({
        trust,
        walletId,
        attemptId: command.attemptId,
        proof: { kind: 'google', idToken: command.idToken },
      }),
    );
  }
  const tokenHash = await sha256HexUtf8(command.sessionToken);
  if (command.action === 'logout') {
    await service.store.revokeSession(tokenHash, originBinding);
    return json({ ok: true });
  }
  const authentication =
    command.action === 'redeem'
      ? await service.store.redeem({
          walletId,
          originBinding,
          attemptId: command.attemptId,
          bindingHash: await sha256HexUtf8(command.binding),
          codeHash: await sha256HexUtf8(command.code),
          sessionTokenHash: tokenHash,
          nowMs: Date.now(),
          trustRevision: trust.revision,
        })
      : await service.store.readSession({
          tokenHash,
          originBinding,
          nowMs: Date.now(),
          trustRevision: trust.revision,
        });
  if (!authentication || authentication.walletId !== walletId) return failure(403, 'access_denied');
  return json(
    { ok: true, value: await service.settings(authentication) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
