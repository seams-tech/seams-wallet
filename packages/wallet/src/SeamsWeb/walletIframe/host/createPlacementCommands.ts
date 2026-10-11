import {
  reconcileWalletPlacementSession,
  type WalletPlacementSession,
} from './reconcileWalletPlacement';
import { readLastWalletMoveRequest } from './walletMoveLocator';
import { requestWalletMove } from './requestWalletMove';
import type { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import { DeviceLinkingError, DeviceLinkingErrorCode } from '@/core/types/linkDevice';
import {
  parseWalletPlacement,
  parseWalletMoveStatus,
  type WalletMoveId,
  type WalletMoveStatusResult,
  type WalletPlacementCapability,
  type WalletPlacementResult,
} from '@/SeamsWeb/publicApi/placement';
import type { WalletHostManagementRequestV1 } from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';
import type { Variant } from '@shared/utils/variant';
import type { WalletId } from '@shared/utils/domainIds';

type Context = WalletPlacementSession & {
  readonly signingEngine: BrowserSigningSurface;
  readonly managementRequest: WalletHostManagementRequestV1;
};

export function createWalletHostPlacementCommands(context: Context): WalletPlacementCapability {
  return {
    getLastMoveRequest: readLastWalletMoveRequest,
    move: requestWalletMove.bind(null, context),
    get: getPlacement.bind(null, context),
    getMove: getMove.bind(null, context),
  };
}

async function getPlacement(context: Context, walletId: WalletId): Promise<WalletPlacementResult> {
  const authentication = context.readAuthentication();
  const result = await readPlacement(
    context,
    walletId,
    `/wallet/placement/v1?walletId=${encodeURIComponent(walletId)}`,
    placementResult,
  );
  if (result.ok) await reconcileWalletPlacementSession(context, walletId, result.placement);
  if (context.readAuthentication() !== authentication)
    return { ok: false, code: 'wallet_unlock_required' };
  return result;
}

function placementResult(body: unknown): WalletPlacementResult {
  return { ok: true, placement: parseWalletPlacement(body) };
}

function moveResult(moveId: WalletMoveId, body: unknown): WalletMoveStatusResult {
  return { ok: true, status: parseWalletMoveStatus(body, moveId) };
}

async function getMove(
  context: Context,
  walletId: WalletId,
  moveId: WalletMoveId,
): Promise<WalletMoveStatusResult> {
  const authentication = context.readAuthentication();
  const path = `/wallet/placement/v1/relocations/${encodeURIComponent(moveId)}?walletId=${encodeURIComponent(walletId)}`;
  const result = await readPlacement(context, walletId, path, moveResult.bind(null, moveId));
  if (result.ok) await reconcileWalletPlacementSession(context, walletId, result.status);
  if (context.readAuthentication() !== authentication)
    return { ok: false, code: 'wallet_unlock_required' };
  return result;
}

async function readPlacement<T extends WalletPlacementResult | WalletMoveStatusResult>(
  context: Context,
  walletId: WalletId,
  canonicalPath: string,
  parse: (body: unknown) => T,
): Promise<T | Variant<WalletPlacementResult, 'ok', false>> {
  const authentication = context.readAuthentication();
  if (authentication.kind !== 'authenticated' || authentication.walletId !== walletId)
    return { ok: false, code: 'wallet_unlock_required' };
  let response: Awaited<ReturnType<WalletHostManagementRequestV1['request']>>;
  try {
    response = await context.managementRequest.request({
      walletId,
      method: 'GET',
      canonicalPath,
    });
  } catch (error) {
    if (
      error instanceof DeviceLinkingError &&
      error.code === DeviceLinkingErrorCode.WALLET_UNLOCK_REQUIRED
    )
      return { ok: false, code: 'wallet_unlock_required' };
    if (context.readAuthentication() !== authentication)
      return { ok: false, code: 'wallet_unlock_required' };
    return { ok: false, code: 'transport_unavailable' };
  }
  if (context.readAuthentication() !== authentication)
    return { ok: false, code: 'wallet_unlock_required' };
  if (response.status === 401 || response.status === 403)
    return { ok: false, code: 'unauthorized' };
  if (response.status !== 200) return { ok: false, code: 'transport_unavailable' };
  try {
    return parse(response.body);
  } catch {
    return { ok: false, code: 'invalid_response' };
  }
}
