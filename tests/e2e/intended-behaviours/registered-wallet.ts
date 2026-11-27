import type { Variant } from '@shared/utils/variant';
import type {
  IntendedEcdsaSummary,
  IntendedNearProvisioningSummary,
  IntendedResult,
} from '../../intended-app/src/intendedContract';
import { assertNever } from './harness-validation';

export type RegisteredNearStateSnapshot =
  /* A wallet whose signer set never included Ed25519. Distinct from 'pending',
     which is an account on its way: nothing is coming, so asking this wallet to
     sign NEAR is a test-authoring mistake rather than a wait. The identity and
     provisioning fields are forbidden rather than optional, so a NEAR-less
     wallet cannot carry a half-filled identity. */
  | {
      nearReadiness: 'absent';
      nearProvisioning?: never;
      nearAccountId?: never;
      operationalPublicKey?: never;
    }
  | {
      nearReadiness: 'pending';
      nearProvisioning: IntendedNearProvisioningSummary;
      nearAccountId?: never;
      operationalPublicKey?: never;
    }
  | {
      nearReadiness: 'ready';
      nearProvisioning?: never;
      nearAccountId: string;
      operationalPublicKey: string;
    };

/**
 * What to call a wallet's NEAR state in a log line when it is not ready.
 *
 * Only 'pending' carries a provisioning record - 'absent' has nothing coming,
 * so there is no status to report and the readiness itself is the answer.
 */
export function nearStateLabel(snapshot: RegisteredNearStateSnapshot): string {
  return snapshot.nearReadiness === 'pending'
    ? snapshot.nearProvisioning.status
    : snapshot.nearReadiness;
}

/**
 * What the harness knows of the wallet it registered: the registration's result, with the NEAR
 * identity that a later step reported once provisioning finished.
 */
export type RegisteredWalletSnapshot =
  | ({ kind: 'passkey_registration_success'; walletId: string } & RegisteredNearStateSnapshot &
      IntendedEcdsaSummary)
  | ({
      kind: 'email_otp_registration_success';
      initialWalletId: string;
      walletId: string;
      authenticationKind: 'authenticated';
    } & RegisteredNearStateSnapshot &
      IntendedEcdsaSummary);

type PasskeyRegisteredWallet = Variant<
  RegisteredWalletSnapshot,
  'kind',
  'passkey_registration_success'
>;

type EmailOtpRegisteredWallet = Variant<
  RegisteredWalletSnapshot,
  'kind',
  'email_otp_registration_success'
>;

export type NearReadyRegisteredWalletSnapshot = RegisteredWalletSnapshot &
  Variant<RegisteredNearStateSnapshot, 'nearReadiness', 'ready'>;

export function requireEmailOtpRegisteredWalletSnapshot(
  registration: RegisteredWalletSnapshot,
): EmailOtpRegisteredWallet {
  if (registration.kind === 'email_otp_registration_success') return registration;
  throw new Error('Email OTP unlock requires an Email OTP registration snapshot');
}

export function requirePasskeyRegisteredWalletSnapshot(
  registration: RegisteredWalletSnapshot,
): PasskeyRegisteredWallet {
  switch (registration.kind) {
    case 'passkey_registration_success':
      return registration;
    case 'email_otp_registration_success':
      throw new Error('Passkey signer addition requires a passkey-registered wallet');
    default:
      return assertNever(registration);
  }
}

/**
 * Linking pins the source signer manifest, so a wallet with an Ed25519
 * signer must have it before a device approves; a wallet without one has
 * nothing to wait for.
 */
export function requireLinkableRegisteredWallet(
  registration: RegisteredWalletSnapshot,
): RegisteredWalletSnapshot {
  if (registration.nearReadiness === 'pending') {
    throw new Error(
      `Device linking requires NEAR readiness; current state is ${nearStateLabel(registration)}`,
    );
  }
  return registration;
}

export function requireNearReadyRegisteredWallet(
  registration: RegisteredWalletSnapshot,
  operation: string,
): NearReadyRegisteredWalletSnapshot {
  if (registration.nearReadiness === 'ready') return registration;
  throw new Error(
    `${operation} requires NEAR readiness; current state is ${nearStateLabel(registration)}`,
  );
}

export function registeredWalletWithNearReady(
  registration: RegisteredWalletSnapshot,
  ready: IntendedResult<'near_provisioning_ready'>,
): NearReadyRegisteredWalletSnapshot {
  const near = {
    nearReadiness: 'ready' as const,
    nearAccountId: ready.nearAccountId,
    operationalPublicKey: ready.operationalPublicKey,
  };
  const ecdsa = ecdsaSummaryOf(registration);
  switch (registration.kind) {
    case 'passkey_registration_success':
      return { kind: registration.kind, walletId: registration.walletId, ...near, ...ecdsa };
    case 'email_otp_registration_success':
      return {
        kind: registration.kind,
        initialWalletId: registration.initialWalletId,
        walletId: registration.walletId,
        ...near,
        authenticationKind: registration.authenticationKind,
        ...ecdsa,
      };
    default:
      return assertNever(registration);
  }
}

/** The ECDSA fields of a summary, without the fields it shares with its wallet. */
function ecdsaSummaryOf(summary: IntendedEcdsaSummary): IntendedEcdsaSummary {
  switch (summary.ecdsaTargetProfile) {
    case 'none':
      return { ecdsaTargetProfile: 'none', ecdsaTargetKeys: summary.ecdsaTargetKeys };
    case 'tempo':
      return {
        ecdsaTargetProfile: 'tempo',
        thresholdEcdsaEthereumAddress: summary.thresholdEcdsaEthereumAddress,
        thresholdEcdsaPublicKeyB64u: summary.thresholdEcdsaPublicKeyB64u,
        ecdsaTargetKeys: summary.ecdsaTargetKeys,
      };
    case 'tempo_arc':
      return {
        ecdsaTargetProfile: 'tempo_arc',
        thresholdEcdsaEthereumAddress: summary.thresholdEcdsaEthereumAddress,
        thresholdEcdsaPublicKeyB64u: summary.thresholdEcdsaPublicKeyB64u,
        ecdsaTargetKeys: summary.ecdsaTargetKeys,
      };
    default:
      return assertNever(summary);
  }
}
