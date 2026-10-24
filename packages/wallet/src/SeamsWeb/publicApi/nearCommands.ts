import type { NearSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { NearTransactionSignerRequest } from '@/core/types/nearSigningKeys';

type NearSigningOperation =
  | 'signAndSendTransaction'
  | 'signTransaction'
  | 'sendTransaction'
  | 'signDelegateAction'
  | 'signMessage';

type ResolvedNearInput<T extends { options?: unknown }> = Omit<
  T,
  'walletSession' | 'nearAccount' | 'options' | 'signer'
> & {
  walletSession: WalletSessionRef;
  nearAccount: NearAccountRef;
  options: NonNullable<T['options']> & {
    /** Wallet-origin cancellation. Functions never cross the iframe boundary. */
    readonly shouldAbort?: () => boolean;
  };
};

export type NearCommands = {
  ownerOperation: import('./ownerNearOperation').ExecuteOwnerNearOperation;
  getDefaultSigner(input: {
    readonly walletSession: WalletSessionRef;
    readonly nearAccount: NearAccountRef;
  }): ReturnType<NearSignerCapability['getDefaultSigner']>;
  setDefaultSigner(input: {
    readonly walletSession: WalletSessionRef;
    readonly nearAccount: NearAccountRef;
    readonly preference: import('@/core/types/nearSigningKeys').NearSignerPreference;
  }): Promise<void>;
  getMlDsaSigners(input: {
    readonly walletSession: WalletSessionRef;
  }): ReturnType<NearSignerCapability['getMlDsaSigners']>;
} & {
  [K in NearSigningOperation]: (
    args: ResolvedNearInput<Parameters<NearSignerCapability[K]>[0]> &
      (K extends 'signTransaction' | 'signAndSendTransaction'
        ? { readonly signer: NearTransactionSignerRequest }
        : object),
  ) => ReturnType<NearSignerCapability[K]>;
};

export type CreateNearCommands = (dispatch: TransactionDispatch) => NearCommands;
