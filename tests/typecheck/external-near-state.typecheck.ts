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
