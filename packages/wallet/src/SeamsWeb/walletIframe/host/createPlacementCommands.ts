import { DeviceLinkingError, DeviceLinkingErrorCode } from '@/core/types/linkDevice';
import {
  parseWalletPlacement,
  type WalletPlacementCapability,
  type WalletPlacementResult,
} from '@/SeamsWeb/publicApi/placement';
import type { WalletAuthenticationState } from '@/core/types/seams';
import type { WalletHostManagementRequestV1 } from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';
import type { WalletId } from '@shared/utils/domainIds';

type Context = {
  readonly managementRequest: WalletHostManagementRequestV1;
  readonly readAuthentication: () => WalletAuthenticationState;
};

export function createWalletHostPlacementCommands(context: Context): WalletPlacementCapability {
  return { get: getPlacement.bind(null, context) };
}

async function getPlacement(context: Context, walletId: WalletId): Promise<WalletPlacementResult> {
  const authentication = context.readAuthentication();
  if (authentication.kind !== 'authenticated' || authentication.walletId !== walletId)
    return { ok: false, code: 'wallet_unlock_required' };
  let response: Awaited<ReturnType<WalletHostManagementRequestV1['request']>>;
  try {
    response = await context.managementRequest.request({
      walletId,
      method: 'GET',
      canonicalPath: `/wallet/placement/v1?walletId=${encodeURIComponent(walletId)}`,
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
    return { ok: true, placement: parseWalletPlacement(response.body) };
  } catch {
    return { ok: false, code: 'invalid_response' };
  }
}
