import { IndexedDBManager } from '@/core/indexedDB';
import { parseWalletMoveRequest, type WalletMoveRequest } from '@/SeamsWeb/publicApi/placement';
import type { WalletId } from '@shared/utils/domainIds';

function key(walletId: WalletId): string {
  return `wallet_move_request:${walletId}`;
}

export async function readLastWalletMoveRequest(
  walletId: WalletId,
): Promise<WalletMoveRequest | null> {
  const raw = await IndexedDBManager.getAppState(key(walletId));
  if (raw === undefined) return null;
  const request = parseWalletMoveRequest(raw);
  if (request.walletId !== walletId) throw new Error('Stored wallet move identity is invalid');
  return request;
}

export async function saveWalletMoveRequest(request: WalletMoveRequest): Promise<void> {
  // Copy only the locator fields. Proofs and credentials never enter this record.
  await IndexedDBManager.setAppState(key(request.walletId), {
    walletId: request.walletId,
    moveId: request.moveId,
    destinationRegion: request.destinationRegion,
    expectedGeneration: request.expectedGeneration,
  });
}
