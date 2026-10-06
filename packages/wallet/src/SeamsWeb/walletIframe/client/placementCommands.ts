import {
  parseWalletPlacementResult,
  type WalletPlacementCapability,
} from '@/SeamsWeb/publicApi/placement';
import type { WalletIframeCoordinator } from '../coordinator';
import type { WalletId } from '@shared/utils/domainIds';

type PlacementPost = (request: {
  readonly type: 'PM_GET_WALLET_PLACEMENT';
  readonly payload: { readonly walletId: WalletId };
}) => Promise<{ readonly result: unknown }>;

export function createIframePlacementCommands(post: PlacementPost): WalletPlacementCapability {
  return { get: readFromHost.bind(null, post) };
}

async function readFromHost(post: PlacementPost, walletId: WalletId) {
  const response = await post({ type: 'PM_GET_WALLET_PLACEMENT', payload: { walletId } });
  return parseWalletPlacementResult(response.result);
}

export function createApplicationPlacementCommands(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): WalletPlacementCapability {
  return { get: readFromIframe.bind(null, iframe) };
}

async function readFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  walletId: WalletId,
) {
  const router = await iframe.requireRouter();
  return router.placement.get(walletId);
}
