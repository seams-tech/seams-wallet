import type { executeEvmFamilyTransactionLifecycle } from '@/SeamsWeb/operations/tempo/executeEvmFamilyTransaction';
import type { EvmSignerCapability, TempoSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';

export type EvmFamilyCommands = Parameters<
  typeof executeEvmFamilyTransactionLifecycle
>[0]['lifecycle'] &
  Pick<TempoSignerCapability, 'bootstrapEcdsaSession' | 'reconcileNonceLane'> &
  Pick<EvmSignerCapability, 'registerEvmWallet'>;

export type CreateEvmFamilyCommands = (dispatch: TransactionDispatch) => EvmFamilyCommands;
