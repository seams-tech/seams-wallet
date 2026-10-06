import type { ActiveWalletSessionV1, WalletSessionHome, WalletSessionOperationCredentialV1 } from './contracts';

declare const activeWithoutQuota: Omit<ActiveWalletSessionV1, 'quotaId'>;

// @ts-expect-error Exact active Wallet Sessions require their quota identity.
const invalidActive: ActiveWalletSessionV1 = activeWithoutQuota;

void invalidActive;

declare const credentialWithoutHome: Omit<WalletSessionOperationCredentialV1, 'home'>;
// @ts-expect-error Session credentials require explicit routing metadata, including through spreads.
const missingHome: WalletSessionOperationCredentialV1 = { ...credentialWithoutHome };
// @ts-expect-error A direct endpoint cannot also select a region.
const mixedHome: WalletSessionHome = { kind: 'direct', region: 'US' };
// @ts-expect-error Regional routing accepts catalog regions, never arbitrary URLs.
const arbitraryHome: WalletSessionHome = { kind: 'regional', region: 'https://untrusted.test' };
void missingHome;
void mixedHome;
void arbitraryHome;

declare const credentialWithoutGeneration: Omit<
  WalletSessionOperationCredentialV1,
  'ownershipGeneration'
>;
// @ts-expect-error Credential construction requires its execution generation.
const missingGeneration: WalletSessionOperationCredentialV1 = { ...credentialWithoutGeneration };
void missingGeneration;
