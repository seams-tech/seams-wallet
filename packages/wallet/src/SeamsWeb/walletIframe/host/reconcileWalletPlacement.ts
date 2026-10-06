import type { WalletId } from '@shared/utils/domainIds';
import type { WalletMoveStatus, WalletPlacement } from '@/SeamsWeb/publicApi/placement';
import { observeWalletOwnershipGeneration } from '@/core/indexedDB/seamsWalletDB/walletOwnershipGeneration';

export async function reconcileWalletPlacement(
  walletId: WalletId,
  placement: WalletPlacement | WalletMoveStatus,
): Promise<void> {
  switch (placement.state) {
    case 'unavailable':
      return;
    case 'settled':
      await observeWalletOwnershipGeneration(walletId, placement.generation);
      return;
    case 'moving':
      // Admission is forward-only. Source-generation signing material cannot survive the move.
      await observeWalletOwnershipGeneration(walletId, placement.move.destinationGeneration);
      return;
    case 'completed':
      await observeWalletOwnershipGeneration(walletId, placement.destinationGeneration);
      return;
    default:
      placement satisfies never;
      throw new Error('Unsupported wallet placement observation');
  }
}
