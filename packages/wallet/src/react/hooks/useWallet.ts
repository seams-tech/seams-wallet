import { useTransactionReviewOwner } from '../transactionReview/TransactionReviewHost';
import type { ReviewedTransactionInput } from '../transactionReview/contract';
import { createReviewedBoundCalls } from '../transactionReview/boundCalls';
import type { ReviewOwner, ReviewHostController } from '../transactionReview/controller';
import { useMemo } from 'react';
import { useSeams } from '../context';
import {
  nearAccountRefFromAccountId,
  walletSessionRefFromSession,
  type NearAccountRef,
  type WalletSessionRef,
} from '../../boundary/walletRefs';
import type { SeamsWeb } from '../../SeamsWeb';
import type {
  ExportKeyInput,
  KeyExportOutcome,
  NearSignerCapability,
  EvmSignerCapability,
  TempoSignerCapability,
} from '../../SeamsWeb/publicApi/types';

// Distributive, so unions keep their arms paired instead of collapsing.
type WithoutNearSubject<T> = T extends unknown ? Omit<T, 'walletSession' | 'nearAccount'> : never;
type WithoutWalletSession<T> = T extends unknown ? Omit<T, 'walletSession'> : never;

/** NEAR signing bound to one wallet and account: the call names only the transaction. */
export interface BoundNearSigner {
  readonly accountId: string;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutNearSubject<Parameters<NearSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<NearSignerCapability['signAndSendTransaction']>;
  signMessage(
    args: WithoutNearSubject<Parameters<NearSignerCapability['signMessage']>[0]>,
  ): ReturnType<NearSignerCapability['signMessage']>;
}

/** EIP-1559 signing bound to one wallet. */
export interface BoundEvmSigner {
  signTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<EvmSignerCapability['signTransaction']>[0]>
    >,
  ): ReturnType<EvmSignerCapability['signTransaction']>;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<EvmSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<EvmSignerCapability['signAndSendTransaction']>;
}

/** EIP-2718 Tempo signing bound to one wallet. */
export interface BoundTempoSigner {
  signTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<TempoSignerCapability['signTransaction']>[0]>
    >,
  ): ReturnType<TempoSignerCapability['signTransaction']>;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<TempoSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<TempoSignerCapability['signAndSendTransaction']>;
}

export interface BoundWallet {
  readonly walletId: string;
  /** The exact reference every bound call authorizes. */
  readonly walletSession: WalletSessionRef;
  /** `null` when this wallet has no NEAR account — EVM-only, or still provisioning. */
  readonly near: BoundNearSigner | null;
  readonly evm: BoundEvmSigner;
  readonly tempo: BoundTempoSigner;
  exportKey(input: WithoutNearSubject<ExportKeyInput>): Promise<KeyExportOutcome>;
}

/**
 * `near`, `evm` and `tempo` are lifted to the top level so the common path is a
 * single check. `near` is null both when nobody is signed in and when the
 * signed-in wallet has no NEAR account — one guard covers both, and `status`
 * tells the two apart when the UI needs to say something different.
 */
export type UseWalletResult =
  | {
      status: 'signed_out';
      wallet: null;
      near: null;
      evm: null;
      tempo: null;
      walletId: null;
      nearAccountId: null;
    }
  | {
      status: 'no_near_account';
      wallet: BoundWallet;
      near: null;
      evm: BoundEvmSigner;
      tempo: BoundTempoSigner;
      walletId: string;
      nearAccountId: null;
    }
  | {
      status: 'ready';
      wallet: BoundWallet;
      near: BoundNearSigner;
      evm: BoundEvmSigner;
      tempo: BoundTempoSigner;
      walletId: string;
      nearAccountId: string;
    };

function createBoundWallet(
  seams: SeamsWeb,
  walletId: string,
  nearAccountId: string | null,
  host: ReviewHostController | null,
  owner: ReviewOwner,
): BoundWallet {
  const walletSession = walletSessionRefFromSession({ walletId });
  const nearAccount: NearAccountRef | null = nearAccountId
    ? nearAccountRefFromAccountId(nearAccountId)
    : null;

  const reviewed = createReviewedBoundCalls({
    seams,
    walletId,
    walletSession,
    nearAccount,
    host,
    owner,
  });

  // Bind the wallet the UI rendered, rather than re-resolving per call: a button
  // signs with the wallet the person was looking at when they clicked.
  const near: BoundNearSigner | null =
    nearAccount && nearAccountId
      ? {
          accountId: nearAccountId,
          signAndSendTransaction: reviewed.nearSign,
          signMessage: (args) =>
            seams.near.signMessage({ ...args, walletSession, nearAccount }),
        }
      : null;

  return {
    walletId,
    walletSession,
    near,
    evm: {
      signTransaction: reviewed.evmSign,
      signAndSendTransaction: reviewed.evmExecute,
    },
    tempo: {
      signTransaction: reviewed.tempoSign,
      signAndSendTransaction: reviewed.tempoExecute,
    },
    exportKey: async (input) => {
      if (input.kind === 'ed25519') {
        return await seams.keys.exportKey({
          ...input,
          walletSession,
          ...(nearAccount ? { nearAccount } : {}),
        });
      }
      return await seams.keys.exportKey({ ...input, walletSession });
    },
  };
}

/**
 * The signed-in wallet, with signing bound to it.
 *
 * `useSeams()` gives you the whole client; `useWallet()` gives you the one
 * wallet the person is signed into, so a signing call names only the
 * transaction. Reach for `useSeams().seams` to target a different wallet.
 *
 * @example
 * const { near } = useWallet();
 * if (!near) return <SignInButton />;
 * await near.signAndSendTransaction({ receiverId, actions });
 */
export function useWallet(): UseWalletResult {
  const { seams, loginState } = useSeams();
  const walletId = loginState.isLoggedIn ? loginState.walletId : null;
  const nearAccountId = loginState.isLoggedIn ? loginState.nearAccountId : null;

  // Review ownership stays with the wallet as NEAR provisioning completes.
  const { host, owner } = useTransactionReviewOwner(walletId);

  return useMemo<UseWalletResult>(() => {
    if (!walletId) {
      return {
        status: 'signed_out',
        wallet: null,
        near: null,
        evm: null,
        tempo: null,
        walletId: null,
        nearAccountId: null,
      };
    }
    const wallet = createBoundWallet(seams, walletId, nearAccountId, host, owner);
    if (!wallet.near || !nearAccountId) {
      return {
        status: 'no_near_account',
        wallet,
        near: null,
        evm: wallet.evm,
        tempo: wallet.tempo,
        walletId,
        nearAccountId: null,
      };
    }
    return {
      status: 'ready',
      wallet,
      near: wallet.near,
      evm: wallet.evm,
      tempo: wallet.tempo,
      walletId,
      nearAccountId,
    };
  }, [seams, walletId, nearAccountId, host, owner]);
}
