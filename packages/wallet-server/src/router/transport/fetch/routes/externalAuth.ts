import type { ExternalAuthTrust } from '../../../../auth/externalAuthStore';
import {
  EXTERNAL_AUTH_PATH,
  externalAuthFailure,
  parseExternalAuthConfiguration,
} from '@shared/auth/externalAuth';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { sha256HexUtf8 } from '@shared/utils/digests';
import {
  buildFullOwnerPermissionsV1,
  buildDelegatedWalletAuthorityV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
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
  'exchange',
  'backend-exchange',
  'redeem',
  'settings',
  'logout',
] as const;
type Action = (typeof ACTIONS)[number];

type BrowserCommand = { readonly appOrigin: string } & ReadonlyExclusiveUnion<
  | { action: 'associate'; ownerCredential: string; idToken: string }
  | { action: 'unlink'; ownerCredential: string; associationId: string }
  | { action: 'prepare'; binding: string; sessionToken: string }
  | { action: 'exchange'; attemptId: string; idToken: string }
  | { action: 'redeem'; attemptId: string; binding: string; sessionToken: string; code: string }
  | { action: 'settings' | 'logout'; sessionToken: string }
>;
type Command = { readonly walletId: WalletId } & ReadonlyExclusiveUnion<
  BrowserCommand | { action: 'backend-exchange'; attemptId: string; idToken: string }
>;

function parseCommand(action: Action, body: Record<string, unknown>): Command {
  const wallet = parseWalletId(body.walletId);
  if (!wallet.ok) throw new Error('Wallet ID is invalid');
  const walletId = wallet.value;
  if (action === 'backend-exchange')
    return {
      action,
      walletId,
      attemptId: requireCanonicalString(body.attemptId, 'attemptId'),
      idToken: requireCanonicalString(body.idToken, 'idToken'),
    };
  const appOrigin = requireCanonicalString(body.appOrigin, 'appOrigin');
  if (new URL(appOrigin).origin !== appOrigin) throw new Error('Application origin is invalid');
  switch (action) {
    case 'associate':
      return {
        action,
        walletId,
        appOrigin,
        ownerCredential: requireCanonicalString(body.ownerCredential, 'ownerCredential'),
        idToken: requireCanonicalString(body.idToken, 'idToken'),
      };
    case 'unlink':
      return {
        action,
        walletId,
        appOrigin,
        ownerCredential: requireCanonicalString(body.ownerCredential, 'ownerCredential'),
        associationId: requireCanonicalString(body.associationId, 'associationId'),
      };
    case 'prepare':
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
): Promise<ExternalAuthTrust | null> {
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
  return configuration.kind === 'google' ? configuration : null;
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
  trust: ExternalAuthTrust,
  command: Command,
): Promise<Response> {
  const walletId = command.walletId;
  const originBinding = JSON.stringify([
    ctx.request.headers.get('origin') || '',
    command.appOrigin,
  ]);
  if (
    command.action === 'prepare' ||
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
  if (command.action === 'associate' || command.action === 'unlink') {
    const token = command.ownerCredential;
    const owner =
      await ctx.service.authorizationSessions.readWalletSessionAuthorizationV2ByOperationCredential(
        {
          tenantId: ctx.service.authorizationSessions.tenantId,
          token,
          nowMs: Date.now(),
        },
      );
    if (
      !owner ||
      owner.authorization.session.walletId !== walletId ||
      !sameDelegatedWalletAuthorityV1(
        buildDelegatedWalletAuthorityV1({ permissions: owner.authority.permissions }),
        buildDelegatedWalletAuthorityV1({ permissions: buildFullOwnerPermissionsV1() }),
      )
    )
      return failure(403, 'access_denied');
    if (command.action === 'unlink') {
      await service.store.revokeAssociation(walletId, command.associationId);
      return json({ ok: true });
    }
    const proof = await service.verifyGoogle(trust, command.idToken);
    if (!proof.ok) return json(proof, { status: 403 });
    const associated = await service.store.associate({
      walletId,
      subject: proof.value.subject,
      authorityId: owner.authority.authorityId,
      authorityEpoch: owner.authority.revocationEpoch,
    });
    return associated ? json({ ok: true }) : failure(409, 'access_denied');
  }
  if (command.action === 'prepare') {
    return json(
      await service.prepare({
        walletId,
        originBinding,
        binding: command.binding,
        sessionToken: command.sessionToken,
      }),
    );
  }
  if (command.action === 'exchange' || command.action === 'backend-exchange') {
    return json(
      await service.exchange({
        trust,
        walletId,
        attemptId: command.attemptId,
        idToken: command.idToken,
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
