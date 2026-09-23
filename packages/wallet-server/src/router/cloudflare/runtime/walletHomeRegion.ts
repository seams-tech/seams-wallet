import {
  MANAGED_WALLET_LANES,
  parseWalletRegionPolicyVersion,
  requireWalletId,
  requireWalletRegionBoundary,
  type HomeRegionCandidate,
  type HomeRegionSnapshot,
  type ManagedWalletRegion,
  type WalletHomeRegionPolicy,
  type WalletHomeRegionSnapshotV1,
} from '@shared/wallet-region';
import type { WalletId } from '@shared/utils/domainIds';
import { WalletHomeLaneAssignmentService } from '../../../core/walletRegion';
import type {
  ManagedWalletLaneCatalogStore,
  ManagedWalletLaneConfiguration,
} from '../../../core/walletRegion';
import type { SessionAdapter } from '../../framework/routerApi';
import type { RouterApiRouteExtension } from '../../framework/routeExtensions';

const WALLET_HOME_REGION_PATH_PREFIX = '/wallets/';
const WALLET_HOME_REGION_PATH_SUFFIX = '/home-region';

export type WalletHomeRegionRouteOptions = {
  readonly session: SessionAdapter;
  readonly assignments: WalletHomeLaneAssignmentService;
  readonly catalog: Pick<ManagedWalletLaneCatalogStore, 'listActiveConfigurations'>;
};

function requestHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function parsePathWalletId(pathname: string): WalletId | null {
  if (
    !pathname.startsWith(WALLET_HOME_REGION_PATH_PREFIX) ||
    !pathname.endsWith(WALLET_HOME_REGION_PATH_SUFFIX)
  ) {
    return null;
  }
  const raw = pathname.slice(
    WALLET_HOME_REGION_PATH_PREFIX.length,
    pathname.length - WALLET_HOME_REGION_PATH_SUFFIX.length,
  );
  if (!raw || raw.includes('/')) return null;
  try {
    return requireWalletId(decodeURIComponent(raw), 'Home region walletId');
  } catch {
    return null;
  }
}

function sessionWalletId(claims: Record<string, unknown>): WalletId | null {
  const candidates = [claims.account_id, claims.walletId, claims.sub].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (candidates.length === 0 || candidates.some((value) => value !== candidates[0])) return null;
  try {
    return requireWalletId(candidates[0], 'Wallet Session walletId');
  } catch {
    return null;
  }
}

function productRegionForLane(
  configuration: ManagedWalletLaneConfiguration,
): ManagedWalletRegion {
  return configuration.productRegion;
}

function homeRegionCandidates(
  configurations: readonly ManagedWalletLaneConfiguration[],
): readonly HomeRegionCandidate[] {
  return configurations.map((configuration) => ({
    laneId: configuration.laneId,
    productRegion: productRegionForLane(configuration),
    label: MANAGED_WALLET_LANES[configuration.productRegion].label,
    status: configuration.status,
    latency: null,
  }));
}

function disabledOwnerMovePolicy(): WalletHomeRegionPolicy {
  return {
    kind: 'owner_moves_disabled',
    policyVersion: requireWalletRegionBoundary(
      parseWalletRegionPolicyVersion('managed-r150-read-only-v1'),
      'Home region policy version',
    ),
    allowedRegions: ['north_america', 'europe', 'asia_pacific'],
    cooldownMs: 60 * 24 * 60 * 60 * 1_000,
  };
}

async function readHomeRegion(
  options: WalletHomeRegionRouteOptions,
  walletId: WalletId,
): Promise<WalletHomeRegionSnapshotV1> {
  const directory = await options.assignments.ensureAssigned(walletId);
  const configurations = await options.catalog.listActiveConfigurations();
  const currentConfiguration = configurations.find(
    (configuration) => configuration.laneId === directory.homeLane.laneId,
  );
  if (!currentConfiguration) {
    throw new Error('wallet Home lane configuration is unavailable');
  }
  const snapshot: HomeRegionSnapshot = {
    walletId,
    current: directory.homeLane,
    currentRegion: currentConfiguration.productRegion,
    currentLaneStatus: currentConfiguration.status,
    currentLatency: null,
    destinations: homeRegionCandidates(configurations),
    recommendation: null,
    policy: disabledOwnerMovePolicy(),
    lastCompletedMoveAt: null,
    nextEligibleMoveAt: null,
    activeMigrationId: directory.migrationId,
  };
  return {
    kind: 'wallet_home_region_snapshot_v1',
    directoryRevision: directory.directoryRevision,
    snapshot,
  };
}

export function createWalletHomeRegionRouteExtension(
  options: WalletHomeRegionRouteOptions,
): RouterApiRouteExtension {
  return {
    kind: 'fetch_route_extension',
    id: 'wallet_home_region',
    routes: [
      {
        id: 'wallet_home_region_get',
        surface: 'relay',
        method: 'GET',
        path: '/wallets/:walletId/home-region',
        summary: 'Read the authenticated wallet Home region',
        auth: { plane: 'session_principal' },
        metering: { kind: 'none' },
        requiredServices: ['session'],
      },
    ],
    async handleFetchRoute(input): Promise<Response> {
      const walletId = parsePathWalletId(input.pathname);
      if (!walletId) {
        return Response.json(
          { ok: false, code: 'invalid_wallet_id', message: 'Wallet id is invalid' },
          { status: 400 },
        );
      }
      const parsedSession = await options.session.parse(requestHeaders(input.request));
      if (!parsedSession.ok) {
        return Response.json(
          { ok: false, code: 'unauthorized', message: 'Wallet Session is required' },
          { status: 401 },
        );
      }
      const authorizedWalletId = sessionWalletId(parsedSession.claims);
      if (authorizedWalletId !== walletId) {
        return Response.json(
          { ok: false, code: 'forbidden', message: 'Wallet Session does not own this wallet' },
          { status: 403 },
        );
      }
      try {
        return Response.json({ ok: true, homeRegion: await readHomeRegion(options, walletId) });
      } catch (error: unknown) {
        input.logger.error('Wallet Home region read failed', { error });
        return Response.json(
          { ok: false, code: 'internal', message: 'Wallet Home region is unavailable' },
          { status: 500 },
        );
      }
    },
  };
}
