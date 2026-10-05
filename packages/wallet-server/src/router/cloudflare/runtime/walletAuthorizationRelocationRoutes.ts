import { D1WalletAuthorizationIntake } from '../d1/wallet/d1WalletAuthorizationIntake';
import { parseNonNegativeSafeInteger } from '@shared/device-linking/wireFields';
import { isPlainObject, requireRecord } from '@shared/utils/validation';
import { parseWalletId } from '@shared/utils/domainIds';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { D1TenantScope } from '../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../storage/tenantRoute';
import type {
  RouterApiRouteExtension,
  RouterApiFetchRouteExtensionInput,
} from '../../framework/routeExtensions';
import {
  D1WalletRelocationSessions,
  WalletRelocationSessionSource,
} from '../d1/wallet/d1WalletRelocationSessions';
import { D1WalletAuthorizationFreeze } from '../d1/wallet/d1WalletAuthorizationFreeze';
import { D1WalletAuthorizationSnapshot } from '../d1/wallet/d1WalletAuthorizationSnapshot';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

const BASE_PATH = '/internal/wallet-relocation/v1/authorization';
type AuthorizationOperation =
  | { readonly kind: 'freeze'; readonly index?: never; readonly chunk?: never }
  | { readonly kind: 'export'; readonly index: number; readonly chunk?: never }
  | { readonly kind: 'prepare' | 'verify'; readonly index?: never; readonly chunk?: never }
  | { readonly kind: 'accept'; readonly chunk: unknown; readonly index?: never };
const ORIGIN = 'https://wallet-relocation.internal';

// This receipt covers authorization storage only. The coordinator must settle
// other admitted effects before it assembles the complete source-fence receipt.
export class WalletAuthorizationRelocationRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension';
  readonly id = 'wallet_authorization_relocation';
  readonly routes: RouterApiRouteExtension['routes'] = [
    {
      id: 'wallet_authorization_freeze',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/freeze`,
      auth: {
        plane: 'public',
        rationale:
          'The handler requires an internal origin and a live Console-authorized gateway freeze command.',
      },
      metering: { kind: 'none' },
      summary: 'Freeze and capture admitted authorization history',
    },
    {
      id: 'wallet_authorization_export',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/export`,
      auth: {
        plane: 'public',
        rationale:
          'The handler requires an internal origin and a live Console-authorized source export command.',
      },
      metering: { kind: 'none' },
      summary: 'Export one sealed authorization snapshot chunk',
    },
    {
      id: 'wallet_authorization_prepare',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/prepare`,
      auth: {
        plane: 'public',
        rationale: 'Console must authorize destination import with its pinned source manifest.',
      },
      metering: { kind: 'none' },
      summary: 'Prepare inactive authorization intake',
    },
    {
      id: 'wallet_authorization_accept',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/accept`,
      auth: {
        plane: 'public',
        rationale: 'Console must authorize destination import with its pinned source manifest.',
      },
      metering: { kind: 'none' },
      summary: 'Restore one authorization snapshot chunk',
    },
    {
      id: 'wallet_authorization_verify',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/verify`,
      auth: {
        plane: 'public',
        rationale: 'Console must authorize destination import with its pinned source manifest.',
      },
      metering: { kind: 'none' },
      summary: 'Verify the complete authorization import',
    },
  ];

  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: D1TenantScope;
      readonly directory: WalletConsoleServiceBinding;
    },
  ) {}

  handleFetchRoute(input: RouterApiFetchRouteExtensionInput): Promise<Response> {
    return this.handle(input.request);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin !== ORIGIN ||
      !this.routes.some(matchesAuthorizationPath.bind(null, url.pathname))
    )
      return failure('not_found', 404);
    if (request.method !== 'POST') return failure('method_not_allowed', 405);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure('invalid_input', 400);
    }
    if (!isPlainObject(body)) return failure('invalid_input', 400);
    let requested: AuthorizationOperation;
    try {
      requested = parseAuthorizationOperation(url.pathname, body);
    } catch {
      return failure('invalid_input', 400);
    }
    const commandKind =
      requested.kind === 'freeze' || requested.kind === 'export'
        ? requested.kind
        : 'import_authorization';
    const walletId = parseWalletId(body.walletId);
    if (!walletId.ok || !isPlainObject(body.attempt)) return failure('invalid_input', 400);
    const wallet = {
      namespace: this.options.scope.namespace,
      organizationId: this.options.scope.orgId,
      projectId: this.options.scope.projectId,
      environmentId: this.options.scope.envId,
      walletId: walletId.value,
    };
    let authorized: Response;
    try {
      authorized = await this.options.directory.fetch(
        new Request(
          'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-command',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, attempt: body.attempt, kind: commandKind }),
          },
        ),
      );
    } catch {
      return failure('relocation_authority_unavailable', 503);
    }
    if (!authorized.ok)
      return failure('relocation_command_denied', authorized.status >= 500 ? 503 : 403);
    let source: WalletRelocationSessionSource;
    let commandDigest: string;
    let pinnedManifest: unknown;
    try {
      const response = requireRecord(await authorized.json(), 'source authorization');
      const command = requireRecord(response.command, 'source command');
      const identity = requireRecord(command.wallet, 'source wallet');
      const operation = requireRecord(command.operation, 'source operation');
      if (
        response.ok !== true ||
        Object.keys(command).length !== 9 ||
        Object.keys(identity).length !== 5 ||
        command.moveId !== body.attempt.moveId ||
        body.attempt.phase !== (requested.kind === 'freeze' ? 'freezing' : 'copying') ||
        command.participant !== 'gateway' ||
        operation.kind !== commandKind ||
        Object.keys(operation).length !==
          (commandKind === 'freeze' ? 1 : commandKind === 'export' ? 2 : 4) ||
        command.id !== `${command.moveId}/gateway/${commandKind}`
      )
        throw new Error('Source command identity conflicts');
      for (const [key, value] of Object.entries(wallet)) {
        if (identity[key] !== value) throw new Error('Source wallet scope conflicts');
      }
      let sourceGeneration = command.generation;
      if (commandKind !== 'freeze') {
        const receipt = requireRecord(operation.receipt, 'source-fence receipt');
        const receiptWallet = requireRecord(receipt.wallet, 'source-fence wallet');
        if (
          receipt.kind !== 'source_fence' ||
          receipt.moveId !== command.moveId ||
          typeof receipt.generation !== 'number' ||
          command.generation !==
            receipt.generation + (commandKind === 'import_authorization' ? 1 : 0)
        )
          throw new Error('Source export receipt conflicts');
        sourceGeneration = receipt.generation;
        for (const [key, value] of Object.entries(wallet)) {
          if (receiptWallet[key] !== value)
            throw new Error('Source export receipt scope conflicts');
        }
      }
      if (commandKind === 'import_authorization') {
        if (
          typeof operation.physicalResource !== 'string' ||
          operation.physicalResource.length === 0
        )
          throw new Error('Destination resource is absent');
        pinnedManifest = operation.manifest;
      }
      source = WalletRelocationSessionSource.parse({
        walletId: identity.walletId,
        moveId: command.moveId,
        requestDigestHex: command.requestDigest,
        sourceGeneration,
      });
      commandDigest = await sha256HexUtf8(
        JSON.stringify([
          'seams/wallet-d1-relocation-command/v1',
          command.wallet,
          command.moveId,
          command.requestDigest,
          command.participant,
          command.versionId,
          command.home,
          command.generation,
          command.operation,
        ]),
      );
      if (response.digest !== commandDigest) throw new Error('Source command digest conflicts');
    } catch {
      return failure('relocation_command_invalid', 502);
    }
    if (
      requested.kind === 'prepare' ||
      requested.kind === 'accept' ||
      requested.kind === 'verify'
    ) {
      try {
        const intake = new D1WalletAuthorizationIntake(this.options.database, this.options.scope);
        const progress = await intake.prepare(source, pinnedManifest);
        switch (requested.kind) {
          case 'prepare':
            return Response.json(
              { kind: 'authorization_prepared', commandDigest, progress },
              { headers: { 'Cache-Control': 'no-store' } },
            );
          case 'accept': {
            const digestHex = await intake.accept(source, requested.chunk);
            return Response.json(
              { kind: 'authorization_chunk_accepted', commandDigest, digestHex },
              { headers: { 'Cache-Control': 'no-store' } },
            );
          }
          case 'verify': {
            const digestHex = await intake.verify(source);
            return Response.json(
              { kind: 'authorization_verified', commandDigest, digestHex },
              { headers: { 'Cache-Control': 'no-store' } },
            );
          }
        }
      } catch {
        return failure('authorization_import_incomplete', 503);
      }
    }
    if (requested.kind === 'export') {
      try {
        const chunk = await new D1WalletAuthorizationSnapshot(
          this.options.database,
          this.options.scope,
        ).exportChunk(source, requested.index);
        return Response.json(
          { kind: 'authorization_chunk', commandDigest, chunk },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch {
        return failure('authorization_export_unavailable', 503);
      }
    }
    try {
      const retiredAtMs = await new D1WalletRelocationSessions(
        this.options.database,
        this.options.scope,
      ).retire(source, Date.now());
      const frozenAtMs = await new D1WalletAuthorizationFreeze(
        this.options.database,
        this.options.scope,
      ).freeze(source, Date.now());
      const manifest = await new D1WalletAuthorizationSnapshot(
        this.options.database,
        this.options.scope,
      ).seal(source);
      const publication = await this.options.directory.fetch(
        new Request(
          'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-authorization-manifest',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, attempt: body.attempt, manifest }),
          },
        ),
      );
      if (!publication.ok) return failure('authorization_manifest_unavailable', 503);
      const published = requireRecord(await publication.json(), 'published authorization manifest');
      const savedManifest = requireRecord(published.manifest, 'pinned authorization manifest');
      if (published.ok !== true || Object.keys(savedManifest).length !== 4)
        return failure('authorization_manifest_conflict', 502);
      for (const [key, value] of Object.entries(manifest)) {
        if (savedManifest[key] !== value) return failure('authorization_manifest_conflict', 502);
      }
      return Response.json(
        { kind: 'authorization_frozen', commandDigest, retiredAtMs, frozenAtMs, manifest },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return failure('authorization_freeze_incomplete', 503);
    }
  }
}

function failure(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function matchesAuthorizationPath(
  pathname: string,
  route: RouterApiRouteExtension['routes'][number],
): boolean {
  return route.path === pathname;
}

function parseAuthorizationOperation(
  pathname: string,
  body: Record<string, unknown>,
): AuthorizationOperation {
  const fields = Object.keys(body).length;
  switch (pathname) {
    case `${BASE_PATH}/freeze`:
      if (fields === 2) return { kind: 'freeze' };
      break;
    case `${BASE_PATH}/export`:
      if (fields === 3)
        return {
          kind: 'export',
          index: parseNonNegativeSafeInteger(body.index, 'snapshot chunk index'),
        };
      break;
    case `${BASE_PATH}/prepare`:
      if (fields === 2) return { kind: 'prepare' };
      break;
    case `${BASE_PATH}/accept`:
      if (fields === 3 && 'chunk' in body) return { kind: 'accept', chunk: body.chunk };
      break;
    case `${BASE_PATH}/verify`:
      if (fields === 2) return { kind: 'verify' };
      break;
  }
  throw new Error('Authorization transfer operation is invalid');
}
