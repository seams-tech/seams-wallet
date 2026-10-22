import type { NearSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { NearTransactionSignerSelection } from '@/core/types/seams';

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
} & {
  [K in NearSigningOperation]: (
    args: ResolvedNearInput<Parameters<NearSignerCapability[K]>[0]> &
      (K extends 'signTransaction' | 'signAndSendTransaction'
        ? { readonly signer: NearTransactionSignerSelection }
        : object),
  ) => ReturnType<NearSignerCapability[K]>;
};

export type CreateNearCommands = (dispatch: TransactionDispatch) => NearCommands;
