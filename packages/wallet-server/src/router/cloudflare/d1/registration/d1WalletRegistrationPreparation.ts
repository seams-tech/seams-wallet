import type { DeviceId } from '@shared/authorization/capabilityKinds';
import type { WalletAuthMethodId, WalletAuthorityId, WalletId } from '@shared/utils/domainIds';
import type { StoredWalletRegistrationCeremony } from '../../../../core/RegistrationCeremonyStore';

export type D1WalletRegistrationOperationPreparedV1 = {
  readonly kind: 'd1_wallet_registration_operation_prepared_v1';
  readonly walletId: WalletId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly deviceId: DeviceId;
  readonly walletAuthMethodId: WalletAuthMethodId;
};

export function walletRegistrationOperationPreparedFromCeremony(
  ceremony: StoredWalletRegistrationCeremony,
  allocated: D1WalletRegistrationOperationPreparedV1 | null,
): D1WalletRegistrationOperationPreparedV1 {
  /* The method the wallet commits must be the one its custody envelope was
     sealed under, and the intent is what the client sealed against. They are
     allocated together at setup, so a disagreement here is corruption rather
     than drift — and committing the ceremony's id anyway would leave the
     wallet with an envelope owned by a method that does not exist. */
  if (
    String(ceremony.foundingWalletAuthMethodId) !==
    String(ceremony.intent.foundingWalletAuthMethodId)
  ) {
    throw new Error('registration ceremony and intent name different founding auth methods');
  }
  if (
    allocated &&
    (allocated.walletId !== ceremony.intent.walletId ||
      allocated.walletAuthorityId !== ceremony.foundingWalletAuthorityId ||
      allocated.deviceId !== ceremony.foundingDeviceId ||
      allocated.walletAuthMethodId !== ceremony.foundingWalletAuthMethodId)
  ) {
    throw new Error('registration operation identity does not match its ceremony');
  }
  return {
    kind: 'd1_wallet_registration_operation_prepared_v1',
    walletId: ceremony.intent.walletId,
    walletAuthorityId: ceremony.foundingWalletAuthorityId,
    deviceId: ceremony.foundingDeviceId,
    walletAuthMethodId: ceremony.foundingWalletAuthMethodId,
  };
}
