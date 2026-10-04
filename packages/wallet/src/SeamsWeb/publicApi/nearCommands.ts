import type { NearSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';

type NearSigningOperation =
  | 'executeAction'
  | 'signAndSendTransaction'
  | 'signTransactionWithActions'
  | 'sendTransaction'
  | 'signDelegateAction'
  | 'signNEP413Message';

type ResolvedNearInput<T extends { options?: unknown }> = Omit<
  T,
  'walletSession' | 'nearAccount' | 'options'
> & {
  walletSession: WalletSessionRef;
  nearAccount: NearAccountRef;
  options: NonNullable<T['options']>;
};

export type NearCommands = {
  [K in NearSigningOperation]: (
    args: ResolvedNearInput<Parameters<NearSignerCapability[K]>[0]>,
  ) => ReturnType<NearSignerCapability[K]>;
} & Pick<NearSignerCapability, 'registerNearWallet' | 'fundImplicitNearAccountForTesting'>;

export type CreateNearCommands = (dispatch: TransactionDispatch) => NearCommands;
