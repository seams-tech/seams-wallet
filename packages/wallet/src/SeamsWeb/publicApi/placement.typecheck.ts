import type { WalletPlacement, WalletPlacementResult } from './placement';
import type { SeamsWeb } from '../SeamsWeb';
import type { Variant } from '@shared/utils/variant';
import type { WalletId } from '@shared/utils/domainIds';

declare const wallet: SeamsWeb;
declare const walletId: WalletId;
declare const moving: Variant<WalletPlacement, 'state', 'moving'>;
void wallet.placement.get(walletId);
// @ts-expect-error Placement reads require wallet identity.
void wallet.placement.get();
// @ts-expect-error A settled home cannot also carry a pending move.
const mixed: WalletPlacement = {
  state: 'settled',
  region: 'US',
  generation: 1,
  nextMoveAtMs: 0,
  move: moving.move,
};
const failed = {
  ok: false,
  code: 'unauthorized',
  placement: { state: 'unavailable', code: 'not_found' },
} as const;
// @ts-expect-error A broad spread cannot attach placement to a failed read.
const failedSpread: WalletPlacementResult = { ...failed };
// @ts-expect-error Cleanup runs at the active destination.
const pausedCleanup: typeof moving.move.progress = {
  state: 'cleanup',
  availability: 'paused',
  execution: { state: 'running' },
};
// @ts-expect-error A blocked move cannot carry an automatic retry time.
const blockedRetry: typeof moving.move.progress.execution = {
  state: 'blocked',
  code: 'receipt_conflict',
  retryAtMs: 1,
};
void [mixed, failedSpread, pausedCleanup, blockedRetry];
