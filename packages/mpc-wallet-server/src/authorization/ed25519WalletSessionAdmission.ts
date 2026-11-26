import type { TenantId } from '@shared/authorization/capabilityKinds';
import type {
  CapabilityOperationEnvelope,
  CapabilityOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import type { WalletId } from '@shared/utils/domainIds';
import type { AuthorizedOperationInput } from './domain';
import type {
  EcdsaWalletSessionAdmissionResult,
  EcdsaWalletSessionResolutionResult,
} from './ecdsaWalletSessionAdmission';

/** An Ed25519 signing operation a reusable Wallet Session admits for the wallet it signs for. */
export type Ed25519WalletSessionAdmissionInput = {
  readonly operation: AuthorizedOperationInput & {
    readonly operation: CapabilityOperationEnvelope<{
      readonly capabilityKind: 'near_ed25519_mpc_signing';
      readonly operationKind:
        'near.sign_transaction' | 'near.sign_delegate_action' | 'near.sign_nep413_message';
    }>;
    readonly authorization: { readonly kind: 'authorization_grant' };
    readonly quota: { readonly kind: 'consume_reusable_wallet_session' };
  };
  readonly walletId: WalletId;
};

/**
 * The outcomes of the ECDSA admission: a live operation carries the owner
 * scope its own admission row pinned, so dispatch needs no second read.
 */
export type Ed25519WalletSessionAdmissionResult = EcdsaWalletSessionAdmissionResult;

/** The operation a finalize request names, found by the fingerprint its prepare claimed. */
export type Ed25519WalletSessionResolutionInput = {
  readonly tenantId: TenantId;
  readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  readonly walletId: WalletId;
  readonly nowMs: number;
};

export type Ed25519WalletSessionResolutionResult = EcdsaWalletSessionResolutionResult;
