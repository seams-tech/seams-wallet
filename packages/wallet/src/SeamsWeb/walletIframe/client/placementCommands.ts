import {
  parseWalletPlacementResult,
  parseWalletMoveRequest,
  parseWalletMoveStatusResult,
  type WalletMoveId,
  type WalletMoveRequest,
  type WalletPlacementCapability,
} from '@/SeamsWeb/publicApi/placement';
import type { WalletIframeCoordinator } from '../coordinator';
import type { WalletId } from '@shared/utils/domainIds';

type PlacementPost = (
  request:
    | {
        readonly type: 'PM_GET_LAST_WALLET_MOVE_REQUEST';
        readonly payload: { readonly walletId: WalletId };
      }
    | { readonly type: 'PM_MOVE_WALLET'; readonly payload: WalletMoveRequest }
    | {
        readonly type: 'PM_GET_WALLET_PLACEMENT';
        readonly payload: { readonly walletId: WalletId };
      }
    | {
        readonly type: 'PM_GET_WALLET_MOVE';
        readonly payload: { readonly walletId: WalletId; readonly moveId: WalletMoveId };
      },
  options?: { readonly timeout: 'interactive' },
) => Promise<{ readonly result: unknown }>;

export function createIframePlacementCommands(post: PlacementPost): WalletPlacementCapability {
  return {
    getLastMoveRequest: readLastMoveFromHost.bind(null, post),
    move: moveFromHost.bind(null, post),
    get: readFromHost.bind(null, post),
    getMove: readMoveFromHost.bind(null, post),
  };
}

async function readFromHost(post: PlacementPost, walletId: WalletId) {
  const response = await post({ type: 'PM_GET_WALLET_PLACEMENT', payload: { walletId } });
  return parseWalletPlacementResult(response.result);
}

export function createApplicationPlacementCommands(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): WalletPlacementCapability {
  return {
    getLastMoveRequest: readLastMoveFromIframe.bind(null, iframe),
    move: moveFromIframe.bind(null, iframe),
    get: readFromIframe.bind(null, iframe),
    getMove: readMoveFromIframe.bind(null, iframe),
  };
}

async function readFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  walletId: WalletId,
) {
  const router = await iframe.requireRouter();
  return router.placement.get(walletId);
}

async function readMoveFromHost(post: PlacementPost, walletId: WalletId, moveId: WalletMoveId) {
  const response = await post({ type: 'PM_GET_WALLET_MOVE', payload: { walletId, moveId } });
  return parseWalletMoveStatusResult(response.result, moveId);
}

async function readMoveFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  walletId: WalletId,
  moveId: WalletMoveId,
) {
  const router = await iframe.requireRouter();
  return router.placement.getMove(walletId, moveId);
}

async function moveFromHost(post: PlacementPost, request: WalletMoveRequest) {
  const response = await post({ type: 'PM_MOVE_WALLET', payload: request }, { timeout: 'interactive' });
  return parseWalletMoveStatusResult(response.result, request.moveId);
}

async function moveFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WalletMoveRequest,
) {
  const router = await iframe.requireRouter();
  return router.placement.move(request);
}

async function readLastMoveFromHost(post: PlacementPost, walletId: WalletId) {
  const response = await post({ type: 'PM_GET_LAST_WALLET_MOVE_REQUEST', payload: { walletId } });
  if (response.result === null) return null;
  const request = parseWalletMoveRequest(response.result);
  if (request.walletId !== walletId) throw new Error('Wallet move locator identity changed');
  return request;
}

async function readLastMoveFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  walletId: WalletId,
) {
  const router = await iframe.requireRouter();
  return router.placement.getLastMoveRequest(walletId);
}
