import type {
  WalletPlacement,
  WalletPlacementResult,
  WalletMoveStatus,
  WalletMoveRequest,
} from './placement';
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

// @ts-expect-error Move reads require a parsed move identity.
void wallet.placement.getMove(walletId, 'unvalidated-move');
// @ts-expect-error Move reads cannot omit the wallet identity.
void wallet.placement.getMove();

declare const completedMove: Variant<WalletMoveStatus, 'state', 'completed'>;
// @ts-expect-error A completed move cannot retain live transfer progress.
const mixedMove: WalletMoveStatus = { ...completedMove, move: moving.move };
void mixedMove;

declare const moveRequest: WalletMoveRequest;
void wallet.placement.move(moveRequest);
// @ts-expect-error Move submission requires the expected ownership generation.
void wallet.placement.move({ walletId, moveId: moveRequest.moveId, destinationRegion: 'APAC' });
// @ts-expect-error Applications cannot supply an owner credential with a move request.
void wallet.placement.move({ ...moveRequest, credential: 'parent-supplied-token' });
