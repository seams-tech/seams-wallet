import type {
  ExternalEvmResult,
  ExternalEvmState,
  ExternalEvmTransactionInput,
} from '@/externalEvm';
import type { WalletSessionRef } from '@/boundary/walletRefs';

const wallet = {
  id: 'wallet',
  name: 'Wallet',
  icon: 'data:image/png;base64,AA==',
  rdns: 'wallet.test',
};
const address = '0x1111111111111111111111111111111111111111';

const disconnected: ExternalEvmState = { kind: 'disconnected' };
const connecting: ExternalEvmState = { kind: 'connecting', wallet };
void disconnected;
void connecting;

// @ts-expect-error A connecting state cannot carry an authorized account.
const invalidConnecting: ExternalEvmState = { kind: 'connecting', wallet, account: address };
void invalidConnecting;

// @ts-expect-error Connected state can only come from the internal branch builder.
const forgedConnected: ExternalEvmState = {
  kind: 'connected',
  generation: 1,
  wallet,
  accounts: [address],
  account: address,
  chainId: 1,
  network: { kind: 'unsupported' },
};
void forgedConnected;

// @ts-expect-error A broad spread cannot add connected identity to a disconnected state.
const spreadDisconnected: ExternalEvmState = { ...disconnected, account: address };
void spreadDisconnected;

// @ts-expect-error An external connection cannot be used as a Seams Wallet Session.
const invalidSession: WalletSessionRef = connecting;
void invalidSession;

const invalidResult: ExternalEvmResult<string> = {
  ok: true,
  value: 'signed',
  // @ts-expect-error A success result cannot carry failure diagnostics.
  code: 'provider_failure',
};
void invalidResult;

const validTransaction: ExternalEvmTransactionInput = {
  to: address,
  data: '0x',
  value: 0n,
  gas: { kind: 'wallet' },
  fees: { kind: 'eip1559', maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
};
void validTransaction;

const invalidTransaction: ExternalEvmTransactionInput = {
  to: address,
  data: '0x',
  value: 0n,
  gas: { kind: 'wallet' },
  // @ts-expect-error Fee branches reject fields belonging to another fee model.
  fees: { kind: 'legacy', gasPrice: 1n, maxFeePerGas: 1n },
};
void invalidTransaction;
