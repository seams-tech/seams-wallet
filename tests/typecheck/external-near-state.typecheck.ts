import type { ExternalNearConnection, ExternalNearState, ExternalNearResult } from '@/externalNear';
import type { WalletSessionRef } from '@/boundary/walletRefs';
const disconnected: ExternalNearState = { kind: 'disconnected' };
// @ts-expect-error Disconnected states cannot contain account authority.
const invalid: ExternalNearState = { ...disconnected, accountId: 'alice.testnet' };
// @ts-expect-error Connected state requires the internal brand.
const forged: ExternalNearConnection = {
  kind: 'connected',
  wallet: 'meteor',
  accountId: 'alice.testnet',
  network: 'testnet',
  generation: 1,
};
// @ts-expect-error External connections cannot authorize Seams custody.
const session: WalletSessionRef = forged;
// @ts-expect-error Successful results cannot contain failure diagnostics.
const result: ExternalNearResult<string> = { ok: true, value: 'signed', code: 'unavailable' };
void invalid;
void session;
void result;

import type { ExternalNearWalletId } from '@/externalNear';
const hot: ExternalNearWalletId = 'hot';
const intear: ExternalNearWalletId = 'intear';
// @ts-expect-error An unqualified wallet cannot become a selected provider.
const unknownWallet: ExternalNearWalletId = 'ledger';
void hot;
void intear;
void unknownWallet;

import { ExternalNearController, type ExternalNearConfig } from '@/externalNear';
// @ts-expect-error Applications must explicitly choose which wallets to enable.
const missingWallets: ExternalNearConfig = {
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
};
// @ts-expect-error A connecting state must retain the selected wallet identity.
const missingPendingWallet: ExternalNearState = { kind: 'connecting' };
const configured = new ExternalNearController({
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  wallets: ['meteor'],
});
// @ts-expect-error An unsupported wallet cannot enter configuration through a spread.
const invalidConfiguration: ExternalNearConfig = { ...missingWallets, wallets: ['ledger'] };
// @ts-expect-error Consumers cannot mutate the controller's allowed-wallet snapshot.
configured.getSnapshot().wallets.push('hot');
// @ts-expect-error The setter accepts only known wallet identifiers.
configured.setWallets(['ledger']);
void missingPendingWallet;
void invalidConfiguration;
