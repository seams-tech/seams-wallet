// EVM browser wallets: EIP-6963 announcements and the Phantom namespace.
export { ExternalEvmController } from './externalEvm/controller';
export type {
  ExternalEvmChain,
  ExternalEvmConnection,
  ExternalEvmErrorCode,
  ExternalEvmFailure,
  ExternalEvmNetwork,
  ExternalEvmReceipt,
  ExternalEvmResult,
  ExternalEvmSnapshot,
  ExternalEvmState,
  ExternalEvmSubmission,
  ExternalEvmTransactionInput,
  ExternalEvmWallet,
} from './externalEvm/types';

// NEAR browser wallets: Meteor, HOT and Intear.
export { ExternalNearController } from './externalNear/controller';
export type {
  ExternalNearConnection,
  ExternalNearConfig,
  ExternalNearWalletId,
  ExternalNearNetwork,
  ExternalNearOutcome,
  ExternalNearResult,
  ExternalNearSnapshot,
  ExternalNearState,
  ExternalNearSubmission,
  ExternalNearMessageParams,
  ExternalNearSignedMessage,
} from './externalNear/types';
export { nearWalletName } from './externalNear/wallets';
