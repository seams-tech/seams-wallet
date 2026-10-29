import type { NearSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';

type NearSigningOperation =
  | 'signAndSendTransaction'
  | 'signTransaction'
  | 'sendTransaction'
  | 'signDelegateAction'
  | 'signMessage';

type ResolvedNearInput<T extends { options?: unknown }> = Omit<
  T,
  'walletSession' | 'nearAccount' | 'options'
> & {
  walletSession: WalletSessionRef;
  nearAccount: NearAccountRef;
  options: NonNullable<T['options']>;
};

export type NearCommands = {
  ownerOperation: import('./ownerNearOperation').ExecuteOwnerNearOperation;
} & {
  [K in NearSigningOperation]: (
    args: ResolvedNearInput<Parameters<NearSignerCapability[K]>[0]>,
  ) => ReturnType<NearSignerCapability[K]>;
};

export type CreateNearCommands = (dispatch: TransactionDispatch) => NearCommands;
