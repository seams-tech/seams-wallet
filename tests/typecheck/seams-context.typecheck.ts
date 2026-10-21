import * as walletReact from '@/react';
import { createBoundWallet } from '@/react/boundWallet';
import { buildReactLoggedOutLoginState } from '@/react/context/reactLoginStateBuilders';
import type { SeamsContextType, SeamsWalletState } from '@/react/types';
import type { Variant } from '@shared/utils/variant';

declare const context: ReturnType<typeof walletReact.useSeams>;
declare const provider: Omit<SeamsContextType, 'wallet'>;
declare const wallet: NonNullable<SeamsContextType['wallet']>;
declare const host: Parameters<typeof createBoundWallet>[2];
declare const owner: Parameters<typeof createBoundWallet>[3];
type AuthenticatedState = Parameters<typeof createBoundWallet>[1];
declare const signedOutState: Variant<SeamsWalletState, 'wallet', null>;

// Authentication is available before a bound wallet exists.
void context.unlock('wallet.testnet');
void context.lock();

// @ts-expect-error Authentication and bound signing use one public hook.
void walletReact.useWallet;

// @ts-expect-error Authentication can leave the current wallet absent.
void context.wallet.evm;

if (context.wallet) {
  void context.wallet.evm.signTransaction;
  void context.wallet.tempo.signTransaction;

  // @ts-expect-error An authenticated wallet can still lack a NEAR account.
  void context.wallet.near.signMessage;

  if (context.wallet.near) {
    void context.wallet.near.signAndSendTransaction({
      receiverId: context.wallet.near.accountId,
      actions: [],
    });
  }
}

// @ts-expect-error A shared provider value does not supply consumer-owned signing.
const missingWallet: SeamsContextType = provider;

// @ts-expect-error An authenticated wallet must have its EVM signer.
const missingEvm: typeof wallet = {
  walletId: 'wallet.testnet',
  walletSession: wallet.walletSession,
  near: null,
  tempo: wallet.tempo,
  exportKey: wallet.exportKey,
};

// @ts-expect-error A broad spread cannot remove a required wallet signer.
const invalidSpread: typeof wallet = { ...wallet, evm: null };

// @ts-expect-error A signed-out branch cannot carry an authenticated wallet.
const contradictoryWallet: SeamsWalletState = { loginState: signedOutState.loginState, wallet };

// @ts-expect-error Broad context spreads cannot pair signed-out state with a bound wallet.
const contradictoryContext: SeamsContextType = { ...context, ...signedOutState, wallet };

const signedOut = buildReactLoggedOutLoginState();
// @ts-expect-error Only authenticated state can construct a bound wallet.
createBoundWallet(context.seams, signedOut, host, owner);

// @ts-expect-error A direct cast cannot turn signed-out state into an authenticated branch.
const invalidCast = { isLoggedIn: false } as AuthenticatedState;

// @ts-expect-error Bound wallets expose signing. Unlock stays available on useSeams.
void wallet.unlock;

void missingWallet;
void missingEvm;
void invalidSpread;
void invalidCast;
void contradictoryWallet;
void contradictoryContext;
