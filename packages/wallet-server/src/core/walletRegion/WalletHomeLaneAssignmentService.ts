import {
  buildWalletHomeLane,
  parseWalletLaneEpoch,
  requireWalletId,
  requireWalletRegionBoundary,
  type ManagedWalletHomeLaneId,
} from '@shared/wallet-region';
import type { WalletId } from '@shared/utils/domainIds';
import type { RouterApiWalletRegistrationService } from '../../router/framework/authServicePort';
import type {
  ManagedWalletLaneCatalogStore,
  WalletHomeLaneDirectoryRecord,
  WalletHomeLaneDirectoryStore,
} from './WalletRegionStore';

export type WalletHomeLaneAssignmentServiceOptions = {
  readonly directory: Pick<
    WalletHomeLaneDirectoryStore,
    'getHomeLane' | 'assignInitialHomeLane'
  >;
  readonly laneCatalog: Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'>;
  readonly defaultHomeLaneId: ManagedWalletHomeLaneId;
  readonly now?: () => number;
};

export class WalletHomeLaneAssignmentService {
  private readonly now: () => number;

  constructor(private readonly options: WalletHomeLaneAssignmentServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async ensureAssigned(walletId: WalletId): Promise<WalletHomeLaneDirectoryRecord> {
    const existing = await this.options.directory.getHomeLane(walletId);
    if (existing) return existing;

    const configuration = await this.options.laneCatalog.getActiveConfiguration(
      this.options.defaultHomeLaneId,
    );
    if (!configuration || configuration.status !== 'available') {
      throw new Error('default managed wallet lane is not available');
    }

    const result = await this.options.directory.assignInitialHomeLane({
      homeLane: buildWalletHomeLane({
        walletId,
        laneId: this.options.defaultHomeLaneId,
        laneEpoch: requireWalletRegionBoundary(
          parseWalletLaneEpoch(1),
          'initial wallet lane epoch',
        ),
      }),
      nowMs: this.now(),
    });
    if (result.outcome === 'applied' || result.outcome === 'replayed') {
      return result.value;
    }
    if (result.currentHomeLane) return result.currentHomeLane;
    throw new Error('initial wallet Home region assignment conflicted');
  }
}

export function assignHomeLaneDuringWalletRegistration(
  service: RouterApiWalletRegistrationService,
  assignments: WalletHomeLaneAssignmentService,
): RouterApiWalletRegistrationService {
  return {
    ...service,
    async setupWalletRegistration(input) {
      const response = await service.setupWalletRegistration(input);
      if (response.ok) {
        await assignments.ensureAssigned(
          requireWalletId(response.walletId, 'registration setup walletId'),
        );
      }
      return response;
    },
    async activateWalletRegistration(input, traceContext, serverTiming) {
      const response = await service.activateWalletRegistration(
        input,
        traceContext,
        serverTiming,
      );
      if (response.ok) {
        await assignments.ensureAssigned(response.walletId);
      }
      return response;
    },
  };
}
