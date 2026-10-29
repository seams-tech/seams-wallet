import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { requireRecord } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';
import type { WalletSessionLocatorPublication } from '../../../authorization/sessionRouting';
import type { CommittedWalletRegistration } from '../../../authorization/domain';
import type { D1PreparedStatementLike } from '../../../storage/tenantRoute';
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
import type { RouterAbEd25519YaoActivationAdmissionReceiptV1, RouterAbEd25519YaoRegistrationAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';

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
      /** The ownership generation the reserved wallet's custody objects are named by. */
      readonly ownershipGeneration: number;
      readonly lifecycle: 'reserved' | 'established';
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly reservation?: never;
      readonly ownershipGeneration?: never;
      readonly lifecycle?: never;
    };

/** Persist custody addresses before setup completes, then start the reserved wallet objects. */
export type RegistrationWalletStartup = {
  readonly walletId: WalletId;
  readonly ownershipGeneration: number;
} & (
  | { readonly kind: 'objects'; readonly admissionRequest?: never; readonly admissionReceipt?: never; readonly expiresAtMs?: never }
  | {
      readonly kind: 'pair';
      readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
      readonly admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
      readonly expiresAtMs: number;
    }
);

export type RegistrationPairStartup = Variant<RegistrationWalletStartup, 'kind', 'pair'>;

export type RegistrationWalletStarter = (registration: RegistrationWalletStartup) => Promise<void>;

export type RegistrationSessionPublication =
  | { readonly kind: 'none'; readonly walletId?: never; readonly digest?: never; readonly expiresAtMs?: never }
  | (WalletSessionLocatorPublication & { readonly kind: 'credential' });

type ReservationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

type RegistrationHomeAdmission<
  Purpose extends 'registration' | 'ordinary' = 'registration' | 'ordinary',
> =
  | {
      readonly ok: true;
      readonly ownershipGeneration: number;
      readonly purpose: Purpose;
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly ownershipGeneration?: never;
      readonly purpose?: never;
    };

export interface WalletExecutionAuthority {
  admitEstablishedHome(input: {
    readonly walletId: WalletId;
  }): Promise<RegistrationHomeAdmission<'ordinary'>>;
}

export interface WalletRegistrationReservationAuthority {
  reserve(input: WalletRegistrationSetupInput): Promise<WalletRegistrationSetupReservationResult>;
  admitHome(input: {
    readonly ceremonyId: string;
    readonly walletId: WalletId;
  }): Promise<RegistrationHomeAdmission>;
  complete(
    input: {
      readonly ceremonyId: string;
      readonly walletId: WalletId;
    } & (
      | {
          readonly outcome: 'established';
          readonly session: RegistrationSessionPublication;
        }
      | { readonly outcome: 'cancelled'; readonly session?: never }
    ),
  ): Promise<ReservationOutcome>;
}

/**
 * The local write that makes an established registration active and records
 * its directory publication as pending. It commits in the batch of the record
 * that completes the registration operation, or it does not commit.
 */
export type RegistrationActivationWrite = {
  readonly statements: readonly D1PreparedStatementLike[];
  /**
   * Sends the pending directory publication. Call it only after the statements
   * commit. It never throws: a failed delivery stays pending for the next attempt.
   */
  readonly publish: () => Promise<void>;
};

/** The registration authority at the wallet's home, which owns the local activation. */
export interface WalletRegistrationHomeAuthority extends Pick<
  WalletRegistrationReservationAuthority,
  'reserve' | 'admitHome'
> {
  /**
   * Prepares the activation of the committed registration decision with its
   * pending directory publication. None when an earlier completion already
   * activated the registration. The caller commits the activation with its
   * completion record, then publishes.
   */
  prepareEstablished(input: {
    readonly registration: CommittedWalletRegistration;
    readonly session: RegistrationSessionPublication;
  }): RegistrationActivationWrite | null;
  /** Fixes a definitive cancellation, publishes it, and retires the local home. */
  cancel(input: {
    readonly ceremonyId: string;
    readonly walletId: WalletId;
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
  input: Pick<WalletRegistrationSetupInput, 'request'>,
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
  input: Pick<
    WalletRegistrationSetupInput,
    'request' | 'orgId' | 'expectedOrigin' | 'runtimePolicyScope'
  >,
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
      completion: input.request.completion,
      authMethod: input.request.authMethod,
      signerSelection: input.request.signerSelection,
    }),
  );
}

export async function cancelRegistrationHome(
  authority: Pick<WalletRegistrationHomeAuthority, 'cancel'> | null,
  input: Parameters<WalletRegistrationHomeAuthority['cancel']>[0],
): Promise<ReservationOutcome> {
  if (!authority)
    return {
      ok: false,
      code: 'registration_authority_unavailable',
      message: 'Registration reservation authority is required',
    };
  return authority.cancel(input);
}

export async function admitRegistrationReservationHome(
  authority: Pick<WalletRegistrationReservationAuthority, 'admitHome'> | null,
  input: Parameters<WalletRegistrationReservationAuthority['admitHome']>[0],
): Promise<RegistrationHomeAdmission> {
  if (!authority)
    return {
      ok: false,
      code: 'registration_authority_unavailable',
      message: 'Registration reservation authority is required',
    };
  return authority.admitHome(input);
}

export function parseRegistrationSessionPublication(raw: unknown, walletId: WalletId): RegistrationSessionPublication {
  const value = requireRecord(raw, 'registration session publication');
  if (value.kind === 'none') return { kind: 'none' };
  if (value.kind !== 'credential' || value.walletId !== String(walletId)) throw new Error('Invalid registration session publication');
  const expiresAtMs = value.expiresAtMs;
  if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) throw new Error('Invalid registration session publication expiry');
  return { kind: 'credential', walletId, digest: parseDigestB64u(value.digest), expiresAtMs };
}
