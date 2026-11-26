import type { WalletId } from '@shared/utils/domainIds';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletSessionLocatorPublication } from './sessionRouting';

declare const digest: DigestB64u;
declare const walletId: WalletId;
const credential: WalletSessionLocatorPublication = {
  kind: 'credential',
  digest,
  walletId,
  expiresAtMs: 1,
};
const exchanged: WalletSessionLocatorPublication = {
  kind: 'exchanged_credential',
  digest,
  exchangeDigest: digest,
};
// @ts-expect-error A direct locator must identify its wallet.
const missingWallet: WalletSessionLocatorPublication = {
  kind: 'credential',
  digest,
  expiresAtMs: 1,
};
// @ts-expect-error An exchanged credential inherits its wallet and expiry from the exchange.
const crossedBranches: WalletSessionLocatorPublication = { ...exchanged, walletId, expiresAtMs: 1 };
// @ts-expect-error A direct locator cannot carry an exchange source.
const spreadEscape: WalletSessionLocatorPublication = { ...credential, exchangeDigest: digest };
const rawDigest: WalletSessionLocatorPublication = {
  kind: 'credential',
  // @ts-expect-error A raw digest is unvalidated at the publication boundary.
  digest: 'raw',
  walletId,
  expiresAtMs: 1,
};
void [credential, exchanged, missingWallet, crossedBranches, spreadEscape, rawDigest];
