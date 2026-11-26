import { IndexedDBManager, walletSessionAuthorizations } from '@/core/indexedDB';
import type { WalletAuthenticationState } from '@/core/types/seams';
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

export type WalletPlacementSession = {
  readonly readAuthentication: () => WalletAuthenticationState;
  readonly lockWallet: () => Promise<void>;
};

export async function reconcileWalletPlacementSession(
  context: WalletPlacementSession,
  walletId: WalletId,
  placement: WalletPlacement | WalletMoveStatus,
): Promise<void> {
  const authentication = context.readAuthentication();
  await reconcileWalletPlacement(walletId, placement);
  if (authentication.kind !== 'authenticated' || authentication.walletId !== walletId) return;
  const activeGeneration = activatedGeneration(placement);
  if (activeGeneration === null) return;
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (selected.kind !== 'resolved') return;
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId,
    authorityId: selected.authority.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (
    session.kind === 'found' &&
    session.operationCredential.ownershipGeneration < activeGeneration &&
    context.readAuthentication() === authentication
  ) {
    await context.lockWallet();
  }
}

function activatedGeneration(placement: WalletPlacement | WalletMoveStatus): number | null {
  switch (placement.state) {
    case 'unavailable':
      return null;
    case 'settled':
      return placement.generation;
    case 'completed':
      return placement.destinationGeneration;
    case 'moving':
      if (placement.move.progress.availability === 'active')
        return placement.move.destinationGeneration;
      return null;
    default:
      placement satisfies never;
      throw new Error('Unsupported wallet activation observation');
  }
}
