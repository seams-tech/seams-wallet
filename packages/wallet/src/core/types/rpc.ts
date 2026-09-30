import type { AccessKeyView, TxExecutionStatus } from '@near-js/types';

export const DEFAULT_WAIT_STATUS = {
  executeAction: 'EXECUTED_OPTIMISTIC' as TxExecutionStatus,
  // Threshold AddKey is safe to treat optimistically; finality will converge shortly after.
  thresholdAddKey: 'EXECUTED_OPTIMISTIC' as TxExecutionStatus,
  // See default finality settings:
  // https://github.com/near/near-api-js/blob/99f34864317725467a097dc3c7a3cc5f7a5b43d4/packages/accounts/src/account.ts#L68
};

export interface TransactionContext {
  nearPublicKeyStr: string;
  accessKeyInfo: AccessKeyView;
  nextNonce: string;
  txBlockHeight: string;
  txBlockHash: string;
}
