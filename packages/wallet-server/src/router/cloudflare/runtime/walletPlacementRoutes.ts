import { isPlainObject } from '@shared/utils/validation';
import type { TenantId } from '@shared/authorization/capabilityKinds';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import type { SessionOrigin } from '../../../authorization/domain';
import type { AuthorizationService } from '../../../authorization/service';
import type { D1TenantScope } from '../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../storage/tenantRoute';
import type {
  RouterApiRouteExtension,
  RouterApiFetchRouteExtensionInput,
} from '../../framework/routeExtensions';
import { D1WalletRelocationChallenges } from '../d1/wallet/d1WalletRelocationChallenges';
import { D1WalletRelocationApprovals } from '../d1/wallet/d1WalletRelocationApprovals';
import { WalletRelocationOwnerRequest } from '../d1/wallet/d1WalletRelocationOwnerRequest';
import { WalletRelocationReadAccess } from '../d1/wallet/d1WalletRelocationReadAccess';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

const BASE_PATH = '/wallet/placement/v1';

// The supplied database and session reader belong to the resolved wallet home.
export class WalletPlacementRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension';
  readonly id = 'wallet_placement';
  readonly routes: RouterApiRouteExtension['routes'] = [
    {
      id: 'wallet_relocation_challenge',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/relocations/challenge`,
      auth: {
        plane: 'public',
        rationale: 'The handler requires an authenticated full-owner Wallet Session.',
      },
      metering: { kind: 'none' },
      summary: 'Issue a fresh owner relocation challenge',
    },
    {
      id: 'wallet_relocation_post',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/relocations`,
      auth: {
        plane: 'public',
        rationale:
          'The handler authenticates an owner or bounded move-read credential before exact replay.',
      },
      metering: { kind: 'none' },
      summary: 'Replay an admitted wallet relocation',
    },
    {
      id: 'wallet_placement_get',
      surface: 'relay',
      method: 'GET',
      path: BASE_PATH,
      auth: {
        plane: 'public',
        rationale: 'The handler authenticates the full-owner Wallet Session.',
      },
      metering: { kind: 'none' },
      summary: 'Read wallet placement',
    },
    {
      id: 'wallet_relocation_get',
      surface: 'relay',
      method: 'GET',
      path: `${BASE_PATH}/relocations/:moveId`,
      auth: {
        plane: 'public',
        rationale: 'The handler authenticates a full owner or bounded move-read credential.',
      },
      metering: { kind: 'none' },
      summary: 'Read wallet relocation progress',
    },
  ];

  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: D1TenantScope;
      readonly tenantId: TenantId;
      readonly allowedOrigins: readonly SessionOrigin[];
      readonly authorizationSessions: Pick<
        AuthorizationService,
        'readWalletSessionExactOperationContextByCredential'
      >;
      readonly directory: WalletConsoleServiceBinding;
    },
  ) {}

  async handleFetchRoute(input: RouterApiFetchRouteExtensionInput): Promise<Response> {
    return this.handle(input.request);
  }

  async handle(request: Request): Promise<Response> {
    if (
      request.method === 'POST' &&
      new URL(request.url).pathname === `${BASE_PATH}/relocations/challenge`
    )
      return this.challenge(request);
    if (request.method === 'POST' && new URL(request.url).pathname === `${BASE_PATH}/relocations`)
      return this.relocate(request);
    if (request.method !== 'GET') return failure('method_not_allowed', 405);
    const url = new URL(request.url);
    const wallet = parseWalletId(url.searchParams.get('walletId'));
    if (!wallet.ok || url.searchParams.getAll('walletId').length !== 1)
      return failure('invalid_input', 400);
    let moveId: string | null;
    if (url.pathname === BASE_PATH) moveId = null;
    else {
      const match = /^\/wallet\/placement\/v1\/relocations\/(wmove_[A-Za-z0-9_-]{43})$/u.exec(
        url.pathname,
      );
      if (!match) return failure('not_found', 404);
      moveId = match[1];
    }
    const nowMs = Date.now();
    const owner = await WalletRelocationOwnerRequest.authenticate({
      request,
      walletId: wallet.value,
      tenantId: this.options.tenantId,
      scope: this.options.scope,
      allowedOrigins: this.options.allowedOrigins,
      authorizationSessions: this.options.authorizationSessions,
      nowMs,
    });
    if (!owner) {
      if (!moveId) return failure('unauthorized', 401);
      const approval = await new D1WalletRelocationApprovals(
        this.options.database,
        this.options.scope,
      ).find(wallet.value, moveId);
      if (!approval) return failure('unauthorized', 401);
      const access = await WalletRelocationReadAccess.authenticate({
        request,
        binding: approval.binding,
        database: this.options.database,
        scope: this.options.scope,
        allowedOrigins: this.options.allowedOrigins,
        nowMs,
      });
      if (!access) return failure('unauthorized', 401);
    }
    const walletKey = this.walletKey(wallet.value);
    const path = moveId === null ? 'placement-status' : 'relocation-status';
    const body = moveId === null ? { wallet: walletKey } : { wallet: walletKey, moveId };
    return this.dispatch(path, body);
  }

  private async challenge(request: Request): Promise<Response> {
    const intent = parseRelocationIntent(await request.json().catch(invalidBody), 'challenge');
    if (!intent || intent.kind !== 'challenge') return failure('invalid_input', 400);
    const nowMs = Date.now();
    const owner = await WalletRelocationOwnerRequest.authenticate({
      request,
      walletId: intent.walletId,
      tenantId: this.options.tenantId,
      scope: this.options.scope,
      allowedOrigins: this.options.allowedOrigins,
      authorizationSessions: this.options.authorizationSessions,
      nowMs,
    });
    if (!owner) return failure('unauthorized', 401);
    const resolved = await this.dispatch('relocation-request', {
      wallet: this.walletKey(intent.walletId),
      moveId: intent.moveId,
      destinationRegion: intent.destinationRegion,
      expectedGeneration: intent.expectedGeneration,
      authorityId: owner.authorityId,
    });
    if (!resolved.ok) return resolved;
    const body: unknown = await resolved.clone().json().catch(invalidBody);
    if (!isPlainObject(body)) return failure('invalid_directory_response', 502);
    if (body.kind === 'unchanged') return resolved;
    if (
      body.kind !== 'resolved' ||
      typeof body.requestDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(body.requestDigest) ||
      body.sourceGeneration !== intent.expectedGeneration ||
      body.destinationRegion !== intent.destinationRegion
    )
      return failure('invalid_directory_response', 502);
    const binding = owner.bindMove({
      moveId: intent.moveId,
      requestDigestHex: body.requestDigest,
      sourceGeneration: intent.expectedGeneration,
      destinationRegion: intent.destinationRegion,
    });
    const challenge = await new D1WalletRelocationChallenges(
      this.options.database,
      this.options.scope,
    ).issue(binding, nowMs, owner.credentialExpiresAtMs);
    return Response.json(
      {
        kind: 'challenge',
        moveId: binding.moveId,
        walletId: binding.walletId,
        destinationRegion: binding.destinationRegion,
        expectedGeneration: binding.sourceGeneration,
        requestDigest: binding.requestDigestHex,
        challengeB64u: challenge.challengeB64u,
        expiresAtMs: challenge.expiresAtMs,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  private async relocate(request: Request): Promise<Response> {
    const raw: unknown = await request.json().catch(invalidBody);
    const intent = parseRelocationIntent(raw, 'admission');
    if (!intent || intent.kind !== 'admission') return failure('invalid_input', 400);
    const nowMs = Date.now();
    const owner = await WalletRelocationOwnerRequest.authenticate({
      request,
      walletId: intent.walletId,
      tenantId: this.options.tenantId,
      scope: this.options.scope,
      allowedOrigins: this.options.allowedOrigins,
      authorizationSessions: this.options.authorizationSessions,
      nowMs,
    });
    const approvals = new D1WalletRelocationApprovals(this.options.database, this.options.scope);
    let approval = await approvals.find(intent.walletId, intent.moveId);
    if (!owner) {
      if (!approval) return failure('unauthorized', 401);
      const access = await WalletRelocationReadAccess.authenticate({
        request,
        binding: approval.binding,
        database: this.options.database,
        scope: this.options.scope,
        allowedOrigins: this.options.allowedOrigins,
        nowMs,
      });
      if (!access) return failure('unauthorized', 401);
    }
    if (!approval) {
      if (!owner) return failure('unauthorized', 401);
      const challenge = await new D1WalletRelocationChallenges(
        this.options.database,
        this.options.scope,
      ).find(intent.walletId, intent.moveId);
      if (!challenge) return failure('relocation_challenge_required', 409);
      if (
        challenge.binding.destinationRegion !== intent.destinationRegion ||
        challenge.binding.sourceGeneration !== intent.expectedGeneration
      )
        return failure('request_conflict', 409);
      if (owner.bindMove(challenge.binding).encoded() !== challenge.binding.encoded())
        return failure('unauthorized', 401);
      const proof = passkeyProof(intent.sourceProof);
      if (!proof) return failure('invalid_source_proof', 400);
      const result = await approvals.approvePasskey({
        owner,
        binding: challenge.binding,
        credential: proof.credential,
        nowMs,
      });
      if (result.kind === 'denied') return failure('source_proof_denied', 403);
      approval = result.approval;
    }
    if (
      intent.destinationRegion !== approval.binding.destinationRegion ||
      intent.expectedGeneration !== approval.binding.sourceGeneration
    )
      return failure('request_conflict', 409);
    return this.dispatch('relocation-replay', {
      wallet: this.walletKey(intent.walletId),
      moveId: intent.moveId,
      requestDigest: approval.binding.requestDigestHex,
    });
  }

  private walletKey(walletId: WalletId) {
    return {
      namespace: this.options.scope.namespace,
      organizationId: this.options.scope.orgId,
      projectId: this.options.scope.projectId,
      environmentId: this.options.scope.envId,
      walletId,
    };
  }

  private async dispatch(
    path: 'placement-status' | 'relocation-status' | 'relocation-replay' | 'relocation-request',
    body: object,
  ): Promise<Response> {
    const response = await this.options.directory.fetch(
      new Request(`https://wallet-placement.internal/internal/wallet-placement/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function invalidBody(): null {
  return null;
}

type RelocationIntent = {
  readonly walletId: WalletId;
  readonly moveId: string;
  readonly destinationRegion: 'US' | 'WEUR' | 'APAC' | 'OC';
  readonly expectedGeneration: number;
} & (
  | { readonly kind: 'challenge'; readonly sourceProof?: never }
  | { readonly kind: 'admission'; readonly sourceProof: unknown }
);

function parseRelocationIntent(
  raw: unknown,
  purpose: 'challenge' | 'admission',
): RelocationIntent | null {
  if (!isPlainObject(raw) || Object.keys(raw).length !== (purpose === 'challenge' ? 4 : 5))
    return null;
  if (purpose === 'admission' && !Object.hasOwn(raw, 'sourceProof')) return null;
  const wallet = parseWalletId(raw.walletId);
  if (
    !wallet.ok ||
    typeof raw.moveId !== 'string' ||
    !/^wmove_[A-Za-z0-9_-]{43}$/u.test(raw.moveId) ||
    typeof raw.expectedGeneration !== 'number' ||
    !Number.isSafeInteger(raw.expectedGeneration) ||
    raw.expectedGeneration <= 0 ||
    (raw.destinationRegion !== 'US' &&
      raw.destinationRegion !== 'WEUR' &&
      raw.destinationRegion !== 'APAC' &&
      raw.destinationRegion !== 'OC')
  )
    return null;
  const intent: Pick<
    RelocationIntent,
    'walletId' | 'moveId' | 'destinationRegion' | 'expectedGeneration'
  > = {
    walletId: wallet.value,
    moveId: raw.moveId,
    destinationRegion: raw.destinationRegion,
    expectedGeneration: raw.expectedGeneration,
  };
  return purpose === 'challenge'
    ? { ...intent, kind: 'challenge' }
    : { ...intent, kind: 'admission', sourceProof: raw.sourceProof };
}

function passkeyProof(
  raw: unknown,
): { readonly kind: 'passkey'; readonly credential: unknown } | null {
  if (
    !isPlainObject(raw) ||
    Object.keys(raw).length !== 2 ||
    raw.kind !== 'passkey' ||
    !Object.hasOwn(raw, 'credential')
  )
    return null;
  return { kind: 'passkey', credential: raw.credential };
}
