import { IndexedDBManager } from '@/core/indexedDB';
import type { WalletId } from '@shared/utils/domainIds';

export async function resolveFullWalletOwner(walletId: WalletId) {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
  if (selected.kind !== 'resolved') return { kind: 'refused', reason: 'locked' } as const;
  const { selection, authMethod, authority } = selected;
  if (
    selection.lockState !== 'unlocked' ||
    selection.walletId !== walletId ||
    authMethod.status !== 'active' ||
    authMethod.walletId !== walletId ||
    selection.walletAuthMethodId !== authMethod.walletAuthMethodId ||
    authMethod.walletAuthorityId !== authority.authorityId ||
    authority.walletId !== walletId ||
    authority.state !== 'active' ||
    !authority.permissions.includes('sign') ||
    !authority.permissions.includes('export_keys') ||
    !authority.permissions.includes('link_devices') ||
    !authority.permissions.includes('revoke_devices')
  )
    return { kind: 'refused', reason: 'full_owner_required' } as const;
  return { kind: 'owner', authMethod, authority } as const;
}
