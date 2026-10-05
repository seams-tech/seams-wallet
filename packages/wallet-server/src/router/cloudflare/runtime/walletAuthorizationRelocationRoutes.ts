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
type SourceOperation =
  | { readonly kind: 'freeze'; readonly index?: never }
  | { readonly kind: 'export'; readonly index: number };
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
      (url.pathname !== `${BASE_PATH}/freeze` && url.pathname !== `${BASE_PATH}/export`)
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
    let requested: SourceOperation;
    try {
      if (url.pathname === `${BASE_PATH}/freeze`) {
        if (Object.keys(body).length !== 2) return failure('invalid_input', 400);
        requested = { kind: 'freeze' };
      } else {
        if (Object.keys(body).length !== 3) return failure('invalid_input', 400);
        requested = {
          kind: 'export',
          index: parseNonNegativeSafeInteger(body.index, 'snapshot chunk index'),
        };
      }
    } catch {
      return failure('invalid_input', 400);
    }
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
            body: JSON.stringify({ wallet, attempt: body.attempt, kind: requested.kind }),
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
        operation.kind !== requested.kind ||
        Object.keys(operation).length !== (requested.kind === 'freeze' ? 1 : 2) ||
        command.id !== `${command.moveId}/gateway/${requested.kind}`
      )
        throw new Error('Source command identity conflicts');
      for (const [key, value] of Object.entries(wallet)) {
        if (identity[key] !== value) throw new Error('Source wallet scope conflicts');
      }
      if (requested.kind === 'export') {
        const receipt = requireRecord(operation.receipt, 'source-fence receipt');
        const receiptWallet = requireRecord(receipt.wallet, 'source-fence wallet');
        if (
          receipt.kind !== 'source_fence' ||
          receipt.moveId !== command.moveId ||
          receipt.generation !== command.generation
        )
          throw new Error('Source export receipt conflicts');
        for (const [key, value] of Object.entries(wallet)) {
          if (receiptWallet[key] !== value)
            throw new Error('Source export receipt scope conflicts');
        }
      }
      source = WalletRelocationSessionSource.parse({
        walletId: identity.walletId,
        moveId: command.moveId,
        requestDigestHex: command.requestDigest,
        sourceGeneration: command.generation,
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
