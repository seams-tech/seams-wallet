import type { executeEvmFamilyTransactionLifecycle } from '@/SeamsWeb/operations/tempo/executeEvmFamilyTransaction';
import type { TempoSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';

export type EvmFamilyCommands = Parameters<
  typeof executeEvmFamilyTransactionLifecycle
>[0]['lifecycle'] &
  Pick<TempoSignerCapability['advanced'], 'reconcileNonceLane'>;

export type CreateEvmFamilyCommands = (dispatch: TransactionDispatch) => EvmFamilyCommands;
