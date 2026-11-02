import type { WalletIframeCoordinator } from '../walletIframe/coordinator';
import type { TransactionReviewReservation } from '../walletIframe/client/transactionReviewReservation';
import type {
  ExecuteOwnerNearOperation,
  OwnerNearOperation,
  OwnerNearReview,
  PrepareOwnerNearTransaction,
} from './ownerNearOperation';
import type { NearSignerCapability, EvmSignerCapability, TempoSignerCapability } from './types';

export type TransactionReviewCapabilities = {
  readonly near: NearSignerCapability;
  readonly ownerNear: ExecuteOwnerNearOperation;
  readonly evm: EvmSignerCapability;
  readonly tempo: TempoSignerCapability;
};

type TransactionReviewBridge = {
  readonly getWalletIframe: () => WalletIframeCoordinator;
  readonly createCapabilities: (
    reservation: TransactionReviewReservation,
  ) => TransactionReviewCapabilities;
  readonly prepareOwnerTransaction: (
    input: PrepareOwnerNearTransaction,
    review: OwnerNearReview,
  ) => OwnerNearOperation;
};

const bridges = new WeakMap<NearSignerCapability, TransactionReviewBridge>();

export function registerTransactionReviewBridge(
  near: NearSignerCapability,
  bridge: TransactionReviewBridge,
): void {
  bridges.set(near, bridge);
}

export function getTransactionReviewBridge(
  near: NearSignerCapability,
): TransactionReviewBridge | undefined {
  return bridges.get(near);
}
