/**
 * The contract between the intended-behaviour page and the harness that drives it.
 *
 * The harness clicks an action's button, waits for `intended-action-status` to settle, and reads
 * the page state from `intended-result-json`. This file names each action and its button, the
 * results and state the page writes, and the helpers the page puts on `window`. The page writes
 * these types and the harness parses into them, so a change on one side fails the other's
 * type check.
 */
import type {
  WalletMoveRequest,
  WalletMoveStatusResult,
  WalletSession,
} from '@seams/mpc-wallet/client';
import type { Variant } from '@shared/utils/variant';
import type { RecoveryAdministrationProbe } from './recoveryAdministrationProbe';

/**
 * Each action the page runs, with the test id and label of the button that starts it, in the
 * order the page shows them.
 */
export const INTENDED_ACTIONS = {
  registerPasskeyWallet: { button: 'intended-register-passkey', label: 'Register Passkey' },
  registerPasskeyEcdsaOnlyWallet: {
    button: 'intended-register-passkey-ecdsa-only',
    label: 'Register ECDSA-only Wallet',
  },
  registerPasskeyEd25519YaoWallet: {
    button: 'intended-register-passkey-ed25519-yao',
    label: 'Register Passkey Ed25519 Yao',
  },
  addEmailOtpAuthMethod: { button: 'intended-add-email-otp-auth-method', label: 'Add Email Code' },
  revokeSourceAuthMethod: {
    button: 'intended-revoke-source-auth-method',
    label: 'Revoke Source Method',
  },
  unlockWithAddedEmailOtp: {
    button: 'intended-unlock-added-email-otp',
    label: 'Unlock With Added Email Code',
  },
  addPasskeyAuthMethod: { button: 'intended-add-passkey-auth-method', label: 'Add Passkey' },
  addPasskeyEd25519YaoWalletSigner: {
    button: 'intended-add-passkey-ed25519-yao-signer',
    label: 'Add Passkey Ed25519 Yao Signer',
  },
  addPasskeyEcdsaWalletSigner: {
    button: 'intended-add-passkey-ecdsa-signer',
    label: 'Add Passkey ECDSA Signer',
  },
  registerEmailOtpEcdsaOnlyWallet: {
    button: 'intended-register-email-otp-ecdsa-only',
    label: 'Register ECDSA-only Email Wallet',
  },
  registerEmailOtpEd25519OnlyWallet: {
    button: 'intended-register-email-otp-ed25519-only',
    label: 'Register Ed25519-only Email Wallet',
  },
  registerEmailOtpWallet: { button: 'intended-register-email-otp', label: 'Register Email OTP' },
  awaitNearReady: { button: 'intended-await-near-ready', label: 'Await NEAR Ready' },
  signNearTransaction: { button: 'intended-sign-near', label: 'Sign NEAR' },
  syncPasskeyWallet: { button: 'intended-sync-passkey', label: 'Sync Passkey' },
  recoverPasskeyWallet: { button: 'intended-recover-passkey', label: 'Recover Passkey' },
  recoverGoogleEmailOtpWallet: {
    button: 'intended-recover-google-email-otp',
    label: 'Recover Google Email OTP',
  },
  unlockPasskeyWallet: { button: 'intended-unlock-passkey', label: 'Unlock Passkey' },
  unlockEmailOtpWallet: { button: 'intended-unlock-email-otp', label: 'Unlock Email OTP' },
  signTempoTransaction: { button: 'intended-sign-tempo', label: 'Sign Tempo' },
  signArcEvmTransaction: { button: 'intended-sign-arc-evm', label: 'Sign Arc' },
  exportEd25519Key: { button: 'intended-export-ed25519', label: 'Export Ed25519' },
  exportEcdsaKey: { button: 'intended-export-ecdsa', label: 'Export ECDSA' },
  startDeviceLinkingAsTarget: { button: 'intended-device-link-start', label: 'Show Link QR' },
  scanAndLinkDevice: { button: 'intended-device-link-scan', label: 'Scan Link QR' },
  revokeLinkedDevice: { button: 'intended-revoke-linked-device', label: 'Revoke Linked Device' },
  revokeLinkedDeviceWithEmailOtp: {
    button: 'intended-revoke-linked-device-email-otp',
    label: 'Revoke Linked Device With Email Code',
  },
} as const;

export type IntendedActionName = keyof typeof INTENDED_ACTIONS;

export function isIntendedActionName(value: string): value is IntendedActionName {
  return Object.hasOwn(INTENDED_ACTIONS, value);
}

export const INTENDED_ACTION_NAMES: readonly IntendedActionName[] =
  Object.keys(INTENDED_ACTIONS).filter(isIntendedActionName);

export type IntendedLifecycleEvent = {
  index: number;
  payload: unknown;
};

export type IntendedEcdsaTargetKeySummary = {
  chain: 'tempo' | 'arc_evm';
  chainId: number;
  thresholdOwnerAddress: string;
};

export type IntendedEcdsaTargetProfileName = 'none' | 'tempo' | 'tempo_arc';

export type IntendedEcdsaTargetKeysSummary =
  | {
      kind: 'none';
      tempo?: never;
      arcEvm?: never;
    }
  | {
      kind: 'tempo';
      tempo: IntendedEcdsaTargetKeySummary;
      arcEvm?: never;
    }
  | {
      kind: 'tempo_arc';
      tempo: IntendedEcdsaTargetKeySummary;
      arcEvm: IntendedEcdsaTargetKeySummary;
    };

export type IntendedEcdsaSessionSummary =
  | {
      ecdsaTargetProfile: 'none';
      thresholdEcdsaEthereumAddress?: never;
      thresholdEcdsaPublicKeyB64u?: never;
    }
  | {
      ecdsaTargetProfile: 'tempo';
      thresholdEcdsaEthereumAddress: string;
      thresholdEcdsaPublicKeyB64u: string;
    }
  | {
      ecdsaTargetProfile: 'tempo_arc';
      thresholdEcdsaEthereumAddress: string;
      thresholdEcdsaPublicKeyB64u: string;
    };

/** The ECDSA session of a profile, with the per-target keys of that same profile. */
export type IntendedEcdsaSummary =
  | (Variant<IntendedEcdsaSessionSummary, 'ecdsaTargetProfile', 'none'> & {
      ecdsaTargetKeys: Variant<IntendedEcdsaTargetKeysSummary, 'kind', 'none'>;
    })
  | (Variant<IntendedEcdsaSessionSummary, 'ecdsaTargetProfile', 'tempo'> & {
      ecdsaTargetKeys: Variant<IntendedEcdsaTargetKeysSummary, 'kind', 'tempo'>;
    })
  | (Variant<IntendedEcdsaSessionSummary, 'ecdsaTargetProfile', 'tempo_arc'> & {
      ecdsaTargetKeys: Variant<IntendedEcdsaTargetKeysSummary, 'kind', 'tempo_arc'>;
    });

export type IntendedNearProvisioningSummary =
  | { status: 'pending'; error?: never; errorCode?: never }
  | { status: 'provisioning'; error?: never; errorCode?: never }
  | { status: 'retryable'; error: string; errorCode: string };

/**
 * What a passkey registration can assert at return time depends on whether it
 * had a NEAR branch and whether that branch settled.
 * A NEAR-only plan resolves with its identity; a mixed plan resolves
 * ECDSA-ready with NEAR still provisioning, so no NEAR identifier exists yet.
 * Modelled as a closed union so neither branch can borrow the other's fields.
 */
/* Three readiness states, discriminated explicitly. 'absent' is a wallet whose
   signer set never included Ed25519: nothing is coming, unlike 'pending'. It
   forbids the identity and provisioning fields rather than leaving them
   optional, so a NEAR-less wallet cannot quietly carry a half-filled identity
   and no caller has to guess which of the three it holds. */
export type PasskeyRegistrationCoreSummary = (
  | {
      kind: 'passkey_registration_success';
      walletId: string;
      nearReadiness: 'ready';
      nearAccountId: string;
      nearEd25519SigningKeyId: string;
      operationalPublicKey: string;
      nearProvisioning?: never;
    }
  | {
      kind: 'passkey_registration_success';
      walletId: string;
      nearReadiness: 'pending';
      nearProvisioning: IntendedNearProvisioningSummary;
      nearAccountId?: never;
      nearEd25519SigningKeyId?: never;
      operationalPublicKey?: never;
    }
  | {
      kind: 'passkey_registration_success';
      walletId: string;
      nearReadiness: 'absent';
      nearAccountId?: never;
      nearEd25519SigningKeyId?: never;
      operationalPublicKey?: never;
      nearProvisioning?: never;
    }
) &
  IntendedEcdsaSessionSummary;

export type PasskeyRegistrationResultSummary = PasskeyRegistrationCoreSummary &
  IntendedEcdsaSummary;

export type Ed25519AddSignerResultSummary = {
  kind: 'wallet_signer_added';
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  operationalPublicKey: string;
};

/** The ECDSA signer an existing wallet gained, with its per-target keys. */
export type EcdsaAddSignerResultSummary = {
  kind: 'ecdsa_signer_added';
  walletId: string;
} & IntendedEcdsaSummary;

type AddEmailOtpAuthMethodResultSummary = {
  kind: 'add_email_otp_success';
  walletAuthMethodId: string;
  walletId: string;
  emailAddress: string;
  authMethod: { kind: 'email_otp'; status: 'active' };
};

type AddPasskeyAuthMethodResultSummary = {
  kind: 'add_passkey_success';
  walletId: string;
  rpId: string;
  walletAuthMethodId: string;
  authMethod: { kind: 'passkey'; status: 'active' };
};

/* Same three readiness states as the passkey summary, for the same reason: an
   Email OTP wallet can own an ECDSA-only signer set too. */
export type EmailOtpRegistrationCoreSummary = (
  | {
      kind: 'email_otp_registration_success';
      initialWalletId: string;
      walletId: string;
      nearReadiness: 'ready';
      nearAccountId: string;
      operationalPublicKey: string;
      nearProvisioning?: never;
      authenticationKind: 'authenticated';
    }
  | {
      kind: 'email_otp_registration_success';
      initialWalletId: string;
      walletId: string;
      nearReadiness: 'pending';
      nearProvisioning: IntendedNearProvisioningSummary;
      nearAccountId?: never;
      operationalPublicKey?: never;
      authenticationKind: 'authenticated';
    }
  | {
      kind: 'email_otp_registration_success';
      initialWalletId: string;
      walletId: string;
      nearReadiness: 'absent';
      nearAccountId?: never;
      operationalPublicKey?: never;
      nearProvisioning?: never;
      authenticationKind: 'authenticated';
    }
) &
  IntendedEcdsaSessionSummary;

export type EmailOtpRegistrationResultSummary = EmailOtpRegistrationCoreSummary &
  IntendedEcdsaSummary;

export type NearSigningResultSummary = {
  kind: 'near_sign_success';
  walletId: string;
  nearAccountId: string;
  signedTransactionB64: string;
  signedTransactionByteLength: number;
};

export type PasskeyUnlockResultSummary =
  | {
      kind: 'passkey_unlock_success';
      walletId: string;
      nearIdentity: 'ready';
      nearAccountId: string;
      operationalPublicKey: string;
      /** The exact credential selected by the resolved capability projection. */
      sessionWalletAuthMethodId: string;
      authenticationKind: 'authenticated';
    }
  | {
      kind: 'passkey_unlock_success';
      walletId: string;
      nearIdentity: 'absent';
      nearAccountId?: never;
      operationalPublicKey?: never;
      /** The exact credential selected by the resolved capability projection. */
      sessionWalletAuthMethodId: string;
      authenticationKind: 'authenticated';
    };

type PasskeySyncResultSummary = {
  kind: 'passkey_sync_success';
  walletId: string;
  nearAccountId: string;
  operationalPublicKey: string;
};

/** Whether an Email OTP unlock opened a NEAR identity. */
export type EmailOtpUnlockNearIdentity =
  | { nearIdentity: 'ready'; nearAccountId: string; operationalPublicKey: string }
  | { nearIdentity: 'absent'; nearAccountId?: never; operationalPublicKey?: never };

export type EmailOtpUnlockCoreSummary = {
  kind: 'email_otp_unlock_success';
  walletId: string;
  sessionWalletAuthMethodId: string;
  authenticationKind: 'authenticated';
} & IntendedEcdsaSessionSummary &
  EmailOtpUnlockNearIdentity;

export type EmailOtpUnlockResultSummary = EmailOtpUnlockCoreSummary & IntendedEcdsaSummary;

type RevokeAuthMethodResultSummary = {
  kind: 'revoke_auth_method_success';
  walletId: string;
  walletAuthMethodId: string;
};

/**
 * The Email OTP method just added opened its wallet.
 *
 * The hosted Google flow names the selected wallet and returns through its
 * address-backed Email OTP method. This summary keeps the exact method id so
 * the contract proves the added credential issued the active session.
 */
type AddedEmailOtpUnlockResultSummary = {
  kind: 'added_email_otp_unlock_success';
  walletId: string;
  /** The exact credential selected by the resolved capability projection. */
  sessionWalletAuthMethodId: string;
  authenticationKind: 'authenticated';
};

export type TempoSigningResultSummary = {
  kind: 'tempo_sign_success';
  walletId: string;
  chainId: number;
  senderHashHex: `0x${string}`;
  rawTxHex: `0x${string}`;
};

export type ArcEvmSigningResultSummary = {
  kind: 'arc_evm_sign_success';
  walletId: string;
  chainId: number;
  txHashHex: `0x${string}`;
  rawTxHex: `0x${string}`;
};

export type EcdsaExportResultSummary = {
  kind: 'ecdsa_export_success';
  walletId: string;
  chainId: number;
};

export type Ed25519ExportResultSummary = {
  kind: 'ed25519_export_success';
  walletId: string;
  nearAccountId: string;
};

type NearProvisioningReadySummary = {
  kind: 'near_provisioning_ready';
  walletId: string;
  nearAccountId: string;
  operationalPublicKey: string;
};

type PasskeyRecoveryResultSummary = {
  kind: 'passkey_recovery_success';
  walletId: string;
  activeRecoveryCodeCount: number;
  totalRecoveryCodeCount: number;
};

type GoogleEmailOtpRecoveryResultSummary = {
  kind: 'google_email_otp_recovery_success';
  walletId: string;
  activeRecoveryCodeCount: number;
  totalRecoveryCodeCount: number;
};

/**
 * Device 2 is showing its link QR. The payload is what Device 1 scans; the
 * flow keeps running on this page until the link activates or fails.
 */
type DeviceLinkQrReadySummary = {
  kind: 'device_link_qr_ready';
  linkSessionId: string;
  qrPayloadJson: string;
};

/** Device 1 approved the scanned device and recorded its source contribution. */
type DeviceLinkApprovalRecordedSummary = {
  kind: 'device_link_approval_recorded';
  walletId: string;
  enrollmentId: string;
  deviceId: string;
};

type LinkedDeviceRevokedSummary = {
  kind: 'linked_device_revoked';
  walletId: string;
  walletAuthMethodId: string;
  authorityId: string;
  revocationEpoch: number;
};

export type IntendedActionResult =
  | DeviceLinkQrReadySummary
  | DeviceLinkApprovalRecordedSummary
  | LinkedDeviceRevokedSummary
  | PasskeyRegistrationResultSummary
  | Ed25519AddSignerResultSummary
  | EcdsaAddSignerResultSummary
  | AddEmailOtpAuthMethodResultSummary
  | AddPasskeyAuthMethodResultSummary
  | EmailOtpRegistrationResultSummary
  | NearProvisioningReadySummary
  | PasskeyRecoveryResultSummary
  | GoogleEmailOtpRecoveryResultSummary
  | NearSigningResultSummary
  | PasskeySyncResultSummary
  | PasskeyUnlockResultSummary
  | EmailOtpUnlockResultSummary
  | AddedEmailOtpUnlockResultSummary
  | RevokeAuthMethodResultSummary
  | TempoSigningResultSummary
  | ArcEvmSigningResultSummary
  | Ed25519ExportResultSummary
  | EcdsaExportResultSummary;

/** The result of one kind. */
export type IntendedResult<K extends IntendedActionResult['kind']> = Variant<
  IntendedActionResult,
  'kind',
  K
>;

export type IntendedActionState =
  | {
      status: 'idle';
      action?: never;
      result?: never;
      error?: never;
    }
  | {
      status: 'running';
      action: IntendedActionName;
      result?: never;
      error?: never;
    }
  | {
      status: 'success';
      action: IntendedActionName;
      result: IntendedActionResult;
      error?: never;
    }
  | {
      status: 'error';
      action: IntendedActionName;
      error: string;
      result?: never;
    };

/**
 * Device 2's side of a link, which outlives the action that showed the QR.
 *
 * `active` means Device 2 created its own passkey, installed its authority,
 * and holds its own Wallet Session. The NEAR identity is read from that
 * session, not from Device 1, so the contract can prove the public signer
 * identity carried over.
 */
export type IntendedDeviceLinkState =
  | { status: 'none' }
  | { status: 'awaiting_owner'; linkSessionId: string }
  | {
      status: 'active';
      linkSessionId: string;
      walletId: string;
      enrollmentId: string;
      sessionWalletAuthMethodId: string;
      /* Null for a wallet whose signer set has no Ed25519. */
      nearAccountId: string | null;
      operationalPublicKey: string | null;
      authenticationKind: 'authenticated';
    }
  | { status: 'failed'; linkSessionId: string; error: string };

/** The page state that `intended-result-json` shows. */
export type IntendedPageState = {
  action: IntendedActionState;
  events: readonly IntendedLifecycleEvent[];
  walletId: string;
  nearAccountId: string | null;
  nearSignerSlot: number;
  deviceLink: IntendedDeviceLinkState;
};

export type IntendedEmailOtpCodeRequest =
  | {
      kind: 'challenge';
      challengeId: string;
      walletId: string;
    }
  | {
      kind: 'latest_for_wallet';
      walletId: string;
      challengeId?: never;
    };

export type IntendedEmailOtpRecoveryRotationResult = {
  readonly kind: 'rotated';
  readonly issuedAtMs: number;
  readonly storeVersion: string;
  readonly recoveryCodeCount: number;
};

declare global {
  interface Window {
    __seamsIntendedE2EReadEmailOtpCode?: (input: IntendedEmailOtpCodeRequest) => Promise<string>;
    __seamsIntendedE2ELockWallet?: () => Promise<void>;
    __seamsIntendedE2EMoveWallet?: (request: WalletMoveRequest) => Promise<WalletMoveStatusResult>;
    __seamsIntendedE2EReadWalletMove?: (moveId: string) => Promise<WalletMoveStatusResult>;
    __seamsIntendedE2ECancelDeviceLink?: () => Promise<void>;
    __seamsIntendedE2EReadWalletLockState?: () => Promise<{
      authenticationKind: WalletSession['authentication']['kind'];
    }>;
    __seamsIntendedE2EReadAuthenticationMethods?: () => Promise<{
      ownerDeviceCount: number;
      linkedDeviceCount: number;
    }>;
    /** The linked-device inventory, parsed strictly by the contract. */
    __seamsIntendedE2EReadLinkedDevices?: () => Promise<unknown>;
    __seamsIntendedE2EProbeRecoveryAdministration?: () => Promise<RecoveryAdministrationProbe>;
    __seamsIntendedE2ERotateEmailOtpRecoveryCodes?: () => Promise<IntendedEmailOtpRecoveryRotationResult>;
    /** The QR payload Device 1 "scans"; the contract has no camera. */
    __seamsIntendedE2EDeviceLinkQrPayloadJson?: string;
    /** The exact revocation Device 1 submits, with its fresh source proof. */
    __seamsIntendedE2ELinkedDeviceRevocationJson?: string;
  }
}
