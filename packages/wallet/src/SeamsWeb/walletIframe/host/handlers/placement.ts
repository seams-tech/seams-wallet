import { parseWalletMoveId } from '@/SeamsWeb/publicApi/placement';
import { parseWalletId } from '@shared/utils/domainIds';
import { requireRecord } from '@shared/utils/validation';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOkResult } from './shared';

export function createPlacementWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  return {
    PM_GET_WALLET_PLACEMENT: getWalletPlacement.bind(null, deps),
    PM_GET_WALLET_MOVE: getWalletMove.bind(null, deps),
  };
}

async function getWalletPlacement(
  deps: HandlerDeps,
  request: Req<'PM_GET_WALLET_PLACEMENT'>,
): Promise<void> {
  const payload = requireRecord(request.payload, 'Wallet placement request');
  const wallet = parseWalletId(payload.walletId);
  if (!wallet.ok || Object.keys(payload).length !== 1)
    throw new Error('Wallet placement identity is invalid');
  const result = await deps.getWalletRuntime().placement.get(wallet.value);
  if (deps.respondIfCancelled(request.requestId)) return;
  respondOkResult(deps, request.requestId, result);
}

async function getWalletMove(deps: HandlerDeps, request: Req<'PM_GET_WALLET_MOVE'>): Promise<void> {
  const payload = requireRecord(request.payload, 'Wallet move request');
  const wallet = parseWalletId(payload.walletId);
  const moveId = parseWalletMoveId(payload.moveId);
  if (!wallet.ok || Object.keys(payload).length !== 2)
    throw new Error('Wallet move request is invalid');
  const result = await deps.getWalletRuntime().placement.getMove(wallet.value, moveId);
  if (deps.respondIfCancelled(request.requestId)) return;
  respondOkResult(deps, request.requestId, result);
}
