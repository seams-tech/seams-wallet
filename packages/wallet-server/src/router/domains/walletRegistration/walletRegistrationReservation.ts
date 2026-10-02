import { parseDeviceId, type DeviceId } from '@shared/authorization/capabilityKinds';
import { alphabetizeStringify, sha256HexUtf8 } from '@shared/utils/digests';
import {
  parseWalletAuthorityId,
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthorityId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { createServerAllocatedWalletId } from '@shared/utils/registrationIds';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { isPlainObject, requireCanonicalString } from '@shared/utils/validation';
import type { WalletRegistrationSetupInput } from './walletRegistrationInputs';

export type WalletRegistrationSetupReservation = {
  readonly walletId: WalletId;
  readonly ceremonyId: string;
  readonly preparationId: string;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly deviceId: DeviceId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly reservedAtMs: number;
};

export type WalletRegistrationSetupReservationResult =
  | {
      readonly ok: true;
      readonly reservation: WalletRegistrationSetupReservation;
      readonly lifecycle: 'reserved' | 'established';
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly reservation?: never;
      readonly lifecycle?: never;
    };

type ReservationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface WalletRegistrationReservationAuthority {
  reserve(input: WalletRegistrationSetupInput): Promise<WalletRegistrationSetupReservationResult>;
  admitHome(input: {
    readonly ceremonyId: string;
    readonly walletId: WalletId;
  }): Promise<ReservationOutcome>;
  complete(input: {
    readonly ceremonyId: string;
    readonly walletId: WalletId;
    readonly outcome: 'established' | 'cancelled';
  }): Promise<ReservationOutcome>;
}

function requireId<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function parseWalletRegistrationSetupReservation(
  raw: unknown,
): WalletRegistrationSetupReservation {
  if (!isPlainObject(raw)) throw new Error('Registration reservation is invalid');
  const ceremonyId = requireCanonicalString(raw.ceremonyId, 'ceremonyId');
  const preparationId = requireCanonicalString(raw.preparationId, 'preparationId');
  if (
    !/^wrc_[A-Za-z0-9_-]{43}$/u.test(ceremonyId) ||
    !/^regprep_[A-Za-z0-9_-]{43}$/u.test(preparationId)
  ) {
    throw new Error('Registration reservation ceremony identity is invalid');
  }
  const reservedAtMs = raw.reservedAtMs;
  if (
    typeof reservedAtMs !== 'number' ||
    !Number.isSafeInteger(reservedAtMs) ||
    reservedAtMs <= 0
  ) {
    throw new Error('Registration reservation timestamp is invalid');
  }
  return {
    walletId: requireId(parseWalletId(raw.walletId)),
    ceremonyId,
    preparationId,
    walletAuthorityId: requireId(parseWalletAuthorityId(raw.walletAuthorityId)),
    deviceId: requireId(parseDeviceId(raw.deviceId)),
    walletAuthMethodId: requireId(parseWalletAuthMethodId(raw.walletAuthMethodId)),
    reservedAtMs,
  };
}

export function proposeWalletRegistrationSetup(
  input: WalletRegistrationSetupInput,
): WalletRegistrationSetupReservation {
  return parseWalletRegistrationSetupReservation({
    walletId:
      input.request.wallet?.kind === 'provided'
        ? input.request.wallet.walletId
        : createServerAllocatedWalletId(),
    ceremonyId: `wrc_${secureRandomBase64Url(32)}`,
    preparationId: `regprep_${secureRandomBase64Url(32)}`,
    walletAuthorityId: `wallet-authority:${secureRandomBase64Url(32)}`,
    deviceId: `device:${secureRandomBase64Url(32)}`,
    walletAuthMethodId: `wallet-auth-method:${secureRandomBase64Url(32)}`,
    reservedAtMs: Date.now(),
  });
}

export async function walletRegistrationSetupRequestDigest(
  namespace: string,
  input: WalletRegistrationSetupInput,
): Promise<string> {
  if (!input.runtimePolicyScope || input.runtimePolicyScope.orgId !== input.orgId) {
    throw new Error('Registration reservation requires an exact authenticated tenant scope');
  }
  return sha256HexUtf8(
    alphabetizeStringify({
      namespace,
      runtimePolicyScope: input.runtimePolicyScope,
      expectedOrigin: input.expectedOrigin,
      wallet: input.request.wallet ?? { kind: 'server_allocated' },
      authMethod: input.request.authMethod,
      signerSelection: input.request.signerSelection,
    }),
  );
}

export async function completeRegistrationReservation(
  authority: WalletRegistrationReservationAuthority | null,
  input: Parameters<WalletRegistrationReservationAuthority['complete']>[0],
): Promise<ReservationOutcome> {
  if (!authority)
    return {
      ok: false,
      code: 'registration_authority_unavailable',
      message: 'Registration reservation authority is required',
    };
  return authority.complete(input);
}

export async function admitRegistrationReservationHome(
  authority: WalletRegistrationReservationAuthority | null,
  input: Parameters<WalletRegistrationReservationAuthority['admitHome']>[0],
): Promise<ReservationOutcome> {
  if (!authority)
    return {
      ok: false,
      code: 'registration_authority_unavailable',
      message: 'Registration reservation authority is required',
    };
  return authority.admitHome(input);
}
