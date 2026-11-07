import { readVoiceIdAvailability } from '@/core/authMethods/availability';
import { IndexedDBManager, walletSessionAuthorizations } from '@/core/indexedDB';
import { loadSpeakToSignHost } from '@/core/transactionFeatures/hostRegistry';
import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignWalletPorts } from './speakToSign';

/** The Wallet iframe's own stores. The verify route admits this credential as the session. */
export const browserSpeakToSignPorts: SpeakToSignWalletPorts = {
  readVoiceIdAvailability,
  readOperationCredential,
  loadHost: loadSpeakToSignHost,
  fetch: fetchFromWindow,
};

async function readOperationCredential(walletId: WalletId): Promise<string> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (selected.kind !== 'resolved') throw new Error('Unlock this wallet before a spoken payment.');
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId,
    authorityId: selected.authority.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (session.kind !== 'found') throw new Error('Unlock this wallet before a spoken payment.');
  return session.operationCredential.token;
}

function fetchFromWindow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
