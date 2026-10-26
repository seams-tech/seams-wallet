import { IndexedDBManager } from '@/core/indexedDB';
import type { AuthMethodSessionInstaller } from './hostPlugin';
import {
  buildVoiceIdWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';

export async function resolveAuthMethodSessionIdentity(
  unlocked: Parameters<AuthMethodSessionInstaller>[0],
) {
  const { walletSession, custodyEnvelope, signal } = unlocked;
  signal.throwIfAborted();
  const method = await IndexedDBManager.getWalletAuthMethodV2(walletSession.authMethodId);
  const authority = await IndexedDBManager.getWalletAuthority(walletSession.authorityId);
  if (
    !method ||
    method.kind !== 'voiceid' ||
    method.status !== 'active' ||
    method.walletId !== walletSession.walletId ||
    method.walletAuthorityId !== walletSession.authorityId ||
    !authority ||
    authority.state !== 'active' ||
    authority.walletId !== walletSession.walletId ||
    authority.authorityDigestB64u !== walletSession.authorityDigestB64u ||
    authority.revocationEpoch !== walletSession.authorityRevocationEpoch ||
    custodyEnvelope.walletId !== walletSession.walletId ||
    custodyEnvelope.ownership.walletAuthMethodId !== method.walletAuthMethodId ||
    custodyEnvelope.factor.kind !== 'voiceid' ||
    custodyEnvelope.factor.deviceKeyId !== method.deviceKeyId
  ) {
    throw new Error('Wallet Session, device method, and custody do not match.');
  }
  const ref = await walletAuthAuthorityRef({
    authority: buildVoiceIdWalletAuthAuthority({
      walletId: method.walletId,
      walletAuthMethodId: method.walletAuthMethodId,
      deviceKeyId: method.deviceKeyId,
    }),
  });
  return { method, authority, ref };
}
