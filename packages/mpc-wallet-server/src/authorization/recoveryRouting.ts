import type { WalletId, WalletRecoveryOperationId } from '@shared/utils/domainIds';
import type { RecoveryCodeLocatorV1 } from '@shared/wallet-recovery/recoveryCodeLocator';

export type WalletRecoveryRoutingPublication =
  | {
      readonly kind: 'codes';
      readonly walletId: WalletId;
      readonly locators: readonly RecoveryCodeLocatorV1[];
      readonly operationId?: never;
    }
  | {
      readonly kind: 'operation';
      readonly walletId: WalletId;
      readonly operationId: WalletRecoveryOperationId;
      readonly locators?: never;
    };

export interface WalletRecoveryRoutingPublisher {
  publishRecovery(
    input: WalletRecoveryRoutingPublication,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'locator_conflict' }>;
}
