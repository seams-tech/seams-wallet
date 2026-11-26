import { D1WalletAuthorizationHistory } from '../d1/wallet/d1WalletAuthorizationHistory';
import { AuthorizationSnapshotLayout } from '../d1/wallet/authorizationSnapshotLayout';
import { D1WalletRelocationApprovals } from '../d1/wallet/d1WalletRelocationApprovals';
import { D1WalletCeremonyActivity } from '../d1/ed25519Yao/d1WalletCeremonyActivity';
import { D1WalletAuthorizationIntake } from '../d1/wallet/d1WalletAuthorizationIntake';
import { D1WalletAuthorizationCleanup } from '../d1/wallet/d1WalletAuthorizationCleanup';
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
import { D1WalletRelocationWriteBlock } from '../d1/wallet/d1WalletRelocationWriteBlock';
import { D1WalletAuthorizationSnapshot } from '../d1/wallet/d1WalletAuthorizationSnapshot';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

const BASE_PATH = '/internal/wallet-relocation/v1/authorization';
type AuthorizationOperation =
  | { readonly kind: 'freeze' | 'export' | 'activate' | 'cleanup'; readonly snapshot?: never }
  | { readonly kind: 'import'; readonly snapshot: unknown };
const ORIGIN = 'https://wallet-relocation.internal';

// This receipt covers authorization storage only. The coordinator must settle
// other admitted effects before it assembles the complete source-fence receipt.
export class WalletAuthorizationRelocationRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension';
  readonly id = 'wallet_authorization_relocation';
  readonly routes: RouterApiRouteExtension['routes'] = [
    {
      id: 'wallet_authorization_block', surface: 'relay', method: 'POST', path: `${BASE_PATH}/block`,
      auth: { plane: 'public', rationale: 'The private Console binding holds a wallet-local capacity block after destination preparation.' },
      metering: { kind: 'none' }, summary: 'Reserve source snapshot capacity',
    },
    {
      id: 'wallet_authorization_release', surface: 'relay', method: 'POST', path: `${BASE_PATH}/release`,
      auth: { plane: 'public', rationale: 'Console durably rejects admission before releasing the source block.' },
      metering: { kind: 'none' }, summary: 'Release an unadmitted source block',
    },
    {
      id: 'wallet_authorization_schema', surface: 'relay', method: 'POST',
      path: `${BASE_PATH}/schema`,
      auth: { plane: 'public', rationale: 'The private Console binding checks source schema before relocation preparation.' },
      metering: { kind: 'none' }, summary: 'Read authorization transfer schema identity',
    },
    {
      id: 'wallet_authorization_reserve', surface: 'relay', method: 'POST',
      path: `${BASE_PATH}/reserve`,
      auth: { plane: 'public', rationale: 'The private Console binding prepares an empty destination before source pause.' },
      metering: { kind: 'none' }, summary: 'Reserve inactive authorization destination',
    },
    {
      id: 'wallet_relocation_owner_approval', surface: 'relay', method: 'POST',
      path: `${BASE_PATH}/owner-approval`,
      auth: { plane: 'public', rationale: 'The internal binding reads fresh durable owner approval for Console admission.' },
      metering: { kind: 'none' }, summary: 'Read fresh owner approval for relocation admission',
    },
    {
      id: 'wallet_authorization_cleanup',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/cleanup`,
      auth: {
        plane: 'public',
        rationale:
          'Console must authorize cleanup after destination activation with the pinned authorization manifest.',
      },
      metering: { kind: 'none' },
      summary: 'Delete one bounded batch of obsolete source authorization state',
    },
    {
      id: 'wallet_authorization_activate',
      surface: 'relay',
      method: 'POST',
      path: `${BASE_PATH}/activate`,
      auth: {
        plane: 'public',
        rationale:
          'Console must authorize activation after cutover with the pinned authorization manifest.',
      },
      metering: { kind: 'none' },
      summary: 'Activate the verified authorization destination',
    },
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
      summary: 'Export the sealed authorization snapshot',
    },
    {
      id: 'wallet_authorization_import', surface: 'relay', method: 'POST',
      path: `${BASE_PATH}/import`,
      auth: { plane: 'public', rationale: 'Console authorizes an atomic import of the pinned snapshot.' },
      metering: { kind: 'none' }, summary: 'Import and verify the complete authorization snapshot',
    },
  ];

  constructor(
    private readonly options: {
      readonly database: D1DatabaseLike;
      readonly scope: D1TenantScope;
      readonly directory: WalletConsoleServiceBinding;
    },
  ) {}

  private async ownerApproval(body: Record<string, unknown>): Promise<Response> {
    const walletId = parseWalletId(body.walletId);
    if (
      Object.keys(body).length !== 5 ||
      !walletId.ok ||
      typeof body.moveId !== 'string' ||
      !/^wmove_[A-Za-z0-9_-]{43}$/u.test(body.moveId) ||
      typeof body.requestDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(body.requestDigest) ||
      typeof body.authorityId !== 'string' ||
      typeof body.sourceGeneration !== 'number' ||
      !Number.isSafeInteger(body.sourceGeneration) ||
      body.sourceGeneration < 1
    ) return failure('invalid_input', 400);
    const approvals = new D1WalletRelocationApprovals(this.options.database, this.options.scope);
    const stored = await approvals.find(walletId.value, body.moveId);
    if (
      !stored ||
      stored.binding.requestDigestHex !== body.requestDigest ||
      stored.binding.authorityId !== body.authorityId ||
      stored.binding.sourceGeneration !== body.sourceGeneration
    ) return Response.json({ kind: 'denied' }, { headers: { 'Cache-Control': 'no-store' } });
    const approval = await approvals.readForAdmission(stored.binding, Date.now());
    if (!approval) return Response.json({ kind: 'denied' }, { headers: { 'Cache-Control': 'no-store' } });
    return Response.json(
      {
        kind: 'approved',
        requestDigest: approval.binding.requestDigestHex,
        authorityId: approval.binding.authorityId,
        sourceGeneration: approval.binding.sourceGeneration,
        approvedAtMs: approval.approvedAtMs,
        expiresAtMs: approval.expiresAtMs,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  private async prepareDestination(body: Record<string, unknown>, reserve: boolean): Promise<Response> {
    let source: WalletRelocationSessionSource | null = null;
    try {
      if (reserve) {
        if (Object.keys(body).length !== 2 || typeof body.schemaDigestHex !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(body.schemaDigestHex)) return failure('invalid_input', 400);
        source = WalletRelocationSessionSource.parse(body.source);
      } else if (Object.keys(body).length !== 1 || !parseWalletId(body.walletId).ok) return failure('invalid_input', 400);
    } catch {
      return failure('invalid_input', 400);
    }
    try {
      const layout = await AuthorizationSnapshotLayout.read(this.options.database);
      const schemaDigestHex = await sha256HexUtf8(JSON.stringify(layout));
      if (source) {
        if (schemaDigestHex !== body.schemaDigestHex) return failure('authorization_schema_conflict', 409);
        await new D1WalletAuthorizationHistory(this.options.database, this.options.scope).prepare(source);
        return Response.json({ kind: 'authorization_reserved', source, schemaDigestHex },
          { headers: { 'Cache-Control': 'no-store' } });
      }
      const walletId = parseWalletId(body.walletId);
      if (!walletId.ok) return failure('invalid_input', 400);
      await new D1WalletAuthorizationSnapshot(this.options.database, this.options.scope).assertCapacity(walletId.value);
      return Response.json({ kind: 'authorization_schema', schemaDigestHex },
        { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return failure('authorization_preparation_unavailable', 503);
    }
  }

  handleFetchRoute(input: RouterApiFetchRouteExtensionInput): Promise<Response> {
    return this.handle(input.request);
  }

  private async capacityBlock(body: Record<string, unknown>, release: boolean): Promise<Response> {
    let source: WalletRelocationSessionSource;
    try {
      if (Object.keys(body).length !== 1) return failure('invalid_input', 400);
      source = WalletRelocationSessionSource.parse(body.source);
    } catch {
      return failure('invalid_input', 400);
    }
    const block = new D1WalletRelocationWriteBlock(this.options.database, this.options.scope);
    try {
      if (release) {
        await block.release(source, Date.now());
        return Response.json({ kind: 'authorization_released' });
      }
      const state = await block.check(source, Date.now());
      return Response.json({ kind: state === 'ready' ? 'authorization_blocked' : 'authorization_draining' },
        { status: state === 'ready' ? 200 : 202 });
    } catch {
      return failure('authorization_capacity_unavailable', 409);
    }
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
    if (url.pathname === `${BASE_PATH}/block` || url.pathname === `${BASE_PATH}/release`)
      return this.capacityBlock(body, url.pathname === `${BASE_PATH}/release`);
    if (url.pathname === `${BASE_PATH}/schema`) return this.prepareDestination(body, false);
    if (url.pathname === `${BASE_PATH}/reserve`) return this.prepareDestination(body, true);
    if (url.pathname === `${BASE_PATH}/owner-approval`) return this.ownerApproval(body);
    let requested: AuthorizationOperation;
    try {
      requested = parseAuthorizationOperation(url.pathname, body);
    } catch {
      return failure('invalid_input', 400);
    }
    const commandKind = authorizationCommandKind(requested.kind);
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
        body.attempt.phase !== authorizationCommandPhase(commandKind) ||
        command.participant !== 'gateway' ||
        operation.kind !== commandKind ||
        Object.keys(operation).length !== authorizationCommandFields(commandKind) ||
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
          receipt.kind !== authorizationReceiptKind(commandKind) ||
          receipt.moveId !== command.moveId ||
          typeof receipt.generation !== 'number' ||
          command.generation !== receipt.generation + authorizationGenerationOffset(commandKind)
        )
          throw new Error('Source export receipt conflicts');
        sourceGeneration =
          receipt.generation - (commandKind === 'activate' || commandKind === 'cleanup' ? 1 : 0);
        for (const [key, value] of Object.entries(wallet)) {
          if (receiptWallet[key] !== value)
            throw new Error('Source export receipt scope conflicts');
        }
      }
      if (commandKind === 'import_authorization' || commandKind === 'activate') {
        if (
          typeof operation.physicalResource !== 'string' ||
          operation.physicalResource.length === 0
        )
          throw new Error('Destination resource is absent');
        pinnedManifest = operation.manifest;
      }
      if (commandKind === 'cleanup') pinnedManifest = operation.manifest;
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
    if (requested.kind === 'cleanup') {
      try {
        const progress = await new D1WalletAuthorizationCleanup(
          this.options.database,
          this.options.scope,
        ).advance(source, pinnedManifest, commandDigest, Date.now());
        return Response.json(
          { kind: 'authorization_cleanup', commandDigest, progress },
          {
            status: progress.state === 'cleaned' ? 200 : 202,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      } catch {
        return failure('authorization_cleanup_incomplete', 503);
      }
    }
    if (requested.kind === 'activate') {
      try {
        const activated = await new D1WalletAuthorizationIntake(
          this.options.database,
          this.options.scope,
        ).activate(source, pinnedManifest, commandDigest, Date.now());
        return Response.json(
          {
            kind: 'authorization_activated',
            commandDigest,
            digestHex: activated.digestHex,
            activatedAtMs: activated.activatedAtMs,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch {
        return failure('authorization_activation_incomplete', 503);
      }
    }
    if (requested.kind === 'import') {
      try {
        const intake = new D1WalletAuthorizationIntake(this.options.database, this.options.scope);
        await intake.prepare(source, pinnedManifest);
        const digestHex = await intake.acceptSnapshot(source, requested.snapshot);
        return Response.json({ kind: 'authorization_verified', commandDigest, digestHex },
          { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        return failure('authorization_import_incomplete', 503);
      }
    }
    if (requested.kind === 'export') {
      try {
        const snapshot = await new D1WalletAuthorizationSnapshot(
          this.options.database,
          this.options.scope,
        ).exportSnapshot(source);
        return Response.json(
          { kind: 'authorization_snapshot', commandDigest, snapshot },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch {
        return failure('authorization_export_unavailable', 503);
      }
    }
    const activity = new D1WalletCeremonyActivity(this.options.database, this.options.scope);
    const sessions = new D1WalletRelocationSessions(this.options.database, this.options.scope);
    try {
      if (await activity.hasPending(source.walletId))
        return pendingAuthorization(commandDigest, 'ceremonies_unsettled');
      if (await sessions.hasPendingOperations(source.walletId))
        return pendingAuthorization(commandDigest, 'operations_unsettled');
      const { retiredAtMs, frozenAtMs } = await new D1WalletRelocationWriteBlock(
        this.options.database, this.options.scope,
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
      if (await activity.hasPending(source.walletId))
        return pendingAuthorization(commandDigest, 'ceremonies_unsettled');
      if (await sessions.hasPendingOperations(source.walletId))
        return pendingAuthorization(commandDigest, 'operations_unsettled');
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
      if (fields === 2) return { kind: 'export' };
      break;
    case `${BASE_PATH}/import`:
      if (fields === 3 && 'snapshot' in body) return { kind: 'import', snapshot: body.snapshot };
      break;
    case `${BASE_PATH}/activate`:
      if (fields === 2) return { kind: 'activate' };
      break;
    case `${BASE_PATH}/cleanup`:
      if (fields === 2) return { kind: 'cleanup' };
      break;
  }
  throw new Error('Authorization transfer operation is invalid');
}

function authorizationCommandKind(kind: AuthorizationOperation['kind']) {
  switch (kind) {
    case 'freeze':
    case 'export':
    case 'activate':
    case 'cleanup':
      return kind;
    case 'import':
      return 'import_authorization';
    default:
      return assertNever(kind);
  }
}

function authorizationCommandPhase(kind: ReturnType<typeof authorizationCommandKind>) {
  switch (kind) {
    case 'freeze':
      return 'freezing';
    case 'export':
    case 'import_authorization':
      return 'copying';
    case 'activate':
    case 'cleanup':
      return 'cutover';
    default:
      return assertNever(kind);
  }
}

function authorizationReceiptKind(
  kind: Exclude<ReturnType<typeof authorizationCommandKind>, 'freeze'>,
) {
  switch (kind) {
    case 'export':
    case 'import_authorization':
      return 'source_fence';
    case 'activate':
      return 'destination_verification';
    case 'cleanup':
      return 'destination_activation';
    default:
      return assertNever(kind);
  }
}

function authorizationGenerationOffset(
  kind: Exclude<ReturnType<typeof authorizationCommandKind>, 'freeze'>,
) {
  switch (kind) {
    case 'import_authorization':
      return 1;
    case 'cleanup':
      return -1;
    case 'activate':
    case 'export':
      return 0;
    default:
      return assertNever(kind);
  }
}

function authorizationCommandFields(kind: ReturnType<typeof authorizationCommandKind>) {
  switch (kind) {
    case 'freeze':
      return 1;
    case 'export':
      return 2;
    case 'cleanup':
      return 3;
    case 'activate':
    case 'import_authorization':
      return 4;
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected authorization operation: ${String(value)}`);
}

function pendingAuthorization(
  commandDigest: string,
  reason: 'ceremonies_unsettled' | 'operations_unsettled',
): Response {
  return Response.json(
    { kind: 'authorization_pending', commandDigest, reason },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
}
