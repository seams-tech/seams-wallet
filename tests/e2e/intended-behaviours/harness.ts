import { IntendedActionTiming } from './signing-timing-evidence';
import { parseExactWalletSessionStatusResponse } from '../../../packages/wallet/src/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import {
  parseWalletSessionId,
  parseMpcWalletSigningQuotaId,
} from '@shared/authorization/capabilityKinds';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Frame,
  type FrameLocator,
  type Locator,
  type Page,
  type Request,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import * as ed25519 from '@noble/ed25519';
import { base58Decode, base64UrlEncode } from '@shared/utils/encoders';
import { decodeWalletRecoveryCode } from '@shared/wallet-recovery/recoveryCodes';
import { computeWalletAuthMethodRevokeOperationFingerprintV1 } from '@shared/utils/walletAuthMethodRecord';
import { createReadableWalletId, walletIdFromString } from '@shared/utils/registrationIds';
import { parseWalletAuthMethodId } from '@shared/utils/domainIds';
import { parseQrLinkedDeviceSessionPayloadV5 } from '@shared/device-linking/parsers';
import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import type { WalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  describeUsableGoogleIdToken,
  resolveGoogleClientId,
} from '../../scripts/intended-google-oidc-env.mjs';
import {
  getAddress,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
} from 'viem';

export type IntendedLifecycleFlow =
  | 'passkey.registration'
  | 'passkey.unlock'
  | 'passkey.recovery'
  | 'email_otp.registration'
  | 'email_otp.unlock'
  | 'email_otp.recovery';

export type IntendedRecoveryTargetKind = WalletRecoveryTargetV1['kind'];

export type IntendedChainTarget = 'near' | 'tempo' | 'arc_evm';

export type IntendedSigningStage =
  | 'post_registration'
  | 'post_unlock'
  | 'post_device_link'
  | 'after_refresh_recovery'
  | 'step_up_required';

type IntendedWarmSessionOriginStage = Extract<
  IntendedSigningStage,
  'post_registration' | 'post_unlock'
>;

type IntendedNearSigningStage = Exclude<IntendedSigningStage, 'after_refresh_recovery'>;

type IntendedNoYaoRecoveryAssertionScenario =
  | { kind: 'passkey_unlock' }
  | { kind: 'email_otp_unlock' }
  | { kind: 'post_refresh_near_signing' };

type IntendedNearSigningScenario =
  | {
      kind: 'standard';
      stage: IntendedNearSigningStage;
      postRefreshMaterialSource?: never;
    }
  | {
      kind: 'post_refresh';
      stage: 'after_refresh_recovery';
      postRefreshMaterialSource?: never;
    };

type IntendedHarnessAction =
  | 'registerPasskeyWallet'
  | 'registerPasskeyEd25519YaoWallet'
  | 'registerPasskeyEcdsaOnlyWallet'
  | 'addPasskeyEd25519YaoWalletSigner'
  | 'addPasskeyEcdsaWalletSigner'
  | 'addEmailOtpAuthMethod'
  | 'addPasskeyAuthMethod'
  | 'registerEmailOtpWallet'
  | 'registerEmailOtpEd25519OnlyWallet'
  | 'registerEmailOtpEcdsaOnlyWallet'
  | 'awaitNearReady'
  | 'syncPasskeyWallet'
  | 'recoverPasskeyWallet'
  | 'recoverGoogleEmailOtpWallet'
  | 'unlockPasskeyWallet'
  | 'unlockEmailOtpWallet'
  | 'unlockWithAddedEmailOtp'
  | 'revokeSourceAuthMethod'
  | 'signNearTransaction'
  | 'signTempoTransaction'
  | 'signArcEvmTransaction'
  | 'exportEd25519Key'
  | 'exportEcdsaKey'
  | 'startDeviceLinkingAsTarget'
  | 'scanAndLinkDevice'
  | 'revokeLinkedDevice'
  | 'revokeLinkedDeviceWithEmailOtp';

const GOOGLE_ID_TOKEN_ACTIONS: ReadonlySet<IntendedHarnessAction> = new Set([
  'addEmailOtpAuthMethod',
  'registerEmailOtpWallet',
  'registerEmailOtpEd25519OnlyWallet',
  'registerEmailOtpEcdsaOnlyWallet',
  'unlockWithAddedEmailOtp',
  'unlockEmailOtpWallet',
  'revokeLinkedDeviceWithEmailOtp',
]);

/** Test hooks into one signing action's lifecycle. */
type IntendedSigningActionHooks = {
  /** Runs as soon as the page reports the action started. */
  readonly onActionStarted?: () => void;
};

type TraceEntry = {
  atMs: number;
  kind: 'stage' | 'console' | 'pageerror' | 'request' | 'requestfailed' | 'response' | 'service';
  message: string;
  url?: string;
  status?: number;
};

const WEB_AUTHN_VIRTUAL_AUTHENTICATOR_OPTIONS = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  hasPrf: true,
  automaticPresenceSimulation: true,
} as const;

function requireWebAuthnAuthenticatorId(raw: unknown): string {
  const response = requireRecord(raw, 'WebAuthn virtual authenticator response');
  return requireString(response.authenticatorId, 'WebAuthn virtual authenticator id');
}

async function addWebAuthnVirtualAuthenticator(client: CDPSession): Promise<string> {
  const response = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: WEB_AUTHN_VIRTUAL_AUTHENTICATOR_OPTIONS,
  });
  return requireWebAuthnAuthenticatorId(response);
}

const ROUTER_AB_ED25519_SIGNING_PATHS = [
  '/router-ab/ed25519/sign/prepare',
  '/router-ab/ed25519/sign',
] as const;

const ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS = [
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
] as const;

const LOCAL_INTENDED_YAO_FAULT_HEADER_V1 = 'x-seams-intended-yao-fault-v1';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-yao-fault-token-v1';
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
const LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1 = 'x-seams-intended-yao-finalize-fault-v1';
const LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-finalize-fault-token-v1';
const WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1 = '/wallets/register/near-provisioning';
const LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1 = 'x-seams-intended-yao-recovery-fault-v1';
const LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-recovery-fault-token-v1';
const LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1 = 'x-seams-intended-yao-signing-fault-v1';
const LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-signing-fault-token-v1';
const ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH = '/router-ab/ed25519/sign';
const GOOGLE_EMAIL_OTP_VERIFY_PATH_V1 = '/auth/google/verify';
/* The Gateway steps of an Email OTP unlock after Google verification. */
const EMAIL_OTP_UNLOCK_GATEWAY_PATHS_V1: ReadonlySet<string> = new Set([
  '/wallet/email-otp/challenge',
  '/wallet/email-otp/factor-release',
  '/wallet/unlock/verify',
]);
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1 = 'x-seams-intended-link-execute-fault-v1';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-link-execute-fault-token-v1';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-link-execute-fault-proof-v1';
const LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1 = 'x-seams-intended-revoke-fault-v1';
const LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-revoke-fault-token-v1';
const LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-revoke-fault-proof-v1';
/* The SigningWorker's refusal of an activation a recovery replaced. */
const SIGNING_WORKER_ACTIVATION_RETIRED_MESSAGE = 'SigningWorker activation is retired';
const SIGNING_WORKER_ACTIVATION_RETIRED_AT_COMMIT_MESSAGE =
  'SigningWorker activation is retired: retired after this finalize loaded its material, before it committed';
const LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1 = 'x-seams-intended-yao-export-fault-v1';
const LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-export-fault-token-v1';
/* The Gateway's side-effect journal lets a retry take an unfinished NEAR
   finalize over only after this long. */
const WALLET_REGISTRATION_NEAR_PROVISIONING_RESUME_AFTER_MS = 30_000;
const LOCAL_INTENDED_YAO_ROUTER_ORIGIN_V1 = 'http://127.0.0.1:4100';

type IntendedYaoFaultModeV1 = 'drop_router_response_once' | 'return_terminal_burned_once';

type IntendedYaoFaultProofV1 =
  | 'exact_request_replayed'
  | 'terminal_failure_not_retried'
  | 'decision_committed_then_storage_lost'
  | 'recovery_replies_lost_after_router_executed'
  | 'recovery_execute_withheld'
  | 'export_authorization_committed_then_storage_lost'
  | 'signing_finalize_captured'
  | 'signing_finalize_withheld';

type IntendedYaoFaultInjectionStateV1 =
  | {
      readonly kind: 'idle';
    }
  | {
      readonly kind: 'armed';
      readonly mode: IntendedYaoFaultModeV1;
      readonly token: string;
    };

const ROUTER_AB_ED25519_YAO_RECOVERY_PATHS = [
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
] as const;

const ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS = [
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
  ...ROUTER_AB_ED25519_YAO_RECOVERY_PATHS,
] as const;

const ROUTER_AB_ED25519_YAO_EXPORT_PATHS = [
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
] as const;

const ROUTER_AB_WALLET_BUDGET_STATUS_PATH = '/wallet/session/status';
const ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH = '/wallets/recovery/prepare';
const ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH = '/wallets/recovery/finalize';
const ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH =
  '/wallets/recovery/google-email-otp/finalize';

type PendingWalletRecoveryCommitIdentity = {
  readonly walletId: string;
  readonly recoveryOperationId: string;
  readonly stage: string;
};

function intendedIndexedDbModulePath(appUrl: string): string {
  const configured = String(process.env.SEAMS_REPO_ROOT || '').trim();
  const cwd = process.cwd();
  const repoRoot =
    configured || (existsSync(path.join(cwd, 'packages/wallet')) ? cwd : path.resolve(cwd, '..'));
  return `${new URL(appUrl).origin}/@fs/${path.join(
    repoRoot,
    'packages/wallet/dist/esm/core/indexedDB/index.js',
  )}`;
}

async function readPendingWalletRecoveryCommitIdentitiesInBrowser(input: {
  readonly modulePath: string;
}): Promise<readonly PendingWalletRecoveryCommitIdentity[]> {
  const { IndexedDBManager } = await import(input.modulePath);
  const records: readonly {
    readonly walletId: unknown;
    readonly recoveryOperationId: unknown;
    readonly stage: unknown;
  }[] = await IndexedDBManager.listPendingWalletRecoveryCommits();
  return records.map((record) => ({
    walletId: String(record.walletId),
    recoveryOperationId: String(record.recoveryOperationId),
    stage: String(record.stage),
  }));
}

type RecoveryRequestKind = 'finalize' | 'replay';

type RecoveryRequestIdentity = {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
  readonly recoveryOperationId: string;
  readonly reservationId: string;
  readonly targetDeviceId: string | null;
  readonly targetAuthorityId: string | null;
  readonly targetWalletAuthMethodId: string | null;
  readonly replacementId: string | null;
};

type RecoveryRequestCapture = {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
  request: RecoveryRequestIdentity | null;
  error: string | null;
};

type IntendedHarnessConfig = {
  appUrl: string;
  routerUrl: string;
  walletOrigin: string;
  projectEnvironmentId: string;
  publishableKey: string;
  emailOtpAddress: string;
  googleProviderSubjectPrefix: string;
  googleClientId: string;
  googleIdToken: string;
  passkeyEcdsaTargetProfile: EcdsaTargetProfileName;
  emailOtpEcdsaTargetProfile: EcdsaTargetProfileName;
  signingSessionDebug: boolean;
};

type IntendedEmailOtpCodeRequestForPage =
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

declare global {
  interface Window {
    __seamsIntendedE2EReadEmailOtpCode?: (
      input: IntendedEmailOtpCodeRequestForPage,
    ) => Promise<string>;
    __seamsIntendedConcurrentActionObserver?: IntendedConcurrentActionObserver;
    __seamsIntendedE2ELockWallet?: () => Promise<void>;
    __seamsIntendedNearHydrationHold?: {
      readonly isHeld: () => boolean;
      readonly release: (spoil: boolean) => void;
    };
    __seamsIntendedE2EReadWalletLockState?: () => Promise<{
      authenticationKind: 'authenticated' | 'signed_out';
    }>;
    __seamsIntendedE2EReadAuthenticationMethods?: () => Promise<{
      ownerDeviceCount: number;
      linkedDeviceCount: number;
    }>;
    /** The linked-device inventory, parsed strictly by the contract. */
    __seamsIntendedE2EReadLinkedDevices?: () => Promise<unknown>;
    /** The QR payload Device 1 "scans"; the contract has no camera. */
    __seamsIntendedE2EDeviceLinkQrPayloadJson?: string;
    /** The exact revocation Device 1 submits, with its fresh source proof. */
    __seamsIntendedE2ELinkedDeviceRevocationJson?: string;
  }
}

async function readLinkedDevicesFromIntendedPage(): Promise<unknown> {
  const read = window.__seamsIntendedE2EReadLinkedDevices;
  if (!read) throw new Error('linked-device inventory helper is unavailable');
  return await read();
}

function presentDeviceLinkQrToIntendedPage(qrPayloadJson: string): void {
  window.__seamsIntendedE2EDeviceLinkQrPayloadJson = qrPayloadJson;
}

function presentLinkedDeviceRevocationToIntendedPage(revocationJson: string): void {
  window.__seamsIntendedE2ELinkedDeviceRevocationJson = revocationJson;
}

async function readAuthenticationMethodsFromIntendedPage(): Promise<{
  ownerDeviceCount: number;
  linkedDeviceCount: number;
}> {
  const read = window.__seamsIntendedE2EReadAuthenticationMethods;
  if (!read) {
    throw new Error('authentication-method inventory helper is unavailable');
  }
  return await read();
}

type IntendedConcurrentActionObserver = {
  observer: MutationObserver;
  snapshots: unknown[];
};

type LifecycleFailureMatcher = {
  id: string;
  pattern: RegExp;
  reason: string;
};

type IntendedPageLifecycleEvent = {
  index: number;
  payload: unknown;
};

type IntendedPageActionSnapshot =
  | {
      status: 'idle';
      action?: never;
      result?: never;
      error?: never;
    }
  | {
      status: 'running';
      action: IntendedHarnessAction;
      result?: never;
      error?: never;
    }
  | {
      status: 'success';
      action: IntendedHarnessAction;
      result: IntendedActionResultSnapshot;
      error?: never;
    }
  | {
      status: 'error';
      action: IntendedHarnessAction;
      error: string;
      result?: never;
    };

type EcdsaTargetKeySnapshot = {
  chain: 'tempo' | 'arc_evm';
  chainId: number;
  thresholdOwnerAddress: string;
};

type EcdsaTargetProfileName = 'none' | 'tempo' | 'tempo_arc';

type EcdsaTargetKeysSnapshot =
  | {
      kind: 'none';
      tempo?: never;
      arcEvm?: never;
    }
  | {
      kind: 'tempo';
      tempo: EcdsaTargetKeySnapshot;
      arcEvm?: never;
    }
  | {
      kind: 'tempo_arc';
      tempo: EcdsaTargetKeySnapshot;
      arcEvm: EcdsaTargetKeySnapshot;
    };

type EcdsaEnabledSnapshot =
  | {
      ecdsaTargetProfile: 'none';
      thresholdEcdsaEthereumAddress?: never;
      thresholdEcdsaPublicKeyB64u?: never;
      ecdsaTargetKeys: Extract<EcdsaTargetKeysSnapshot, { kind: 'none' }>;
    }
  | {
      ecdsaTargetProfile: 'tempo';
      thresholdEcdsaEthereumAddress: string;
      thresholdEcdsaPublicKeyB64u: string;
      ecdsaTargetKeys: Extract<EcdsaTargetKeysSnapshot, { kind: 'tempo' }>;
    }
  | {
      ecdsaTargetProfile: 'tempo_arc';
      thresholdEcdsaEthereumAddress?: never;
      thresholdEcdsaPublicKeyB64u?: never;
      ecdsaTargetKeys: Extract<EcdsaTargetKeysSnapshot, { kind: 'tempo_arc' }>;
    };

type RegisteredNearStateSnapshot =
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
      nearProvisioning:
        | { status: 'pending'; error?: never; errorCode?: never }
        | { status: 'provisioning'; error?: never; errorCode?: never }
        | { status: 'retryable'; error: string; errorCode: string };
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
function nearStateLabel(snapshot: RegisteredNearStateSnapshot): string {
  return snapshot.nearReadiness === 'pending'
    ? snapshot.nearProvisioning.status
    : snapshot.nearReadiness;
}

type PasskeyRegistrationResultSnapshot = {
  kind: 'passkey_registration_success';
  walletId: string;
} & RegisteredNearStateSnapshot &
  EcdsaEnabledSnapshot;

type Ed25519AddSignerResultSnapshot = {
  kind: 'wallet_signer_added';
  walletId: string;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  operationalPublicKey: string;
};

type EcdsaAddSignerResultSnapshot = {
  kind: 'ecdsa_signer_added';
  walletId: string;
} & EcdsaEnabledSnapshot;

type EmailOtpRegistrationCoreSnapshot = {
  kind: 'email_otp_registration_success';
  initialWalletId: string;
  walletId: string;
  authenticationKind: 'authenticated';
} & RegisteredNearStateSnapshot;

type EmailOtpRegistrationResultSnapshot = EmailOtpRegistrationCoreSnapshot & EcdsaEnabledSnapshot;

type RegisteredWalletSnapshot =
  | PasskeyRegistrationResultSnapshot
  | EmailOtpRegistrationResultSnapshot;

type NearReadyRegisteredWalletSnapshot = RegisteredWalletSnapshot &
  Extract<RegisteredNearStateSnapshot, { nearReadiness: 'ready' }>;

type NearSigningResultSnapshot = {
  kind: 'near_sign_success';
  walletId: string;
  nearAccountId: string;
  signedTransactionB64: string;
  signedTransactionByteLength: number;
};

type PasskeyUnlockResultSnapshot =
  | {
      kind: 'passkey_unlock_success';
      walletId: string;
      nearIdentity: 'ready';
      nearAccountId: string;
      operationalPublicKey: string;
      sessionWalletAuthMethodId: string;
      authenticationKind: 'authenticated';
    }
  | {
      kind: 'passkey_unlock_success';
      walletId: string;
      nearIdentity: 'absent';
      nearAccountId?: never;
      operationalPublicKey?: never;
      sessionWalletAuthMethodId: string;
      authenticationKind: 'authenticated';
    };

type PasskeySyncResultSnapshot = {
  kind: 'passkey_sync_success';
  walletId: string;
  nearAccountId: string;
  operationalPublicKey: string;
};

type PasskeyRecoveryResultSnapshot = {
  kind: 'passkey_recovery_success';
  walletId: string;
  activeRecoveryCodeCount: number;
  totalRecoveryCodeCount: number;
};

type GoogleEmailOtpRecoveryResultSnapshot = {
  kind: 'google_email_otp_recovery_success';
  walletId: string;
  activeRecoveryCodeCount: number;
  totalRecoveryCodeCount: number;
};

type EmailOtpUnlockCoreSnapshot = {
  kind: 'email_otp_unlock_success';
  walletId: string;
  sessionWalletAuthMethodId: string;
  authenticationKind: 'authenticated';
} & (
  | { nearIdentity: 'ready'; nearAccountId: string; operationalPublicKey: string }
  | { nearIdentity: 'absent'; nearAccountId?: never; operationalPublicKey?: never }
);

type EmailOtpUnlockResultSnapshot = EmailOtpUnlockCoreSnapshot & EcdsaEnabledSnapshot;

type TempoSigningResultSnapshot = {
  kind: 'tempo_sign_success';
  walletId: string;
  chainId: number;
  senderHashHex: `0x${string}`;
  rawTxHex: `0x${string}`;
};

type ArcEvmSigningResultSnapshot = {
  kind: 'arc_evm_sign_success';
  walletId: string;
  chainId: number;
  txHashHex: `0x${string}`;
  rawTxHex: `0x${string}`;
};

type EcdsaExportResultSnapshot = {
  kind: 'ecdsa_export_success';
  walletId: string;
  chainId: number;
};

type Ed25519ExportResultSnapshot = {
  kind: 'ed25519_export_success';
  walletId: string;
  nearAccountId: string;
};

type NearProvisioningReadySnapshot = {
  kind: 'near_provisioning_ready';
  walletId: string;
  nearAccountId: string;
  operationalPublicKey: string;
};

type AddEmailOtpAuthMethodResultSnapshot = {
  kind: 'add_email_otp_success';
  walletId: string;
  emailAddress: string;
  walletAuthMethodId: string;
  authMethod: { kind: 'email_otp'; status: 'active' };
};

type AddPasskeyAuthMethodResultSnapshot = {
  kind: 'add_passkey_success';
  walletId: string;
  rpId: string;
  walletAuthMethodId: string;
  authMethod: { kind: 'passkey'; status: 'active' };
};

type RevokeAuthMethodResultSnapshot = {
  kind: 'revoke_auth_method_success';
  walletId: string;
  walletAuthMethodId: string;
};

type AddedEmailOtpUnlockResultSnapshot = {
  kind: 'added_email_otp_unlock_success';
  walletId: string;
  sessionWalletAuthMethodId: string;
  authenticationKind: 'authenticated';
};

/* Device 2 does not know the wallet until the link names it. */
type DeviceLinkQrReadySnapshot = {
  kind: 'device_link_qr_ready';
  linkSessionId: string;
  qrPayloadJson: string;
  walletId?: never;
};

type DeviceLinkApprovalRecordedSnapshot = {
  kind: 'device_link_approval_recorded';
  walletId: string;
  enrollmentId: string;
  deviceId: string;
};

/** Device 2's settled link, read from page state rather than an action. */
type DeviceLinkActiveSnapshot = {
  linkSessionId: string;
  walletId: string;
  enrollmentId: string;
  sessionWalletAuthMethodId: string;
  /* Null for a wallet whose signer set has no Ed25519. */
  nearAccountId: string | null;
  operationalPublicKey: string | null;
  authenticationKind: 'authenticated';
};

type LinkedDeviceRevokedSnapshot = {
  kind: 'linked_device_revoked';
  walletId: string;
  walletAuthMethodId: string;
  authorityId: string;
  revocationEpoch: number;
};

type LinkedDeviceOwnerMethodSnapshot = {
  readonly walletAuthMethodId: string;
  readonly credentialKind: 'passkey' | 'email_otp';
  readonly credentialIdB64u: string | null;
};

type LinkedDeviceEntrySnapshot = {
  readonly deviceId: string;
  readonly enrollmentId: string;
  readonly walletId: string;
  readonly walletAuthMethodId: string;
  readonly credentialKind: 'passkey' | 'email_otp';
  readonly state: 'provisioning' | 'active' | 'suspended' | 'expired' | 'revoked';
};

type LinkedDeviceInventorySnapshot = {
  readonly ownerDevices: readonly LinkedDeviceOwnerMethodSnapshot[];
  readonly devices: readonly LinkedDeviceEntrySnapshot[];
};

type IntendedActionResultSnapshot =
  | DeviceLinkQrReadySnapshot
  | DeviceLinkApprovalRecordedSnapshot
  | LinkedDeviceRevokedSnapshot
  | PasskeyRegistrationResultSnapshot
  | Ed25519AddSignerResultSnapshot
  | EcdsaAddSignerResultSnapshot
  | AddEmailOtpAuthMethodResultSnapshot
  | AddedEmailOtpUnlockResultSnapshot
  | RevokeAuthMethodResultSnapshot
  | AddPasskeyAuthMethodResultSnapshot
  | EmailOtpRegistrationResultSnapshot
  | NearProvisioningReadySnapshot
  | NearSigningResultSnapshot
  | PasskeySyncResultSnapshot
  | PasskeyRecoveryResultSnapshot
  | GoogleEmailOtpRecoveryResultSnapshot
  | PasskeyUnlockResultSnapshot
  | EmailOtpUnlockResultSnapshot
  | TempoSigningResultSnapshot
  | ArcEvmSigningResultSnapshot
  | Ed25519ExportResultSnapshot
  | EcdsaExportResultSnapshot;

type IntendedPageSnapshot = {
  action: IntendedPageActionSnapshot;
  events: readonly IntendedPageLifecycleEvent[];
};

type IntendedLifecycleTracePayload = {
  flow: IntendedLifecycleFlow;
  walletId: string | null;
  appUrl: string;
  routerUrl: string;
  matcherTableVersion: string;
  authPrompts: {
    emailOtp: number;
    passkey: number;
  };
  latestPageSnapshot: IntendedPageSnapshot | null;
  trace: readonly TraceEntry[];
  violations: readonly string[];
};

type WalletIframeAutoConfirmDiagnostics = {
  attempts: number;
  clicked: boolean;
  recoveryBackupAcknowledged?: boolean;
  otpFilled?: boolean;
  otpChallengeMissing?: boolean;
  otpLookupKind?: IntendedEmailOtpCodeRequestForPage['kind'];
  lastOtpError?: string;
  firstIframeAttachedMs?: number;
  firstFrameResolvedMs?: number;
  firstOtpInputVisibleMs?: number;
  firstOtpCodeResolvedMs?: number;
  firstOtpFillDispatchMs?: number;
  firstButtonVisibleMs?: number;
  firstClickDispatchMs?: number;
  firstClickDurationMs?: number;
  totalMs?: number;
};

type WalletIframeAutoConfirmTimingKey =
  | 'firstIframeAttachedMs'
  | 'firstFrameResolvedMs'
  | 'firstOtpInputVisibleMs'
  | 'firstOtpCodeResolvedMs'
  | 'firstOtpFillDispatchMs'
  | 'firstButtonVisibleMs'
  | 'firstClickDispatchMs'
  | 'firstClickDurationMs'
  | 'totalMs';

type WalletIframeConfirmationFingerprint = {
  readonly intendedAction: string;
  readonly controlIdentity: string;
  readonly stateIdentity: string | null;
};

type NearSignedTransactionParts = {
  unsignedTransactionBytes: Uint8Array;
  signatureKeyType: number;
  signatureBytes64: Uint8Array;
};

type NearUnsignedTransactionSubject = {
  signerId: string;
  publicKey: {
    keyType: number;
    keyData32: Uint8Array;
  };
};

type BorshReadResult<T> = {
  value: T;
  nextOffset: number;
};

type RlpValue =
  | {
      kind: 'bytes';
      bytes: Uint8Array;
    }
  | {
      kind: 'list';
      items: RlpValue[];
    };

type RlpReadResult = {
  value: RlpValue;
  nextOffset: number;
};

type TempoSignedTransactionParts = {
  chainId: number;
  senderSignatureHex: `0x${string}`;
};

type SigningAuthExpectation = 'warm_session' | 'passkey_step_up' | 'email_otp_step_up';

type SigningAuthEventSummary = {
  phases: readonly string[];
  authenticationMethods: readonly SigningAuthMethod[];
  remainingUses: readonly number[];
  warmSessionClaimed: boolean;
  /** Every warm claim came from an active Wallet Authority, whose budget the
      server keeps: that plan carries no remaining uses. A warm-session plan
      promises them, so any warm-session claim keeps the check. */
  activeWalletAuthorityClaimed: boolean;
  passkeyPromptStarted: boolean;
  passkeyPromptSucceeded: boolean;
  passkeyAuthenticationComplete: boolean;
  emailOtpChallengeStarted: boolean;
  emailOtpChallengeSent: boolean;
  emailOtpVerifyStarted: boolean;
  emailOtpVerifySucceeded: boolean;
  emailOtpAuthenticationComplete: boolean;
  thresholdReconnectStarted: boolean;
  thresholdReconnectSucceeded: boolean;
};

type CapturedWalletBudgetStatusRequest = {
  url: string;
  authorization: string;
  contentType: string;
  body: string;
  walletSessionId: string;
  quotaId: string;
};

type RecoveryAuthorityProjection = {
  readonly walletId: string;
  readonly authorityId: string;
  readonly deviceId: string;
  readonly provenanceKind: 'wallet_recovery';
  readonly recoveryOperationId: string;
  readonly continuityAuthorityId: string;
  readonly authMethodWalletAuthMethodId: string;
  readonly authMethodWalletAuthorityId: string;
  readonly authMethodKind: 'passkey' | 'email_otp';
  readonly authMethodStatus: 'active';
};

type IntendedRecoveryAction =
  | {
      readonly target: Extract<IntendedRecoveryTargetKind, 'passkey'>;
      readonly name: 'recoverPasskeyWallet';
      readonly buttonTestId: 'intended-recover-passkey';
    }
  | {
      readonly target: Extract<IntendedRecoveryTargetKind, 'google_email_otp'>;
      readonly name: 'recoverGoogleEmailOtpWallet';
      readonly buttonTestId: 'intended-recover-google-email-otp';
    };

type AuthoritativeWalletBudgetReplay =
  | {
      kind: 'active';
      walletSessionId: string;
      quotaId: string;
    }
  | {
      kind: 'exhausted';
      walletSessionId: string;
      quotaId: string;
    };

type KeyExportAuthEventSummary = {
  phases: readonly string[];
  passkeyPromptStarted: boolean;
  passkeyPromptSucceeded: boolean;
};

type AuthCounterIncrement = {
  passkeyPrompts: number;
  emailOtpVerifications: number;
};

type SigningAuthMethod = 'passkey' | 'email_otp' | 'warm_session';

const INTENDED_TEMPO_CHAIN_ID = 42_431;
const INTENDED_ARC_EVM_CHAIN_ID = 5_042_002;
const TEMPO_TRANSACTION_TYPE = 0x76;
const MAX_BUDGET_EXHAUSTION_SIGNS = 8;
const SIGNING_AUTH_WARM_SESSION_CLAIMED = 'signing.auth.warm_session.claimed';
const SIGNING_AUTH_PASSKEY_PROMPT_STARTED = 'signing.auth.passkey.prompt.started';
const SIGNING_AUTH_PASSKEY_PROMPT_SUCCEEDED = 'signing.auth.passkey.prompt.succeeded';
const SIGNING_AUTH_EMAIL_OTP_CHALLENGE_STARTED = 'signing.auth.email_otp.challenge.started';
const SIGNING_AUTH_EMAIL_OTP_CHALLENGE_SENT = 'signing.auth.email_otp.challenge.sent';
const SIGNING_AUTH_EMAIL_OTP_VERIFY_STARTED = 'signing.auth.email_otp.verify.started';
const SIGNING_AUTH_EMAIL_OTP_VERIFY_SUCCEEDED = 'signing.auth.email_otp.verify.succeeded';
const SIGNING_AUTHENTICATION_COMPLETE = 'signing.authentication.complete';
const SIGNING_THRESHOLD_SESSION_RECONNECT_STARTED = 'signing.threshold_session.reconnect.started';
const SIGNING_THRESHOLD_SESSION_RECONNECT_SUCCEEDED =
  'signing.threshold_session.reconnect.succeeded';
const KEY_EXPORT_AUTH_PASSKEY_PROMPT_STARTED = 'key_export.auth.passkey.prompt.started';
const KEY_EXPORT_AUTH_PASSKEY_PROMPT_SUCCEEDED = 'key_export.auth.passkey.prompt.succeeded';

const LIFECYCLE_FAILURE_MATCHER_TABLE_VERSION = 'refactor-88-2026-07-04';

const LIFECYCLE_FAILURE_MATCHERS: readonly LifecycleFailureMatcher[] = [
  {
    id: 'exact_lane_selection_failure',
    pattern: /exact selected lane/i,
    reason: 'signing did not use a single exact lane',
  },
  {
    id: 'wallet_runtime_postcondition',
    pattern: /WalletRuntimePostcondition/,
    reason: 'wallet runtime reported a lifecycle postcondition failure',
  },
  {
    id: 'canonical_ecdsa_lane_ambiguous_material',
    pattern: /ambiguous_material/i,
    reason: 'runtime observed multiple canonical ECDSA material groups for one operation',
  },
  {
    id: 'post_step_up_retry_success',
    pattern: /post-step-up transaction failed/i,
    reason: 'first post-step-up transaction failed before a retry could succeed',
  },
] as const;

const EXTERNAL_HOST_PATTERNS = [
  /(^|\.)googleapis\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)near\.org$/i,
  /(^|\.)fastnear\.com$/i,
  /^rpc\.moderato\.tempo\.xyz$/i,
  /^rpc\.testnet\.arc\.network$/i,
] as const;

const NEAR_STUB_BLOCK_HASH = '11111111111111111111111111111111';
const SEAMS_INTENDED_PERSIST_TRACE_ENV = 'SEAMS_INTENDED_PERSIST_TRACE';
const SEAMS_INTENDED_TRACE_DIR_ENV = 'SEAMS_INTENDED_TRACE_DIR';

function shouldPersistIntendedLifecycleTrace(): boolean {
  return process.env[SEAMS_INTENDED_PERSIST_TRACE_ENV] === '1';
}

function safeTraceFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function intendedLifecycleTraceDirectory(testInfo: TestInfo): string {
  const configured = process.env[SEAMS_INTENDED_TRACE_DIR_ENV];
  if (configured) return path.resolve(configured);
  return path.resolve(testInfo.config.rootDir, '..', 'test-results', 'intended-lifecycle-traces');
}

function intendedLifecycleTraceFilePath(args: {
  testInfo: TestInfo;
  payload: IntendedLifecycleTracePayload;
  attachmentName: string;
}): string {
  const walletId = args.payload.walletId
    ? safeTraceFileSegment(args.payload.walletId)
    : 'no-wallet';
  const flow = safeTraceFileSegment(args.payload.flow);
  /* The devices of one linking contract share a wallet and can close in the
     same millisecond; the attachment name keeps their traces apart. */
  const fileName = `${Date.now()}-${flow}-${walletId}-${safeTraceFileSegment(args.attachmentName)}`;
  return path.join(intendedLifecycleTraceDirectory(args.testInfo), fileName);
}

async function persistIntendedLifecycleTrace(args: {
  testInfo: TestInfo;
  payload: IntendedLifecycleTracePayload;
  attachmentName: string;
}): Promise<void> {
  if (!shouldPersistIntendedLifecycleTrace()) return;
  const filePath = intendedLifecycleTraceFilePath(args);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(args.payload, null, 2), 'utf8');
}

function isRequestTraceEntry(entry: TraceEntry): boolean {
  return entry.kind === 'request';
}

function isWalletUnlockVerifyRequest(entry: TraceEntry): boolean {
  return entry.url !== undefined && new URL(entry.url).pathname === '/wallet/unlock/verify';
}

function isWalletSessionStatusRequest(entry: TraceEntry): boolean {
  return entry.url !== undefined && new URL(entry.url).pathname === '/wallet/session/status';
}

function intendedPageActionIsComplete(expectedAction: string): boolean {
  const status = document.querySelector('[data-testid="intended-action-status"]');
  if (!status) return false;
  const state = status.getAttribute('data-state');
  const actionName = status.getAttribute('data-action');
  return actionName === expectedAction && (state === 'success' || state === 'error');
}

function intendedPageActionStartedOrCompleted(expectedAction: string): boolean {
  const status = document.querySelector('[data-testid="intended-action-status"]');
  if (!status) return false;
  const state = status.getAttribute('data-state');
  const actionName = status.getAttribute('data-action');
  return (
    actionName === expectedAction &&
    (state === 'running' || state === 'success' || state === 'error')
  );
}

function installIntendedConcurrentActionObserver(): void {
  // Playwright serializes this installer alone, so its observer callback must be self-contained.
  function captureSnapshot(): void {
    const state = window.__seamsIntendedConcurrentActionObserver;
    if (!state) return;
    const output = document.querySelector('[data-testid="intended-result-json"]');
    const text = output?.textContent?.trim();
    if (!text) return;
    try {
      state.snapshots.push(JSON.parse(text));
    } catch {
      return;
    }
  }

  window.__seamsIntendedConcurrentActionObserver?.observer.disconnect();
  const output = document.querySelector('[data-testid="intended-result-json"]');
  if (!output) {
    throw new Error('Intended page result output is unavailable for concurrent signing');
  }
  const observer = new MutationObserver(captureSnapshot);
  window.__seamsIntendedConcurrentActionObserver = { observer, snapshots: [] };
  observer.observe(output, { childList: true, characterData: true, subtree: true });
  captureSnapshot();
}

function triggerConcurrentEvmFamilySigning(): void {
  const tempo = document.querySelector<HTMLButtonElement>('[data-testid="intended-sign-tempo"]');
  const arcEvm = document.querySelector<HTMLButtonElement>('[data-testid="intended-sign-arc-evm"]');
  if (!tempo || !arcEvm) {
    throw new Error('Concurrent Tempo/Arc signing controls are unavailable');
  }
  if (tempo.disabled || arcEvm.disabled) {
    throw new Error('Concurrent Tempo/Arc signing controls are disabled');
  }
  tempo.click();
  arcEvm.click();
}

function intendedConcurrentEvmFamilySigningFinished(): boolean {
  const snapshots = window.__seamsIntendedConcurrentActionObserver?.snapshots;
  if (!snapshots) return false;
  let tempoComplete = false;
  let arcEvmComplete = false;
  for (const raw of snapshots) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const action = Reflect.get(raw, 'action');
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
    const status = Reflect.get(action, 'status');
    if (status !== 'success' && status !== 'error') continue;
    const actionName = Reflect.get(action, 'action');
    if (actionName === 'signTempoTransaction') tempoComplete = true;
    if (actionName === 'signArcEvmTransaction') arcEvmComplete = true;
  }
  return tempoComplete && arcEvmComplete;
}

function readIntendedConcurrentActionSnapshots(): unknown[] {
  return window.__seamsIntendedConcurrentActionObserver?.snapshots ?? [];
}

function disconnectIntendedConcurrentActionObserver(): void {
  const state = window.__seamsIntendedConcurrentActionObserver;
  if (!state) return;
  state.observer.disconnect();
  delete window.__seamsIntendedConcurrentActionObserver;
}

function nearDemoSignButtonIsActionable(): boolean {
  const buttons = Array.from(document.querySelectorAll('button'));
  for (const button of buttons) {
    if (button.textContent?.trim() !== 'Sign on NEAR') continue;
    return button instanceof HTMLButtonElement && !button.disabled;
  }
  return false;
}

function ignoreNearDemoStatusReadError(): null {
  return null;
}

export class IntendedBehaviourHarness {
  readonly flow: IntendedLifecycleFlow;

  walletId: string;

  readonly trace: TraceEntry[] = [];

  private readonly context: BrowserContext;

  private readonly page: Page;

  private readonly request: APIRequestContext;

  private readonly networkMode: 'managed_local' | 'external_staging';

  private readonly config: IntendedHarnessConfig;

  private readonly violations: string[] = [];

  private emailOtpVerificationCount = 0;

  /** Set by an auth-method addition, which uses one family to add the other. */
  private crossFamilyAuthMethodAdditionRan = false;

  /** The exact method the last addition created, to check what unlocks later. */
  private addedWalletAuthMethodId: string | null = null;

  /**
   * The family the wallet is currently operating as.
   *
   * Not the same as `flow`, which names how the wallet was registered. Once a
   * cross-family method is added and used to unlock, every later step-up runs
   * through that family instead, and asserting against the registration flow
   * would demand the credential the user just stopped using.
   */
  private operatingAuthFamily: 'passkey' | 'email_otp' | null = null;

  private passkeyPromptCount = 0;

  private latestPageSnapshot: IntendedPageSnapshot | null = null;

  private latestActionTiming: IntendedActionTiming | null = null;

  private latestWalletIframeAutoConfirmDiagnostics: WalletIframeAutoConfirmDiagnostics | null =
    null;

  private intendedPageReady = false;

  private reloadIntendedPageBeforeNextAction = true;

  private registeredWallet: RegisteredWalletSnapshot | null = null;

  private recoveryCodes: readonly string[] = [];

  private nearSignerSlot = 1;

  private currentWarmSigningStage: IntendedWarmSessionOriginStage = 'post_registration';

  private latestSigningRemainingUses: number | null = null;

  private latestWalletBudgetStatusRequest: CapturedWalletBudgetStatusRequest | null = null;

  private sourceWalletBudgetStatusRequest: CapturedWalletBudgetStatusRequest | null = null;

  private recoveryAuthorityProjection: RecoveryAuthorityProjection | null = null;

  private recoveryAuthorityProjectionError: string | null = null;

  private intendedYaoFaultInjection: IntendedYaoFaultInjectionStateV1 = { kind: 'idle' };

  private readonly intendedYaoFaultProofs: string[] = [];
  /** Armed once: the next NEAR finalize loses the Gateway's storage after its decision. */
  private intendedYaoFinalizeFaultToken: string | null = null;
  /** Armed once: the next recovery execution loses every Router reply, or is kept from it. */
  private intendedYaoRecoveryFault: {
    readonly mode: 'lose_router_recovery_replies' | 'withhold_router_recovery_execute';
    readonly token: string;
  } | null = null;

  /** Armed once: the next export admission loses storage after its authorization commits. */
  private intendedYaoExportFaultToken: string | null = null;

  /** Armed for one NEAR signature: every finalize of it is kept, run or withheld. */
  private intendedYaoSigningFault: {
    readonly mode: 'capture_signing_finalize' | 'withhold_signing_finalize';
    readonly token: string;
  } | null = null;

  /** The next device of a device-link contract, opened and closed by this one. */
  private linkedDevice: {
    readonly harness: IntendedBehaviourHarness;
    readonly context: BrowserContext;
  } | null = null;

  /** This device's place in a device-link contract: Device 1 registered the wallet. */
  private deviceNumber = 1;

  constructor(args: {
    context: BrowserContext;
    flow: IntendedLifecycleFlow;
    networkMode: 'managed_local' | 'external_staging';
    page: Page;
    request: APIRequestContext;
  }) {
    this.context = args.context;
    this.flow = args.flow;
    this.networkMode = args.networkMode;
    this.page = args.page;
    this.request = args.request;
    this.config = intendedHarnessConfigFromEnv();
    this.walletId = uniqueWalletId();
  }

  async initialize(): Promise<void> {
    this.recordStage('initialize');
    await this.installRegistrationBenchmarkDiagnosticsFlag();
    await this.installSigningSessionDebugFlag();
    await this.installFailureCollectors();
    if (this.networkMode === 'managed_local') {
      await this.installExternalNetworkStubs();
      await this.installIntendedYaoFaultInjection();
    }
    await this.installWebAuthnVirtualAuthenticator();
    await this.resetBrowserStorage();
    await this.assertServicesReady();
  }

  async registerPasskeyWallet(): Promise<void> {
    this.recordStage('register_passkey_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerPasskeyWallet',
      'intended-register-passkey',
      { onRecoveryCodes: this.captureRecoveryCodes },
    );
    if (this.recoveryCodes.length === 0) {
      this.captureRecoveryCodes(
        await waitForWalletRecoveryCodeBackup(
          this.page,
          this.latestWalletIframeAutoConfirmDiagnostics || undefined,
        ),
      );
    }
    const result = requirePasskeyRegistrationResult(snapshot, this.walletId);
    if (this.config.passkeyEcdsaTargetProfile !== 'none' && result.nearReadiness !== 'pending') {
      throw new Error('Mixed passkey registration did not return ECDSA-ready with NEAR pending');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Passkey registration did not emit structured lifecycle events');
    }
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      result.walletId,
    );
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      result.nearReadiness === 'ready'
        ? `passkey registration succeeded wallet=${result.walletId} near=${result.nearAccountId}`
        : `passkey registration succeeded ECDSA-ready wallet=${result.walletId} near=${nearStateLabel(result)}`,
    );
  }

  async assertRegistrationOwnerSessionIsActive(): Promise<void> {
    const inventory = await this.page.evaluate(readAuthenticationMethodsFromIntendedPage);
    if (inventory.ownerDeviceCount < 1) {
      throw new Error('registration owner session returned no owner authentication method');
    }
    this.recordService(
      `registration owner session active ownerMethods=${inventory.ownerDeviceCount} linkedDevices=${inventory.linkedDeviceCount}`,
    );
  }

  /**
   * Opens the next device for this wallet: a fresh browser context with its
   * own storage and its own virtual authenticator. It shares nothing with the
   * devices already open except the wallet it is about to join, which is why
   * it starts on the same wallet id and no credential. A linked device opens
   * the device it will approve in turn.
   */
  async openLinkedDevice(browser: Browser): Promise<IntendedBehaviourHarness> {
    this.recordStage('open_linked_device');
    requireLinkableRegisteredWallet(this.requireRegisteredWalletForSigning());
    const deviceNumber = this.deviceNumber + 1;
    if (this.linkedDevice) throw new Error(`Device ${deviceNumber} is already open`);
    const context = await browser.newContext();
    try {
      if (this.networkMode === 'external_staging') {
        await installHostedBenchmarkAccess(context);
      }
      const page = await context.newPage();
      const device2 = new IntendedBehaviourHarness({
        context,
        flow: this.flow,
        networkMode: this.networkMode,
        page,
        request: this.request,
      });
      device2.walletId = this.walletId;
      device2.deviceNumber = deviceNumber;
      this.linkedDevice = { harness: device2, context };
      await device2.initialize();
      this.recordService(
        `Device ${deviceNumber} opened with its own storage and virtual authenticator`,
      );
      return device2;
    } catch (error) {
      if (!this.linkedDevice) await context.close();
      throw error;
    }
  }

  /**
   * Fixture teardown: attach the linked device's trace, apply its guards,
   * close it. A device it linked in turn closes first.
   */
  async closeLinkedDevice(testInfo: TestInfo): Promise<void> {
    const linked = this.linkedDevice;
    if (!linked) return;
    this.linkedDevice = null;
    try {
      await linked.harness.closeLinkedDevice(testInfo);
      await linked.harness.attachTrace(
        testInfo,
        `device-${linked.harness.deviceNumber}-intended-lifecycle-trace.json`,
      );
      linked.harness.assertNoLifecycleViolations();
      linked.harness.assertNoWrongAuthPath();
    } finally {
      await linked.context.close();
    }
  }

  /**
   * Device 2 shows a link QR, Device 1 approves the scanned payload, and
   * Device 2 answers its own passkey prompt. Both sides run at once, as they
   * do for a user holding two devices.
   *
   * Linking must add exactly one device-link authority with a fresh method,
   * leave Device 1's founding method untouched, and hand Device 2 a Wallet
   * Session whose NEAR identity is the wallet's existing one.
   */
  async linkDeviceWithPasskey(device2: IntendedBehaviourHarness): Promise<void> {
    this.recordStage('device_link_with_passkey');
    const target = `Device ${device2.deviceNumber}`;
    if (this.linkedDevice?.harness !== device2) {
      throw new Error(`${target} must be opened by this Device ${this.deviceNumber} harness`);
    }
    const registration = requireLinkableRegisteredWallet(this.requireRegisteredWalletForSigning());
    const before = await this.readLinkedDeviceInventory();
    /* Device 1 links first; each later link comes from the device linked
       just before it, so the wallet lists one linked device per earlier link. */
    if (before.devices.length !== this.deviceNumber - 1) {
      throw new Error(
        `wallet lists ${before.devices.length} linked devices before linking ${target}`,
      );
    }
    const owner = requireSingleOwnerPasskey(before);

    const qr = await device2.showDeviceLinkQr();
    await this.ensureIntendedPageOpen();
    await this.page.evaluate(presentDeviceLinkQrToIntendedPage, qr.qrPayloadJson);
    const approvalRun = this.runIntendedPageAction(
      'scanAndLinkDevice',
      'intended-device-link-scan',
    );
    const activationRun = device2.waitForDeviceLinkAsTarget(qr.linkSessionId);
    /* Whichever side fails first names the failure. The other keeps running
       only until teardown closes its page, so its rejection is observed here. */
    approvalRun.catch(() => undefined);
    activationRun.catch(() => undefined);
    const [approvalSnapshot, active] = await Promise.all([approvalRun, activationRun]);
    const approval = requireDeviceLinkApprovalResult(approvalSnapshot, this.walletId);
    if (active.walletId !== this.walletId) {
      throw new Error(`${target} joined wallet ${active.walletId}; expected ${this.walletId}`);
    }
    if (active.enrollmentId !== approval.enrollmentId) {
      throw new Error(
        `${target} activated enrollment ${active.enrollmentId}; Device ${this.deviceNumber} approved ${approval.enrollmentId}`,
      );
    }
    if (active.sessionWalletAuthMethodId === owner.walletAuthMethodId) {
      throw new Error(`${target}'s Wallet Session names Device 1's founding method`);
    }
    const walletNearAccountId = registration.nearAccountId ?? null;
    const walletOperationalPublicKey = registration.operationalPublicKey ?? null;
    if (
      active.nearAccountId !== walletNearAccountId ||
      active.operationalPublicKey !== walletOperationalPublicKey
    ) {
      throw new Error(
        `${target} holds NEAR ${active.nearAccountId}/${active.operationalPublicKey}; the wallet's is ${walletNearAccountId}/${walletOperationalPublicKey}`,
      );
    }

    /* Linking adds exactly one device and leaves every earlier one as it was. */
    const after = await this.readLinkedDeviceInventory();
    const earlier = new Set(before.devices.map((device) => JSON.stringify(device)));
    const [linked, ...extra] = after.devices.filter(
      (device) => !earlier.has(JSON.stringify(device)),
    );
    if (!linked || extra.length > 0 || after.devices.length !== before.devices.length + 1) {
      throw new Error(
        `linking ${target} must add exactly one device: ${JSON.stringify(before.devices)} -> ${JSON.stringify(after.devices)}`,
      );
    }
    if (
      linked.deviceId !== approval.deviceId ||
      linked.enrollmentId !== approval.enrollmentId ||
      linked.walletAuthMethodId !== active.sessionWalletAuthMethodId ||
      linked.credentialKind !== 'passkey' ||
      linked.state !== 'active'
    ) {
      throw new Error(
        `linked-device inventory does not name the device just linked: ${JSON.stringify(linked)}`,
      );
    }
    assertOwnerDevicesUnchanged(before, after, 'Device linking');

    /* A linked device signs with the wallet's public keys, so its signatures
       are verified against Device 1's registration rather than anything the
       linked device reports about itself. */
    device2.registeredWallet = registration;
    device2.nearSignerSlot = this.nearSignerSlot;
    device2.passkeyPromptCount += 1;
    this.recordService(
      `device linked wallet=${this.walletId} device=${linked.deviceId} method=${linked.walletAuthMethodId}`,
    );
  }

  /**
   * Device 1: its next source-contribution execute reaches the Router, which
   * runs Device 2's target registration and reserves its material, and the
   * local Gateway then loses the Router's answer. The Gateway must send that
   * same request again, marked as the Router's replay, and the Router must
   * answer it from the run it already made, with the same reservation. The
   * Gateway reports what it saw in a proof header.
   */
  async loseLinkExecuteRouterResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const executePath =
      /\/wallet\/device-linking\/v1\/sessions\/[^/]+\/source-contribution\/execute$/;
    const token = randomUUID();
    let armed = true;
    let proof: string | null = null;
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (
        !armed ||
        request.method() !== 'POST' ||
        !executePath.test(new URL(request.url()).pathname)
      ) {
        await route.fallback();
        return;
      }
      armed = false;
      const response = await route.fetch({
        headers: {
          ...request.headers(),
          [LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1]: 'drop_router_response_once',
          [LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1]: token,
        },
      });
      proof = response.headers()[LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1] ?? null;
      await route.fulfill({ response });
    };
    await this.context.route('**/source-contribution/execute', handler);
    return {
      release: async () => {
        await this.context.unroute('**/source-contribution/execute', handler);
      },
      assertReplayed: () => {
        const expected = `${token}:replay_answered_same_reservation`;
        if (proof !== expected) {
          throw new Error(
            `linked-device execute expected the Router replay proof ${expected}, saw ${proof ?? 'none'}`,
          );
        }
        this.recordService(
          'linked-device execute lost its Router answer and replayed the reservation',
        );
      },
    };
  }

  /**
   * Device 2: lets its first successful activation reach the Gateway, which
   * activates the linked authority and both curves' reserved material, then
   * drops the response. Device 2 retries its committed delivery on its own;
   * the retry must carry the same installation receipt and receive exactly
   * the activation that was lost, never a second authority or session.
   */
  async loseLinkedActivationResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const receiptPath = /\/wallet\/device-linking\/v1\/sessions\/[^/]+\/receipt$/;
    type Attempt = { readonly request: string; readonly body: string };
    let lost: Attempt | null = null;
    let replayed: Attempt | null = null;
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      const requestBody = request.postData() ?? '';
      if (
        request.method() !== 'POST' ||
        !receiptPath.test(new URL(request.url()).pathname) ||
        !requestBody.includes('"local_authority_installation_receipt_v1"')
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const attempt = { request: requestBody, body: await response.text() };
      if (!lost && response.status() === 200) {
        lost = attempt;
        await route.abort('connectionreset');
        return;
      }
      if (lost && !replayed) replayed = attempt;
      await route.fulfill({ response });
    };
    await this.context.route('**/receipt', handler);
    return {
      release: async () => {
        await this.context.unroute('**/receipt', handler);
      },
      assertReplayed: () => {
        if (!lost || !replayed) {
          throw new Error(
            `linked-device activation expected one lost and one replayed response, saw lost=${Boolean(lost)} replayed=${Boolean(replayed)}`,
          );
        }
        const lostAttempt: Attempt = lost;
        const replayedAttempt: Attempt = replayed;
        if (replayedAttempt.request !== lostAttempt.request) {
          throw new Error('linked-device activation retry changed its installation receipt');
        }
        const activation = JSON.parse(lostAttempt.body) as {
          readonly kind?: unknown;
          readonly authority?: { readonly authorityId?: unknown };
        };
        if (activation.kind !== 'active') {
          throw new Error(`lost linked-device activation answered ${String(activation.kind)}`);
        }
        expect(JSON.parse(replayedAttempt.body)).toEqual(activation);
        this.recordService(
          `linked-device activation lost its response and replayed authority=${String(activation.authority?.authorityId)}`,
        );
      },
    };
  }

  /**
   * Device 1 revokes Device 2's exact method with a fresh assertion from its
   * own founding passkey, bound to this revocation's operation fingerprint.
   *
   * The SDK takes this proof as input and exposes no producer for it, so the
   * contract asks the authenticator for it inside the wallet frame - the
   * origin the Gateway checks for a request the wallet host sends.
   */
  async revokeLinkedDeviceWithOwnerPasskey(): Promise<void> {
    this.recordStage('revoke_linked_device_with_owner_passkey');
    const before = await this.readLinkedDeviceInventory();
    const [linked, ...extra] = before.devices;
    if (!linked || extra.length > 0) {
      throw new Error(`revocation expects one linked device, found ${before.devices.length}`);
    }
    const owner = requireSingleOwnerPasskey(before);
    const targetWalletAuthMethodId = parseWalletAuthMethodId(linked.walletAuthMethodId);
    if (!targetWalletAuthMethodId.ok) throw new Error(targetWalletAuthMethodId.error.message);
    const requestedAtMs = Date.now();
    const operationFingerprintDigest = String(
      await computeWalletAuthMethodRevokeOperationFingerprintV1({
        walletId: walletIdFromString(this.walletId),
        targetWalletAuthMethodId: targetWalletAuthMethodId.value,
        requestedAtMs,
      }),
    );
    const rpId = new URL(this.config.walletOrigin).hostname;
    const walletFrame = await walletServiceFrame(this.page, this.config.walletOrigin);
    const credential = await walletFrame.evaluate(getWalletOriginPasskeyAssertion, {
      rpId,
      challengeB64u: operationFingerprintDigest,
      credentialIdB64u: owner.credentialIdB64u,
    });
    this.passkeyPromptCount += 1;
    await this.page.evaluate(
      presentLinkedDeviceRevocationToIntendedPage,
      JSON.stringify({
        walletAuthMethodId: linked.walletAuthMethodId,
        requestedAtMs,
        sourceProof: {
          kind: 'webauthn_assertion',
          rpId,
          credential,
          expectedChallengeDigestB64u: operationFingerprintDigest,
        },
      }),
    );
    const snapshot = await this.runIntendedPageAction(
      'revokeLinkedDevice',
      'intended-revoke-linked-device',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(`linked-device revocation ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'linked_device_revoked') {
      throw new Error(`linked-device revocation returned ${result.kind}`);
    }
    if (
      result.walletId !== this.walletId ||
      result.walletAuthMethodId !== linked.walletAuthMethodId
    ) {
      throw new Error(
        `revocation removed ${result.walletAuthMethodId} of ${result.walletId}; expected ${linked.walletAuthMethodId}`,
      );
    }

    const after = await this.readLinkedDeviceInventory();
    if (after.devices.length !== 0) {
      throw new Error(`revoked device is still listed: ${JSON.stringify(after.devices)}`);
    }
    assertOwnerDevicesUnchanged(before, after, 'Linked-device revocation');
    this.recordService(
      `linked device revoked method=${result.walletAuthMethodId} authority=${result.authorityId} epoch=${result.revocationEpoch}`,
    );
  }

  /**
   * Device 1 revokes its linked device with an email code from its Email OTP
   * method, as the account menu does, so Device 1 must be unlocked with that
   * method. The contract names the device and the time; the page requests a
   * challenge bound to the revocation and presents the code.
   */
  async revokeLinkedDeviceWithOwnerEmailOtp(
    options: { readonly refuseFirstRevocationCommit?: boolean } = {},
  ): Promise<void> {
    this.recordStage('revoke_linked_device_with_owner_email_otp');
    const before = await this.readLinkedDeviceInventory();
    const [linked, ...extra] = before.devices;
    if (!linked || extra.length > 0) {
      throw new Error(`revocation expects one linked device, found ${before.devices.length}`);
    }
    const targetWalletAuthMethodId = parseWalletAuthMethodId(linked.walletAuthMethodId);
    if (!targetWalletAuthMethodId.ok) throw new Error(targetWalletAuthMethodId.error.message);
    const requestedAtMs = Date.now();
    const operationFingerprintDigest = String(
      await computeWalletAuthMethodRevokeOperationFingerprintV1({
        walletId: walletIdFromString(this.walletId),
        targetWalletAuthMethodId: targetWalletAuthMethodId.value,
        requestedAtMs,
      }),
    );
    await this.page.evaluate(
      presentLinkedDeviceRevocationToIntendedPage,
      JSON.stringify({
        walletAuthMethodId: linked.walletAuthMethodId,
        requestedAtMs,
        operationFingerprintDigest,
      }),
    );
    const refusedCommit = options.refuseFirstRevocationCommit
      ? await this.refuseFirstRevocationCommitOnce('linked_device')
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction(
        'revokeLinkedDeviceWithEmailOtp',
        'intended-revoke-linked-device-email-otp',
      );
    } finally {
      await refusedCommit?.release();
    }
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `linked-device revocation with an email code ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'linked_device_revoked') {
      throw new Error(`linked-device revocation returned ${result.kind}`);
    }
    if (
      result.walletId !== this.walletId ||
      result.walletAuthMethodId !== linked.walletAuthMethodId
    ) {
      throw new Error(
        `revocation removed ${result.walletAuthMethodId} of ${result.walletId}; expected ${linked.walletAuthMethodId}`,
      );
    }
    refusedCommit?.assertRecovered('email_otp');
    this.emailOtpVerificationCount += 1;

    const after = await this.readLinkedDeviceInventory();
    if (after.devices.length !== 0) {
      throw new Error(`revoked device is still listed: ${JSON.stringify(after.devices)}`);
    }
    assertOwnerDevicesUnchanged(before, after, 'Linked-device revocation');
    this.recordService(
      `linked device revoked with an email code method=${result.walletAuthMethodId} authority=${result.authorityId} epoch=${result.revocationEpoch}`,
    );
  }

  /**
   * Revocation retires Device 2's Wallet Session and signer activations, so
   * each signer family must refuse to sign rather than recover through
   * anything Device 1 still holds.
   */
  async assertRevokedDeviceCannotSign(): Promise<void> {
    this.recordStage('revoked_device_signing_refused');
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'Revoked-device signing',
    );
    const tempo = await this.runIntendedPageAction('signTempoTransaction', 'intended-sign-tempo', {
      expectedOutcome: 'error',
    });
    const near = await this.runIntendedPageAction('signNearTransaction', 'intended-sign-near', {
      nearAccountId: registration.nearAccountId,
      expectedOutcome: 'error',
    });
    for (const [label, snapshot] of [
      ['Tempo', tempo],
      ['NEAR', near],
    ] as const) {
      if (snapshot.action.status !== 'error') {
        throw new Error(`revoked Device 2 ${label} signing ended with ${snapshot.action.status}`);
      }
      this.recordService(`revoked Device 2 ${label} signing refused: ${snapshot.action.error}`);
    }
  }

  private async readLinkedDeviceInventory(): Promise<LinkedDeviceInventorySnapshot> {
    await this.ensureIntendedPageOpen();
    const inventory = parseLinkedDeviceInventory(
      await this.page.evaluate(readLinkedDevicesFromIntendedPage),
    );
    for (const device of inventory.devices) {
      if (device.walletId !== this.walletId) {
        throw new Error(`linked-device inventory listed a device of wallet ${device.walletId}`);
      }
    }
    return inventory;
  }

  /** Device 2: show the link QR and hand back its strictly parsed payload. */
  private async showDeviceLinkQr(): Promise<DeviceLinkQrReadySnapshot> {
    this.recordStage('device_link_show_qr');
    const snapshot = await this.runIntendedPageAction(
      'startDeviceLinkingAsTarget',
      'intended-device-link-start',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(`device-link QR ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'device_link_qr_ready') {
      throw new Error(`device-link QR returned ${result.kind}`);
    }
    const payload = parseQrLinkedDeviceSessionPayloadV5(JSON.parse(result.qrPayloadJson));
    if (String(payload.linkSessionId) !== result.linkSessionId) {
      throw new Error('device-link QR payload names a different link session');
    }
    if (payload.targetFactor.kind !== 'passkey_prf') {
      throw new Error(`device-link QR targets ${payload.targetFactor.kind}, not a passkey`);
    }
    this.recordService(
      `Device ${this.deviceNumber} showing link QR session=${result.linkSessionId}`,
    );
    return result;
  }

  /**
   * Device 2: wait for the link to settle. The page answers the passkey prompt
   * itself; nothing is clicked on this page mid-link because the wallet keeps
   * its link surface over the page until the link settles.
   */
  private async waitForDeviceLinkAsTarget(
    linkSessionId: string,
  ): Promise<DeviceLinkActiveSnapshot> {
    this.recordStage('device_link_target_settle');
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    try {
      await autoConfirmWalletIframeUntil(
        this.page,
        this.page.waitForFunction(intendedDeviceLinkSettled, undefined, { timeout: 150_000 }),
        { timeoutMs: 150_000, intervalMs: 250, diagnostics },
      );
    } catch (error) {
      throw new Error(
        [
          `Device ${this.deviceNumber} link did not settle: ${error instanceof Error ? error.message : String(error)}`,
          `Wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
    }
    const state = await readSettledDeviceLinkState(this.page);
    if (state.linkSessionId !== linkSessionId) {
      throw new Error(
        `Device ${this.deviceNumber} settled link ${state.linkSessionId}; expected ${linkSessionId}`,
      );
    }
    if (state.status === 'failed') {
      throw new Error(
        `Device ${this.deviceNumber} link failed: ${state.error}\n${this.recentTraceForError()}`,
      );
    }
    const { status: _status, ...active } = state;
    this.recordService(`Device ${this.deviceNumber} link active session=${linkSessionId}`);
    return active;
  }

  async registerPasskeyEd25519YaoWallet(): Promise<void> {
    this.recordStage('register_passkey_ed25519_yao_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerPasskeyEd25519YaoWallet',
      'intended-register-passkey-ed25519-yao',
    );
    const result = requirePasskeyRegistrationResult(snapshot, this.walletId);
    const ready = requireNearReadyRegisteredWallet(result, 'Ed25519 Yao registration');
    if (result.ecdsaTargetProfile !== 'none' || result.ecdsaTargetKeys.kind !== 'none') {
      throw new Error('Ed25519 Yao registration unexpectedly provisioned an ECDSA signer');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 Yao passkey registration did not emit lifecycle events');
    }
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `Ed25519 Yao passkey registration succeeded wallet=${ready.walletId} near=${ready.nearAccountId}`,
    );
  }

  async registerPasskeyEd25519YaoWalletWithExactTransportRetry(): Promise<void> {
    this.recordStage('register_passkey_ed25519_yao_wallet_with_exact_transport_retry');
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = this.armIntendedYaoFault('drop_router_response_once');
    try {
      await this.registerPasskeyEd25519YaoWallet();
      this.assertIntendedYaoFaultProof(proofStartIndex, faultToken, 'exact_request_replayed');
    } finally {
      this.intendedYaoFaultInjection = { kind: 'idle' };
    }
  }

  /**
   * A mixed passkey registration whose deferred NEAR finalize loses the
   * Gateway's storage once, right after the batch that made the Ed25519
   * signer visible committed the lifecycle's decision. NEAR is left
   * retryable. Once the Gateway's journal lets a retry take the finalize
   * over, unlocking retries it: the retry finds its own decision, commits
   * nothing again, and completes.
   */
  async registerPasskeyWalletAcrossNearFinalizeStorageLoss(): Promise<void> {
    this.recordStage('register_passkey_wallet_across_near_finalize_storage_loss');
    if (this.config.passkeyEcdsaTargetProfile === 'none') {
      throw new Error('A deferred NEAR finalize needs a mixed passkey registration');
    }
    if (this.intendedYaoFinalizeFaultToken !== null) {
      throw new Error('An intended Yao finalize fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = randomUUID();
    this.intendedYaoFinalizeFaultToken = faultToken;
    const failedFinalize = this.page.waitForResponse(isNearProvisioningFinalizeResponse, {
      timeout: 180_000,
    });
    let failedAtMs: number;
    try {
      await this.registerPasskeyWallet();
      const failed = await failedFinalize;
      expect(await failed.json()).toMatchObject({
        ok: false,
        nearProvisioning: { status: 'near_failed_retryable' },
      });
      failedAtMs = Date.now();
    } finally {
      this.intendedYaoFinalizeFaultToken = null;
    }
    this.assertIntendedYaoFaultProof(
      proofStartIndex,
      faultToken,
      'decision_committed_then_storage_lost',
    );
    await this.page.waitForTimeout(
      Math.max(
        0,
        failedAtMs + WALLET_REGISTRATION_NEAR_PROVISIONING_RESUME_AFTER_MS + 1_000 - Date.now(),
      ),
    );
    await this.unlockPasskeyWithPendingNear();
    await this.awaitNearReady();
    this.recordService('deferred NEAR finalize resumed from its decision after losing storage');
  }

  async assertMixedNearTerminalFailureSurvivesUnlock(): Promise<void> {
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = this.armIntendedYaoFault('return_terminal_burned_once');
    const failed = this.page.waitForResponse(isNearRegistrationExecutionResponse);
    await this.registerPasskeyWallet();
    const initial = await failed;
    expect(await initial.json()).toMatchObject({ ok: false, code: 'execution_failed' });
    this.assertIntendedYaoFaultProof(proofStartIndex, faultToken, 'terminal_failure_not_retried');
    await this.signTempoTransaction('post_registration');
    const replay = this.page.waitForResponse(isNearRegistrationExecutionResponse);
    await this.unlockPasskeyWithPendingNear();
    const retained = await replay;
    expect(await retained.json()).toMatchObject({ ok: false, code: 'execution_failed' });
    expect(retained.request().postData()).toBe(initial.request().postData());
    await this.signArcEvmTransaction('post_unlock');
  }

  async assertPasskeyEd25519YaoTerminalFailureWithoutRetry(): Promise<void> {
    this.recordStage('assert_passkey_ed25519_yao_terminal_failure_without_retry');
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = this.armIntendedYaoFault('return_terminal_burned_once');
    try {
      const snapshot = await this.runIntendedPageAction(
        'registerPasskeyEd25519YaoWallet',
        'intended-register-passkey-ed25519-yao',
        { expectedOutcome: 'error' },
      );
      if (snapshot.action.status !== 'error') {
        throw new Error('Terminal Ed25519 Yao registration unexpectedly succeeded');
      }
      if (!snapshot.action.error.includes('router_execution_burned')) {
        throw new Error(
          `Terminal Ed25519 Yao registration returned the wrong failure: ${snapshot.action.error}`,
        );
      }
      this.passkeyPromptCount += 1;
      this.assertIntendedYaoFaultProof(proofStartIndex, faultToken, 'terminal_failure_not_retried');
      this.recordService('terminal Ed25519 Yao failure returned without a Router retry');
    } finally {
      this.intendedYaoFaultInjection = { kind: 'idle' };
    }
  }

  async addPasskeyEd25519YaoWalletSigner(): Promise<void> {
    this.recordStage('add_passkey_ed25519_yao_wallet_signer');
    const previous = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Ed25519 signer addition',
    );
    const snapshot = await this.runIntendedPageAction(
      'addPasskeyEd25519YaoWalletSigner',
      'intended-add-passkey-ed25519-yao-signer',
    );
    const result = requireEd25519AddSignerResult(snapshot, this.walletId);
    if (
      result.nearAccountId === previous.nearAccountId ||
      result.operationalPublicKey === previous.operationalPublicKey
    ) {
      throw new Error('Ed25519 add-signer did not create a distinct signer identity');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 add-signer did not emit structured lifecycle events');
    }
    this.registeredWallet = {
      kind: 'passkey_registration_success',
      walletId: result.walletId,
      nearReadiness: 'ready',
      nearAccountId: result.nearAccountId,
      operationalPublicKey: result.operationalPublicKey,
      ecdsaTargetProfile: 'none',
      ecdsaTargetKeys: { kind: 'none' },
    };
    this.nearSignerSlot = 2;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `Ed25519 Yao signer added wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  /**
   * A NEAR-ready passkey wallet without ECDSA gains an ECDSA signer through the
   * public add-signer path; later EVM signatures must recover to its address.
   */
  async addPasskeyEcdsaWalletSigner(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_passkey_ecdsa_wallet_signer');
    const previous = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'ECDSA signer addition',
    );
    if (previous.ecdsaTargetProfile !== 'none') {
      throw new Error('ECDSA signer addition expects a wallet without an ECDSA signer');
    }
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddSignerFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction(
        'addPasskeyEcdsaWalletSigner',
        'intended-add-passkey-ecdsa-signer',
      );
    } finally {
      await lostFinalize?.release();
    }
    if (lostFinalize) lostFinalize.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `ECDSA add-signer ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'ecdsa_signer_added' || result.walletId !== this.walletId) {
      throw new Error(`ECDSA add-signer returned ${result.kind} for ${result.walletId}`);
    }
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA add-signer provisioned no ECDSA target');
    }
    if (snapshot.events.length === 0) {
      throw new Error('ECDSA add-signer did not emit structured lifecycle events');
    }
    const { kind: _kind, walletId: _walletId, ...ecdsa } = result;
    this.registeredWallet = {
      kind: 'passkey_registration_success',
      walletId: previous.walletId,
      nearReadiness: 'ready',
      nearAccountId: previous.nearAccountId,
      operationalPublicKey: previous.operationalPublicKey,
      ...ecdsa,
    };
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `ECDSA signer added wallet=${result.walletId} profile=${result.ecdsaTargetProfile}`,
    );
  }

  /**
   * Lets the first add-signer finalize reach the Gateway and commit, then drops
   * its response, so the SDK must recover the committed outcome by asking
   * again. The retry must carry the same idempotency key and receive exactly
   * the response that was lost.
   */
  private async loseAddSignerFinalizeResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const finalizePath = /\/wallets\/[^/]+\/signers\/finalize$/;
    const attempts: { readonly idempotencyKey: string; readonly body: string }[] = [];
    const handler = async (route: Route): Promise<void> => {
      if (route.request().method() !== 'POST' || !finalizePath.test(new URL(route.request().url()).pathname)) {
        await route.fallback();
        return;
      }
      const request = route.request().postDataJSON() as { readonly idempotencyKey?: unknown };
      const response = await route.fetch();
      attempts.push({
        idempotencyKey: String(request.idempotencyKey ?? ''),
        body: await response.text(),
      });
      if (attempts.length === 1) {
        await route.abort('connectionreset');
        return;
      }
      await route.fulfill({ response });
    };
    await this.context.route('**/signers/finalize', handler);
    return {
      release: async () => {
        await this.context.unroute('**/signers/finalize', handler);
      },
      assertReplayed: () => {
        const [lost, replayed] = attempts;
        if (attempts.length !== 2 || !lost || !replayed) {
          throw new Error(`Add-signer finalize expected one lost and one replayed response, saw ${attempts.length}`);
        }
        if (!lost.idempotencyKey || lost.idempotencyKey !== replayed.idempotencyKey) {
          throw new Error('Add-signer finalize retry changed its idempotency key');
        }
        expect(JSON.parse(replayed.body)).toEqual(JSON.parse(lost.body));
        this.recordService('add-signer finalize lost its response and replayed the committed outcome');
      },
    };
  }

  /**
   * Lets the first add-auth-method finalize reach the Gateway and commit, then
   * drops its response. The SDK recovers the committed outcome by asking
   * again with the exact same request, and must receive exactly the response
   * that was lost: one added method, not two.
   */
  private async loseAddAuthMethodFinalizeResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const finalizePath = /\/wallets\/[^/]+\/auth-methods\/finalize$/;
    const attempts: { readonly request: string; readonly body: string }[] = [];
    const handler = async (route: Route): Promise<void> => {
      if (
        route.request().method() !== 'POST' ||
        !finalizePath.test(new URL(route.request().url()).pathname)
      ) {
        await route.fallback();
        return;
      }
      const request = route.request().postData() ?? '';
      const response = await route.fetch();
      attempts.push({ request, body: await response.text() });
      if (attempts.length === 1) {
        await route.abort('connectionreset');
        return;
      }
      await route.fulfill({ response });
    };
    await this.context.route('**/auth-methods/finalize', handler);
    return {
      release: async () => {
        await this.context.unroute('**/auth-methods/finalize', handler);
      },
      assertReplayed: () => {
        const [lost, replayed] = attempts;
        if (attempts.length !== 2 || !lost || !replayed) {
          throw new Error(
            `Add-auth-method finalize expected one lost and one replayed response, saw ${attempts.length}`,
          );
        }
        if (replayed.request !== lost.request) {
          throw new Error('Add-auth-method finalize retry changed its request');
        }
        expect(JSON.parse(replayed.body)).toEqual(JSON.parse(lost.body));
        this.recordService(
          'add-auth-method finalize lost its response and replayed the committed outcome',
        );
      },
    };
  }

  /**
   * The registered passkey wallet gains an Email OTP method. The wallet prompts
   * for the code on its own surface, so the same auto-confirm that drives every
   * other Email OTP step drives this one.
   */
  async addEmailOtpAuthMethod(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_email_otp_auth_method');
    const registration = this.requireRegisteredWalletForSigning();
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddAuthMethodFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction(
        'addEmailOtpAuthMethod',
        'intended-add-email-otp-auth-method',
      );
    } finally {
      await lostFinalize?.release();
    }
    lostFinalize?.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(`add-email-code ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'add_email_otp_success') {
      throw new Error(
        `add-email-code returned the wrong result: ${JSON.stringify(snapshot.action.result)}`,
      );
    }
    if (String(result.walletId) !== String(registration.walletId)) {
      throw new Error('add-email-code returned a different wallet');
    }
    this.emailOtpVerificationCount += 1;
    this.crossFamilyAuthMethodAdditionRan = true;
    this.addedWalletAuthMethodId = result.walletAuthMethodId;
    this.recordService(
      `email code added wallet=${String(result.walletId)} email=${String(result.emailAddress)} method=${result.walletAuthMethodId}`,
    );
  }

  /**
   * Retire the method that did the adding.
   *
   * The page picks the target - the one sibling that is not the method just
   * added - so the test cannot accidentally revoke the credential it is about
   * to rely on.
   */
  async revokeSourceAuthMethod(
    expect: 'source' | 'added' = 'source',
    options: { readonly refuseFirstRevocationCommit?: boolean } = {},
  ): Promise<void> {
    this.recordStage(`revoke_${expect}_auth_method`);
    const registration = this.requireRegisteredWalletForSigning();
    const sourceFamily = this.currentOperatingAuthFamily();
    const refusedCommit = options.refuseFirstRevocationCommit
      ? await this.refuseFirstRevocationCommitOnce('auth_method')
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction(
        'revokeSourceAuthMethod',
        'intended-revoke-source-auth-method',
      );
    } finally {
      await refusedCommit?.release();
    }
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `revoke ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'revoke_auth_method_success') {
      throw new Error(`revoke returned ${result.kind}`);
    }
    if (result.walletId !== registration.walletId) {
      throw new Error('revoke targeted a different wallet');
    }
    /* The page always removes the sibling of whoever holds the session, so
       which one that is depends on which method the test is operating as. Say
       it out loud, otherwise a contract that unlocked with the wrong method
       would still look like it passed. */
    const removedAdded = result.walletAuthMethodId === this.addedWalletAuthMethodId;
    if (expect === 'added' && !removedAdded) {
      throw new Error('revoke removed the source method, not the added one');
    }
    if (expect === 'source' && removedAdded) {
      throw new Error('revoke removed the added method instead of its sibling');
    }
    refusedCommit?.assertRecovered(sourceFamily);
    if (sourceFamily === 'passkey') {
      this.passkeyPromptCount += 1;
    } else {
      this.emailOtpVerificationCount += 1;
    }
    this.recordService(`revoked ${expect} method=${result.walletAuthMethodId}`);
  }

  /**
   * The Gateway refuses the first revocation's commit, as a batch that failed,
   * and that answer is lost too, so the SDK sends the exact request again. The
   * retry must commit on the same proof: an Email OTP code is spent only by
   * the batch that revokes, so a failed commit leaves it usable. The harness
   * then sends the committed request once more. Its code is spent by then, so
   * only the Gateway's record of the revocation can answer, and the answer
   * must be exactly the one the retry received.
   */
  private async refuseFirstRevocationCommitOnce(route: 'auth_method' | 'linked_device'): Promise<{
    readonly release: () => Promise<void>;
    readonly assertRecovered: (sourceFamily: 'passkey' | 'email_otp') => void;
  }> {
    /* An auth method is revoked directly, or as a linked device's through
       device management. Each route answers its refused commit its own way. */
    const revokePath =
      route === 'auth_method'
        ? /\/wallets\/[^/]+\/auth-methods\/[^/]+\/revoke$/
        : /\/wallet\/device-linking\/v1\/devices\/[^/]+\/revoke$/;
    const label = route === 'auth_method' ? 'Auth-method revoke' : 'Linked-device revoke';
    /* The route needs the wallet's Origin, which Playwright's provisional
       headers may leave out of a forwarded request. */
    const origin = new URL(this.config.walletOrigin).origin;
    const token = randomUUID();
    type Attempt = {
      readonly request: string;
      readonly status: number;
      readonly body: string;
      readonly proof: string | null;
    };
    const attempts: Attempt[] = [];
    let replayed: Attempt | null = null;
    const changed: { readonly change: string; readonly status: number; readonly body: string }[] =
      [];
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (request.method() !== 'POST' || !revokePath.test(new URL(request.url()).pathname)) {
        await route.fallback();
        return;
      }
      const headers = { ...request.headers(), origin };
      const body = request.postData() ?? '';
      if (attempts.length === 0) {
        const refused = await route.fetch({
          headers: {
            ...headers,
            [LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1]: 'refuse_revocation_batch_once',
            [LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1]: token,
          },
        });
        attempts.push({
          request: body,
          status: refused.status(),
          body: await refused.text(),
          proof: refused.headers()[LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1] ?? null,
        });
        await route.abort('connectionreset');
        return;
      }
      const committed = await route.fetch({ headers });
      attempts.push({
        request: body,
        status: committed.status(),
        body: await committed.text(),
        proof: null,
      });
      if (attempts.length === 2) {
        const replay = await route.fetch({ headers });
        replayed = {
          request: body,
          status: replay.status(),
          body: await replay.text(),
          proof: null,
        };
        /* A changed request is not the one that committed: it must be refused,
           never answered from the record. */
        for (const change of ['operation', 'proof'] as const) {
          const refused = await route.fetch({
            headers,
            postData: changedRevokeRequestBody(body, change),
          });
          changed.push({ change, status: refused.status(), body: await refused.text() });
        }
      }
      await route.fulfill({ response: committed });
    };
    await this.context.route('**/revoke', handler);
    return {
      release: async () => {
        await this.context.unroute('**/revoke', handler);
      },
      assertRecovered: (sourceFamily) => {
        const [refused, committed] = attempts;
        const replay: Attempt | null = replayed;
        if (attempts.length !== 2 || !refused || !committed || !replay) {
          throw new Error(
            `${label} expected a refused commit, one retry and a replay, saw ${attempts.length} attempts`,
          );
        }
        const expectedProof = `${token}:${
          sourceFamily === 'email_otp'
            ? 'refused_revocation_with_its_code'
            : 'refused_revocation_without_code'
        }`;
        if (refused.proof !== expectedProof) {
          throw new Error(
            `${label} expected the refused-commit proof ${expectedProof}, saw ${refused.proof ?? 'none'}`,
          );
        }
        const refusal = JSON.parse(refused.body) as {
          readonly ok?: unknown;
          readonly code?: unknown;
          readonly kind?: unknown;
        };
        const refusedAsConflict =
          route === 'auth_method'
            ? refused.status === 400 && refusal.ok === false && refusal.code === 'conflict'
            : refused.status === 409 && refusal.ok === false && refusal.kind === 'conflict';
        if (!refusedAsConflict) {
          throw new Error(`${label}'s refused commit answered ${refused.status}: ${refused.body}`);
        }
        if (committed.request !== refused.request || replay.request !== refused.request) {
          throw new Error(`${label} retry changed its request`);
        }
        const answer = JSON.parse(committed.body) as { readonly ok?: unknown };
        if (committed.status !== 200 || answer.ok !== true) {
          throw new Error(
            `${label} retry on the same proof answered ${committed.status}: ${committed.body}`,
          );
        }
        if (replay.status !== committed.status || replay.body !== committed.body) {
          throw new Error(
            `${label} replay answered ${replay.status}: ${replay.body}, not the committed answer`,
          );
        }
        if (changed.length !== 2) {
          throw new Error(`${label} sent ${changed.length} changed requests, expected 2`);
        }
        for (const refusal of changed) {
          if (refusal.status !== 401 || refusal.body === committed.body) {
            throw new Error(
              `${label} with a changed ${refusal.change} answered ${refusal.status}: ${refusal.body}`,
            );
          }
        }
        this.recordService(
          `${label}: a refused commit spent nothing, the retry committed on the same ${sourceFamily} proof, and a replay received the recorded answer`,
        );
      },
    };
  }

  /**
   * Adding a family the authority already has is refused at admission, before
   * anything is verified or written.
   *
   * The counters matter as much as the refusal. A repeat that costs the user
   * another code, or writes a second enrollment before noticing, is a
   * different behaviour from one that answers off the existing inventory.
   */
  async assertRepeatAdditionIsAlreadyConfigured(
    action: 'addPasskeyAuthMethod' | 'addEmailOtpAuthMethod',
  ): Promise<void> {
    this.recordStage('repeat_addition_already_configured');
    const passkeyPromptsBefore = this.passkeyPromptCount;
    const emailVerificationsBefore = this.emailOtpVerificationCount;
    const snapshot = await this.runIntendedPageAction(
      action,
      action === 'addPasskeyAuthMethod'
        ? 'intended-add-passkey-auth-method'
        : 'intended-add-email-otp-auth-method',
      { expectedOutcome: 'error' },
    );
    if (snapshot.action.status === 'success') {
      throw new Error('repeating an addition succeeded; it must be already_configured');
    }
    const detail = String(snapshot.action.status === 'error' ? snapshot.action.error : '');
    if (!/already[\s_]?(has|configured)/i.test(detail)) {
      throw new Error(`repeat addition failed for the wrong reason: ${detail}`);
    }
    if (
      this.passkeyPromptCount !== passkeyPromptsBefore ||
      this.emailOtpVerificationCount !== emailVerificationsBefore
    ) {
      throw new Error('repeat addition verified a factor before answering already_configured');
    }
    this.recordService('repeat addition refused as already configured');
  }

  /**
   * The last way into a wallet cannot be removed.
   *
   * A wallet with one method has no sibling to authorize the removal, and a
   * method may not authorize its own. Together those leave the last credential
   * un-removable, which is the property that makes revocation safe to offer at
   * all.
   */
  async assertFinalAuthMethodCannotBeRevoked(): Promise<void> {
    this.recordStage('final_auth_method_revocation_refused');
    const snapshot = await this.runIntendedPageAction(
      'revokeSourceAuthMethod',
      'intended-revoke-source-auth-method',
      { expectedOutcome: 'error' },
    );
    if (snapshot.action.status === 'success') {
      throw new Error('revoking the final auth method succeeded; it must be refused');
    }
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (!/sibling/i.test(String(detail))) {
      throw new Error(`final auth method revocation failed for the wrong reason: ${detail}`);
    }
    this.recordService('final auth method revocation refused');
  }

  /**
   * The wallet's Email OTP method was revoked: a fresh code must no longer
   * open the wallet, and the refusal must come from the revocation, not from
   * some unrelated failure.
   * - `registered`, a wallet registered with Email OTP: the auth menu still
   *   offers Google for it, so the Gateway's Google verification must refuse
   *   this wallet, whose Email OTP enrollment the revocation removed.
   * - `added`, a wallet that gained the method later: its session no longer
   *   lists the method, so the unlock finds no Email OTP method to open.
   * Either way the unlock never reaches an Email OTP challenge, a factor
   * release or an unlock verification.
   */
  async assertRevokedEmailOtpCannotUnlock(method: 'registered' | 'added'): Promise<void> {
    this.recordStage(`revoked_${method}_email_otp_unlock_refused`);
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const refusal =
      method === 'registered'
        ? await this.refuseRevokedRegisteredEmailOtpUnlock()
        : await this.refuseRevokedAddedEmailOtpUnlock();
    const reached = this.trace
      .slice(traceStartIndex)
      .filter(isRequestTraceEntry)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter(
        (path): path is string => path !== null && EMAIL_OTP_UNLOCK_GATEWAY_PATHS_V1.has(path),
      );
    if (reached.length > 0) {
      throw new Error(`revoked Email OTP unlock still reached ${reached.join(', ')}`);
    }
    this.recordService(`revoked ${method} Email OTP unlock refused: ${refusal}`);
  }

  /**
   * The Gateway answers the Google verification without this wallet: on
   * fresh services no wallet is enrolled for the Google identity any more
   * (`stale_identity_mapping` naming this wallet); where another wallet is
   * enrolled for it, the answer names that one. The menu keeps the refusal on
   * screen and never settles, so the harness closes it.
   */
  private async refuseRevokedRegisteredEmailOtpUnlock(): Promise<string> {
    const verification = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        routePathAtRouter(response.url(), this.config.routerUrl) ===
          GOOGLE_EMAIL_OTP_VERIFY_PATH_V1,
      { timeout: 60_000 },
    );
    const action = this.runIntendedPageAction('unlockEmailOtpWallet', 'intended-unlock-email-otp', {
      expectedOutcome: 'error',
    });
    /* Settled below, once the menu is closed. */
    action.catch(() => undefined);
    const response = await verification;
    const answer = (await response.json().catch(() => null)) as {
      readonly code?: unknown;
      readonly walletId?: unknown;
    } | null;
    const refusedHere =
      response.status() === 400 &&
      answer?.code === 'stale_identity_mapping' &&
      answer.walletId === this.walletId;
    const answeredAnotherWallet =
      response.ok() && typeof answer?.walletId === 'string' && answer.walletId !== this.walletId;
    if (!refusedHere && !answeredAnotherWallet) {
      throw new Error(
        `revoked Email OTP verification answered ${response.status()}: ${JSON.stringify(answer)}`,
      );
    }
    await this.page
      .locator('iframe[allow*="publickey-credentials-get"]')
      .last()
      .contentFrame()
      .locator('.auth-menu-root')
      .press('Escape');
    const snapshot = await action;
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (detail !== 'Google Email OTP unlock ended with cancelled') {
      throw new Error(`revoked Email OTP unlock ended for another reason: ${detail}`);
    }
    return refusedHere
      ? `Google verification found no enrollment for ${this.walletId}`
      : `Google verification answered wallet ${String(answer?.walletId)}`;
  }

  /** The wallet's session no longer lists the revoked method. */
  private async refuseRevokedAddedEmailOtpUnlock(): Promise<string> {
    const snapshot = await this.runIntendedPageAction(
      'unlockWithAddedEmailOtp',
      'intended-unlock-added-email-otp',
      { expectedOutcome: 'error' },
    );
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (detail !== 'added email-code unlock needs one email method, found 0') {
      throw new Error(`revoked added Email OTP unlock ended for another reason: ${detail}`);
    }
    return 'the wallet lists no Email OTP method';
  }

  /**
   * The authenticated capability belongs to the method that opened it.
   *
   * The family alone proves nothing here - both methods live on one authority,
   * and the wallet would look identical if it had authenticated the method
   * that did the adding. Only the exact capability id separates the two.
   */
  private assertWalletSessionNamesAddedMethod(input: {
    readonly label: string;
    readonly sessionWalletAuthMethodId: string;
  }): void {
    const expected = this.addedWalletAuthMethodId;
    if (!expected) {
      throw new Error(`${input.label} unlock ran without a recorded added auth method`);
    }
    if (input.sessionWalletAuthMethodId !== expected) {
      throw new Error(
        `${input.label} unlock authenticated ${input.sessionWalletAuthMethodId}, not the added ${expected}`,
      );
    }
    this.recordService(`${input.label} authenticated method=${expected}`);
  }

  /**
   * The method just added actually opens the wallet.
   *
   * Deliberately not `unlockPasskeyWallet`, which requires a passkey-REGISTERED
   * wallet. The point here is the opposite: this wallet was registered with the
   * other family, and the passkey it is unlocking with exists only because the
   * addition created it. Gating on how the wallet was registered would refuse
   * the exact case under test.
   */
  async unlockWithAddedPasskey(): Promise<void> {
    this.recordStage('unlock_with_added_passkey');
    const registration = this.requireRegisteredWalletForSigning();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction(
      'unlockPasskeyWallet',
      'intended-unlock-passkey',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `unlock with the added passkey ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'passkey_unlock_success') {
      throw new Error(`unlock with the added passkey returned ${result.kind}`);
    }
    if (result.walletId !== registration.walletId) {
      throw new Error('unlock with the added passkey opened a different wallet');
    }
    /* The added method inherits whatever the wallet already had. A NEAR-ready
       wallet must still open NEAR through it - losing NEAR by adding a passkey
       would be the bug - while an ECDSA-only wallet has no NEAR identity for
       any method to return. Asserting one shape for both would encode the
       wallet's provisioning state into the addition. */
    const expectedNearIdentity = registration.nearReadiness === 'ready' ? 'ready' : 'absent';
    if (result.nearIdentity !== expectedNearIdentity) {
      throw new Error(
        `added-passkey unlock returned NEAR identity ${result.nearIdentity} for a ${registration.nearReadiness} wallet`,
      );
    }
    if (result.authenticationKind !== 'authenticated') {
      throw new Error(
        `unlock with the added passkey did not authenticate the wallet: ${result.authenticationKind}`,
      );
    }
    this.assertWalletSessionNamesAddedMethod({
      label: 'added passkey',
      sessionWalletAuthMethodId: result.sessionWalletAuthMethodId,
    });
    const observedPaths = this.trace
      .slice(traceStartIndex)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter((path): path is string => path !== null);
    if (!observedPaths.includes('/wallet/unlock/verify')) {
      throw new Error('Added passkey unlock did not traverse /wallet/unlock/verify');
    }
    this.passkeyPromptCount += 1;
    this.operatingAuthFamily = 'passkey';
    this.recordService(`added passkey unlocked wallet=${String(registration.walletId)}`);
  }

  /**
   * Signer-profile matrix: register a wallet whose signer set is ECDSA only.
   *
   * It becomes the registered wallet like any other, but with NEAR reported
   * absent rather than pending, so anything that would ask it to sign NEAR
   * fails on the readiness check instead of waiting for an account that is
   * never coming.
   */
  async registerPasskeyEcdsaOnlyWallet(): Promise<void> {
    this.recordStage('register_passkey_ecdsa_only_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerPasskeyEcdsaOnlyWallet',
      'intended-register-passkey-ecdsa-only',
    );
    const result = requirePasskeyRegistrationResult(snapshot, this.walletId);
    if (result.nearReadiness !== 'absent') {
      throw new Error(`ECDSA-only registration reported NEAR ${result.nearReadiness}`);
    }
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA-only registration provisioned no ECDSA target');
    }
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `ECDSA-only passkey registration succeeded wallet=${result.walletId} profile=${result.ecdsaTargetProfile}`,
    );
  }

  /** Signer-profile matrix: an Email OTP wallet whose signer set is ECDSA only. */
  async registerEmailOtpEcdsaOnlyWallet(): Promise<void> {
    this.recordStage('register_email_otp_ecdsa_only_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerEmailOtpEcdsaOnlyWallet',
      'intended-register-email-otp-ecdsa-only',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `ECDSA-only Email OTP registration ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'email_otp_registration_success') {
      throw new Error(`ECDSA-only Email OTP registration returned ${result.kind}`);
    }
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA-only Email OTP registration provisioned no ECDSA target');
    }
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(`ECDSA-only Email OTP registration succeeded wallet=${result.walletId}`);
  }

  /** Signer-profile matrix: an Email OTP wallet whose signer set is Ed25519 only. */
  async registerEmailOtpEd25519OnlyWallet(): Promise<void> {
    this.recordStage('register_email_otp_ed25519_only_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerEmailOtpEd25519OnlyWallet',
      'intended-register-email-otp-ed25519-only',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `Ed25519-only Email OTP registration ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'email_otp_registration_success') {
      throw new Error(`Ed25519-only Email OTP registration returned ${result.kind}`);
    }
    if (result.ecdsaTargetProfile !== 'none') {
      throw new Error('Ed25519-only Email OTP registration provisioned an ECDSA signer');
    }
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(`Ed25519-only Email OTP registration succeeded wallet=${result.walletId}`);
  }

  /** An Email OTP wallet gains a Passkey method. */
  async addPasskeyAuthMethod(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_passkey_auth_method');
    const registration = this.requireRegisteredWalletForSigning();
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddAuthMethodFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction(
        'addPasskeyAuthMethod',
        'intended-add-passkey-auth-method',
      );
    } finally {
      await lostFinalize?.release();
    }
    lostFinalize?.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(`add-passkey ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'add_passkey_success') {
      throw new Error(
        `add-passkey returned the wrong result: ${JSON.stringify(snapshot.action.result)}`,
      );
    }
    if (String(result.walletId) !== String(registration.walletId)) {
      throw new Error('add-passkey returned a different wallet');
    }
    this.emailOtpVerificationCount += 1;
    this.passkeyPromptCount += 1;
    this.crossFamilyAuthMethodAdditionRan = true;
    this.addedWalletAuthMethodId = result.walletAuthMethodId;
    this.recordService(
      `passkey added wallet=${String(result.walletId)} rp=${String(result.rpId)} method=${result.walletAuthMethodId}`,
    );
  }

  async registerEmailOtpWallet(): Promise<void> {
    this.recordStage('register_email_otp_wallet');
    const snapshot = await this.runIntendedPageAction(
      'registerEmailOtpWallet',
      'intended-register-email-otp',
      { onRecoveryCodes: this.captureRecoveryCodes },
    );
    if (this.recoveryCodes.length === 0) {
      this.captureRecoveryCodes(
        await waitForWalletRecoveryCodeBackup(
          this.page,
          this.latestWalletIframeAutoConfirmDiagnostics || undefined,
        ),
      );
    }
    const result = requireEmailOtpRegistrationResult(snapshot);
    if (snapshot.events.length === 0) {
      throw new Error('Email OTP registration did not emit structured lifecycle events');
    }
    this.walletId = result.walletId;
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(
      result.nearReadiness === 'ready'
        ? `email otp registration succeeded initial=${result.initialWalletId} wallet=${result.walletId} near=${result.nearAccountId}`
        : `email otp registration succeeded ECDSA-ready initial=${result.initialWalletId} wallet=${result.walletId} near=${nearStateLabel(result)}`,
    );
  }

  /** Resolves once the trace holds a console message containing `fragment`. */
  async waitForTraceConsoleMessage(fragment: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        this.trace.some((entry) => entry.kind === 'console' && entry.message.includes(fragment))
      ) {
        return;
      }
      await this.page.waitForTimeout(10);
    }
    throw new Error(`The trace did not log ${fragment} within ${timeoutMs} ms`);
  }

  /**
   * Holds every Wallet Session status answer until released. The Gateway
   * answers each request when it arrives; only the answer's delivery to the
   * wallet waits.
   */
  async holdWalletSessionStatusAnswers(): Promise<{
    readonly heldCount: () => number;
    readonly release: () => void;
    readonly dispose: () => Promise<void>;
  }> {
    const statusPath = '/wallet/session/status';
    /* The status route needs the wallet's Origin, which Playwright's
       provisional headers may leave out of a forwarded request. */
    const origin = new URL(this.config.walletOrigin).origin;
    let holding = true;
    let held = 0;
    let releaseAll: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (
        !holding ||
        request.method() !== 'POST' ||
        new URL(request.url()).pathname !== statusPath
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch({ headers: { ...request.headers(), origin } });
      held += 1;
      await released;
      await route.fulfill({ response });
    };
    await this.context.route(`**${statusPath}`, handler);
    const release = (): void => {
      holding = false;
      releaseAll();
    };
    return {
      heldCount: () => held,
      release,
      dispose: async () => {
        release();
        await this.context.unroute(`**${statusPath}`, handler);
      },
    };
  }

  /**
   * Holds a read-write transaction on one of the wallet's IndexedDB stores, in
   * the wallet's frame, until released. Every transaction made meanwhile that
   * touches the store waits behind it, and they run in the order they were
   * made.
   */
  async holdWalletIndexedDbStore(
    storeName: string,
  ): Promise<{ readonly release: () => Promise<void> }> {
    const frame = await walletServiceFrame(this.page, this.config.walletOrigin);
    await frame.evaluate(startHeldWalletStore, storeName);
    return {
      release: async () => {
        await frame.evaluate(releaseHeldWalletStore);
      },
    };
  }

  async awaitNearReady(): Promise<void> {
    this.recordStage('near.await_ready');
    const registration = this.requireRegisteredWalletForSigning();
    if (registration.nearReadiness === 'ready') {
      this.recordService(`NEAR already ready wallet=${registration.walletId}`);
      return;
    }
    const snapshot = await this.runIntendedPageAction(
      'awaitNearReady',
      'intended-await-near-ready',
    );
    const ready = requireNearProvisioningReadyResult(snapshot, this.walletId);
    this.registeredWallet = registeredWalletWithNearReady(registration, ready);
    this.recordService(
      `NEAR provisioning ready wallet=${ready.walletId} near=${ready.nearAccountId}`,
    );
  }

  /**
   * The Email OTP method just added actually opens the wallet.
   *
   * The hosted Google menu names the selected wallet, proves its verified
   * address, and opens the exact Email OTP method added to a passkey-founded
   * wallet.
   */
  async unlockWithAddedEmailOtp(): Promise<void> {
    this.recordStage('unlock_with_added_email_otp');
    const registration = this.requireRegisteredWalletForSigning();
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction(
      'unlockWithAddedEmailOtp',
      'intended-unlock-added-email-otp',
    );
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `unlock with the added email code ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'added_email_otp_unlock_success') {
      throw new Error(`unlock with the added email code returned ${result.kind}`);
    }
    if (result.walletId !== registration.walletId) {
      throw new Error('unlock with the added email code opened a different wallet');
    }
    if (result.authenticationKind !== 'authenticated') {
      throw new Error(
        `unlock with the added email code did not authenticate the wallet: ${result.authenticationKind}`,
      );
    }
    this.assertWalletSessionNamesAddedMethod({
      label: 'added email code',
      sessionWalletAuthMethodId: result.sessionWalletAuthMethodId,
    });
    const observedPaths = new Set(
      this.trace
        .slice(traceStartIndex)
        .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
        .filter((path): path is string => path !== null),
    );
    for (const expectedPath of [
      '/auth/google/verify',
      '/wallet/email-otp/challenge',
      '/wallet/email-otp/factor-release',
      '/wallet/unlock/verify',
    ]) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`Added Email OTP unlock did not traverse ${expectedPath}`);
      }
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
    this.operatingAuthFamily = 'email_otp';
    this.recordService(`added email code unlocked wallet=${String(registration.walletId)}`);
  }

  async unlockPasskeyWithPendingNear(): Promise<void> {
    this.recordStage('unlock_passkey_with_pending_near');
    await this.resetRuntimeOnlyState();
    const snapshot = await this.runIntendedPageAction(
      'unlockPasskeyWallet',
      'intended-unlock-passkey',
    );
    if (snapshot.action?.status !== 'success')
      throw new Error('Pending NEAR Passkey unlock failed');
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
  }

  async unlockEmailOtpWithPendingNear(): Promise<void> {
    this.recordStage('unlock_email_otp_with_pending_near');
    await this.resetRuntimeOnlyState();
    const snapshot = await this.runIntendedPageAction(
      'unlockEmailOtpWallet',
      'intended-unlock-email-otp',
    );
    if (snapshot.action?.status !== 'success') {
      throw new Error('Pending NEAR Email OTP unlock failed');
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
  }

  async unlockPasskeyWallet(): Promise<void> {
    this.recordStage('unlock_passkey_wallet');
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'Passkey unlock',
    );
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction(
      'unlockPasskeyWallet',
      'intended-unlock-passkey',
    );
    const result = requirePasskeyUnlockResult(snapshot, {
      walletId: this.walletId,
      nearAccountId: registration.nearAccountId,
      operationalPublicKey: registration.operationalPublicKey,
    });
    const observedPaths = this.trace
      .slice(traceStartIndex)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter((path): path is string => path !== null);
    if (!observedPaths.includes('/wallet/unlock/verify')) {
      throw new Error('Passkey unlock did not traverse /wallet/unlock/verify');
    }
    if (observedPaths.includes('/router-ab/wallet-session/ed25519')) {
      throw new Error('Passkey unlock requested a second Ed25519 Wallet Session ceremony');
    }
    const unlockRequests = this.trace.slice(traceStartIndex).filter(isRequestTraceEntry);
    const verifyIndex = unlockRequests.findIndex(isWalletUnlockVerifyRequest);
    const statusReads = unlockRequests.slice(verifyIndex + 1).filter(isWalletSessionStatusRequest);
    expect(
      statusReads.length,
      'post-passkey unlock must avoid redundant session-status reads',
    ).toBeLessThanOrEqual(3);
    this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
      kind: 'passkey_unlock',
    });
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
    this.recordService(
      `passkey unlock succeeded wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  async syncPasskeyWalletFromEmptyStorage(): Promise<void> {
    this.recordStage('sync_passkey_wallet_from_empty_storage');
    const registration = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Passkey cold sync',
    );
    await this.clearBrowserStorageForColdSync();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('syncPasskeyWallet', 'intended-sync-passkey');
    const result = requirePasskeySyncResult(snapshot, registration);
    const observedPaths = this.trace
      .slice(traceStartIndex)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter((path): path is string => path !== null);
    if (!observedPaths.includes('/sync-account/verify')) {
      throw new Error('Passkey cold sync did not traverse /sync-account/verify');
    }
    if (observedPaths.some((path) => path.startsWith('/wallets/recovery/'))) {
      throw new Error('Passkey cold sync unexpectedly consumed wallet recovery state');
    }
    if (observedPaths.some((path) => path.startsWith('/wallets/register/'))) {
      throw new Error('Passkey cold sync unexpectedly created another wallet registration');
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
    this.recordService(
      `passkey cold sync restored wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  async recoverPasskeyWalletFromFreshBrowser(): Promise<void> {
    this.recordStage('recover_passkey_wallet_from_fresh_browser');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({
      action: recoveryActionForTarget('passkey'),
    });
    await driveHostedPasskeyRecovery(this.page, recoveryCode);
    const snapshot = await this.waitForIntendedPageActionCompletion(
      'recoverPasskeyWallet',
      'success',
    );
    const result = requirePasskeyRecoveryResult(snapshot, this.walletId);
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += 2;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('fresh-browser passkey recovery completed through normal passkey login');
  }

  async recoverPasskeyWalletAfterFailedFinalization(): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_failed_finalization');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const prepareCapture: RecoveryPrepareCapture = { reservationIds: [] };
    const capturePrepareReservation = captureRecoveryPrepareReservation.bind(null, prepareCapture);
    const finalizeFailure: RecoveryFinalizeFailure = { injected: false };
    const failFirstFinalization = failFirstRecoveryFinalization.bind(null, finalizeFailure);
    this.page.on('request', capturePrepareReservation);
    await this.page.route(`**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`, failFirstFinalization);
    try {
      const frame = await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await expect(frame.locator('.seams-recovery-status')).toHaveText(
        'Recovery couldn’t be completed. Try again.',
        { timeout: 60_000 },
      );
      await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
        timeout: 30_000,
      });
      await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    } finally {
      await this.page.unroute(
        `**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`,
        failFirstFinalization,
      );
      this.page.off('request', capturePrepareReservation);
    }
    const snapshot = await this.waitForIntendedPageActionCompletion(action.name, 'success');
    const result = requirePasskeyRecoveryResult(snapshot, this.walletId);
    this.assertRecoveryCodeConsumption(result);
    if (prepareCapture.reservationIds.length !== 1 || !finalizeFailure.injected) {
      throw new Error('Recovery finalization retry did not reuse the admitted recovery operation');
    }
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += 3;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('failed finalization left the admitted recovery code reusable');
  }

  /**
   * A fresh-browser recovery whose first attempt is interrupted: the Router
   * runs its execution, staging the attempt's candidate at the SigningWorker,
   * and every reply to it is lost, the Gateway's replay included. The Gateway
   * records the execution as interrupted. Retrying with the same code starts a
   * new attempt of the same recovery, which takes the interrupted attempt's
   * place at the Gateway and its candidate's place at the SigningWorker, then
   * recovers.
   */
  async recoverPasskeyWalletAfterInterruptedAttempt(): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_interrupted_attempt');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    if (this.intendedYaoRecoveryFault !== null) {
      throw new Error('An intended Yao recovery fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = randomUUID();
    this.intendedYaoRecoveryFault = { mode: 'lose_router_recovery_replies', token: faultToken };
    let frame: FrameLocator;
    try {
      frame = await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await expect(frame.locator('.seams-recovery-status').last()).toHaveText(
        'Recovery couldn’t be completed. Try again.',
        { timeout: 120_000 },
      );
    } finally {
      this.intendedYaoRecoveryFault = null;
    }
    this.assertIntendedYaoFaultProof(
      proofStartIndex,
      faultToken,
      'recovery_replies_lost_after_router_executed',
    );
    await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
      timeout: 30_000,
    });
    await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    const snapshot = await this.waitForIntendedPageActionCompletion(action.name, 'success');
    const result = requirePasskeyRecoveryResult(snapshot, this.walletId);
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += 3;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('a retry with the same code superseded the interrupted recovery attempt');
  }

  /**
   * A superseded recovery attempt reaches the SigningWorker late, after the
   * attempt that superseded it staged its candidate, and displaces nothing.
   * The first attempt's execution is kept from the Router, so the Gateway
   * records it interrupted. A retry with the same code starts a new attempt,
   * which supersedes the first, executes and stages. Before the new attempt
   * promotes, the kept execution reaches the Router, which runs it and
   * delivers its packages to the SigningWorker. The new attempt still
   * promotes, and the wallet recovers.
   */
  async recoverPasskeyWalletAcrossALateSupersededAttempt(): Promise<void> {
    this.recordStage('recover_passkey_wallet_across_late_superseded_attempt');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    if (this.intendedYaoRecoveryFault !== null) {
      throw new Error('An intended Yao recovery fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const kept = randomUUID();
    this.intendedYaoRecoveryFault = { mode: 'withhold_router_recovery_execute', token: kept };
    let frame: FrameLocator;
    try {
      frame = await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await expect(frame.locator('.seams-recovery-status').last()).toHaveText(
        'Recovery couldn’t be completed. Try again.',
        { timeout: 120_000 },
      );
    } finally {
      this.intendedYaoRecoveryFault = null;
    }
    this.assertIntendedYaoFaultProof(proofStartIndex, kept, 'recovery_execute_withheld');
    const activationGate = new RecoveryReplayGate();
    const holdActivation = holdRecoveryReplayUntilReleased.bind(null, activationGate);
    const activationPattern = `**${ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1}`;
    const activationRequested = this.page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname === ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
      { timeout: 120_000 },
    );
    await this.context.route(activationPattern, holdActivation);
    try {
      await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
        timeout: 30_000,
      });
      // The new attempt has executed and staged; its promotion waits here.
      await activationRequested;
      const late = await this.releaseKeptRecoveryExecute(kept);
      this.recordService(
        `the superseded attempt's late execution answered ${late.status} ${late.body}`,
      );
      let answer: unknown = null;
      try {
        answer = JSON.parse(late.body);
      } catch {
        // A refusal need not be JSON.
      }
      if (
        late.status === 200 &&
        (answer as { readonly status?: unknown } | null)?.status === 'succeeded'
      ) {
        throw new Error(
          `The superseded attempt's late execution staged at the SigningWorker: ${late.body}`,
        );
      }
      /* The Router ran the late execution, and the SigningWorker refused its
         packages as a superseded attempt. Every Router answers that as
         final, so nothing retries it. */
      const refusal = answer as { readonly status?: unknown; readonly code?: unknown } | null;
      if (
        late.status !== 200 ||
        refusal?.status !== 'rejected' ||
        refusal.code !== 'attempt_superseded'
      ) {
        throw new Error(
          `The superseded attempt's late execution was not refused as superseded: ${late.status} ${late.body}`,
        );
      }
    } finally {
      activationGate.release();
      await this.context.unroute(activationPattern, holdActivation);
    }
    await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    const snapshot = await this.waitForIntendedPageActionCompletion(action.name, 'success');
    const result = requirePasskeyRecoveryResult(snapshot, this.walletId);
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += 3;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService(
      'a superseded attempt that reached the SigningWorker after its successor staged was refused',
    );
  }

  async recoverPasskeyWalletAfterLostFinalizationResponse(): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_lost_finalization_response');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const finalizeFailure: RecoveryFinalizeFailure = { injected: false };
    const finalizationCapture = createRecoveryRequestCapture({
      kind: 'finalize',
      path: ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH,
      target: 'passkey',
      walletId: registration.walletId,
    });
    const captureFinalizationRequest = captureRecoveryRequest.bind(null, finalizationCapture);
    const concealFirstFinalization = concealFirstRecoveryFinalizationResponse.bind(
      null,
      finalizeFailure,
    );
    this.page.on('request', captureFinalizationRequest);
    await this.page.route(`**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`, concealFirstFinalization);
    const firstFinalizationRequest = this.page.waitForRequest(
      (request) => isRecoveryFinalizationRequest(request, ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH),
      { timeout: 120_000 },
    );
    const firstFinalizationResponse = this.page.waitForResponse(
      (response) =>
        isRecoveryFinalizationResponse(response, ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH, 503),
      { timeout: 120_000 },
    );
    try {
      await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await firstFinalizationRequest;
      await firstFinalizationResponse;
      if (!finalizeFailure.injected) {
        throw new Error('Passkey recovery did not reach the injected finalization response loss');
      }
      /* The conceal route keeps blocking duplicate submissions while the
         journal check runs, so a straggling confirm click cannot commit the
         finalization the runtime-reset replay is expected to deliver. */
      await this.waitForPendingWalletRecoveryCommit(
        requireCapturedRecoveryRequest(finalizationCapture),
        'present',
      );
    } finally {
      await this.page.unroute(
        `**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`,
        concealFirstFinalization,
      );
      this.page.off('request', captureFinalizationRequest);
    }
    const finalization = requireCapturedRecoveryRequest(finalizationCapture);
    await this.resumeCommittedRecoveryAfterRuntimeReset(finalization);
    await this.unlockPasskeyWallet();
    await this.signTempoTransaction('post_unlock');
    await this.signNearTransaction('post_unlock');
    await this.assertConsumedRecoveryCodeReportedAsUsed();
    this.recordService('Passkey recovery replayed its committed finalization after response loss');
  }

  async recoverGoogleEmailOtpWalletFromFreshBrowser(): Promise<void> {
    this.recordStage('recover_google_email_otp_wallet_from_fresh_browser');
    requireUsableIntendedGoogleIdToken(this.config);
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({
      action: recoveryActionForTarget('google_email_otp'),
    });
    await fillHostedRecoveryCode(this.page, recoveryCode, 'google_email_otp');
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    const snapshot = await autoConfirmWalletIframeUntil(
      this.page,
      this.waitForIntendedPageActionCompletion('recoverGoogleEmailOtpWallet', 'success'),
      {
        timeoutMs: 120_000,
        intervalMs: 250,
        diagnostics,
      },
    );
    this.latestPageSnapshot = snapshot;
    this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
    const result = requireGoogleEmailOtpRecoveryResult(snapshot, this.walletId);
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.emailOtpVerificationCount += 1;
    this.operatingAuthFamily = 'email_otp';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('fresh-browser Google Email OTP recovery completed through normal login');
  }

  async recoverGoogleEmailOtpWalletAfterLostFinalizationResponse(): Promise<void> {
    this.recordStage('recover_google_email_otp_wallet_after_lost_finalization_response');
    requireUsableIntendedGoogleIdToken(this.config);
    const action = recoveryActionForTarget('google_email_otp');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const finalizeFailure: RecoveryFinalizeFailure = { injected: false };
    const finalizationCapture = createRecoveryRequestCapture({
      kind: 'finalize',
      path: ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH,
      target: 'google_email_otp',
      walletId: registration.walletId,
    });
    const captureFinalizationRequest = captureRecoveryRequest.bind(null, finalizationCapture);
    const concealFirstFinalization = concealFirstRecoveryFinalizationResponse.bind(
      null,
      finalizeFailure,
    );
    this.page.on('request', captureFinalizationRequest);
    await this.page.route(
      `**${ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH}`,
      concealFirstFinalization,
    );
    const firstFinalizationRequest = this.page.waitForRequest(
      (request) =>
        isRecoveryFinalizationRequest(
          request,
          ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH,
        ),
      { timeout: 120_000 },
    );
    const firstFinalizationResponse = this.page.waitForResponse(
      (response) =>
        isRecoveryFinalizationResponse(
          response,
          ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH,
          503,
        ),
      { timeout: 120_000 },
    );
    try {
      await fillHostedRecoveryCode(this.page, recoveryCode, 'google_email_otp');
      await autoConfirmWalletIframeUntil(this.page, firstFinalizationRequest, {
        timeoutMs: 120_000,
        intervalMs: 250,
      });
      await firstFinalizationResponse;
      if (!finalizeFailure.injected) {
        throw new Error('Google recovery did not reach the injected finalization response loss');
      }
      /* The conceal route keeps blocking duplicate submissions while the
         journal check runs, so a straggling confirm click cannot commit the
         finalization the runtime-reset replay is expected to deliver. */
      await this.waitForPendingWalletRecoveryCommit(
        requireCapturedRecoveryRequest(finalizationCapture),
        'present',
      );
    } finally {
      await this.page.unroute(
        `**${ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH}`,
        concealFirstFinalization,
      );
      this.page.off('request', captureFinalizationRequest);
    }
    const finalization = requireCapturedRecoveryRequest(finalizationCapture);
    await this.resumeCommittedRecoveryAfterRuntimeReset(finalization);
    /* This device re-established custody through the Google Email OTP
       recovery, so the recovered method - not the founding passkey - is the
       factor that unlocks here. The Passkey mirror case covers the
       passkey-bound custody path. The replayed finalization response carries
       the committed projection naming the installed method. */
    const projection = await this.waitForRecoveryAuthorityProjection();
    this.addedWalletAuthMethodId = projection.authMethodWalletAuthMethodId;
    await this.unlockWithAddedEmailOtp();
    await this.signTempoTransaction('post_unlock');
    await this.signNearTransaction('post_unlock');
    await this.assertConsumedRecoveryCodeReportedAsUsed('google_email_otp');
    this.recordService('Google recovery replayed its committed finalization after response loss');
  }

  async assertRecoveryAuthorityIsAdditive(target: IntendedRecoveryTargetKind): Promise<void> {
    const projection = await this.waitForRecoveryAuthorityProjection();
    const expectedMethod = target === 'passkey' ? 'passkey' : 'email_otp';
    if (projection.walletId !== this.walletId) {
      throw new Error('Recovery authority projection named a different wallet');
    }
    if (projection.authMethodKind !== expectedMethod) {
      throw new Error(
        `Recovery authority installed ${projection.authMethodKind}, expected ${expectedMethod}`,
      );
    }
    if (projection.authorityId === projection.continuityAuthorityId) {
      throw new Error('Recovery reused the continuity authority instead of adding one');
    }
    if (projection.authMethodWalletAuthorityId !== projection.authorityId) {
      throw new Error('Recovery method is not bound to the recovered authority');
    }
    this.recordService(`recovery installed an additive ${expectedMethod} authority`);
  }

  async assertSourceWalletSessionRemainsActive(): Promise<void> {
    const captured = this.sourceWalletBudgetStatusRequest;
    if (!captured) {
      throw new Error('Source Wallet Session authorization was not captured before recovery');
    }
    const replay = await this.replayWalletBudgetStatus(captured);
    if (
      replay.kind !== 'active' ||
      replay.walletSessionId !== captured.walletSessionId ||
      replay.quotaId !== captured.quotaId
    ) {
      throw new Error('The pre-recovery Wallet Session was not active after recovery');
    }
    this.recordService('source Wallet Session remained active after recovery');
  }

  async assertConsumedRecoveryCodeReportedAsUsed(
    target: IntendedRecoveryTargetKind = 'passkey',
  ): Promise<void> {
    const recoveryCode = this.recoveryCodes[0];
    if (!recoveryCode) throw new Error('Recovery-code reuse requires a captured recovery code');
    await this.assertRecoveryCodeAlreadyUsedServerResponse(recoveryCode, target);
    const action = recoveryActionForTarget(target);
    await this.page.getByTestId(action.buttonTestId).click();
    await this.waitForIntendedPageActionStarted(action.name);
    const frame = await fillHostedRecoveryCode(this.page, recoveryCode, target);
    await expect(frame.locator('.seams-recovery-status')).toHaveText(
      'That recovery code has already been used. Use another code.',
      { timeout: 30_000 },
    );
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('server and client identified the consumed recovery code');
  }

  async assertReservedRecoveryCodeReportedAsUsed(): Promise<void> {
    const action = recoveryActionForTarget('google_email_otp');
    const { recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const preparedResponse = this.page.waitForResponse(isSuccessfulRecoveryPrepareResponse);
    await fillHostedRecoveryCode(this.page, recoveryCode, 'google_email_otp');
    await preparedResponse;
    await this.assertRecoveryCodeAlreadyUsedServerResponse(recoveryCode, 'google_email_otp');
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('server identified a recovery code held by an active recovery');
  }

  private async assertRecoveryCodeAlreadyUsedServerResponse(
    recoveryCode: string,
    target: IntendedRecoveryTargetKind,
  ): Promise<void> {
    const response = await this.request.post(
      `${this.config.routerUrl}${ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: new URL(this.config.appUrl).origin,
        },
        data: {
          recoveryCodeB64u: base64UrlEncode(decodeWalletRecoveryCode(recoveryCode)),
          reservationId: `wallet-recovery-reservation-${randomUUID().replaceAll('-', '')}`,
          target:
            target === 'passkey'
              ? { kind: 'passkey', rpId: new URL(this.config.appUrl).hostname }
              : { kind: 'google_email_otp', googleProvider: 'google' },
        },
      },
    );
    const body = (await response.json()) as { readonly code?: unknown; readonly message?: unknown };
    expect(response.status()).toBe(401);
    expect(body).toMatchObject({
      code: 'recovery_code_used',
      message: 'that recovery code has already been used',
    });
  }

  private async beginFreshBrowserRecovery(input: {
    readonly action: IntendedRecoveryAction;
  }): Promise<{
    readonly registration: RegisteredWalletSnapshot;
    readonly recoveryCode: string;
  }> {
    const registration = this.requireRegisteredWalletForSigning();
    const recoveryCode = this.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error(`${input.action.target} recovery requires a captured recovery code`);
    }
    this.sourceWalletBudgetStatusRequest = this.latestWalletBudgetStatusRequest;
    if (!this.sourceWalletBudgetStatusRequest) {
      throw new Error('Source Wallet Session authorization was not captured before recovery');
    }
    this.recoveryAuthorityProjection = null;
    this.recoveryAuthorityProjectionError = null;
    await this.clearBrowserStorageForColdSync();
    await this.ensureIntendedPageOpen();
    const pageRoot = this.page.getByTestId('intended-e2e-page');
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
    await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
    await this.page.getByTestId(input.action.buttonTestId).click();
    await this.waitForIntendedPageActionStarted(input.action.name);
    return { registration, recoveryCode };
  }

  private async resumeCommittedRecoveryAfterRuntimeReset(
    finalization: RecoveryRequestIdentity,
  ): Promise<void> {
    const replayCapture = createRecoveryRequestCapture({
      kind: 'replay',
      path: finalization.path,
      target: finalization.target,
      walletId: finalization.walletId,
    });
    const captureReplayRequest = captureRecoveryRequest.bind(null, replayCapture);
    const replayGate = new RecoveryReplayGate();
    const holdReplay = holdRecoveryReplayUntilReleased.bind(null, replayGate);
    const routePattern = `**${finalization.path}`;
    const replayRequest = this.page.waitForRequest(
      (request) => isRecoveryFinalizationRequest(request, finalization.path),
      { timeout: 120_000 },
    );
    const replayResponse = this.page.waitForResponse(
      (response) => isRecoveryFinalizationResponse(response, finalization.path),
      { timeout: 120_000 },
    );
    this.page.on('request', captureReplayRequest);
    await this.page.route(routePattern, holdReplay);
    try {
      await this.resetRuntimeOnlyState();
      await this.ensureIntendedPageOpen();
      const pageRoot = this.page.getByTestId('intended-e2e-page');
      await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
      await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
      await replayRequest;
      const replay = requireCapturedRecoveryRequest(replayCapture);
      assertRecoveryReplayMatchesFinalization(finalization, replay);
      await this.waitForPendingWalletRecoveryCommit(finalization, 'present');
      replayGate.release();
      const response = await replayResponse;
      if (response.status() !== 200) {
        throw new Error(`Durable recovery resume returned HTTP ${response.status()}`);
      }
    } finally {
      replayGate.release();
      await this.page.unroute(routePattern, holdReplay);
      this.page.off('request', captureReplayRequest);
    }
    await this.waitForPendingWalletRecoveryCommit(finalization, 'absent');
    this.recordService('durable recovery resume published local continuity after runtime reset');
  }

  private async waitForPendingWalletRecoveryCommit(
    finalization: RecoveryRequestIdentity,
    expectation: 'present' | 'absent',
  ): Promise<void> {
    const modulePath = intendedIndexedDbModulePath(this.config.appUrl);
    const frame = await walletServiceFrame(this.page, this.config.walletOrigin);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const pending = await frame.evaluate(readPendingWalletRecoveryCommitIdentitiesInBrowser, {
        modulePath,
      });
      const matching = pending.filter(
        (record) =>
          record.walletId === finalization.walletId &&
          record.recoveryOperationId === finalization.recoveryOperationId,
      );
      const matchesExpectation =
        expectation === 'present'
          ? matching.length === 1 && matching[0]?.stage === 'awaiting_server_promotion'
          : matching.length === 0;
      if (matchesExpectation) {
        this.recordService(
          `durable recovery journal ${expectation} for wallet=${finalization.walletId} operation=${finalization.recoveryOperationId}`,
        );
        return;
      }
      await this.page.waitForTimeout(250);
    }
    throw new Error(
      `Durable recovery journal did not become ${expectation} for wallet=${finalization.walletId} operation=${finalization.recoveryOperationId}`,
    );
  }

  private assertRecoveryCodeConsumption(
    result: Pick<
      PasskeyRecoveryResultSnapshot | GoogleEmailOtpRecoveryResultSnapshot,
      'activeRecoveryCodeCount' | 'totalRecoveryCodeCount'
    >,
  ): void {
    if (result.totalRecoveryCodeCount !== this.recoveryCodes.length) {
      throw new Error('Recovery changed the recovery-set size');
    }
    if (result.activeRecoveryCodeCount !== this.recoveryCodes.length - 1) {
      throw new Error('Recovery did not consume exactly one recovery code');
    }
  }

  private async assertRecoveredWalletLoggedIn(expectedWalletId: string): Promise<void> {
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
      { timeout: 30_000 },
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      expectedWalletId,
      { timeout: 30_000 },
    );
  }

  private async waitForRecoveryAuthorityProjection(): Promise<RecoveryAuthorityProjection> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (this.recoveryAuthorityProjection) return this.recoveryAuthorityProjection;
      await this.page.waitForTimeout(50);
    }
    if (this.recoveryAuthorityProjectionError) {
      throw new Error(this.recoveryAuthorityProjectionError);
    }
    throw new Error('Recovery finalization did not return its authority projection');
  }

  async unlockEmailOtpWallet(): Promise<void> {
    this.recordStage('unlock_email_otp_wallet');
    const emailOtpRegistration = requireNearReadyRegisteredWallet(
      requireEmailOtpRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Email OTP unlock',
    );
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction(
      'unlockEmailOtpWallet',
      'intended-unlock-email-otp',
    );
    const result = requireEmailOtpUnlockResult(snapshot, emailOtpRegistration);
    this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
      kind: 'email_otp_unlock',
    });
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
    this.recordService(
      `email otp unlock succeeded wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  async signNearTransaction(stage: IntendedNearSigningStage): Promise<SigningAuthEventSummary> {
    return await this.executeNearSigningScenario({ kind: 'standard', stage });
  }

  async signNearTransactionAfterRefresh(): Promise<SigningAuthEventSummary> {
    return await this.executeNearSigningScenario({
      kind: 'post_refresh',
      stage: 'after_refresh_recovery',
    });
  }

  private async executeNearSigningScenario(
    scenario: IntendedNearSigningScenario,
  ): Promise<SigningAuthEventSummary> {
    const { stage } = scenario;
    this.recordStage(`${stage}:near.sign`);
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'NEAR signing',
    );
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runNearSigningPageAction(registration.nearAccountId);
    const result = requireNearSigningResult(snapshot, {
      walletId: this.walletId,
      nearAccountId: registration.nearAccountId,
    });
    await verifyNearEd25519Signature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('NEAR signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'NEAR signing');
    switch (scenario.kind) {
      case 'standard':
        break;
      case 'post_refresh':
        this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
          kind: 'post_refresh_near_signing',
        });
        break;
      default:
        assertNever(scenario);
    }
    this.assertRouterAbEd25519SigningRoutes(traceStartIndex);
    this.assertNoEd25519YaoRegistrationRoutes(traceStartIndex);
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `near signing signature verified wallet=${result.walletId} near=${result.nearAccountId} bytes=${result.signedTransactionByteLength}`,
    );
    return summary;
  }

  private async runNearSigningPageAction(nearAccountId: string): Promise<IntendedPageSnapshot> {
    try {
      return await this.runIntendedPageAction('signNearTransaction', 'intended-sign-near', {
        nearAccountId,
      });
    } catch (error) {
      if (!isAutomatedSecureConfirmationCancellation(error)) throw error;
      this.recordService('retrying transient automated NEAR secure-confirm cancellation');
      await this.page.waitForTimeout(250);
      return await this.runIntendedPageAction('signNearTransaction', 'intended-sign-near', {
        nearAccountId,
      });
    }
  }

  async refreshPagePreservingWalletStorage(): Promise<void> {
    this.recordStage('page_refresh_preserving_wallet_storage');
    this.latestPageSnapshot = null;
    await this.page.goto(this.intendedPageUrl().href, { waitUntil: 'domcontentloaded' });
    await this.page.getByTestId('intended-e2e-page').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
      { timeout: 15_000 },
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      this.walletId,
      { timeout: 15_000 },
    );
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
    this.recordService('page refreshed preserving wallet storage');
  }

  async lockWallet(): Promise<void> {
    await this.page.evaluate(async () => {
      const lock = window.__seamsIntendedE2ELockWallet;
      if (!lock) throw new Error('Wallet lock helper is unavailable');
      await lock();
    });
  }

  async assertWalletLocked(): Promise<void> {
    const state = await this.page.evaluate(async () => {
      const read = window.__seamsIntendedE2EReadWalletLockState;
      if (!read) throw new Error('Wallet lock-state helper is unavailable');
      return await read();
    });
    expect(state.authenticationKind).not.toBe('authenticated');
  }

  async assertLockedPageReloadStaysLocked(): Promise<void> {
    this.recordStage('locked_page_reload_stays_locked');
    await this.ensureIntendedPageOpen();
    await this.page.evaluate(async () => {
      const lockWallet = window.__seamsIntendedE2ELockWallet;
      if (!lockWallet) throw new Error('Intended wallet lock helper is unavailable');
      await lockWallet();
    });
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_out',
    );

    this.latestPageSnapshot = null;
    await this.page.goto(this.intendedPageUrl().href, { waitUntil: 'domcontentloaded' });
    const pageRoot = this.page.getByTestId('intended-e2e-page');
    await pageRoot.waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForFunction(
      () => typeof window.__seamsIntendedE2EReadWalletLockState === 'function',
      undefined,
      { timeout: 15_000 },
    );
    const lockState = await this.page.evaluate(async () => {
      const readLockState = window.__seamsIntendedE2EReadWalletLockState;
      if (!readLockState) throw new Error('Intended wallet lock-state helper is unavailable');
      return await readLockState();
    });
    if (lockState.authenticationKind === 'authenticated') {
      throw new Error('A locked wallet remained authenticated after page reload');
    }
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
    await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
    this.recordService(
      `locked page reload remained locked authentication=${lockState.authenticationKind}`,
    );
  }

  async assertNearDemoSigningActionable(): Promise<void> {
    this.recordStage('post_registration:near.demo_actionable');
    await this.page.evaluate(navigateWithinSite, '/wallet');
    this.intendedPageReady = false;
    try {
      // The demo renders only the selected chain's panel, and Tempo is the
      // default tab, so the NEAR controls must be selected before they exist.
      await this.page.getByRole('tab', { name: 'NEAR', exact: true }).click({ timeout: 20_000 });
      await this.page.waitForFunction(nearDemoSignButtonIsActionable, undefined, {
        timeout: 20_000,
      });
    } catch (error) {
      const statusText = await this.page
        .locator('.near-funding-status')
        .textContent({ timeout: 1_000 })
        .catch(ignoreNearDemoStatusReadError);
      throw new Error(
        `NEAR demo signing remained unavailable after registration: ${String(statusText || 'no readiness status')}`,
        { cause: error },
      );
    }
    this.recordService('public React wallet projection enabled the NEAR demo signing control');
    await this.page.evaluate(navigateWithinSite, this.intendedPageUrl().href);
    await this.page.getByTestId('intended-e2e-page').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
  }

  signingActionTimingEvidence() {
    if (!this.latestActionTiming) throw new Error('Expected action timing evidence');
    const diagnostics = this.latestWalletIframeAutoConfirmDiagnostics;
    return {
      ...this.latestActionTiming.evidence(),
      confirmationAutomation: {
        clock: 'milliseconds since confirmation loop start',
        buttonVisibleMs: diagnostics?.firstButtonVisibleMs ?? null,
        clickDispatchMs: diagnostics?.firstClickDispatchMs ?? null,
        clickDurationMs: diagnostics?.firstClickDurationMs ?? null,
      },
    };
  }

  async signTempoTransaction(
    stage: IntendedSigningStage,
    options: IntendedSigningActionHooks = {},
  ): Promise<SigningAuthEventSummary> {
    this.recordStage(`${stage}:tempo.sign`);
    const registration = this.requireRegisteredWalletForSigning();
    const snapshot = await this.runIntendedPageAction(
      'signTempoTransaction',
      'intended-sign-tempo',
      options,
    );
    const result = requireTempoSigningResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_TEMPO_CHAIN_ID,
    });
    await verifyTempoEcdsaSignature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('Tempo signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'Tempo signing');
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `tempo signing signature verified wallet=${result.walletId} chainId=${result.chainId}`,
    );
    return summary;
  }

  async signArcEvmTransaction(
    stage: IntendedSigningStage,
    options: IntendedSigningActionHooks = {},
  ): Promise<SigningAuthEventSummary> {
    this.recordStage(`${stage}:arc_evm.sign`);
    const registration = this.requireRegisteredWalletForSigning();
    const snapshot = await this.runIntendedPageAction(
      'signArcEvmTransaction',
      'intended-sign-arc-evm',
      options,
    );
    const result = requireArcEvmSigningResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    await verifyArcEvmSignature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('Arc/EVM signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'Arc/EVM signing');
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `arc evm signing signature verified wallet=${result.walletId} chainId=${result.chainId}`,
    );
    return summary;
  }

  async signTempoAndArcEvmConcurrently(stage: IntendedSigningStage): Promise<void> {
    this.recordStage(`${stage}:tempo_arc.concurrent_sign`);
    const registration = this.requireRegisteredWalletForSigning();
    await this.ensureIntendedPageOpen();
    this.latestWalletBudgetStatusRequest = null;
    await this.page.evaluate(installIntendedConcurrentActionObserver);
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    let rawSnapshots: unknown[];
    try {
      await this.page.evaluate(triggerConcurrentEvmFamilySigning);
      const completion = this.page.waitForFunction(
        intendedConcurrentEvmFamilySigningFinished,
        undefined,
        { timeout: 120_000 },
      );
      await autoConfirmWalletIframeUntil(this.page, completion, {
        timeoutMs: 120_000,
        intervalMs: 250,
        diagnostics,
      });
      rawSnapshots = await this.page.evaluate(readIntendedConcurrentActionSnapshots);
    } catch (error) {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `Concurrent wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      await this.page.evaluate(disconnectIntendedConcurrentActionObserver);
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      this.recordService(`concurrent wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
    }

    const snapshots = parseIntendedConcurrentActionSnapshots(rawSnapshots);
    const tempoSnapshot = requireConcurrentSigningSuccess(snapshots, 'signTempoTransaction');
    const arcEvmSnapshot = requireConcurrentSigningSuccess(snapshots, 'signArcEvmTransaction');
    const tempoResult = requireTempoSigningResult(tempoSnapshot, {
      walletId: this.walletId,
      chainId: INTENDED_TEMPO_CHAIN_ID,
    });
    const arcEvmResult = requireArcEvmSigningResult(arcEvmSnapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    await verifyTempoEcdsaSignature({ registration, result: tempoResult });
    await verifyArcEvmSignature({ registration, result: arcEvmResult });
    await this.assertConcurrentWalletBudgetExhausted();
    const concurrentSnapshot = snapshotWithMostLifecycleEvents(tempoSnapshot, arcEvmSnapshot);
    this.assertSigningAuthEvents(concurrentSnapshot, stage, 'Concurrent Tempo/Arc signing');
    this.latestSigningRemainingUses = 0;
    this.latestPageSnapshot = concurrentSnapshot;
    this.recordService(
      `concurrent Tempo/Arc signatures verified wallet=${this.walletId} remainingUses=0`,
    );
    await waitForWalletIframeConfirmationSettlement(this.page);
  }

  async exhaustSigningBudget(): Promise<void> {
    this.recordStage('remaining_spend.exhaust');
    if (this.latestSigningRemainingUses === 0) {
      this.recordService('signing remaining spend already exhausted');
      return;
    }
    if (this.latestWalletBudgetStatusRequest) {
      const replay = await this.replayLatestWalletBudgetStatus();
      if (replay.kind === 'exhausted') {
        this.latestSigningRemainingUses = 0;
        this.recordService(
          `signing remaining spend authoritatively exhausted walletSessionId=${replay.walletSessionId} quotaId=${replay.quotaId}`,
        );
        return;
      }
    }
    for (let attempt = 1; attempt <= MAX_BUDGET_EXHAUSTION_SIGNS; attempt += 1) {
      const summary = await this.signNearTransaction(this.currentWarmSigningStage);
      const remainingUses = minimumRemainingUse(summary);
      this.recordService(
        `near remaining spend exhaustion attempt=${attempt} remainingUses=${String(remainingUses)}`,
      );
      if (remainingUses === 0) {
        return;
      }
      if (this.latestWalletBudgetStatusRequest) {
        const replay = await this.replayLatestWalletBudgetStatus();
        if (replay.kind === 'exhausted') {
          this.latestSigningRemainingUses = 0;
          this.recordService(
            `signing remaining spend authoritatively exhausted walletSessionId=${replay.walletSessionId} quotaId=${replay.quotaId}`,
          );
          return;
        }
      }
    }
    throw new Error(
      `NEAR remaining spend did not exhaust within ${MAX_BUDGET_EXHAUSTION_SIGNS} warm signs`,
    );
  }

  async exportEcdsaKey(): Promise<void> {
    this.recordStage('ecdsa.export');
    const snapshot = await this.runIntendedPageAction('exportEcdsaKey', 'intended-export-ecdsa');
    const result = requireEcdsaExportResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    if (snapshot.events.length === 0) {
      throw new Error('ECDSA export did not emit structured lifecycle events');
    }
    this.recordExportAuthCounters(this.assertKeyExportAuthEvents(snapshot, 'ECDSA export'));
    await this.closeExportViewerIfOpen();
    this.recordService(
      `ecdsa export succeeded wallet=${result.walletId} chainId=${result.chainId}`,
    );
  }

  async exportEd25519Key(): Promise<void> {
    this.recordStage('ed25519.export');
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction(
      'exportEd25519Key',
      'intended-export-ed25519',
    );
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'Ed25519 export',
    );
    const result = requireEd25519ExportResult(snapshot, {
      walletId: this.walletId,
      nearAccountId: registration.nearAccountId,
    });
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 export did not emit structured lifecycle events');
    }
    this.recordExportAuthCounters(this.assertKeyExportAuthEvents(snapshot, 'Ed25519 export'));
    this.assertRouterAbEd25519YaoExportRoutes(traceStartIndex);
    await this.closeExportViewerIfOpen();
    this.recordService(
      `ed25519 export succeeded wallet=${result.walletId} nearAccountId=${result.nearAccountId}`,
    );
  }

  /**
   * A recovery retires, at the SigningWorker, the activation it replaced. Two
   * NEAR signatures are authorized under that activation before the recovery
   * begins: one is made, and the Gateway keeps its finalize; the other's
   * finalize the Gateway withholds. The recovery is interrupted once and
   * retried with the same code. Once it promotes, both finalizes reach the
   * Router again: the withheld one is refused as retired, and the one already
   * made answers with its signature.
   */
  async recoverPasskeyWalletRetiringTheReplacedActivation(): Promise<void> {
    this.recordStage('recover_passkey_wallet_retiring_replaced_activation');
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const made = await this.keepNearSigningFinalize('capture_signing_finalize');
    const withheld = await this.keepNearSigningFinalize('withhold_signing_finalize');
    await this.recoverPasskeyWalletAfterInterruptedAttempt();
    const delayed = await this.releaseNearSigningFinalize(withheld);
    if (delayed.status < 400 || !delayed.body.includes(SIGNING_WORKER_ACTIVATION_RETIRED_MESSAGE)) {
      throw new Error(
        `A finalize withheld across the recovery was not refused as retired: ${delayed.status} ${delayed.body}`,
      );
    }
    const replayed = await this.releaseNearSigningFinalize(made);
    if (
      replayed.original === null ||
      replayed.status !== replayed.original.status ||
      JSON.stringify(JSON.parse(replayed.body)) !==
        JSON.stringify(JSON.parse(replayed.original.body))
    ) {
      throw new Error(
        `A signature made before the recovery did not answer again: ${replayed.status} ${replayed.body}`,
      );
    }
    this.recordService(
      'the recovery retired the replaced activation: a delayed finalize was refused, a made signature answered again',
    );
  }

  /**
   * A NEAR finalize that loaded the replaced activation's material before a
   * recovery promoted is refused at its commit, and its signature never
   * answers. Only the Workers D1 SigningWorker signs and commits in separate
   * steps; the wallet object and the VM SigningWorker commit in the step that
   * loads the material. The Gateway withholds the finalize of a signature
   * authorized before the recovery, and the SigningWorker is asked to hold
   * the wallet's next finalize after it signs, until its activation is
   * retired. The withheld finalize reaches the Router, and the SigningWorker
   * holds it. The recovery promotes, retiring the activation, and the held
   * finalize's commit is refused.
   */
  async recoverPasskeyWalletWhileAFinalizeHoldsTheReplacedMaterial(): Promise<void> {
    this.recordStage('recover_passkey_wallet_while_finalize_holds_replaced_material');
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const withheld = await this.keepNearSigningFinalize('withhold_signing_finalize');
    const armed = await this.commandSigningWorkerHold('arm_signing_worker_hold');
    if (armed !== 'armed') {
      throw new Error(`The SigningWorker did not arm its finalize hold: ${armed}`);
    }
    const held = this.releaseNearSigningFinalize(withheld, 300_000).then(
      (released) => ({ kind: 'answered' as const, released }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    );
    await this.waitForSigningWorkerHold('holding');
    this.recordService(
      'the SigningWorker holds a finalize that has signed with the active material',
    );
    await this.recoverPasskeyWalletFromFreshBrowser();
    const outcome = await held;
    if (outcome.kind === 'failed') throw outcome.error;
    const refused = outcome.released;
    if (
      refused.status < 400 ||
      !refused.body.includes(SIGNING_WORKER_ACTIVATION_RETIRED_AT_COMMIT_MESSAGE)
    ) {
      throw new Error(
        `A finalize held across the recovery's promotion was not refused at its commit: ${refused.status} ${refused.body}`,
      );
    }
    const released = await this.commandSigningWorkerHold('read_signing_worker_hold');
    if (released !== 'released_retired') {
      throw new Error(`The SigningWorker's hold did not end on the retirement: ${released}`);
    }
    this.recordService(
      'a finalize that signed with the replaced material before the recovery promoted was refused at its commit',
    );
  }

  /** Arms or reads the SigningWorker's hold on this wallet's next NEAR finalize. */
  private async commandSigningWorkerHold(
    mode: 'arm_signing_worker_hold' | 'read_signing_worker_hold',
  ): Promise<string | null> {
    const response = await this.page.request.post(
      new URL(ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH, this.config.routerUrl).href,
      {
        headers: {
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1]: mode,
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1]: randomUUID(),
        },
        data: { wallet_id: this.requireRegisteredWalletForSigning().walletId },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `The SigningWorker hold command failed: ${response.status()} ${await response.text()}`,
      );
    }
    const reply = requireRecord(await response.json(), 'SigningWorker hold reply');
    const body = requireString(reply.body, 'SigningWorker hold body');
    if (Number(reply.status) !== 200) {
      throw new Error(`The SigningWorker refused the hold command: ${reply.status} ${body}`);
    }
    const state = requireRecord(JSON.parse(body), 'SigningWorker hold state').state;
    return typeof state === 'string' ? state : null;
  }

  private async waitForSigningWorkerHold(expected: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    let state: string | null = null;
    while (Date.now() < deadline) {
      state = await this.commandSigningWorkerHold('read_signing_worker_hold');
      if (state === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`The SigningWorker's finalize hold stayed ${state}, not ${expected}`);
  }

  /** Signs NEAR once with every finalize of it kept by the Gateway, run or withheld. */
  private async keepNearSigningFinalize(
    mode: 'capture_signing_finalize' | 'withhold_signing_finalize',
  ): Promise<string> {
    if (this.intendedYaoSigningFault !== null) {
      throw new Error('An intended Yao signing fault is already armed');
    }
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'NEAR signing',
    );
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const token = randomUUID();
    this.intendedYaoSigningFault = { mode, token };
    try {
      if (mode === 'capture_signing_finalize') {
        await this.signNearTransaction('post_registration');
      } else {
        let signed = false;
        try {
          await this.runNearSigningPageAction(registration.nearAccountId);
          signed = true;
        } catch {
          // The Gateway withheld the finalize, so the signature failed.
        }
        if (signed) throw new Error('A NEAR signature signed although its finalize was withheld');
      }
    } finally {
      this.intendedYaoSigningFault = null;
    }
    const expected = `${token}:${
      mode === 'capture_signing_finalize'
        ? 'signing_finalize_captured'
        : 'signing_finalize_withheld'
    }`;
    const observed = this.intendedYaoFaultProofs.slice(proofStartIndex);
    if (observed.length === 0 || observed.some((proof) => proof !== expected)) {
      throw new Error(
        `Expected intended Yao fault proof ${expected}; observed ${observed.join(', ') || '<none>'}`,
      );
    }
    this.recordService(`intended Yao fault proof: ${expected.slice(token.length + 1)}`);
    return token;
  }

  /** Sends a finalize the Gateway kept to the Router again, and reads the Router's reply. */
  private async releaseNearSigningFinalize(
    token: string,
    timeoutMs = 30_000,
  ): Promise<{
    readonly status: number;
    readonly body: string;
    readonly original: { readonly status: number; readonly body: string } | null;
  }> {
    const response = await this.page.request.post(
      new URL(ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH, this.config.routerUrl).href,
      {
        headers: {
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1]: 'release_signing_finalize',
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1]: token,
        },
        data: {},
        timeout: timeoutMs,
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Releasing a kept finalize failed: ${response.status()} ${await response.text()}`,
      );
    }
    const released = requireRecord(await response.json(), 'released finalize');
    const original = released.original;
    return {
      status: Number(released.status),
      body: requireString(released.body, 'released finalize body'),
      original:
        original === null
          ? null
          : {
              status: Number(requireRecord(original, 'original finalize').status),
              body: requireString(
                requireRecord(original, 'original finalize').body,
                'original body',
              ),
            },
    };
  }

  /**
   * An Ed25519 export whose admission loses the Gateway's storage right after
   * the batch that authorized it committed the export's `authorized` state,
   * its nonce claim and its authorized operation. The Gateway sends the
   * identical request again, which admits the export from that durable
   * authorization, and the export completes.
   */
  async exportEd25519KeyAcrossInterruptedAuthorization(): Promise<void> {
    this.recordStage('ed25519.export_across_interrupted_authorization');
    if (this.intendedYaoExportFaultToken !== null) {
      throw new Error('An intended Yao export fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = randomUUID();
    this.intendedYaoExportFaultToken = faultToken;
    try {
      await this.exportEd25519Key();
    } finally {
      this.intendedYaoExportFaultToken = null;
    }
    this.assertIntendedYaoFaultProof(
      proofStartIndex,
      faultToken,
      'export_authorization_committed_then_storage_lost',
    );
    this.recordService('the exact retry admitted an export interrupted after its authorization');
  }

  assertNoLifecycleViolations(): void {
    if (this.violations.length === 0) return;
    throw new Error(`Intended lifecycle violations:\n${this.violations.join('\n')}`);
  }

  assertNoWrongAuthPath(): void {
    /* Auth-method additions are the one lifecycle that legitimately uses
       both families: the wallet authorizes with the factor it already has and
       verifies the one being added. The guard exists to catch a lifecycle
       silently falling back to the other factor, which is still worth checking
       everywhere else, so this is an opt-out a step must take rather than a
       prefix the flow can accidentally match. */
    if (this.crossFamilyAuthMethodAdditionRan) return;
    if (
      (this.flow === 'passkey.registration' || this.flow === 'passkey.unlock') &&
      this.emailOtpVerificationCount > 0
    ) {
      throw new Error('Passkey lifecycle used Email OTP verification');
    }
    if (
      (this.flow === 'email_otp.registration' || this.flow === 'email_otp.unlock') &&
      this.passkeyPromptCount > 0
    ) {
      throw new Error('Email OTP lifecycle used passkey/WebAuthn verification');
    }
  }

  async attachTrace(
    testInfo: TestInfo,
    attachmentName = 'intended-lifecycle-trace.json',
  ): Promise<void> {
    if (this.networkMode === 'external_staging') return;
    const payload: IntendedLifecycleTracePayload = {
      flow: this.flow,
      walletId: this.walletId,
      appUrl: this.config.appUrl,
      routerUrl: this.config.routerUrl,
      matcherTableVersion: LIFECYCLE_FAILURE_MATCHER_TABLE_VERSION,
      authPrompts: {
        emailOtp: this.emailOtpVerificationCount,
        passkey: this.passkeyPromptCount,
      },
      latestPageSnapshot: this.latestPageSnapshot,
      trace: this.trace,
      violations: this.violations,
    };
    await persistIntendedLifecycleTrace({ testInfo, payload, attachmentName });
    await testInfo.attach(attachmentName, {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  }

  private async installFailureCollectors(): Promise<void> {
    this.page.on('console', this.handleConsoleMessage.bind(this));
    this.page.on('pageerror', this.handlePageError.bind(this));
    this.context.on('request', this.handleRequest.bind(this));
    this.context.on('requestfailed', this.handleRequestFailed.bind(this));
    this.context.on('response', this.handleResponse.bind(this));
  }

  private async installSigningSessionDebugFlag(): Promise<void> {
    if (!this.config.signingSessionDebug) return;
    await this.context.addInitScript(enableSigningSessionDebugInFrame);
  }

  private async installRegistrationBenchmarkDiagnosticsFlag(): Promise<void> {
    await this.context.addInitScript(enableRegistrationBenchmarkDiagnosticsInFrame);
  }

  private async installExternalNetworkStubs(): Promise<void> {
    await this.context.route('**/*', this.handleExternalRoute.bind(this));
  }

  private async installIntendedYaoFaultInjection(): Promise<void> {
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1}`,
      this.handleIntendedYaoFaultRoute.bind(this),
    );
    await this.context.route(
      `**${WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1}`,
      this.handleIntendedYaoFinalizeFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1}`,
      this.handleIntendedYaoRecoveryFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1}`,
      this.handleIntendedYaoExportFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH}`,
      this.handleIntendedYaoSigningFaultRoute.bind(this),
    );
  }

  private async installWebAuthnVirtualAuthenticator(): Promise<void> {
    const client = await this.context.newCDPSession(this.page);
    await client.send('WebAuthn.enable');
    await addWebAuthnVirtualAuthenticator(client);
    this.recordService('webauthn virtual authenticator ready');
  }

  private async resetBrowserStorage(): Promise<void> {
    await this.context.clearCookies();
    await this.page.goto(`${new URL(this.config.appUrl).origin}/__storage-reset`, {
      waitUntil: 'commit',
    });
    await this.page.evaluate(clearBrowserStorage);
    await this.page.waitForFunction(browserStorageDatabasesEmpty, undefined, { timeout: 5_000 });
    if (this.config.signingSessionDebug) {
      await this.page.evaluate(() => {
        localStorage.setItem('seams:debug:signing-session', '1');
      });
    }
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser storage reset');
  }

  private async assertServicesReady(): Promise<void> {
    // The hosted ingress admits readiness only with the benchmark token, and
    // API requests do not pass through the context route that adds it.
    const routerHeaders: Record<string, string> =
      this.networkMode === 'external_staging'
        ? { 'x-r150-benchmark-access': hostedBenchmarkAccessToken() }
        : {};
    await assertHttpOk(this.request, this.config.appUrl, 'site');
    await assertHttpOk(
      this.request,
      `${this.config.routerUrl}/healthz`,
      'router healthz',
      routerHeaders,
    );
    await assertHttpOk(
      this.request,
      `${this.config.routerUrl}/readyz`,
      'router readyz',
      routerHeaders,
    );
    this.recordService('site and router ready');
  }

  private intendedPageUrl(): URL {
    const url = new URL('/__intended-e2e', this.config.appUrl);
    url.searchParams.set('flow', this.flow);
    url.searchParams.set('walletId', this.walletId);
    if (this.registeredWallet?.nearReadiness === 'ready') {
      url.searchParams.set('nearAccountId', this.registeredWallet.nearAccountId);
      url.searchParams.set('nearSignerSlot', String(this.nearSignerSlot));
    }
    if (this.config.googleIdToken) {
      url.searchParams.set('googleIdToken', this.config.googleIdToken);
    }
    url.searchParams.set('passkeyEcdsaTargetProfile', this.config.passkeyEcdsaTargetProfile);
    url.searchParams.set('emailOtpEcdsaTargetProfile', this.config.emailOtpEcdsaTargetProfile);
    return url;
  }

  private async openIntendedPage(): Promise<void> {
    const url = this.intendedPageUrl();
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await this.page.getByTestId('intended-e2e-page').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
  }

  private async resetRuntimeOnlyState(): Promise<void> {
    this.latestPageSnapshot = null;
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser runtime reset preserving storage');
  }

  private async clearBrowserStorageForColdSync(): Promise<void> {
    await this.context.clearCookies();
    const resetTargets = [
      `${new URL(this.page.url()).origin}/__storage-reset`,
      `${new URL(this.config.walletOrigin).origin}/__storage-reset`,
    ];
    for (const target of resetTargets) {
      await this.page.goto(target, { waitUntil: 'commit' });
      await this.page.evaluate(clearBrowserStorage);
      await this.page.waitForFunction(browserStorageDatabasesEmpty, undefined, { timeout: 5_000 });
    }
    this.latestPageSnapshot = null;
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser storage cleared while preserving the synced passkey credential');
  }

  private async ensureIntendedPageOpen(): Promise<void> {
    if (this.intendedPageReady && !this.reloadIntendedPageBeforeNextAction) return;
    await this.openIntendedPage();
  }

  private async runIntendedPageAction(
    action: IntendedHarnessAction,
    buttonTestId: string,
    opts?: {
      nearAccountId?: string;
      expectedOutcome?: 'success' | 'error';
      onRecoveryCodes?: (codes: readonly string[]) => void;
      /** Runs as soon as the page reports the action started. */
      onActionStarted?: () => void;
    },
  ): Promise<IntendedPageSnapshot> {
    if (opts?.nearAccountId && !this.registeredWallet) {
      throw new Error('NEAR signing requires a registered wallet');
    }
    if (GOOGLE_ID_TOKEN_ACTIONS.has(action)) {
      requireUsableIntendedGoogleIdToken(this.config);
    }
    const timing = new IntendedActionTiming();
    await this.ensureIntendedPageOpen();
    timing.pageReadyAt = performance.now();
    await this.page.getByTestId(buttonTestId).click();
    await this.waitForIntendedPageActionStarted(action);
    timing.actionObservedAt = performance.now();
    opts?.onActionStarted?.();
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    let diagnosticsRecorded = false;
    try {
      const snapshot = await autoConfirmWalletIframeUntil(
        this.page,
        this.waitForIntendedPageActionCompletion(action, opts?.expectedOutcome ?? 'success')
          .then(timing.complete.bind(timing)),
        {
          timeoutMs: 120_000,
          intervalMs: 250,
          diagnostics,
          onRecoveryCodes: opts?.onRecoveryCodes,
        },
      );
      timing.automationFinishedAt = performance.now();
      this.latestPageSnapshot = snapshot;
      if (intendedActionRequiresConfirmationSettlement(action)) {
        await waitForWalletIframeConfirmationSettlement(this.page);
      }
      timing.settledAt = performance.now();
      this.latestActionTiming = timing;
      return snapshot;
    } catch (error) {
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
      diagnosticsRecorded = true;
      throw new Error(
        [
          error instanceof Error ? error.message : String(error || 'Intended action failed'),
          `Wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      if (!diagnosticsRecorded) {
        this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
      }
    }
  }

  private captureRecoveryCodes = (codes: readonly string[]): void => {
    this.recoveryCodes = [...codes];
  };

  private async waitForIntendedPageActionStarted(action: IntendedHarnessAction): Promise<void> {
    try {
      await this.page.waitForFunction(intendedPageActionStartedOrCompleted, action, {
        timeout: 5_000,
      });
    } catch (error) {
      const snapshot = await this.tryReadIntendedPageSnapshot();
      throw new Error(
        [
          `Intended action ${action} did not start after click.`,
          `Page snapshot: ${snapshot ? JSON.stringify(snapshot) : '<unavailable>'}`,
          this.recentTraceForError(),
          `Original error: ${String(error)}`,
        ].join('\n'),
      );
    }
  }

  private async closeExportViewerIfOpen(): Promise<void> {
    const closed = await closeExportViewerFrameButton(this.page);
    if (closed) {
      this.recordService('key export viewer closed');
    }
  }

  private async waitForIntendedPageActionCompletion(
    action: IntendedHarnessAction,
    expectedOutcome: 'success' | 'error',
  ): Promise<IntendedPageSnapshot> {
    try {
      await this.page.waitForFunction(intendedPageActionIsComplete, action, { timeout: 120_000 });
    } catch (error) {
      const snapshot = await this.tryReadIntendedPageSnapshot();
      throw new Error(
        [
          `Intended action ${action} did not complete.`,
          `Page snapshot: ${snapshot ? JSON.stringify(snapshot) : '<unavailable>'}`,
          this.recentTraceForError(),
          `Original error: ${String(error)}`,
        ].join('\n'),
      );
    }
    const snapshot = await readIntendedPageSnapshot(this.page);
    switch (expectedOutcome) {
      case 'success':
        if (snapshot.action.status === 'success') return snapshot;
        if (snapshot.action.status === 'error') {
          throw new Error(
            `Intended action ${action} failed: ${snapshot.action.error}\n${this.recentTraceForError()}`,
          );
        }
        break;
      case 'error':
        if (snapshot.action.status === 'error') return snapshot;
        if (snapshot.action.status === 'success') {
          throw new Error(`Intended action ${action} succeeded; expected a terminal failure`);
        }
        break;
      default:
        return assertNever(expectedOutcome);
    }
    throw new Error(`Intended action ${action} ended in invalid state: ${snapshot.action.status}`);
  }

  private async tryReadIntendedPageSnapshot(): Promise<IntendedPageSnapshot | null> {
    try {
      return await readIntendedPageSnapshot(this.page);
    } catch {
      return null;
    }
  }

  private recentTraceForError(): string {
    const recent = this.trace.slice(-30);
    if (recent.length === 0) return 'Recent intended trace: <empty>';
    return [
      'Recent intended trace:',
      ...recent.map((entry) => {
        const status = entry.status ? ` status=${entry.status}` : '';
        const url = entry.url ? ` url=${entry.url}` : '';
        return `- ${entry.kind}${status}${url}: ${entry.message}`;
      }),
    ].join('\n');
  }

  private async handleExternalRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!isExternalStubHost(url.hostname)) {
      await route.continue();
      return;
    }
    await fulfillExternalStub(route, this.config);
  }

  private async handleIntendedYaoFaultRoute(route: Route): Promise<void> {
    const current = this.intendedYaoFaultInjection;
    if (current.kind === 'idle') {
      await route.continue();
      return;
    }
    this.intendedYaoFaultInjection = { kind: 'idle' };
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_FAULT_HEADER_V1]: current.mode,
        [LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1]: current.token,
      },
    });
  }

  private async handleIntendedYaoRecoveryFaultRoute(route: Route): Promise<void> {
    const armed = this.intendedYaoRecoveryFault;
    if (armed === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoRecoveryFault = null;
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1]: armed.mode,
        [LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1]: armed.token,
      },
    });
  }

  /** Sends a recovery execution the Gateway kept to the Router, and reads the Router's reply. */
  private async releaseKeptRecoveryExecute(
    token: string,
  ): Promise<{ readonly status: number; readonly body: string }> {
    const response = await this.page.request.post(
      new URL(ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1, this.config.routerUrl).href,
      {
        headers: {
          [LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1]: 'release_router_recovery_execute',
          [LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1]: token,
        },
        data: {},
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Releasing a kept recovery execution failed: ${response.status()} ${await response.text()}`,
      );
    }
    const released = requireRecord(await response.json(), 'released recovery execution');
    return {
      status: Number(released.status),
      body: requireString(released.body, 'released recovery execution body'),
    };
  }

  private async handleIntendedYaoSigningFaultRoute(route: Route): Promise<void> {
    const armed = this.intendedYaoSigningFault;
    if (armed === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1]: armed.mode,
        [LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1]: armed.token,
      },
    });
  }

  private async handleIntendedYaoExportFaultRoute(route: Route): Promise<void> {
    const token = this.intendedYaoExportFaultToken;
    if (token === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoExportFaultToken = null;
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1]: 'lose_storage_after_export_authorization_once',
        [LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1]: token,
      },
    });
  }

  private async handleIntendedYaoFinalizeFaultRoute(route: Route): Promise<void> {
    const token = this.intendedYaoFinalizeFaultToken;
    if (token === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoFinalizeFaultToken = null;
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1]: 'lose_storage_after_decision_once',
        [LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1]: token,
      },
    });
  }

  private handleConsoleMessage(message: { type(): string; text(): string }): void {
    const text = message.text();
    this.trace.push({
      atMs: Date.now(),
      kind: 'console',
      message: `${message.type()}: ${text}`,
    });
    this.recordViolationIfNeeded(text);
  }

  private handlePageError(error: Error): void {
    const text = error.stack || error.message || String(error);
    this.trace.push({ atMs: Date.now(), kind: 'pageerror', message: text });
    this.recordViolationIfNeeded(text);
  }

  private handleRequestFailed(request: {
    url(): string;
    failure(): { errorText: string } | null;
  }): void {
    const failure = request.failure();
    const message = failure?.errorText || 'request failed';
    this.trace.push({
      atMs: Date.now(),
      kind: 'requestfailed',
      message,
      url: request.url(),
    });
    this.recordViolationIfNeeded(message);
  }

  private handleRequest(request: Request): void {
    const routePath = routePathAtRouter(request.url(), this.config.routerUrl);
    if (routePath) {
      this.trace.push({
        atMs: Date.now(),
        kind: 'request',
        message: `${request.method()} ${routePath}`,
        url: request.url(),
      });
    }
    const captured = captureWalletBudgetStatusRequest(request, this.config.routerUrl);
    if (captured) this.latestWalletBudgetStatusRequest = captured;
  }

  private async assertConcurrentWalletBudgetExhausted(): Promise<void> {
    const replay = await this.replayLatestWalletBudgetStatus();
    if (replay.kind !== 'exhausted') {
      throw new Error('Concurrent Tempo/Arc authoritative wallet budget remained active');
    }
    this.recordService(
      `authoritative wallet budget exhausted walletSessionId=${replay.walletSessionId} quotaId=${replay.quotaId}`,
    );
  }

  async readCurrentWalletSessionStatus() {
    const captured = this.latestWalletBudgetStatusRequest;
    if (!captured) throw new Error('Signing has not read Wallet Session status');
    const walletSessionId = parseWalletSessionId(captured.walletSessionId);
    const quotaId = parseMpcWalletSigningQuotaId(captured.quotaId);
    if (!walletSessionId.ok || !quotaId.ok) throw new Error('Invalid captured session identity');
    const response = await this.request.post(captured.url, {
      headers: { Authorization: captured.authorization, 'Content-Type': captured.contentType },
      data: captured.body,
    });
    if (!response.ok()) throw new Error(`Wallet Session status failed: ${response.status()}`);
    const status = parseExactWalletSessionStatusResponse(await response.json(), {
      walletSessionId: walletSessionId.value,
      quotaId: quotaId.value,
    });
    if (!status || (status.status !== 'active' && status.status !== 'exhausted')) {
      throw new Error('Expected a current Wallet Session');
    }
    return status;
  }

  private async replayLatestWalletBudgetStatus(): Promise<AuthoritativeWalletBudgetReplay> {
    const captured = this.latestWalletBudgetStatusRequest;
    if (!captured) {
      throw new Error('Signing did not issue an authenticated wallet budget status request');
    }
    return await this.replayWalletBudgetStatus(captured);
  }

  private async replayWalletBudgetStatus(
    captured: CapturedWalletBudgetStatusRequest,
  ): Promise<AuthoritativeWalletBudgetReplay> {
    const response = await this.request.post(captured.url, {
      headers: {
        Authorization: captured.authorization,
        'Content-Type': captured.contentType,
      },
      data: captured.body,
    });
    const responseText = await response.text();
    if (!response.ok()) {
      throw new Error(
        `Authoritative wallet budget status returned HTTP ${response.status()}: ${responseText}`,
      );
    }
    return parseAuthoritativeWalletBudgetStatus({
      responseText,
      expectedWalletSessionId: captured.walletSessionId,
      expectedQuotaId: captured.quotaId,
    });
  }

  private handleResponse(response: Response): void {
    const status = response.status();
    const faultProof = response.headers()[LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1];
    if (faultProof) this.intendedYaoFaultProofs.push(faultProof);
    const signingPath = routerAbEd25519SigningPath(response.url(), this.config.routerUrl);
    const yaoRegistrationPath = routerAbEd25519YaoRegistrationPath(
      response.url(),
      this.config.routerUrl,
    );
    const yaoRecoveryPath = routerAbEd25519YaoWarmRecoveryPath(
      response.url(),
      this.config.routerUrl,
    );
    const yaoExportPath = routerAbEd25519YaoExportPath(response.url(), this.config.routerUrl);
    if (status < 400) {
      void this.captureRecoveryAuthorityProjection(response);
      const observedPath = signingPath ?? yaoRegistrationPath ?? yaoRecoveryPath ?? yaoExportPath;
      if (observedPath) {
        this.trace.push({
          atMs: Date.now(),
          kind: 'response',
          message: `HTTP ${status} ${observedPath}`,
          status,
          url: response.url(),
        });
      }
      return;
    }
    this.trace.push({
      atMs: Date.now(),
      kind: 'response',
      message: `HTTP ${status}`,
      status,
      url: response.url(),
    });
    void this.captureFailedResponseBody(response);
  }

  private async captureRecoveryAuthorityProjection(response: Response): Promise<void> {
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (
      url.origin !== new URL(this.config.routerUrl).origin ||
      (url.pathname !== ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH &&
        url.pathname !== ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH)
    ) {
      return;
    }
    const body = await response.json().catch(() => null);
    try {
      this.recoveryAuthorityProjection = parseRecoveryAuthorityProjection(body);
    } catch {
      this.recoveryAuthorityProjectionError =
        'Recovery finalization returned an invalid authority projection';
    }
  }

  private async captureFailedResponseBody(response: Response): Promise<void> {
    const body = await response.text().catch(() => '');
    const bodySnippet = compactResponseBodyForTrace(body);
    if (!bodySnippet) return;
    this.trace.push({
      atMs: Date.now(),
      kind: 'response',
      message: bodySnippet,
      status: response.status(),
      url: response.url(),
    });
    this.recordViolationIfNeeded(bodySnippet);
  }

  private recordStage(message: string): void {
    this.trace.push({ atMs: Date.now(), kind: 'stage', message });
  }

  private assertRouterAbEd25519SigningRoutes(traceStartIndex: number): void {
    const observedPaths = new Set(
      this.trace
        .slice(traceStartIndex)
        .map((entry) => routerAbEd25519SigningPath(entry.url, this.config.routerUrl))
        .filter((path): path is (typeof ROUTER_AB_ED25519_SIGNING_PATHS)[number] => !!path),
    );
    for (const expectedPath of ROUTER_AB_ED25519_SIGNING_PATHS) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`NEAR signing did not traverse ${expectedPath}`);
      }
    }
    this.recordService('NEAR signing traversed Router A/B Ed25519 prepare and finalize routes');
  }

  private assertNoEd25519YaoRegistrationRoutes(traceStartIndex: number): void {
    const observedPaths = this.trace
      .slice(traceStartIndex)
      .map((entry) => routerAbEd25519YaoRegistrationPath(entry.url, this.config.routerUrl))
      .filter((path): path is (typeof ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS)[number] => !!path);
    if (observedPaths.length > 0) {
      throw new Error(
        `Ordinary NEAR signing invoked Ed25519 Yao activation routes: ${observedPaths.join(', ')}`,
      );
    }
    this.recordService('ordinary NEAR signing made zero Ed25519 Yao activation route calls');
  }

  private assertNoRouterAbEd25519YaoRecoveryRoutes(
    traceStartIndex: number,
    scenario: IntendedNoYaoRecoveryAssertionScenario,
  ): void {
    const flowLabel = noYaoRecoveryAssertionLabel(scenario);
    const observedPaths = new Set<(typeof ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS)[number]>();
    for (const entry of this.trace.slice(traceStartIndex)) {
      const path = routerAbEd25519YaoWarmRecoveryPath(entry.url, this.config.routerUrl);
      if (path) observedPaths.add(path);
    }
    if (observedPaths.size > 0) {
      throw new Error(
        `${flowLabel} unexpectedly invoked Yao recovery routes: ${[...observedPaths].join(', ')}`,
      );
    }
    this.recordService(`${flowLabel} rehydrated local Ed25519 material without Yao recovery`);
  }

  private assertRouterAbEd25519YaoExportRoutes(traceStartIndex: number): void {
    const observedPaths = new Set<(typeof ROUTER_AB_ED25519_YAO_EXPORT_PATHS)[number]>();
    for (const entry of this.trace.slice(traceStartIndex)) {
      const path = routerAbEd25519YaoExportPath(entry.url, this.config.routerUrl);
      if (path) observedPaths.add(path);
    }
    for (const expectedPath of ROUTER_AB_ED25519_YAO_EXPORT_PATHS) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`Ed25519 export did not traverse ${expectedPath}`);
      }
    }
    this.recordService('Ed25519 export traversed all strict Router A/B Yao export routes');
  }

  private recordService(message: string): void {
    this.trace.push({ atMs: Date.now(), kind: 'service', message });
  }

  private armIntendedYaoFault(mode: IntendedYaoFaultModeV1): string {
    if (this.intendedYaoFaultInjection.kind !== 'idle') {
      throw new Error('An intended Yao transport fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const token = randomUUID();
    this.intendedYaoFaultInjection = { kind: 'armed', mode, token };
    return token;
  }

  private assertIntendedYaoFaultProof(
    proofStartIndex: number,
    token: string,
    expected: IntendedYaoFaultProofV1,
  ): void {
    const observed = this.intendedYaoFaultProofs.slice(proofStartIndex);
    const expectedProof = `${token}:${expected}`;
    if (observed.length !== 1 || observed[0] !== expectedProof) {
      throw new Error(
        `Expected intended Yao fault proof ${expectedProof}; observed ${observed.join(', ') || '<none>'}`,
      );
    }
    this.recordService(`intended Yao fault proof: ${expected}`);
  }

  private recordViolationIfNeeded(message: string): void {
    const matched = LIFECYCLE_FAILURE_MATCHERS.find((matcher) => matcher.pattern.test(message));
    if (!matched) return;
    this.violations.push(`${matched.id}: ${message}`);
  }

  private currentOperatingAuthFamily(): 'passkey' | 'email_otp' {
    if (this.operatingAuthFamily) return this.operatingAuthFamily;
    return this.flow.startsWith('passkey') ? 'passkey' : 'email_otp';
  }

  private assertSigningAuthEvents(
    snapshot: IntendedPageSnapshot,
    stage: IntendedSigningStage,
    label: string,
  ): SigningAuthEventSummary {
    const expectation = signingAuthExpectationForStage(this.currentOperatingAuthFamily(), stage);
    const summary = summarizeSigningAuthEvents(snapshot);
    assertSigningAuthExpectation({
      label,
      stage,
      expectation,
      summary,
    });
    this.passkeyPromptCount += signingPasskeyPromptCount(summary);
    this.emailOtpVerificationCount += signingEmailOtpVerificationCount(summary);
    return summary;
  }

  private assertKeyExportAuthEvents(
    snapshot: IntendedPageSnapshot,
    label: string,
  ): AuthCounterIncrement {
    const summary = summarizeKeyExportAuthEvents(snapshot);
    const diagnostics = this.latestWalletIframeAutoConfirmDiagnostics;
    if (this.currentOperatingAuthFamily() === 'passkey') {
      assertPasskeyKeyExportAuth({ label, summary, diagnostics });
      return { passkeyPrompts: 1, emailOtpVerifications: 0 };
    }
    assertEmailOtpKeyExportAuth({ label, summary, diagnostics });
    return { passkeyPrompts: 0, emailOtpVerifications: 1 };
  }

  private recordExportAuthCounters(increment: AuthCounterIncrement): void {
    this.passkeyPromptCount += increment.passkeyPrompts;
    this.emailOtpVerificationCount += increment.emailOtpVerifications;
  }

  private recordSigningRemainingUses(summary: SigningAuthEventSummary): void {
    const remainingUses = minimumRemainingUse(summary);
    if (remainingUses === null) return;
    this.latestSigningRemainingUses = remainingUses;
  }

  private requireRegisteredWalletForSigning(): RegisteredWalletSnapshot {
    if (this.registeredWallet) return this.registeredWallet;
    throw new Error('Signing requires a registered wallet');
  }
}

async function browserStorageDatabasesEmpty(): Promise<boolean> {
  const databases = await indexedDB.databases().catch((): IDBDatabaseInfo[] => []);
  return databases.every((database) => !database.name);
}

function noYaoRecoveryAssertionLabel(scenario: IntendedNoYaoRecoveryAssertionScenario): string {
  switch (scenario.kind) {
    case 'passkey_unlock':
      return 'Passkey unlock';
    case 'email_otp_unlock':
      return 'Email OTP unlock';
    case 'post_refresh_near_signing':
      return 'Post-refresh local-envelope hydration';
    default:
      return assertNever(scenario);
  }
}

function navigateWithinSite(targetHref: string): void {
  const target = new URL(targetHref, window.location.origin);
  if (target.origin !== window.location.origin) {
    throw new Error(`Refusing cross-origin client navigation to ${target.origin}`);
  }
  const relativeHref = `${target.pathname}${target.search}${target.hash}`;
  window.history.pushState({}, '', relativeHref);
  window.dispatchEvent(new Event('site:navigate'));
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function requireEmailOtpRegisteredWalletSnapshot(
  registration: RegisteredWalletSnapshot,
): EmailOtpRegistrationResultSnapshot {
  if (registration.kind === 'email_otp_registration_success') return registration;
  throw new Error('Email OTP unlock requires an Email OTP registration snapshot');
}

function requirePasskeyRegisteredWalletSnapshot(
  registration: RegisteredWalletSnapshot,
): PasskeyRegistrationResultSnapshot {
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
function requireLinkableRegisteredWallet(
  registration: RegisteredWalletSnapshot,
): RegisteredWalletSnapshot {
  if (registration.nearReadiness === 'pending') {
    throw new Error(
      `Device linking requires NEAR readiness; current state is ${nearStateLabel(registration)}`,
    );
  }
  return registration;
}

function requireNearReadyRegisteredWallet(
  registration: RegisteredWalletSnapshot,
  operation: string,
): NearReadyRegisteredWalletSnapshot {
  if (registration.nearReadiness === 'ready') return registration;
  throw new Error(
    `${operation} requires NEAR readiness; current state is ${nearStateLabel(registration)}`,
  );
}

function registeredWalletWithNearReady(
  registration: RegisteredWalletSnapshot,
  ready: NearProvisioningReadySnapshot,
): NearReadyRegisteredWalletSnapshot {
  switch (registration.kind) {
    case 'passkey_registration_success':
      return passkeyWalletWithNearReady(registration, ready);
    case 'email_otp_registration_success':
      return emailOtpWalletWithNearReady(registration, ready);
    default:
      return assertNever(registration);
  }
}

function passkeyWalletWithNearReady(
  registration: PasskeyRegistrationResultSnapshot,
  ready: NearProvisioningReadySnapshot,
): NearReadyRegisteredWalletSnapshot {
  const near = {
    kind: registration.kind,
    walletId: registration.walletId,
    nearReadiness: 'ready' as const,
    nearAccountId: ready.nearAccountId,
    operationalPublicKey: ready.operationalPublicKey,
  };
  switch (registration.ecdsaTargetProfile) {
    case 'none':
      return { ...near, ecdsaTargetProfile: 'none', ecdsaTargetKeys: registration.ecdsaTargetKeys };
    case 'tempo':
      return {
        ...near,
        ecdsaTargetProfile: 'tempo',
        thresholdEcdsaEthereumAddress: registration.thresholdEcdsaEthereumAddress,
        thresholdEcdsaPublicKeyB64u: registration.thresholdEcdsaPublicKeyB64u,
        ecdsaTargetKeys: registration.ecdsaTargetKeys,
      };
    case 'tempo_arc':
      return {
        ...near,
        ecdsaTargetProfile: 'tempo_arc',
        ecdsaTargetKeys: registration.ecdsaTargetKeys,
      };
    default:
      return assertNever(registration);
  }
}

function emailOtpWalletWithNearReady(
  registration: EmailOtpRegistrationResultSnapshot,
  ready: NearProvisioningReadySnapshot,
): NearReadyRegisteredWalletSnapshot {
  const core = {
    kind: registration.kind,
    initialWalletId: registration.initialWalletId,
    walletId: registration.walletId,
    nearReadiness: 'ready' as const,
    nearAccountId: ready.nearAccountId,
    operationalPublicKey: ready.operationalPublicKey,
    authenticationKind: registration.authenticationKind,
  };
  switch (registration.ecdsaTargetProfile) {
    case 'none':
      return { ...core, ecdsaTargetProfile: 'none', ecdsaTargetKeys: registration.ecdsaTargetKeys };
    case 'tempo':
      return {
        ...core,
        ecdsaTargetProfile: 'tempo',
        thresholdEcdsaEthereumAddress: registration.thresholdEcdsaEthereumAddress,
        thresholdEcdsaPublicKeyB64u: registration.thresholdEcdsaPublicKeyB64u,
        ecdsaTargetKeys: registration.ecdsaTargetKeys,
      };
    case 'tempo_arc':
      return {
        ...core,
        ecdsaTargetProfile: 'tempo_arc',
        ecdsaTargetKeys: registration.ecdsaTargetKeys,
      };
    default:
      return assertNever(registration);
  }
}

export const intendedTest = base.extend<{
  harness: IntendedBehaviourHarness;
}>({
  harness: async ({ context, page, request }, use, testInfo) => {
    const flow = lifecycleFlowFromTestFile(testInfo.file);
    const networkMode = intendedNetworkModeFromEnv();
    if (networkMode === 'external_staging') {
      await installHostedBenchmarkAccess(context);
    }
    const harness = new IntendedBehaviourHarness({
      context,
      flow,
      networkMode,
      page,
      request,
    });
    await harness.initialize();
    await use(harness);
    await harness.attachTrace(testInfo);
    await harness.closeLinkedDevice(testInfo);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
  },
});

function hostedBenchmarkAccessToken(): string {
  const accessToken = process.env.SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN;
  if (!accessToken || accessToken.length < 32) {
    throw new Error('Hosted benchmark access token must contain at least 32 characters');
  }
  return accessToken;
}

async function installHostedBenchmarkAccess(context: BrowserContext): Promise<void> {
  const accessToken = hostedBenchmarkAccessToken();
  const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL;
  if (!gatewayUrl) throw new Error('Hosted benchmark Gateway URL is required');
  const gatewayOrigin = new URL(gatewayUrl).origin;
  await context.route(
    `${gatewayOrigin}/**`,
    forwardHostedBenchmarkRequest.bind(undefined, accessToken),
  );
}

async function forwardHostedBenchmarkRequest(accessToken: string, route: Route): Promise<void> {
  await route.continue({
    headers: {
      ...route.request().headers(),
      'x-r150-benchmark-access': accessToken,
    },
  });
}

function intendedNetworkModeFromEnv(): 'managed_local' | 'external_staging' {
  switch (process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY) {
    case undefined:
    case '0':
      return 'managed_local';
    case '1': {
      const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
      const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL;
      if (arm !== 'd1' && arm !== 'do') {
        throw new Error('Hosted benchmark backend arm must be d1 or do');
      }
      if (!gatewayUrl) throw new Error('Hosted benchmark Gateway URL is required');
      const gateway = new URL(gatewayUrl);
      if (
        gateway.protocol !== 'https:' ||
        gateway.hostname.split('.')[0] !== `r150-bench-20260925-${arm}-ingress`
      ) {
        throw new Error('Hosted benchmark Gateway must name the selected arm ingress');
      }
      return 'external_staging';
    }
    default:
      throw new Error('SEAMS_INTENDED_EXTERNAL_GATEWAY must be 0 or 1');
  }
}

function intendedHarnessConfigFromEnv(): IntendedHarnessConfig {
  const googleClientId = resolveGoogleClientId({ processEnv: process.env });
  return {
    appUrl: process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4001',
    routerUrl: process.env.SEAMS_INTENDED_ROUTER_URL || 'https://localhost:4101',
    walletOrigin: process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'https://localhost:4002',
    projectEnvironmentId: process.env.SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID || 'local-env',
    publishableKey: process.env.SEAMS_INTENDED_PUBLISHABLE_KEY || 'pk_local',
    emailOtpAddress: process.env.SEAMS_INTENDED_EMAIL || 'alice@example.test',
    googleProviderSubjectPrefix:
      process.env.SEAMS_INTENDED_GOOGLE_SUBJECT_PREFIX || 'intended-google-subject',
    googleClientId,
    googleIdToken: process.env.SEAMS_INTENDED_GOOGLE_ID_TOKEN || '',
    passkeyEcdsaTargetProfile: ecdsaTargetProfileFromEnv({
      raw: process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE,
      name: 'SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE',
    }),
    emailOtpEcdsaTargetProfile: emailOtpEcdsaTargetProfileFromEnv(
      process.env.SEAMS_INTENDED_EMAIL_OTP_ECDSA_TARGET_PROFILE,
    ),
    signingSessionDebug: process.env.SEAMS_INTENDED_SIGNING_SESSION_DEBUG === '1',
  };
}

function requireUsableIntendedGoogleIdToken(
  config: Pick<IntendedHarnessConfig, 'googleClientId' | 'googleIdToken'>,
): void {
  const result = describeUsableGoogleIdToken({
    token: config.googleIdToken,
    clientId: config.googleClientId,
  });
  if (result.status === 'usable') return;
  throw new Error(
    [
      `SEAMS_INTENDED_GOOGLE_ID_TOKEN is ${result.reason}.`,
      'Run pnpm -C tests ensure:intended-google-token before invoking Google-backed intended actions.',
    ].join(' '),
  );
}

export function requireLocalIntendedYaoFaultRouterOrigin(routerUrl: string): void {
  const origin = new URL(routerUrl).origin;
  const offset = Number(process.env.SEAMS_LOCAL_PORT_OFFSET || 0);
  const expected =
    Number.isSafeInteger(offset) && offset >= 0 && offset <= 61435
      ? `http://127.0.0.1:${4100 + offset}`
      : LOCAL_INTENDED_YAO_ROUTER_ORIGIN_V1;
  if (origin === expected) return;
  throw new Error(`Intended Yao fault injection requires ${expected}; received ${origin}`);
}

function emailOtpEcdsaTargetProfileFromEnv(raw: string | undefined): EcdsaTargetProfileName {
  return ecdsaTargetProfileFromEnv({
    raw,
    name: 'SEAMS_INTENDED_EMAIL_OTP_ECDSA_TARGET_PROFILE',
  });
}

function ecdsaTargetProfileFromEnv(args: {
  raw: string | undefined;
  name: string;
}): EcdsaTargetProfileName {
  const value = String(args.raw || 'tempo_arc').trim();
  switch (value) {
    case 'none':
    case 'tempo':
    case 'tempo_arc':
      return value;
    default:
      throw new Error(`Unknown ${args.name}: ${value}`);
  }
}

function uniqueWalletId(): string {
  return String(createReadableWalletId());
}

function lifecycleFlowFromTestFile(filePath: string): IntendedLifecycleFlow {
  const normalized = filePath.replaceAll('\\', '/');
  if (
    /\/passkey\.registration(?:\.(?:checkpoint|resume|activation-resume))?\.contract\.test\.ts$/u.test(
      normalized,
    ) ||
    normalized.endsWith('passkey.presign-pool.contract.test.ts') ||
    normalized.endsWith('passkey.ed25519-yao-local.contract.test.ts') ||
    normalized.endsWith('passkey.add-email-otp.contract.test.ts') ||
    normalized.endsWith('passkey.device-linking.contract.test.ts') ||
    normalized.endsWith('auth-method-addition.matrix.contract.test.ts') ||
    normalized.endsWith('passkey.registration.benchmark.test.ts')
  ) {
    return 'passkey.registration';
  }
  if (normalized.endsWith('passkey.unlock.contract.test.ts')) return 'passkey.unlock';
  if (normalized.endsWith('passkey.recovery.contract.test.ts')) {
    return 'passkey.recovery';
  }
  if (normalized.endsWith('google-email-otp.recovery.contract.test.ts')) {
    return 'email_otp.recovery';
  }
  if (
    normalized.endsWith('email-otp.registration.contract.test.ts') ||
    normalized.endsWith('email-otp.registration.resume.contract.test.ts') ||
    normalized.endsWith('email-otp.add-passkey.contract.test.ts') ||
    normalized.endsWith('email-otp.registration.benchmark.test.ts')
  ) {
    return 'email_otp.registration';
  }
  if (
    normalized.endsWith('email-otp.unlock.contract.test.ts') ||
    normalized.endsWith('email-otp.unlock.benchmark.test.ts')
  ) {
    return 'email_otp.unlock';
  }
  throw new Error(`Unknown intended lifecycle contract file: ${filePath}`);
}

async function clearBrowserStorage(): Promise<void> {
  localStorage.clear();
  sessionStorage.clear();
  const databases = await indexedDB.databases().catch((): IDBDatabaseInfo[] => []);
  const deletions: Promise<void>[] = [];
  for (const database of databases) {
    const name = database.name;
    if (!name) continue;
    deletions.push(
      new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => undefined;
      }),
    );
  }
  await Promise.all(deletions);
}

export function enableSigningSessionDebugInFrame(): void {
  try {
    localStorage.setItem('seams:debug:signing-session', '1');
  } catch {}
}

function enableRegistrationBenchmarkDiagnosticsInFrame(): void {
  (
    globalThis as {
      __SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS?: boolean;
    }
  ).__SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS = true;
}

function scheduleServiceReadinessRetry(resolve: () => void): void {
  setTimeout(resolve, 250);
}

async function assertHttpOk(
  request: APIRequestContext,
  url: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await request.get(url, { headers, ignoreHTTPSErrors: true, timeout: 5_000 });
      lastStatus = response.status();
      if (response.ok()) return;
    } catch {
      lastStatus = 0;
    }
    await new Promise<void>(scheduleServiceReadinessRetry);
  }
  throw new Error(`${label} is not ready at ${url}${lastStatus > 0 ? `: HTTP ${lastStatus}` : ''}`);
}

function isExternalStubHost(hostname: string): boolean {
  return EXTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

async function fulfillExternalStub(route: Route, config: IntendedHarnessConfig): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sub: `${config.googleProviderSubjectPrefix}-stub`,
        email: config.emailOtpAddress,
        email_verified: true,
        aud: config.publishableKey,
      }),
    });
    return;
  }
  if (url.hostname.endsWith('near.org')) {
    await fulfillNearRpcStub(route);
    return;
  }
  if (url.hostname.endsWith('fastnear.com')) {
    await fulfillNearRpcStub(route);
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: 'intended-evm', result: '0x1' }),
  });
}

async function fulfillNearRpcStub(route: Route): Promise<void> {
  const request = parseJsonRpcRequest(route.request().postData() || '{}');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: nearRpcStubResult(request),
    }),
  });
}

function parseJsonRpcRequest(body: string): { id: unknown; method: string; params: unknown } {
  try {
    const parsed = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { id: 'intended-near', method: 'unknown', params: null };
    }
    const id = Reflect.get(parsed, 'id');
    const method = Reflect.get(parsed, 'method');
    return {
      id: id ?? 'intended-near',
      method: typeof method === 'string' ? method : 'unknown',
      params: Reflect.get(parsed, 'params'),
    };
  } catch {
    return { id: 'intended-near', method: 'unknown', params: null };
  }
}

function nearRpcStubResult(request: { method: string; params: unknown }): unknown {
  switch (request.method) {
    case 'query':
      return nearRpcQueryStubResult(request.params);
    case 'block':
      return {
        author: 'intended-e2e',
        chunks: [],
        header: {
          hash: NEAR_STUB_BLOCK_HASH,
          height: 1,
          prev_hash: NEAR_STUB_BLOCK_HASH,
        },
      };
    case 'send_tx':
      return {
        status: { SuccessValue: '' },
        transaction: { hash: 'intended-near-tx' },
        transaction_outcome: {
          id: 'intended-near-tx',
          outcome: { status: { SuccessValue: '' } },
        },
        receipts_outcome: [],
      };
    default:
      return {};
  }
}

function compactResponseBodyForTrace(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return trimmed.length <= 2_000 ? trimmed : `${trimmed.slice(0, 2_000)}...<truncated>`;
}

function nearRpcQueryStubResult(params: unknown): unknown {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return {};
  const requestType = Reflect.get(params, 'request_type');
  switch (requestType) {
    case 'view_access_key':
      return {
        nonce: 1,
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
        permission: 'FullAccess',
      };
    case 'view_access_key_list':
      return {
        keys: [],
      };
    case 'view_account':
      return {
        amount: '1000000000000000000000000',
        locked: '0',
        code_hash: NEAR_STUB_BLOCK_HASH,
        storage_usage: 0,
        storage_paid_at: 0,
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
      };
    case 'call_function':
      return {
        result: Array.from(new TextEncoder().encode(JSON.stringify('Hello from local NEAR'))),
        logs: [],
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
      };
    default:
      return {};
  }
}

function signingAuthExpectationForStage(
  authFamily: 'passkey' | 'email_otp',
  stage: IntendedSigningStage,
): SigningAuthExpectation {
  switch (stage) {
    case 'post_registration':
      return 'warm_session';
    case 'post_unlock':
    case 'post_device_link':
    case 'after_refresh_recovery':
      return 'warm_session';
    case 'step_up_required':
      return authFamily === 'passkey' ? 'passkey_step_up' : 'email_otp_step_up';
    default:
      return assertNever(stage);
  }
}

function summarizeSigningAuthEvents(snapshot: IntendedPageSnapshot): SigningAuthEventSummary {
  const phases: string[] = [];
  const authenticationMethods: SigningAuthMethod[] = [];
  const remainingUses: number[] = [];
  let warmSessionClaimed = false;
  let authorityClaims = 0;
  let warmSessionPlanClaims = 0;
  let passkeyPromptStarted = false;
  let passkeyPromptSucceeded = false;
  let passkeyAuthenticationComplete = false;
  let emailOtpChallengeStarted = false;
  let emailOtpChallengeSent = false;
  let emailOtpVerifyStarted = false;
  let emailOtpVerifySucceeded = false;
  let emailOtpAuthenticationComplete = false;
  let thresholdReconnectStarted = false;
  let thresholdReconnectSucceeded = false;

  for (const event of snapshot.events) {
    const phase = signingEventPhase(event.payload);
    if (!phase) continue;
    phases.push(phase);
    const maybeRemainingUses = signingEventRemainingUses(event.payload);
    if (maybeRemainingUses !== null) {
      remainingUses.push(maybeRemainingUses);
    }
    const completedAuthMethod = signingAuthenticationCompleteAuthMethod(event.payload, phase);
    if (completedAuthMethod) {
      authenticationMethods.push(completedAuthMethod);
      switch (completedAuthMethod) {
        case 'passkey':
          passkeyAuthenticationComplete = true;
          break;
        case 'email_otp':
          emailOtpAuthenticationComplete = true;
          break;
        case 'warm_session':
          break;
        default:
          assertNever(completedAuthMethod);
      }
    }
    switch (phase) {
      case SIGNING_AUTH_WARM_SESSION_CLAIMED:
        warmSessionClaimed = true;
        if (signingEventClaimedActiveWalletAuthority(event.payload)) authorityClaims += 1;
        else warmSessionPlanClaims += 1;
        break;
      case SIGNING_AUTH_PASSKEY_PROMPT_STARTED:
        passkeyPromptStarted = true;
        break;
      case SIGNING_AUTH_PASSKEY_PROMPT_SUCCEEDED:
        passkeyPromptSucceeded = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_CHALLENGE_STARTED:
        emailOtpChallengeStarted = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_CHALLENGE_SENT:
        emailOtpChallengeSent = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_VERIFY_STARTED:
        emailOtpVerifyStarted = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_VERIFY_SUCCEEDED:
        emailOtpVerifySucceeded = true;
        break;
      case SIGNING_THRESHOLD_SESSION_RECONNECT_STARTED:
        thresholdReconnectStarted = true;
        break;
      case SIGNING_THRESHOLD_SESSION_RECONNECT_SUCCEEDED:
        thresholdReconnectSucceeded = true;
        break;
      default:
        break;
    }
  }

  return {
    phases,
    authenticationMethods,
    remainingUses,
    warmSessionClaimed,
    activeWalletAuthorityClaimed: authorityClaims > 0 && warmSessionPlanClaims === 0,
    passkeyPromptStarted,
    passkeyPromptSucceeded,
    passkeyAuthenticationComplete,
    emailOtpChallengeStarted,
    emailOtpChallengeSent,
    emailOtpVerifyStarted,
    emailOtpVerifySucceeded,
    emailOtpAuthenticationComplete,
    thresholdReconnectStarted,
    thresholdReconnectSucceeded,
  };
}

function assertSigningAuthExpectation(input: {
  label: string;
  stage: IntendedSigningStage;
  expectation: SigningAuthExpectation;
  summary: SigningAuthEventSummary;
}): void {
  switch (input.expectation) {
    case 'warm_session':
      assertWarmSessionSigningAuth(input);
      return;
    case 'passkey_step_up':
      assertPasskeyStepUpSigningAuth(input);
      return;
    case 'email_otp_step_up':
      assertEmailOtpStepUpSigningAuth(input);
      return;
    default:
      return assertNever(input.expectation);
  }
}

function signingAuthSummaryDetails(summary: SigningAuthEventSummary): string {
  return JSON.stringify({
    phases: summary.phases,
    authenticationMethods: summary.authenticationMethods,
    remainingUses: summary.remainingUses,
    warmSessionClaimed: summary.warmSessionClaimed,
    activeWalletAuthorityClaimed: summary.activeWalletAuthorityClaimed,
    passkeyPromptStarted: summary.passkeyPromptStarted,
    passkeyPromptSucceeded: summary.passkeyPromptSucceeded,
    passkeyAuthenticationComplete: summary.passkeyAuthenticationComplete,
    emailOtpChallengeStarted: summary.emailOtpChallengeStarted,
    emailOtpChallengeSent: summary.emailOtpChallengeSent,
    emailOtpVerifyStarted: summary.emailOtpVerifyStarted,
    emailOtpVerifySucceeded: summary.emailOtpVerifySucceeded,
    emailOtpAuthenticationComplete: summary.emailOtpAuthenticationComplete,
    thresholdReconnectStarted: summary.thresholdReconnectStarted,
    thresholdReconnectSucceeded: summary.thresholdReconnectSucceeded,
  });
}

function assertWarmSessionSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const usedNoPromptReconnect =
    input.summary.thresholdReconnectSucceeded &&
    !input.summary.passkeyPromptStarted &&
    !input.summary.passkeyPromptSucceeded &&
    !input.summary.passkeyAuthenticationComplete &&
    !hasAnyEmailOtpSigningEvent(input.summary);
  if (!input.summary.warmSessionClaimed && !usedNoPromptReconnect) {
    throw new Error(
      `${input.label} at ${input.stage} did not claim a warm signing session; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete
  ) {
    throw new Error(`${input.label} at ${input.stage} prompted for passkey before exhaustion`);
  }
  if (hasAnyEmailOtpSigningEvent(input.summary)) {
    throw new Error(`${input.label} at ${input.stage} used Email OTP before exhaustion`);
  }
  if (
    input.summary.remainingUses.length === 0 &&
    !usedNoPromptReconnect &&
    !input.summary.activeWalletAuthorityClaimed
  ) {
    throw new Error(`${input.label} at ${input.stage} did not report remaining signing uses`);
  }
}

function assertPasskeyStepUpSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const performedPasskeyAuth =
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete;
  if (!performedPasskeyAuth) {
    throw new Error(
      `${input.label} at ${input.stage} did not perform passkey step-up; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (hasAnyEmailOtpSigningEvent(input.summary)) {
    throw new Error(`${input.label} at ${input.stage} used Email OTP in a passkey lifecycle`);
  }
}

function assertEmailOtpStepUpSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const performedEmailOtpAuth =
    input.summary.emailOtpChallengeSent ||
    input.summary.emailOtpVerifySucceeded ||
    input.summary.emailOtpAuthenticationComplete;
  if (!performedEmailOtpAuth) {
    throw new Error(
      `${input.label} at ${input.stage} did not perform Email OTP step-up; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete
  ) {
    throw new Error(`${input.label} at ${input.stage} used passkey in an Email OTP lifecycle`);
  }
}

function summarizeKeyExportAuthEvents(snapshot: IntendedPageSnapshot): KeyExportAuthEventSummary {
  const phases: string[] = [];
  let passkeyPromptStarted = false;
  let passkeyPromptSucceeded = false;

  for (const event of snapshot.events) {
    const phase = signingEventPhase(event.payload);
    if (!phase) continue;
    phases.push(phase);
    switch (phase) {
      case KEY_EXPORT_AUTH_PASSKEY_PROMPT_STARTED:
        passkeyPromptStarted = true;
        break;
      case KEY_EXPORT_AUTH_PASSKEY_PROMPT_SUCCEEDED:
        passkeyPromptSucceeded = true;
        break;
      default:
        break;
    }
  }

  return {
    phases,
    passkeyPromptStarted,
    passkeyPromptSucceeded,
  };
}

function assertPasskeyKeyExportAuth(input: {
  label: string;
  summary: KeyExportAuthEventSummary;
  diagnostics: WalletIframeAutoConfirmDiagnostics | null;
}): void {
  if (!input.summary.passkeyPromptStarted || !input.summary.passkeyPromptSucceeded) {
    throw new Error(
      `${input.label} did not require fresh passkey export authorization; observed ${keyExportAuthSummaryDetails(input.summary)}`,
    );
  }
  if (input.diagnostics?.otpFilled) {
    throw new Error(`${input.label} filled Email OTP in a passkey lifecycle`);
  }
}

function assertEmailOtpKeyExportAuth(input: {
  label: string;
  summary: KeyExportAuthEventSummary;
  diagnostics: WalletIframeAutoConfirmDiagnostics | null;
}): void {
  if (input.summary.passkeyPromptStarted || input.summary.passkeyPromptSucceeded) {
    throw new Error(`${input.label} used passkey export authorization in an Email OTP lifecycle`);
  }
  if (!input.diagnostics?.otpFilled) {
    throw new Error(
      `${input.label} did not fill a fresh Email OTP export authorization; diagnostics ${JSON.stringify(input.diagnostics)}`,
    );
  }
}

function keyExportAuthSummaryDetails(summary: KeyExportAuthEventSummary): string {
  return JSON.stringify({
    phases: summary.phases,
    passkeyPromptStarted: summary.passkeyPromptStarted,
    passkeyPromptSucceeded: summary.passkeyPromptSucceeded,
  });
}

function hasAnyEmailOtpSigningEvent(summary: SigningAuthEventSummary): boolean {
  return (
    summary.emailOtpChallengeStarted ||
    summary.emailOtpChallengeSent ||
    summary.emailOtpVerifyStarted ||
    summary.emailOtpVerifySucceeded ||
    summary.emailOtpAuthenticationComplete
  );
}

function signingPasskeyPromptCount(summary: SigningAuthEventSummary): number {
  return summary.passkeyPromptStarted ||
    summary.passkeyPromptSucceeded ||
    summary.passkeyAuthenticationComplete
    ? 1
    : 0;
}

function signingEmailOtpVerificationCount(summary: SigningAuthEventSummary): number {
  return hasAnyEmailOtpSigningEvent(summary) ? 1 : 0;
}

function minimumRemainingUse(summary: SigningAuthEventSummary): number | null {
  if (summary.remainingUses.length === 0) return null;
  return Math.min(...summary.remainingUses);
}

function signingEventPhase(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const phase = Reflect.get(payload, 'phase');
  return typeof phase === 'string' ? phase : null;
}

function signingEventClaimedActiveWalletAuthority(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const data = Reflect.get(payload, 'data');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  return (
    typeof Reflect.get(data, 'authorityId') === 'string' &&
    typeof Reflect.get(data, 'walletSessionId') === 'string'
  );
}

function signingEventRemainingUses(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = Reflect.get(payload, 'data');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const remainingUses = Reflect.get(data, 'remainingUses');
  if (typeof remainingUses !== 'number' || !Number.isFinite(remainingUses)) return null;
  return remainingUses;
}

function signingAuthenticationCompleteAuthMethod(
  payload: unknown,
  phase: string,
): SigningAuthMethod | null {
  if (phase !== SIGNING_AUTHENTICATION_COMPLETE) return null;
  return eventAuthMethod(payload);
}

function eventAuthMethod(payload: unknown): SigningAuthMethod | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const authMethod = Reflect.get(payload, 'authMethod');
  if (authMethod === 'passkey' || authMethod === 'email_otp' || authMethod === 'warm_session') {
    return authMethod;
  }
  return null;
}

function requirePasskeyRegistrationResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): PasskeyRegistrationResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Passkey registration did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'passkey_registration_success') {
    throw new Error(`Passkey registration returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Passkey registration wallet mismatch: ${result.walletId}`);
  }
  return result;
}

function requireEd25519AddSignerResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): Ed25519AddSignerResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Ed25519 add-signer did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'wallet_signer_added') {
    throw new Error(`Ed25519 add-signer returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Ed25519 add-signer wallet mismatch: ${result.walletId}`);
  }
  if (!result.nearAccountId || !result.nearEd25519SigningKeyId || !result.operationalPublicKey) {
    throw new Error('Ed25519 add-signer result is missing signer identity');
  }
  return result;
}

function requireEmailOtpRegistrationResult(
  snapshot: IntendedPageSnapshot,
): EmailOtpRegistrationResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Email OTP registration did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'email_otp_registration_success') {
    throw new Error(`Email OTP registration returned unexpected result kind: ${result.kind}`);
  }
  if (!result.initialWalletId) {
    throw new Error('Email OTP registration result is missing initialWalletId');
  }
  if (!result.walletId) {
    throw new Error('Email OTP registration result is missing walletId');
  }
  if (result.walletId === result.initialWalletId) {
    throw new Error('Email OTP registration did not reroll the initial wallet id');
  }
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(
      `Email OTP registration did not authenticate the wallet: ${result.authenticationKind}`,
    );
  }
  return result;
}

function requireNearProvisioningReadyResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): NearProvisioningReadySnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`NEAR provisioning did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'near_provisioning_ready') {
    throw new Error(`NEAR provisioning returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`NEAR provisioning wallet mismatch: ${result.walletId}`);
  }
  return result;
}

function requireDeviceLinkApprovalResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): DeviceLinkApprovalRecordedSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Device 1 link approval ended with ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'device_link_approval_recorded') {
    throw new Error(`Device 1 link approval returned ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Device 1 approved a link for ${result.walletId}`);
  }
  return result;
}

function intendedDeviceLinkSettled(): boolean {
  const state = document
    .querySelector('[data-testid="intended-e2e-page"]')
    ?.getAttribute('data-device-link-state');
  return state === 'active' || state === 'failed';
}

type DeviceLinkSettledSnapshot =
  | ({ status: 'active' } & DeviceLinkActiveSnapshot)
  | { status: 'failed'; linkSessionId: string; error: string };

async function readSettledDeviceLinkState(page: Page): Promise<DeviceLinkSettledSnapshot> {
  const text = await page.getByTestId('intended-result-json').textContent();
  if (!text) throw new Error('Intended page snapshot is empty');
  const snapshot = requireRecord(JSON.parse(text), 'intended page snapshot');
  const record = requireRecord(snapshot.deviceLink, 'device-link state');
  const status = requireString(record.status, 'device-link status');
  const linkSessionId = requireString(record.linkSessionId, 'device-link linkSessionId');
  switch (status) {
    case 'active':
      return {
        status,
        linkSessionId,
        walletId: requireString(record.walletId, 'device-link activation walletId'),
        enrollmentId: requireString(record.enrollmentId, 'device-link activation enrollmentId'),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'device-link activation sessionWalletAuthMethodId',
        ),
        nearAccountId:
          record.nearAccountId === null
            ? null
            : requireString(record.nearAccountId, 'device-link activation nearAccountId'),
        operationalPublicKey:
          record.operationalPublicKey === null
            ? null
            : requireString(
                record.operationalPublicKey,
                'device-link activation operationalPublicKey',
              ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'device-link activation authenticationKind',
        ),
      };
    case 'failed':
      return { status, linkSessionId, error: requireString(record.error, 'device-link error') };
    default:
      throw new Error(`device-link state is ${status}, not settled`);
  }
}

function requireNearSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
  },
): NearSigningResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`NEAR signing did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'near_sign_success') {
    throw new Error(`NEAR signing returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`NEAR signing wallet mismatch: ${result.walletId}`);
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`NEAR signing account mismatch: ${result.nearAccountId}`);
  }
  if (!result.signedTransactionB64) {
    throw new Error('NEAR signing result is missing signedTransactionB64');
  }
  if (result.signedTransactionByteLength <= 0) {
    throw new Error('NEAR signing result is missing signed transaction bytes');
  }
  return result;
}

function requirePasskeyUnlockResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
    operationalPublicKey: string;
  },
): PasskeyUnlockResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Passkey unlock did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'passkey_unlock_success') {
    throw new Error(`Passkey unlock returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Passkey unlock wallet mismatch: ${result.walletId}`);
  }
  if (result.nearIdentity !== 'ready') {
    throw new Error('Passkey unlock did not return its expected NEAR identity');
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Passkey unlock NEAR account mismatch: ${result.nearAccountId}`);
  }
  if (result.operationalPublicKey !== expected.operationalPublicKey) {
    throw new Error('Passkey unlock operational public key mismatch');
  }
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(`Passkey unlock did not authenticate the wallet: ${result.authenticationKind}`);
  }
  return result;
}

function requirePasskeySyncResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
    operationalPublicKey: string;
  },
): PasskeySyncResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Passkey cold sync did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'passkey_sync_success') {
    throw new Error(`Passkey cold sync returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Passkey cold sync wallet mismatch: ${result.walletId}`);
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Passkey cold sync NEAR account mismatch: ${result.nearAccountId}`);
  }
  if (result.operationalPublicKey !== expected.operationalPublicKey) {
    throw new Error('Passkey cold sync changed the Ed25519 public key');
  }
  return result;
}

function requirePasskeyRecoveryResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): PasskeyRecoveryResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Passkey recovery did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'passkey_recovery_success') {
    throw new Error(`Passkey recovery returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Passkey recovery wallet mismatch: ${result.walletId}`);
  }
  return result;
}

function requireGoogleEmailOtpRecoveryResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): GoogleEmailOtpRecoveryResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Google Email OTP recovery did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'google_email_otp_recovery_success') {
    throw new Error(`Google Email OTP recovery returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Google Email OTP recovery wallet mismatch: ${result.walletId}`);
  }
  return result;
}

function requireEmailOtpUnlockResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
    operationalPublicKey: string;
  } & EcdsaEnabledSnapshot,
): EmailOtpUnlockResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Email OTP unlock did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'email_otp_unlock_success') {
    throw new Error(`Email OTP unlock returned unexpected result kind: ${result.kind}`);
  }
  if (result.nearIdentity !== 'ready') {
    throw new Error('Completed Email OTP wallet unlock omitted its NEAR identity');
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Email OTP unlock wallet mismatch: ${result.walletId}`);
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Email OTP unlock NEAR account mismatch: ${result.nearAccountId}`);
  }
  if (result.operationalPublicKey !== expected.operationalPublicKey) {
    throw new Error('Email OTP unlock operational public key mismatch');
  }
  assertEcdsaEnabledSnapshotsMatch({
    actual: result,
    expected,
    label: 'Email OTP unlock',
  });
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(
      `Email OTP unlock did not authenticate the wallet: ${result.authenticationKind}`,
    );
  }
  return result;
}

function assertEcdsaEnabledSnapshotsMatch(args: {
  actual: EcdsaEnabledSnapshot;
  expected: EcdsaEnabledSnapshot;
  label: string;
}): void {
  if (args.actual.ecdsaTargetProfile !== args.expected.ecdsaTargetProfile) {
    throw new Error(
      `${args.label} ECDSA target profile mismatch: ${args.actual.ecdsaTargetProfile}`,
    );
  }
  switch (args.actual.ecdsaTargetProfile) {
    case 'none':
      return;
    case 'tempo':
      if (args.expected.ecdsaTargetProfile !== 'tempo') {
        throw new Error(`${args.label} ECDSA expected profile mismatch`);
      }
      assertSameEcdsaAddress({
        actual: args.actual.thresholdEcdsaEthereumAddress,
        expected: args.expected.thresholdEcdsaEthereumAddress,
        label: `${args.label} threshold ECDSA address`,
      });
      if (args.actual.thresholdEcdsaPublicKeyB64u !== args.expected.thresholdEcdsaPublicKeyB64u) {
        throw new Error(`${args.label} threshold ECDSA public key mismatch`);
      }
      assertEcdsaTargetKeysMatch({
        actual: args.actual.ecdsaTargetKeys,
        expected: args.expected.ecdsaTargetKeys,
        label: `${args.label} ECDSA target keys`,
      });
      return;
    case 'tempo_arc':
      if (args.expected.ecdsaTargetProfile !== 'tempo_arc') {
        throw new Error(`${args.label} ECDSA expected profile mismatch`);
      }
      assertEcdsaTargetKeysMatch({
        actual: args.actual.ecdsaTargetKeys,
        expected: args.expected.ecdsaTargetKeys,
        label: `${args.label} ECDSA target keys`,
      });
      return;
    default:
      return assertNever(args.actual);
  }
}

function assertEcdsaTargetKeysMatch(args: {
  actual: EcdsaTargetKeysSnapshot;
  expected: EcdsaTargetKeysSnapshot;
  label: string;
}): void {
  if (args.actual.kind !== args.expected.kind) {
    throw new Error(`${args.label} profile mismatch: ${args.actual.kind}`);
  }
  switch (args.actual.kind) {
    case 'none':
      return;
    case 'tempo':
      if (args.expected.kind !== 'tempo') {
        throw new Error(`${args.label} expected profile mismatch`);
      }
      assertEcdsaTargetKeyMatch({
        actual: args.actual.tempo,
        expected: args.expected.tempo,
        label: `${args.label} Tempo`,
      });
      return;
    case 'tempo_arc':
      if (args.expected.kind !== 'tempo_arc') {
        throw new Error(`${args.label} expected profile mismatch`);
      }
      assertEcdsaTargetKeyMatch({
        actual: args.actual.tempo,
        expected: args.expected.tempo,
        label: `${args.label} Tempo`,
      });
      assertEcdsaTargetKeyMatch({
        actual: args.actual.arcEvm,
        expected: args.expected.arcEvm,
        label: `${args.label} Arc/EVM`,
      });
      return;
    default:
      return assertNever(args.actual);
  }
}

function assertEcdsaTargetKeyMatch(args: {
  actual: EcdsaTargetKeySnapshot;
  expected: EcdsaTargetKeySnapshot;
  label: string;
}): void {
  if (args.actual.chain !== args.expected.chain) {
    throw new Error(`${args.label} chain mismatch: ${args.actual.chain}`);
  }
  if (args.actual.chainId !== args.expected.chainId) {
    throw new Error(`${args.label} chainId mismatch: ${args.actual.chainId}`);
  }
  if (
    getAddress(args.actual.thresholdOwnerAddress) !==
    getAddress(args.expected.thresholdOwnerAddress)
  ) {
    throw new Error(`${args.label} threshold owner mismatch`);
  }
}

function requireTempoSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): TempoSigningResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Tempo signing did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'tempo_sign_success') {
    throw new Error(`Tempo signing returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Tempo signing wallet mismatch: ${result.walletId}`);
  }
  if (result.chainId !== expected.chainId) {
    throw new Error(`Tempo signing chainId mismatch: ${result.chainId}`);
  }
  return result;
}

function requireArcEvmSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): ArcEvmSigningResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Arc/EVM signing did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'arc_evm_sign_success') {
    throw new Error(`Arc/EVM signing returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Arc/EVM signing wallet mismatch: ${result.walletId}`);
  }
  if (result.chainId !== expected.chainId) {
    throw new Error(`Arc/EVM signing chainId mismatch: ${result.chainId}`);
  }
  return result;
}

function requireEcdsaExportResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): EcdsaExportResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`ECDSA export did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'ecdsa_export_success') {
    throw new Error(`ECDSA export returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`ECDSA export wallet mismatch: ${result.walletId}`);
  }
  if (result.chainId !== expected.chainId) {
    throw new Error(`ECDSA export chainId mismatch: ${result.chainId}`);
  }
  return result;
}

function requireEd25519ExportResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
  },
): Ed25519ExportResultSnapshot {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Ed25519 export did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'ed25519_export_success') {
    throw new Error(`Ed25519 export returned unexpected result kind: ${result.kind}`);
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Ed25519 export wallet mismatch: ${result.walletId}`);
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Ed25519 export NEAR account mismatch: ${result.nearAccountId}`);
  }
  return result;
}

async function verifyNearEd25519Signature(args: {
  registration: NearReadyRegisteredWalletSnapshot;
  result: NearSigningResultSnapshot;
}): Promise<void> {
  const registeredPublicKey = parseNearEd25519PublicKey(args.registration.operationalPublicKey);
  const signedTransaction = decodeNearSignedTransactionB64(args.result.signedTransactionB64);
  const decodedLength = signedTransaction.unsignedTransactionBytes.length + 65;
  if (decodedLength !== args.result.signedTransactionByteLength) {
    throw new Error(
      `NEAR signed transaction length mismatch: decoded=${decodedLength} reported=${args.result.signedTransactionByteLength}`,
    );
  }
  if (signedTransaction.signatureKeyType !== 0) {
    throw new Error(
      `NEAR signature key type must be Ed25519, received ${signedTransaction.signatureKeyType}`,
    );
  }
  const subject = parseNearUnsignedTransactionSubject(signedTransaction.unsignedTransactionBytes);
  if (subject.signerId !== args.result.nearAccountId) {
    throw new Error(`NEAR transaction signer mismatch: ${subject.signerId}`);
  }
  if (subject.publicKey.keyType !== 0) {
    throw new Error(
      `NEAR transaction public key type must be Ed25519, received ${subject.publicKey.keyType}`,
    );
  }
  assertEqualBytes(
    subject.publicKey.keyData32,
    registeredPublicKey.keyData32,
    'NEAR transaction public key does not match registered wallet key',
  );
  const signedMessageHash = sha256Bytes(signedTransaction.unsignedTransactionBytes);
  const verified = await ed25519.verifyAsync(
    signedTransaction.signatureBytes64,
    signedMessageHash,
    registeredPublicKey.keyData32,
  );
  if (!verified) {
    throw new Error('NEAR Ed25519 signature verification failed');
  }
}

async function verifyTempoEcdsaSignature(args: {
  registration: RegisteredWalletSnapshot;
  result: TempoSigningResultSnapshot;
}): Promise<void> {
  const targetKey = requireTempoEcdsaTargetKey(args.registration.ecdsaTargetKeys);
  const parts = decodeTempoSignedTransaction(args.result.rawTxHex);
  if (parts.chainId !== args.result.chainId) {
    throw new Error(`Tempo raw transaction chainId mismatch: ${parts.chainId}`);
  }
  const recovered = await recoverAddress({
    hash: args.result.senderHashHex,
    signature: parts.senderSignatureHex,
  });
  assertSameEcdsaAddress({
    actual: recovered,
    expected: targetKey.thresholdOwnerAddress,
    label: 'Tempo recovered signer',
  });
}

async function verifyArcEvmSignature(args: {
  registration: RegisteredWalletSnapshot;
  result: ArcEvmSigningResultSnapshot;
}): Promise<void> {
  const targetKey = requireArcEvmEcdsaTargetKey(args.registration.ecdsaTargetKeys);
  const transaction = parseTransaction(args.result.rawTxHex);
  if (Number(transaction.chainId) !== args.result.chainId) {
    throw new Error(`Arc/EVM raw transaction chainId mismatch: ${String(transaction.chainId)}`);
  }
  const recovered = await recoverTransactionAddress({
    serializedTransaction: serializeTransaction(transaction),
  });
  assertSameEcdsaAddress({
    actual: recovered,
    expected: targetKey.thresholdOwnerAddress,
    label: 'Arc/EVM recovered signer',
  });
}

function requireTempoEcdsaTargetKey(keys: EcdsaTargetKeysSnapshot): EcdsaTargetKeySnapshot {
  switch (keys.kind) {
    case 'tempo':
    case 'tempo_arc':
      return keys.tempo;
    case 'none':
      throw new Error('Tempo signing requires a Tempo ECDSA target key');
    default:
      return assertNever(keys);
  }
}

function requireArcEvmEcdsaTargetKey(keys: EcdsaTargetKeysSnapshot): EcdsaTargetKeySnapshot {
  switch (keys.kind) {
    case 'tempo_arc':
      return keys.arcEvm;
    case 'none':
    case 'tempo':
      throw new Error('Arc/EVM signing requires an Arc/EVM ECDSA target key');
    default:
      return assertNever(keys);
  }
}

function parseNearEd25519PublicKey(publicKey: string): { keyData32: Uint8Array } {
  const value = publicKey.trim();
  const prefix = 'ed25519:';
  if (!value.startsWith(prefix)) {
    throw new Error(`NEAR operational public key must use ed25519 prefix: ${value}`);
  }
  const keyData32 = base58Decode(value.slice(prefix.length));
  if (keyData32.length !== 32) {
    throw new Error(
      `NEAR operational public key must decode to 32 bytes, received ${keyData32.length}`,
    );
  }
  return { keyData32 };
}

function decodeNearSignedTransactionB64(base64: string): NearSignedTransactionParts {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length <= 65) {
    throw new Error(`NEAR signed transaction is too short: ${bytes.length} bytes`);
  }
  const signatureStart = bytes.length - 65;
  return {
    unsignedTransactionBytes: bytes.slice(0, signatureStart),
    signatureKeyType: bytes[signatureStart],
    signatureBytes64: bytes.slice(signatureStart + 1),
  };
}

function parseNearUnsignedTransactionSubject(bytes: Uint8Array): NearUnsignedTransactionSubject {
  const signer = readBorshString(bytes, 0, 'NEAR transaction signerId');
  const publicKey = readNearPublicKey(bytes, signer.nextOffset);
  return {
    signerId: signer.value,
    publicKey: publicKey.value,
  };
}

function readNearPublicKey(
  bytes: Uint8Array,
  offset: number,
): BorshReadResult<NearUnsignedTransactionSubject['publicKey']> {
  requireByteRange(bytes, offset, 33, 'NEAR transaction publicKey');
  return {
    value: {
      keyType: bytes[offset],
      keyData32: bytes.slice(offset + 1, offset + 33),
    },
    nextOffset: offset + 33,
  };
}

function readBorshString(
  bytes: Uint8Array,
  offset: number,
  label: string,
): BorshReadResult<string> {
  const length = readBorshU32(bytes, offset, `${label} length`);
  const valueStart = offset + 4;
  requireByteRange(bytes, valueStart, length, label);
  return {
    value: new TextDecoder().decode(bytes.slice(valueStart, valueStart + length)),
    nextOffset: valueStart + length,
  };
}

function readBorshU32(bytes: Uint8Array, offset: number, label: string): number {
  requireByteRange(bytes, offset, 4, label);
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getUint32(0, true);
}

function requireByteRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`${label} exceeds byte length ${bytes.length}`);
  }
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return createHash('sha256').update(bytes).digest();
}

function assertEqualBytes(actual: Uint8Array, expected: Uint8Array, message: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${message}: length ${actual.length} !== ${expected.length}`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] === expected[index]) continue;
    throw new Error(`${message}: byte ${index} differs`);
  }
}

function assertSameEcdsaAddress(args: { actual: string; expected: string; label: string }): void {
  const actual = getAddress(args.actual);
  const expected = getAddress(args.expected);
  if (actual !== expected) {
    throw new Error(`${args.label} mismatch: ${actual} !== ${expected}`);
  }
}

function decodeTempoSignedTransaction(rawTxHex: `0x${string}`): TempoSignedTransactionParts {
  const bytes = hexToBytes(rawTxHex);
  if (bytes[0] !== TEMPO_TRANSACTION_TYPE) {
    throw new Error(`Tempo raw transaction must start with type 0x76, received ${bytes[0]}`);
  }
  const decoded = readRlpValue(bytes, 1);
  if (decoded.nextOffset !== bytes.length) {
    throw new Error('Tempo raw transaction has trailing bytes after RLP payload');
  }
  if (decoded.value.kind !== 'list') {
    throw new Error('Tempo raw transaction payload must be an RLP list');
  }
  const fields = decoded.value.items;
  if (fields.length !== 14) {
    throw new Error(`Tempo raw transaction must contain 14 fields, received ${fields.length}`);
  }
  const chainId = rlpBytesToSafeInteger(requireRlpBytes(fields[0], 'Tempo chainId'));
  requireEmptyRlpList(fields[12], 'Tempo AA authorization list');
  const signatureBytes = requireRlpBytes(fields[13], 'Tempo sender signature');
  if (signatureBytes.length !== 65) {
    throw new Error(`Tempo sender signature must be 65 bytes, received ${signatureBytes.length}`);
  }
  return {
    chainId,
    senderSignatureHex: bytesToHex(signatureBytes),
  };
}

function readRlpValue(bytes: Uint8Array, offset: number): RlpReadResult {
  requireByteRange(bytes, offset, 1, 'RLP prefix');
  const prefix = bytes[offset];
  if (prefix <= 0x7f) {
    return {
      value: { kind: 'bytes', bytes: bytes.slice(offset, offset + 1) },
      nextOffset: offset + 1,
    };
  }
  if (prefix <= 0xb7) {
    const length = prefix - 0x80;
    return readRlpShortBytes(bytes, offset + 1, length);
  }
  if (prefix <= 0xbf) {
    const lengthOfLength = prefix - 0xb7;
    const length = readRlpLength(bytes, offset + 1, lengthOfLength, 'RLP long bytes');
    return readRlpShortBytes(bytes, offset + 1 + lengthOfLength, length);
  }
  if (prefix <= 0xf7) {
    const length = prefix - 0xc0;
    return readRlpList(bytes, offset + 1, length);
  }
  const lengthOfLength = prefix - 0xf7;
  const length = readRlpLength(bytes, offset + 1, lengthOfLength, 'RLP long list');
  return readRlpList(bytes, offset + 1 + lengthOfLength, length);
}

function readRlpShortBytes(bytes: Uint8Array, offset: number, length: number): RlpReadResult {
  requireByteRange(bytes, offset, length, 'RLP bytes');
  return {
    value: { kind: 'bytes', bytes: bytes.slice(offset, offset + length) },
    nextOffset: offset + length,
  };
}

function readRlpList(bytes: Uint8Array, offset: number, length: number): RlpReadResult {
  requireByteRange(bytes, offset, length, 'RLP list');
  const endOffset = offset + length;
  const items: RlpValue[] = [];
  let cursor = offset;
  while (cursor < endOffset) {
    const item = readRlpValue(bytes, cursor);
    items.push(item.value);
    cursor = item.nextOffset;
  }
  if (cursor !== endOffset) {
    throw new Error('RLP list item exceeded declared length');
  }
  return {
    value: { kind: 'list', items },
    nextOffset: endOffset,
  };
}

function readRlpLength(
  bytes: Uint8Array,
  offset: number,
  lengthOfLength: number,
  label: string,
): number {
  requireByteRange(bytes, offset, lengthOfLength, label);
  let value = 0;
  for (let index = 0; index < lengthOfLength; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} is too large`);
  }
  return value;
}

function requireRlpBytes(value: RlpValue | undefined, label: string): Uint8Array {
  if (!value || value.kind !== 'bytes') {
    throw new Error(`${label} must be RLP bytes`);
  }
  return value.bytes;
}

function requireEmptyRlpList(value: RlpValue | undefined, label: string): void {
  if (!value || value.kind !== 'list' || value.items.length !== 0) {
    throw new Error(`${label} must be an empty RLP list`);
  }
}

function rlpBytesToSafeInteger(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('RLP integer is too large');
  }
  return value;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const raw = hex.slice(2);
  if (raw.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const bytes = new Uint8Array(raw.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(value)) {
      throw new Error('hex string contains invalid bytes');
    }
    bytes[index] = value;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function readIntendedPageSnapshot(page: Page): Promise<IntendedPageSnapshot> {
  const text = await page.getByTestId('intended-result-json').textContent();
  if (!text) throw new Error('Intended page snapshot is empty');
  return parseIntendedPageSnapshot(JSON.parse(text));
}

function parseIntendedConcurrentActionSnapshots(
  rawSnapshots: readonly unknown[],
): IntendedPageSnapshot[] {
  const snapshots: IntendedPageSnapshot[] = [];
  for (const raw of rawSnapshots) {
    snapshots.push(parseIntendedPageSnapshot(raw));
  }
  return snapshots;
}

function requireConcurrentSigningSuccess(
  snapshots: readonly IntendedPageSnapshot[],
  action: 'signTempoTransaction' | 'signArcEvmTransaction',
): IntendedPageSnapshot {
  let success: IntendedPageSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.action.status === 'error' && snapshot.action.action === action) {
      throw new Error(`Concurrent ${action} failed: ${snapshot.action.error}`);
    }
    if (snapshot.action.status === 'success' && snapshot.action.action === action) {
      success = snapshot;
    }
  }
  if (success) return success;
  throw new Error(`Concurrent ${action} did not produce a success result`);
}

function snapshotWithMostLifecycleEvents(
  left: IntendedPageSnapshot,
  right: IntendedPageSnapshot,
): IntendedPageSnapshot {
  return left.events.length >= right.events.length ? left : right;
}

function parseIntendedPageSnapshot(raw: unknown): IntendedPageSnapshot {
  const record = requireRecord(raw, 'intended page snapshot');
  return {
    action: parseIntendedPageActionSnapshot(record.action),
    events: parseIntendedPageLifecycleEvents(record.events),
  };
}

function parseIntendedPageLifecycleEvents(raw: unknown): readonly IntendedPageLifecycleEvent[] {
  if (!Array.isArray(raw)) {
    throw new Error('intended page snapshot events must be an array');
  }
  return raw.map(parseIntendedPageLifecycleEvent);
}

function parseIntendedPageLifecycleEvent(raw: unknown): IntendedPageLifecycleEvent {
  const record = requireRecord(raw, 'intended page lifecycle event');
  const index = Number(record.index);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('intended page lifecycle event index must be a non-negative integer');
  }
  return {
    index,
    payload: record.payload,
  };
}

function parseIntendedPageActionSnapshot(raw: unknown): IntendedPageActionSnapshot {
  const record = requireRecord(raw, 'intended page action');
  const status = requireString(record.status, 'intended page action status');
  switch (status) {
    case 'idle':
      return { status };
    case 'running':
      return { status, action: parseIntendedHarnessAction(record.action) };
    case 'success':
      return {
        status,
        action: parseIntendedHarnessAction(record.action),
        result: parseIntendedActionResultSnapshot(record.result),
      };
    case 'error':
      return {
        status,
        action: parseIntendedHarnessAction(record.action),
        error: requireString(record.error, 'intended page action error'),
      };
    default:
      throw new Error(`Unknown intended page action status: ${status}`);
  }
}

function parseEmailOtpUnlockNearIdentity(
  record: Record<string, unknown>,
):
  | { nearIdentity: 'ready'; nearAccountId: string; operationalPublicKey: string }
  | { nearIdentity: 'absent'; nearAccountId?: never; operationalPublicKey?: never } {
  switch (record.nearIdentity) {
    case 'ready':
      return {
        nearIdentity: 'ready',
        nearAccountId: requireString(record.nearAccountId, 'Email OTP unlock nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'Email OTP unlock operationalPublicKey',
        ),
      };
    case 'absent':
      if (record.nearAccountId !== undefined || record.operationalPublicKey !== undefined) {
        throw new Error('Email OTP unlock has contradictory NEAR identity fields');
      }
      return { nearIdentity: 'absent' };
    default:
      throw new Error('Email OTP unlock returned an invalid NEAR identity state');
  }
}

function parsePasskeyUnlockResultSnapshot(
  record: Record<string, unknown>,
): PasskeyUnlockResultSnapshot {
  const nearIdentity = requireString(record.nearIdentity, 'passkey unlock NEAR identity');
  const common = {
    kind: 'passkey_unlock_success' as const,
    walletId: requireString(record.walletId, 'passkey unlock walletId'),
    sessionWalletAuthMethodId: requireString(
      record.sessionWalletAuthMethodId,
      'passkey unlock sessionWalletAuthMethodId',
    ),
    authenticationKind: requireAuthenticatedKind(
      record.authenticationKind,
      'passkey unlock authenticationKind',
    ),
  };
  switch (nearIdentity) {
    case 'ready':
      return {
        ...common,
        nearIdentity,
        nearAccountId: requireString(record.nearAccountId, 'passkey unlock nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'passkey unlock operationalPublicKey',
        ),
      };
    case 'absent':
      return {
        ...common,
        nearIdentity,
      };
    default:
      throw new Error(`Unknown passkey unlock NEAR identity: ${nearIdentity}`);
  }
}

function parseIntendedActionResultSnapshot(raw: unknown): IntendedActionResultSnapshot {
  const record = requireRecord(raw, 'intended action result');
  const kind = requireString(record.kind, 'intended action result kind');
  switch (kind) {
    case 'passkey_registration_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'passkey registration walletId'),
        ...parseRegisteredNearState(record, 'passkey registration'),
        ...parseEcdsaEnabledSnapshot(record, 'passkey registration'),
      };
    case 'wallet_signer_added':
      return {
        kind,
        walletId: requireString(record.walletId, 'Ed25519 add-signer walletId'),
        nearAccountId: requireString(record.nearAccountId, 'Ed25519 add-signer nearAccountId'),
        nearEd25519SigningKeyId: requireString(
          record.nearEd25519SigningKeyId,
          'Ed25519 add-signer nearEd25519SigningKeyId',
        ),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'Ed25519 add-signer operationalPublicKey',
        ),
      };
    case 'ecdsa_signer_added':
      return {
        kind,
        walletId: requireString(record.walletId, 'ECDSA add-signer walletId'),
        ...parseEcdsaEnabledSnapshot(record, 'ECDSA add-signer'),
      };
    case 'add_email_otp_success': {
      const authMethod = requireRecord(record.authMethod, 'add-email-code auth method');
      if (authMethod.kind !== 'email_otp' || authMethod.status !== 'active') {
        throw new Error('add-email-code auth method is not active Email OTP');
      }
      return {
        kind,
        walletId: requireString(record.walletId, 'add-email-code walletId'),
        emailAddress: requireString(record.emailAddress, 'add-email-code emailAddress'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'add-email-code walletAuthMethodId',
        ),
        authMethod: { kind: 'email_otp', status: 'active' },
      };
    }
    case 'add_passkey_success': {
      const authMethod = requireRecord(record.authMethod, 'add-passkey auth method');
      if (authMethod.kind !== 'passkey' || authMethod.status !== 'active') {
        throw new Error('add-passkey auth method is not an active Passkey');
      }
      return {
        kind,
        walletId: requireString(record.walletId, 'add-passkey walletId'),
        rpId: requireString(record.rpId, 'add-passkey rpId'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'add-passkey walletAuthMethodId',
        ),
        authMethod: { kind: 'passkey', status: 'active' },
      };
    }
    case 'revoke_auth_method_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'revoke walletId'),
        walletAuthMethodId: requireString(record.walletAuthMethodId, 'revoke walletAuthMethodId'),
      };
    case 'added_email_otp_unlock_success': {
      return {
        kind,
        walletId: requireString(record.walletId, 'added email-code unlock walletId'),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'added email-code unlock sessionWalletAuthMethodId',
        ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'added email-code unlock authenticationKind',
        ),
      };
    }
    case 'near_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'NEAR signing walletId'),
        nearAccountId: requireString(record.nearAccountId, 'NEAR signing nearAccountId'),
        signedTransactionB64: requireString(
          record.signedTransactionB64,
          'NEAR signing signedTransactionB64',
        ),
        signedTransactionByteLength: requirePositiveInteger(
          record.signedTransactionByteLength,
          'NEAR signing signedTransactionByteLength',
        ),
      };
    case 'email_otp_registration_success':
      return {
        kind,
        initialWalletId: requireString(
          record.initialWalletId,
          'Email OTP registration initialWalletId',
        ),
        walletId: requireString(record.walletId, 'Email OTP registration walletId'),
        ...parseRegisteredNearState(record, 'Email OTP registration'),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'Email OTP registration authenticationKind',
        ),
        ...parseEcdsaEnabledSnapshot(record, 'Email OTP registration'),
      };
    case 'near_provisioning_ready':
      return {
        kind,
        walletId: requireString(record.walletId, 'NEAR provisioning walletId'),
        nearAccountId: requireString(record.nearAccountId, 'NEAR provisioning nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'NEAR provisioning operationalPublicKey',
        ),
      };
    case 'passkey_unlock_success':
      return parsePasskeyUnlockResultSnapshot(record);
    case 'passkey_sync_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'passkey sync walletId'),
        nearAccountId: requireString(record.nearAccountId, 'passkey sync nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'passkey sync operationalPublicKey',
        ),
      };
    case 'passkey_recovery_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'passkey recovery walletId'),
        activeRecoveryCodeCount: requireNonNegativeInteger(
          record.activeRecoveryCodeCount,
          'passkey recovery activeRecoveryCodeCount',
        ),
        totalRecoveryCodeCount: requirePositiveInteger(
          record.totalRecoveryCodeCount,
          'passkey recovery totalRecoveryCodeCount',
        ),
      };
    case 'google_email_otp_recovery_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Google Email OTP recovery walletId'),
        activeRecoveryCodeCount: requireNonNegativeInteger(
          record.activeRecoveryCodeCount,
          'Google Email OTP recovery activeRecoveryCodeCount',
        ),
        totalRecoveryCodeCount: requirePositiveInteger(
          record.totalRecoveryCodeCount,
          'Google Email OTP recovery totalRecoveryCodeCount',
        ),
      };
    case 'email_otp_unlock_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Email OTP unlock walletId'),
        ...parseEmailOtpUnlockNearIdentity(record),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'Email OTP unlock sessionWalletAuthMethodId',
        ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'Email OTP unlock authenticationKind',
        ),
        ...parseEcdsaEnabledSnapshot(record, 'Email OTP unlock'),
      };
    case 'tempo_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Tempo signing walletId'),
        chainId: requirePositiveInteger(record.chainId, 'Tempo signing chainId'),
        senderHashHex: requireHexString(record.senderHashHex, 'Tempo signing senderHashHex'),
        rawTxHex: requireHexString(record.rawTxHex, 'Tempo signing rawTxHex'),
      };
    case 'arc_evm_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Arc/EVM signing walletId'),
        chainId: requirePositiveInteger(record.chainId, 'Arc/EVM signing chainId'),
        txHashHex: requireHexString(record.txHashHex, 'Arc/EVM signing txHashHex'),
        rawTxHex: requireHexString(record.rawTxHex, 'Arc/EVM signing rawTxHex'),
      };
    case 'ecdsa_export_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'ECDSA export walletId'),
        chainId: requirePositiveInteger(record.chainId, 'ECDSA export chainId'),
      };
    case 'ed25519_export_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Ed25519 export walletId'),
        nearAccountId: requireString(record.nearAccountId, 'Ed25519 export nearAccountId'),
      };
    case 'device_link_qr_ready':
      return {
        kind,
        linkSessionId: requireString(record.linkSessionId, 'device-link QR linkSessionId'),
        qrPayloadJson: requireString(record.qrPayloadJson, 'device-link QR payload'),
      };
    case 'device_link_approval_recorded':
      return {
        kind,
        walletId: requireString(record.walletId, 'device-link approval walletId'),
        enrollmentId: requireString(record.enrollmentId, 'device-link approval enrollmentId'),
        deviceId: requireString(record.deviceId, 'device-link approval deviceId'),
      };
    case 'linked_device_revoked':
      return {
        kind,
        walletId: requireString(record.walletId, 'linked-device revocation walletId'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'linked-device revocation walletAuthMethodId',
        ),
        authorityId: requireString(record.authorityId, 'linked-device revocation authorityId'),
        revocationEpoch: requireNonNegativeInteger(
          record.revocationEpoch,
          'linked-device revocation revocationEpoch',
        ),
      };
    default:
      throw new Error(`Unknown intended action result kind: ${kind}`);
  }
}

function parseRegisteredNearState(
  record: Record<string, unknown>,
  label: string,
): RegisteredNearStateSnapshot {
  if (record.nearReadiness === 'absent') return { nearReadiness: 'absent' };
  const rawProvisioning = record.nearProvisioning;
  if (rawProvisioning !== undefined) {
    const provisioning = requireRecord(rawProvisioning, `${label} nearProvisioning`);
    const status = requireString(provisioning.status, `${label} nearProvisioning status`);
    switch (status) {
      case 'pending':
        return { nearReadiness: 'pending', nearProvisioning: { status } };
      case 'provisioning':
        return { nearReadiness: 'pending', nearProvisioning: { status } };
      case 'retryable':
        return {
          nearReadiness: 'pending',
          nearProvisioning: {
            status,
            error: requireString(provisioning.error, `${label} nearProvisioning error`),
            errorCode: requireString(provisioning.errorCode, `${label} nearProvisioning errorCode`),
          },
        };
      default:
        throw new Error(`${label} returned unknown NEAR provisioning state: ${status}`);
    }
  }
  return {
    nearReadiness: 'ready',
    nearAccountId: requireString(record.nearAccountId, `${label} nearAccountId`),
    operationalPublicKey: requireString(
      record.operationalPublicKey,
      `${label} operationalPublicKey`,
    ),
  };
}

function parseEcdsaEnabledSnapshot(
  raw: Record<string, unknown>,
  label: string,
): EcdsaEnabledSnapshot {
  const profile = parseEcdsaTargetProfileName(recordValue(raw, 'ecdsaTargetProfile'), label);
  const ecdsaTargetKeys = parseEcdsaTargetKeys(raw.ecdsaTargetKeys, label);
  switch (profile) {
    case 'none':
      if (ecdsaTargetKeys.kind !== 'none') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'none',
        ecdsaTargetKeys,
      };
    case 'tempo':
      if (ecdsaTargetKeys.kind !== 'tempo') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'tempo',
        thresholdEcdsaEthereumAddress: requireString(
          raw.thresholdEcdsaEthereumAddress,
          `${label} thresholdEcdsaEthereumAddress`,
        ),
        thresholdEcdsaPublicKeyB64u: requireString(
          raw.thresholdEcdsaPublicKeyB64u,
          `${label} thresholdEcdsaPublicKeyB64u`,
        ),
        ecdsaTargetKeys,
      };
    case 'tempo_arc':
      if (ecdsaTargetKeys.kind !== 'tempo_arc') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'tempo_arc',
        ecdsaTargetKeys,
      };
    default:
      return assertNever(profile);
  }
}

function parseEcdsaTargetProfileName(raw: unknown, label: string): EcdsaTargetProfileName {
  const value = requireString(raw, `${label} ecdsaTargetProfile`);
  switch (value) {
    case 'none':
    case 'tempo':
    case 'tempo_arc':
      return value;
    default:
      throw new Error(`${label} ecdsaTargetProfile is invalid: ${value}`);
  }
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function parseEcdsaTargetKeys(raw: unknown, label: string): EcdsaTargetKeysSnapshot {
  const record = requireRecord(raw, `${label} ECDSA target keys`);
  const kind = parseEcdsaTargetProfileName(record.kind, `${label} ECDSA target keys`);
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'tempo':
      return {
        kind: 'tempo',
        tempo: parseEcdsaTargetKey(record.tempo, 'tempo', `${label} Tempo ECDSA target key`),
      };
    case 'tempo_arc':
      return {
        kind: 'tempo_arc',
        tempo: parseEcdsaTargetKey(record.tempo, 'tempo', `${label} Tempo ECDSA target key`),
        arcEvm: parseEcdsaTargetKey(record.arcEvm, 'arc_evm', `${label} Arc/EVM ECDSA target key`),
      };
    default:
      return assertNever(kind);
  }
}

function parseEcdsaTargetKey(
  raw: unknown,
  expectedChain: EcdsaTargetKeySnapshot['chain'],
  label: string,
): EcdsaTargetKeySnapshot {
  const record = requireRecord(raw, label);
  const chain = requireString(record.chain, `${label} chain`);
  if (chain !== expectedChain) {
    throw new Error(`${label} chain mismatch: ${chain}`);
  }
  return {
    chain: expectedChain,
    chainId: requirePositiveInteger(record.chainId, `${label} chainId`),
    thresholdOwnerAddress: getAddress(
      requireString(record.thresholdOwnerAddress, `${label} thresholdOwnerAddress`),
    ),
  };
}

function parseIntendedHarnessAction(raw: unknown): IntendedHarnessAction {
  const action = requireString(raw, 'intended action');
  switch (action) {
    case 'registerPasskeyWallet':
    case 'registerPasskeyEd25519YaoWallet':
    case 'registerPasskeyEcdsaOnlyWallet':
    case 'addPasskeyEd25519YaoWalletSigner':
    case 'addPasskeyEcdsaWalletSigner':
    case 'addEmailOtpAuthMethod':
    case 'addPasskeyAuthMethod':
    case 'registerEmailOtpWallet':
    case 'registerEmailOtpEd25519OnlyWallet':
    case 'registerEmailOtpEcdsaOnlyWallet':
    case 'awaitNearReady':
    case 'syncPasskeyWallet':
    case 'recoverPasskeyWallet':
    case 'recoverGoogleEmailOtpWallet':
    case 'unlockPasskeyWallet':
    case 'unlockEmailOtpWallet':
    case 'unlockWithAddedEmailOtp':
    case 'revokeSourceAuthMethod':
    case 'signNearTransaction':
    case 'signTempoTransaction':
    case 'signArcEvmTransaction':
    case 'exportEd25519Key':
    case 'exportEcdsaKey':
    case 'startDeviceLinkingAsTarget':
    case 'scanAndLinkDevice':
    case 'revokeLinkedDevice':
    case 'revokeLinkedDeviceWithEmailOtp':
      return action;
    default:
      throw new Error(`Unknown intended action: ${action}`);
  }
}

function routerAbEd25519SigningPath(
  rawUrl: string | undefined,
  routerUrl: string,
): (typeof ROUTER_AB_ED25519_SIGNING_PATHS)[number] | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(routerUrl).origin) return null;
  for (const path of ROUTER_AB_ED25519_SIGNING_PATHS) {
    if (url.pathname === path) return path;
  }
  return null;
}

function routePathAtRouter(rawUrl: string | undefined, routerUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== new URL(routerUrl).origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function routerAbEd25519YaoRegistrationPath(
  rawUrl: string | undefined,
  routerUrl: string,
): (typeof ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS)[number] | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(routerUrl).origin) return null;
  for (const path of ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS) {
    if (url.pathname === path) return path;
  }
  return null;
}

function routerAbEd25519YaoWarmRecoveryPath(
  rawUrl: string | undefined,
  routerUrl: string,
): (typeof ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS)[number] | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(routerUrl).origin) return null;
  for (const path of ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS) {
    if (url.pathname === path) return path;
  }
  return null;
}

function routerAbEd25519YaoExportPath(
  rawUrl: string | undefined,
  routerUrl: string,
): (typeof ROUTER_AB_ED25519_YAO_EXPORT_PATHS)[number] | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(routerUrl).origin) return null;
  for (const path of ROUTER_AB_ED25519_YAO_EXPORT_PATHS) {
    if (url.pathname === path) return path;
  }
  return null;
}

function captureWalletBudgetStatusRequest(
  request: Request,
  routerUrl: string,
): CapturedWalletBudgetStatusRequest | null {
  if (request.method() !== 'POST') return null;
  let requestUrl: URL;
  let routerOrigin: string;
  try {
    requestUrl = new URL(request.url());
    routerOrigin = new URL(routerUrl).origin;
  } catch {
    return null;
  }
  if (
    requestUrl.origin !== routerOrigin ||
    requestUrl.pathname !== ROUTER_AB_WALLET_BUDGET_STATUS_PATH
  ) {
    return null;
  }

  const headers = request.headers();
  const authorization = headers.authorization?.trim() ?? '';
  const contentType = headers['content-type']?.trim() ?? 'application/json';
  const body = request.postData();
  if (!authorization.startsWith('Bearer ') || !body) return null;

  let walletSessionId: string;
  let quotaId: string;
  try {
    const parsed: unknown = JSON.parse(body);
    const requestBody = requireRecord(parsed, 'wallet budget status request body');
    if (
      Object.keys(requestBody).length !== 2 ||
      typeof requestBody.walletSessionId !== 'string' ||
      typeof requestBody.quotaId !== 'string'
    )
      return null;
    walletSessionId = requestBody.walletSessionId;
    quotaId = requestBody.quotaId;
  } catch {
    return null;
  }

  return {
    url: request.url(),
    authorization,
    contentType,
    body,
    walletSessionId,
    quotaId,
  };
}

function parseAuthoritativeWalletBudgetStatus(args: {
  readonly responseText: string;
  readonly expectedWalletSessionId: string;
  readonly expectedQuotaId: string;
}): AuthoritativeWalletBudgetReplay {
  let raw: unknown;
  try {
    raw = JSON.parse(args.responseText);
  } catch {
    throw new Error('Authoritative wallet budget status response must be valid JSON');
  }
  const response = requireRecord(raw, 'authoritative wallet budget status response');
  if (response.ok !== true) {
    throw new Error('Authoritative wallet budget status response must report ok=true');
  }
  const walletSessionId = requireString(
    response.walletSessionId,
    'authoritative wallet session status walletSessionId',
  );
  const quotaId = requireString(response.quotaId, 'authoritative wallet session status quotaId');
  if (walletSessionId !== args.expectedWalletSessionId || quotaId !== args.expectedQuotaId) {
    throw new Error('Authoritative wallet budget status returned a different session or quota');
  }
  if (response.status === 'active') {
    return { kind: 'active', walletSessionId, quotaId };
  }
  if (response.status !== 'exhausted') {
    throw new Error(
      `Authoritative wallet budget status has unexpected status ${String(response.status)}`,
    );
  }
  const remainingUses = requireNonNegativeInteger(
    response.remainingUses,
    'authoritative exhausted wallet budget remainingUses',
  );
  if (remainingUses !== 0) {
    throw new Error('Authoritative exhausted wallet quota must have zero remaining uses');
  }
  return {
    kind: 'exhausted',
    walletSessionId,
    quotaId,
  };
}

function parseRecoveryAuthorityProjection(raw: unknown): RecoveryAuthorityProjection {
  const response = requireRecord(raw, 'recovery finalization response');
  if (response.ok !== true) {
    throw new Error('recovery finalization response must report ok=true');
  }
  const projection = requireRecord(response.projection, 'recovery committed projection');
  if (projection.version !== 'wallet_recovery_committed_projection_v1') {
    throw new Error('recovery finalization must return the committed projection envelope');
  }
  const authority = requireRecord(projection.authority, 'recovery authority projection');
  const principal = requireRecord(authority.principal, 'recovery authority principal');
  const provenance = requireRecord(authority.provenance, 'recovery authority provenance');
  const authMethod = requireRecord(projection.authMethod, 'recovery auth method projection');
  if (authority.state !== 'active') {
    throw new Error('recovery authority projection must be active');
  }
  if (principal.kind !== 'owner_device') {
    throw new Error('recovery authority projection must be an owner device');
  }
  if (provenance.kind !== 'wallet_recovery') {
    throw new Error('recovery authority projection must carry wallet-recovery provenance');
  }
  if (authMethod.status !== 'active') {
    throw new Error('recovery auth method projection must be active');
  }
  if (authMethod.kind !== 'passkey' && authMethod.kind !== 'email_otp') {
    throw new Error('recovery auth method projection has an unsupported kind');
  }
  return {
    walletId: requireString(authority.walletId, 'recovery authority walletId'),
    authorityId: requireString(authority.authorityId, 'recovery authority authorityId'),
    deviceId: requireString(principal.deviceId, 'recovery authority deviceId'),
    provenanceKind: 'wallet_recovery',
    recoveryOperationId: requireString(
      provenance.recoveryOperationId,
      'recovery authority recoveryOperationId',
    ),
    continuityAuthorityId: requireString(
      provenance.continuityAuthorityId,
      'recovery authority continuityAuthorityId',
    ),
    authMethodWalletAuthMethodId: requireString(
      authMethod.walletAuthMethodId,
      'recovery auth method walletAuthMethodId',
    ),
    authMethodWalletAuthorityId: requireString(
      authMethod.walletAuthorityId,
      'recovery auth method walletAuthorityId',
    ),
    authMethodKind: authMethod.kind,
    authMethodStatus: 'active',
  };
}

function requireRecord(raw: unknown, label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return Object.fromEntries(Object.entries(raw));
}

function requireString(raw: unknown, label: string): string {
  if (typeof raw !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label} must be non-empty`);
  }
  return value;
}

function requireAuthenticatedKind(raw: unknown, label: string): 'authenticated' {
  const value = requireString(raw, label);
  if (value !== 'authenticated') {
    throw new Error(`${label} must be authenticated`);
  }
  return value;
}

function requireHexString(raw: unknown, label: string): `0x${string}` {
  const value = requireString(raw, label);
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be 0x-prefixed hex`);
  }
  return value as `0x${string}`;
}

function requirePositiveInteger(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return raw;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected intended e2e value: ${String(value)}`);
}

function parseLinkedDeviceCredentialKind(raw: unknown, label: string): 'passkey' | 'email_otp' {
  const value = requireString(raw, label);
  switch (value) {
    case 'passkey':
    case 'email_otp':
      return value;
    default:
      throw new Error(`${label} is ${value}`);
  }
}

function parseLinkedDeviceState(raw: unknown): LinkedDeviceEntrySnapshot['state'] {
  const value = requireString(raw, 'linked device state');
  switch (value) {
    case 'provisioning':
    case 'active':
    case 'suspended':
    case 'expired':
    case 'revoked':
      return value;
    default:
      throw new Error(`linked device state is ${value}`);
  }
}

function parseLinkedDeviceInventory(raw: unknown): LinkedDeviceInventorySnapshot {
  const record = requireRecord(raw, 'linked-device inventory');
  if (!Array.isArray(record.ownerDevices) || !Array.isArray(record.devices)) {
    throw new Error('linked-device inventory must list owner devices and linked devices');
  }
  return {
    ownerDevices: record.ownerDevices.map((entry): LinkedDeviceOwnerMethodSnapshot => {
      const owner = requireRecord(entry, 'owner device');
      const credentialKind = parseLinkedDeviceCredentialKind(
        owner.credentialKind,
        'owner device credential kind',
      );
      return {
        walletAuthMethodId: requireString(owner.walletAuthMethodId, 'owner walletAuthMethodId'),
        credentialKind,
        credentialIdB64u:
          credentialKind === 'passkey'
            ? requireString(owner.credentialIdB64u, 'owner passkey credential id')
            : null,
      };
    }),
    devices: record.devices.map((entry): LinkedDeviceEntrySnapshot => {
      const device = requireRecord(entry, 'linked device');
      return {
        deviceId: requireString(device.deviceId, 'linked deviceId'),
        enrollmentId: requireString(device.enrollmentId, 'linked enrollmentId'),
        walletId: requireString(device.walletId, 'linked device walletId'),
        walletAuthMethodId: requireString(
          device.walletAuthMethodId,
          'linked device walletAuthMethodId',
        ),
        credentialKind: parseLinkedDeviceCredentialKind(
          device.credentialKind,
          'linked device credential kind',
        ),
        state: parseLinkedDeviceState(device.state),
      };
    }),
  };
}

/** The wallet's one founding passkey method: the source Device 1 proves with. */
function requireSingleOwnerPasskey(
  inventory: LinkedDeviceInventorySnapshot,
): LinkedDeviceOwnerMethodSnapshot & { readonly credentialIdB64u: string } {
  const [owner, ...extra] = inventory.ownerDevices;
  if (!owner || extra.length > 0) {
    throw new Error(`expected one founding owner method, found ${inventory.ownerDevices.length}`);
  }
  if (owner.credentialKind !== 'passkey' || owner.credentialIdB64u === null) {
    throw new Error(`founding owner method is ${owner.credentialKind}, not a passkey`);
  }
  return { ...owner, credentialIdB64u: owner.credentialIdB64u };
}

function assertOwnerDevicesUnchanged(
  before: LinkedDeviceInventorySnapshot,
  after: LinkedDeviceInventorySnapshot,
  label: string,
): void {
  const describe = (inventory: LinkedDeviceInventorySnapshot): string =>
    JSON.stringify(inventory.ownerDevices.map((owner) => owner.walletAuthMethodId).sort());
  if (describe(before) !== describe(after)) {
    throw new Error(
      `${label} changed Device 1's founding methods: ${describe(before)} -> ${describe(after)}`,
    );
  }
}

type IntendedWebAuthnAssertionRequest = {
  readonly rpId: string;
  readonly challengeB64u: string;
  readonly credentialIdB64u: string;
};

/**
 * Runs inside the wallet frame, so the assertion's client data names the
 * wallet origin - the origin the Gateway expects for a request the wallet
 * host sends. Playwright serializes this function alone; keep it
 * self-contained.
 */
async function getWalletOriginPasskeyAssertion(
  input: IntendedWebAuthnAssertionRequest,
): Promise<Record<string, unknown>> {
  function decodeB64u(value: string): Uint8Array {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  function encodeB64u(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const credential = await navigator.credentials.get({
    publicKey: {
      rpId: input.rpId,
      challenge: decodeB64u(input.challengeB64u),
      allowCredentials: [{ type: 'public-key', id: decodeB64u(input.credentialIdB64u) }],
      userVerification: 'required',
      timeout: 30_000,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Wallet-origin passkey assertion returned no public-key credential');
  }
  const response = credential.response;
  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error('Wallet-origin passkey assertion returned a non-assertion response');
  }
  return {
    id: credential.id,
    rawId: encodeB64u(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    response: {
      clientDataJSON: encodeB64u(response.clientDataJSON),
      authenticatorData: encodeB64u(response.authenticatorData),
      signature: encodeB64u(response.signature),
      userHandle: response.userHandle ? encodeB64u(response.userHandle) : null,
    },
    clientExtensionResults: {},
  };
}

async function hostedAuthMenuFrame(page: Page): Promise<FrameLocator> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  await iframe.waitFor({ state: 'attached', timeout: 15_000 });
  return iframe.contentFrame();
}

async function walletServiceFrame(page: Page, walletOrigin: string): Promise<Frame> {
  const iframe = page.locator('iframe[src*="/wallet-service"]').last();
  await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  const iframeHandle = await iframe.elementHandle();
  if (!iframeHandle) throw new Error('Wallet service iframe is unavailable');
  const frame = await iframeHandle.contentFrame();
  if (!frame) throw new Error('Wallet service frame is unavailable');
  const expectedOrigin = new URL(walletOrigin).origin;
  if (new URL(frame.url()).origin !== expectedOrigin) {
    throw new Error('Wallet service frame origin changed');
  }
  return frame;
}

function recoveryActionForTarget(target: IntendedRecoveryTargetKind): IntendedRecoveryAction {
  switch (target) {
    case 'passkey':
      return {
        target,
        name: 'recoverPasskeyWallet',
        buttonTestId: 'intended-recover-passkey',
      };
    case 'google_email_otp':
      return {
        target,
        name: 'recoverGoogleEmailOtpWallet',
        buttonTestId: 'intended-recover-google-email-otp',
      };
    default:
      return assertNever(target);
  }
}

function isSuccessfulRecoveryPrepareResponse(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH &&
    response.status() === 200
  );
}

function isRecoveryFinalizationRequest(request: Request, path: string): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === path;
}

function isRecoveryFinalizationResponse(
  response: Response,
  path: string,
  status?: number,
): boolean {
  return (
    isRecoveryFinalizationRequest(response.request(), path) &&
    (status === undefined || response.status() === status)
  );
}

function createRecoveryRequestCapture(input: {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
}): RecoveryRequestCapture {
  return {
    ...input,
    request: null,
    error: null,
  };
}

function optionalRecoveryRequestString(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const raw = body[field];
  return raw === undefined ? null : requireString(raw, `recovery ${field}`);
}

function parseRecoveryRequestIdentity(
  capture: RecoveryRequestCapture,
  request: Request,
): RecoveryRequestIdentity {
  const body = requireRecord(
    request.postDataJSON(),
    `${capture.kind} recovery finalization request body`,
  );
  if (body.kind !== capture.kind) {
    throw new Error(
      `Recovery finalization request kind ${String(body.kind)} does not equal ${capture.kind}`,
    );
  }
  assertCredentialFreeRecoveryReplayBody(capture, body);
  const requestedWalletId = optionalRecoveryRequestString(body, 'walletId');
  if (requestedWalletId !== null && requestedWalletId !== capture.walletId) {
    throw new Error('Recovery finalization request changed its wallet identity');
  }
  if (capture.target === 'passkey' && requestedWalletId === null) {
    throw new Error('Passkey recovery finalization request omitted walletId');
  }
  const targetDeviceId = optionalRecoveryRequestString(body, 'targetDeviceId');
  const targetAuthorityId = optionalRecoveryRequestString(body, 'targetAuthorityId');
  const targetWalletAuthMethodId = optionalRecoveryRequestString(body, 'targetWalletAuthMethodId');
  if (
    capture.target === 'passkey' &&
    (targetDeviceId === null || targetAuthorityId === null || targetWalletAuthMethodId === null)
  ) {
    throw new Error('Passkey recovery finalization request omitted target identity');
  }
  return {
    kind: capture.kind,
    path: capture.path,
    target: capture.target,
    walletId: requestedWalletId ?? capture.walletId,
    recoveryOperationId: requireString(
      body.recoveryOperationId,
      'recovery finalization request recoveryOperationId',
    ),
    reservationId: requireString(body.reservationId, 'recovery finalization request reservationId'),
    targetDeviceId,
    targetAuthorityId,
    targetWalletAuthMethodId,
    replacementId: optionalRecoveryRequestString(body, 'replacementId'),
  };
}

function assertCredentialFreeRecoveryReplayBody(
  capture: RecoveryRequestCapture,
  body: Record<string, unknown>,
): void {
  if (capture.kind !== 'replay') return;
  const expectedFields =
    capture.target === 'passkey'
      ? [
          'kind',
          'walletId',
          'reservationId',
          'recoveryOperationId',
          'targetDeviceId',
          'targetAuthorityId',
          'targetWalletAuthMethodId',
          'replacementId',
          'replacementEnvelope',
        ]
      : ['kind', 'recoveryOperationId', 'reservationId', 'replacementEnvelope'];
  const actualFields = Object.keys(body).sort();
  const sortedExpectedFields = expectedFields.slice().sort();
  if (
    actualFields.length !== sortedExpectedFields.length ||
    actualFields.some((field, index) => field !== sortedExpectedFields[index])
  ) {
    throw new Error(
      `${capture.target} recovery replay must be credential-free and use its exact request shape`,
    );
  }
}

function captureRecoveryRequest(capture: RecoveryRequestCapture, request: Request): void {
  if (!isRecoveryFinalizationRequest(request, capture.path) || capture.request || capture.error) {
    return;
  }
  try {
    capture.request = parseRecoveryRequestIdentity(capture, request);
  } catch (error) {
    capture.error = error instanceof Error ? error.message : String(error);
  }
}

function requireCapturedRecoveryRequest(capture: RecoveryRequestCapture): RecoveryRequestIdentity {
  if (capture.error) throw new Error(capture.error);
  if (!capture.request) {
    throw new Error(`No exact ${capture.kind} recovery finalization request was captured`);
  }
  return capture.request;
}

function assertRecoveryReplayMatchesFinalization(
  finalization: RecoveryRequestIdentity,
  replay: RecoveryRequestIdentity,
): void {
  const fields: readonly (keyof RecoveryRequestIdentity)[] = [
    'path',
    'target',
    'walletId',
    'recoveryOperationId',
    'reservationId',
    'targetDeviceId',
    'targetAuthorityId',
    'targetWalletAuthMethodId',
    'replacementId',
  ];
  for (const field of fields) {
    if (finalization[field] !== replay[field]) {
      throw new Error(`Recovery replay changed ${field}`);
    }
  }
}

class RecoveryReplayGate {
  readonly released: Promise<void>;
  private resolveRelease: (() => void) | null = null;

  constructor() {
    this.released = new Promise<void>((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  release(): void {
    const resolve = this.resolveRelease;
    this.resolveRelease = null;
    resolve?.();
  }
}

async function holdRecoveryReplayUntilReleased(
  gate: RecoveryReplayGate,
  route: Route,
): Promise<void> {
  await gate.released;
  await route.continue();
}

async function fillHostedRecoveryCode(
  page: Page,
  recoveryCode: string,
  target: IntendedRecoveryTargetKind,
): Promise<FrameLocator> {
  const frame = await hostedAuthMenuFrame(page);
  await frame.getByRole('button', { name: 'Recover account' }).click({ timeout: 15_000 });
  await frame.locator('[data-recovery-code]').fill(recoveryCode);
  await frame.locator(`[data-recovery-target="${target}"]`).click({ timeout: 30_000 });
  return frame;
}

async function waitForHostedPasskeyRecoverySignIn(page: Page, frame: FrameLocator): Promise<void> {
  const deadline = Date.now() + 90_000;
  const primary = frame.locator('[data-auth-menu-primary]');
  const status = frame.locator('.seams-recovery-status').last();
  while (Date.now() < deadline) {
    const label = (await primary.textContent({ timeout: 100 }).catch(() => null))?.trim() ?? '';
    const message = (await status.textContent({ timeout: 100 }).catch(() => null))?.trim() ?? '';
    if (label === 'Sign in with new passkey') {
      await primary.click({ timeout: 15_000 });
      return;
    }
    const createFailed =
      label === 'Create new passkey' &&
      message !== 'Creating new passkey…' &&
      message !== 'Finishing recovery…';
    if (label === 'Retry finalization' || label === 'Continue' || createFailed) {
      throw new Error(`Passkey recovery returned to "${label}": ${message || 'no status message'}`);
    }
    await page.waitForTimeout(250);
  }
  const label =
    (await primary.textContent({ timeout: 100 }).catch(() => null))?.trim() ||
    'no recovery control';
  const message =
    (await status.textContent({ timeout: 100 }).catch(() => null))?.trim() || 'no status message';
  throw new Error(`Passkey recovery did not reach sign-in-ready: ${label}; ${message}`);
}

type RecoveryPrepareCapture = { readonly reservationIds: string[] };

function captureRecoveryPrepareReservation(
  capture: RecoveryPrepareCapture,
  request: Request,
): void {
  if (new URL(request.url()).pathname !== ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH) return;
  const body = request.postDataJSON() as { readonly reservationId?: unknown };
  if (typeof body.reservationId === 'string') capture.reservationIds.push(body.reservationId);
}

type RecoveryFinalizeFailure = { injected: boolean };

async function failFirstRecoveryFinalization(
  failure: RecoveryFinalizeFailure,
  route: Route,
): Promise<void> {
  if (failure.injected) {
    await route.continue();
    return;
  }
  failure.injected = true;
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'temporary_failure' }),
  });
}

async function concealFirstRecoveryFinalizationResponse(
  failure: RecoveryFinalizeFailure,
  route: Route,
): Promise<void> {
  /* The lost-response contract needs exactly one committed finalization.
     The flag flips before the server round-trip so a concurrent or
     straggling duplicate submission is refused without reaching the server
     instead of committing the operation the replay is expected to find. */
  if (failure.injected) {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'response_lost' }),
    });
    return;
  }
  failure.injected = true;
  const committed = await route.fetch();
  if (committed.status() !== 200) {
    throw new Error(`Recovery finalization failed before response loss: ${committed.status()}`);
  }
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, code: 'response_lost' }),
  });
}

async function driveHostedPasskeyRecovery(page: Page, recoveryCode: string): Promise<void> {
  const frame = await fillHostedRecoveryCode(page, recoveryCode, 'passkey');
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  await waitForHostedPasskeyRecoverySignIn(page, frame);
}

function recordAutoConfirmMark(
  diagnostics: WalletIframeAutoConfirmDiagnostics | undefined,
  startedAtMs: number | undefined,
  key: WalletIframeAutoConfirmTimingKey,
  valueMs?: number,
): void {
  if (!diagnostics || startedAtMs == null) return;
  if (diagnostics[key] != null) return;
  diagnostics[key] = Math.max(0, Math.round(valueMs ?? Date.now() - startedAtMs));
}

async function fillWalletIframeEmailOtpIfAvailable(
  page: Page,
  frame: FrameLocator,
  opts?: {
    timeoutMs?: number;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    diagnosticsStartedAtMs?: number;
  },
): Promise<'absent' | 'filled' | 'ready'> {
  const timeoutMs = Math.max(50, Math.floor(opts?.timeoutMs ?? 500));
  const input = frame
    .locator(
      'input[name="email-code"][autocomplete="one-time-code"], #seams-auth-menu-google-otp, #seams-recovery-google-otp',
    )
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!visible) return 'absent';
  const currentValue = await input.inputValue().catch(() => '');
  if (/^\d{6}$/.test(currentValue)) return 'ready';
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpInputVisibleMs');
  let otpIdentity: { challengeId: string; walletId: string | null } | null = null;
  try {
    otpIdentity = (await input.evaluate(readWalletIframeConfirmationState)).otpIdentity;
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = `challenge probe failed: ${compactUnknownErrorForDiagnostics(error)}`;
    }
  }
  const walletId =
    otpIdentity?.walletId ||
    (await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id'));
  if (!walletId) {
    throw new Error('Email OTP auto-confirm requires current intended wallet id');
  }
  const otpLookup: IntendedEmailOtpCodeRequestForPage = otpIdentity
    ? {
        kind: 'challenge',
        challengeId: otpIdentity.challengeId,
        walletId,
      }
    : {
        kind: 'latest_for_wallet',
        walletId,
      };
  if (opts?.diagnostics) {
    opts.diagnostics.otpLookupKind = otpLookup.kind;
  }
  let otpCode: string;
  try {
    otpCode = await page.evaluate(readIntendedEmailOtpCodeFromPage, otpLookup);
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = compactUnknownErrorForDiagnostics(error);
    }
    return 'absent';
  }
  if (!otpIdentity && opts?.diagnostics) {
    opts.diagnostics.otpChallengeMissing = true;
  }
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpCodeResolvedMs');
  try {
    await input.fill(otpCode, { timeout: timeoutMs });
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = compactUnknownErrorForDiagnostics(error);
    }
    return 'absent';
  }
  if (opts?.diagnostics) {
    opts.diagnostics.otpFilled = true;
  }
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpFillDispatchMs');
  const recoveryOtp = frame.locator('#seams-recovery-google-otp').first();
  if (await recoveryOtp.isVisible().catch(() => false)) {
    await frame.locator('[data-auth-menu-primary]').first().click({ timeout: timeoutMs });
    if (opts?.diagnostics) {
      opts.diagnostics.clicked = true;
    }
  }
  return 'filled';
}

function compactUnknownErrorForDiagnostics(error: unknown): string {
  const text = error instanceof Error ? error.message || String(error) : String(error || '');
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function readWalletIframeConfirmationState(anchor: Element): {
  otpIdentity: { challengeId: string; walletId: string | null } | null;
  requestIdentity: string | null;
  controlIdentity: string;
} {
  const challengeId = String(anchor.getAttribute('data-email-otp-challenge-id') || '').trim();
  const walletId = String(anchor.getAttribute('data-email-otp-wallet-id') || '').trim();
  let otpIdentity = challengeId ? { challengeId, walletId: walletId || null } : null;
  let requestIdentity: string | null = null;

  const roots: Array<Document | ShadowRoot> = [anchor.ownerDocument];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const elements = Array.from(roots[rootIndex].querySelectorAll('*'));
    for (const element of elements) {
      const promptElement = element as HTMLElement & {
        emailOtpPrompt?: { challengeId?: unknown };
        intentDigest?: unknown;
        requestId?: unknown;
      };
      if (!otpIdentity) {
        const promptChallengeId = String(promptElement.emailOtpPrompt?.challengeId || '').trim();
        if (promptChallengeId) {
          otpIdentity = { challengeId: promptChallengeId, walletId: null };
        }
      }
      if (!requestIdentity) {
        const intentDigest = String(promptElement.intentDigest || '').trim();
        const requestId = String(promptElement.requestId || '').trim();
        requestIdentity = intentDigest || requestId || null;
      }
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return {
    otpIdentity,
    requestIdentity,
    controlIdentity: JSON.stringify({
      tagName: anchor.tagName.toLowerCase(),
      id: anchor.id,
      className: anchor.getAttribute('class') || '',
      name: anchor.getAttribute('name') || '',
      ariaLabel: anchor.getAttribute('aria-label') || '',
      text: String(anchor.textContent || '')
        .replace(/\s+/g, ' ')
        .trim(),
      registrationActivation: anchor.getAttribute('data-seams-registration-activation-start'),
      authMenuPrimary: anchor.getAttribute('data-auth-menu-primary'),
      authMenuProvider: anchor.getAttribute('data-auth-menu-provider'),
    }),
  };
}

async function readWalletIframeConfirmationFingerprint(
  control: Locator,
  intendedAction: string | null,
  timeoutMs: number,
): Promise<WalletIframeConfirmationFingerprint> {
  const state = await control.evaluate(readWalletIframeConfirmationState, undefined, {
    timeout: timeoutMs,
  });
  return {
    intendedAction: intendedAction || '',
    controlIdentity: state.controlIdentity,
    stateIdentity: state.otpIdentity
      ? `email-otp:${state.otpIdentity.challengeId}`
      : state.requestIdentity,
  };
}

function walletIframeConfirmationAlreadyDispatched(
  dispatched: readonly WalletIframeConfirmationFingerprint[],
  current: WalletIframeConfirmationFingerprint,
): boolean {
  return dispatched.some((previous) => {
    if (
      previous.intendedAction !== current.intendedAction ||
      previous.controlIdentity !== current.controlIdentity
    ) {
      return false;
    }
    if (previous.stateIdentity && current.stateIdentity) {
      return previous.stateIdentity === current.stateIdentity;
    }
    return true;
  });
}

async function readIntendedEmailOtpCodeFromPage(
  input: IntendedEmailOtpCodeRequestForPage,
): Promise<string> {
  const reader = window.__seamsIntendedE2EReadEmailOtpCode;
  if (typeof reader !== 'function') {
    throw new Error('Intended page Email OTP reader is not installed');
  }
  const otpCode = String(await reader(input)).trim();
  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error('Intended page Email OTP reader returned an invalid OTP code');
  }
  return otpCode;
}

function intendedActionRequiresSecureConfirmation(action: string | null): boolean {
  switch (action) {
    case 'signNearTransaction':
    case 'signTempoTransaction':
    case 'signArcEvmTransaction':
    case 'exportEd25519Key':
    case 'exportEcdsaKey':
      return true;
    default:
      return false;
  }
}

function isAutomatedSecureConfirmationCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('Request cancelled.') &&
    message.includes('User cancelled secure confirm request')
  );
}

function intendedActionRequiresConfirmationSettlement(action: string): boolean {
  return (
    action === 'signNearTransaction' ||
    action === 'signTempoTransaction' ||
    action === 'signArcEvmTransaction'
  );
}

function walletIframeSecureConfirmationControl(frame: FrameLocator): Locator {
  return frame
    .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
    .last();
}

async function waitForWalletIframeConfirmationSettlement(page: Page): Promise<void> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  if ((await iframe.count()) === 0) return;
  await walletIframeSecureConfirmationControl(iframe.contentFrame()).waitFor({
    state: 'hidden',
    timeout: 5_000,
  });
  await page.waitForTimeout(100);
  const minimizeReceipt = iframe.contentFrame().getByRole('button', {
    name: 'Minimize transaction',
    exact: true,
  });
  if (await minimizeReceipt.isVisible()) {
    await minimizeReceipt.click({ timeout: 5_000 });
  }
}

async function resolveWalletIframeConfirmControl(input: {
  readonly frame: FrameLocator;
  readonly intendedAction: string | null;
  readonly timeoutMs: number;
}): Promise<Locator> {
  const secureConfirm = walletIframeSecureConfirmationControl(input.frame);
  if (intendedActionRequiresSecureConfirmation(input.intendedAction)) {
    await secureConfirm.waitFor({ state: 'visible', timeout: input.timeoutMs });
    return secureConfirm;
  }
  if (await secureConfirm.isVisible().catch(() => false)) {
    return secureConfirm;
  }
  return input.frame
    .locator('[data-seams-registration-activation-start="true"], [data-auth-menu-primary]')
    .first();
}

async function clickWalletIframeConfirm(
  page: Page,
  dispatchedConfirmations: WalletIframeConfirmationFingerprint[],
  opts?: {
    timeoutMs?: number;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    diagnosticsStartedAtMs?: number;
  },
): Promise<boolean> {
  const timeoutMs = Math.max(50, Math.floor(opts?.timeoutMs ?? 15_000));
  if (opts?.diagnostics) {
    opts.diagnostics.attempts += 1;
  }
  try {
    const iframeEl = page.locator('iframe[allow*="publickey-credentials-get"]').last();
    const attached = await iframeEl
      .waitFor({ state: 'attached', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!attached) return false;
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstIframeAttachedMs');
    const frame = iframeEl.contentFrame();
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstFrameResolvedMs');

    let intendedAction: string | null = null;
    try {
      intendedAction = await page.getByTestId('intended-action-status').getAttribute('data-action');
    } catch {
      intendedAction = null;
    }

    const otpState = await fillWalletIframeEmailOtpIfAvailable(page, frame, {
      timeoutMs: Math.min(500, timeoutMs),
      diagnostics: opts?.diagnostics,
      diagnosticsStartedAtMs: opts?.diagnosticsStartedAtMs,
    });
    if (otpState === 'filled') return true;
    if (intendedAction === 'unlockEmailOtpWallet' || intendedAction === 'unlockWithAddedEmailOtp') {
      const google = frame.locator('[data-auth-menu-provider="google"]').first();
      let googleVisible = false;
      try {
        googleVisible = await google.isVisible();
      } catch {
        googleVisible = false;
      }
      if (googleVisible) {
        const fingerprint = await readWalletIframeConfirmationFingerprint(
          google,
          intendedAction,
          timeoutMs,
        );
        if (walletIframeConfirmationAlreadyDispatched(dispatchedConfirmations, fingerprint)) {
          return false;
        }
        await google.click({ timeout: timeoutMs });
        dispatchedConfirmations.push(fingerprint);
        if (opts?.diagnostics) {
          opts.diagnostics.clicked = true;
        }
        return true;
      }
    }

    if (intendedAction === 'unlockPasskeyWallet') {
      const primary = frame.locator('[data-auth-menu-primary]').first();
      const primaryEnabled = await primary.isEnabled({ timeout: timeoutMs }).catch(() => false);
      if (!primaryEnabled) {
        const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
        if (!walletId) {
          throw new Error('Passkey auto-confirm requires current intended wallet id');
        }
        const accountMenuTrigger = frame.locator('.seams-account-menu-trigger').first();
        const triggerVisible = await accountMenuTrigger.isVisible().catch(() => false);
        if (triggerVisible) {
          await accountMenuTrigger.click({ timeout: timeoutMs });
          const passkeyAccount = frame
            .locator(
              `.seams-account-menu-option[data-wallet-id=${JSON.stringify(
                walletId,
              )}][data-auth-method="passkey"]`,
            )
            .first();
          const passkeyAccountVisible = await passkeyAccount.isVisible().catch(() => false);
          if (passkeyAccountVisible) {
            const selected = await passkeyAccount
              .getAttribute('aria-selected')
              .then((value) => value === 'true')
              .catch(() => false);
            if (!selected) {
              await passkeyAccount.click({ timeout: timeoutMs });
            } else {
              await accountMenuTrigger.click({ timeout: timeoutMs });
            }
            return true;
          }
        }
      }
    }

    const confirmBtn = await resolveWalletIframeConfirmControl({
      frame,
      intendedAction,
      timeoutMs,
    });
    await confirmBtn.waitFor({ state: 'visible', timeout: timeoutMs });
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstButtonVisibleMs');
    const fingerprint = await readWalletIframeConfirmationFingerprint(
      confirmBtn,
      intendedAction,
      timeoutMs,
    );
    if (walletIframeConfirmationAlreadyDispatched(dispatchedConfirmations, fingerprint)) {
      return false;
    }
    const clickStartedAtMs = Date.now();
    await confirmBtn.click({ timeout: timeoutMs });
    dispatchedConfirmations.push(fingerprint);
    if (opts?.diagnostics) {
      opts.diagnostics.clicked = true;
    }
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstClickDispatchMs');
    recordAutoConfirmMark(
      opts?.diagnostics,
      opts?.diagnosticsStartedAtMs,
      'firstClickDurationMs',
      Date.now() - clickStartedAtMs,
    );
    return true;
  } catch {
    return false;
  }
}

async function closeExportViewerFrameButton(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const closeButton = frame.getByRole('button', { name: 'Close' }).first();
    const visible = await closeButton
      .waitFor({ state: 'visible', timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (!visible) continue;
    await closeButton.click({ timeout: 2_000 });
    return true;
  }
  return false;
}

async function acknowledgeWalletRecoveryCodeBackup(
  page: Page,
  diagnostics?: WalletIframeAutoConfirmDiagnostics,
): Promise<readonly string[] | null> {
  for (const frame of page.frames()) {
    const acknowledgement = frame
      .locator('[data-seams-wallet-recovery-backup-acknowledgement]')
      .first();
    const visible = await acknowledgement.isVisible().catch(() => false);
    if (!visible) continue;
    const recoveryCodes = await frame.locator('.recovery-code-value').allTextContents();
    if (recoveryCodes.length === 0 || recoveryCodes.some((code) => !code.trim())) {
      throw new Error('Wallet recovery backup omitted its recovery codes');
    }
    if (!(await acknowledgement.isChecked())) {
      await acknowledgement.evaluate((input) => {
        if (!(input instanceof HTMLInputElement)) {
          throw new Error('Wallet recovery backup acknowledgement is not an input');
        }
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    // With the acknowledgement checked, the single close control completes the
    // backup (there is no separate "Finish backup" button).
    await frame.locator('[data-seams-wallet-recovery-backup-close]').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Wallet recovery backup close control is not a button');
      }
      button.click();
    });
    if (diagnostics) diagnostics.recoveryBackupAcknowledged = true;
    return recoveryCodes.map((code) => code.trim());
  }
  return null;
}

async function waitForWalletRecoveryCodeBackup(
  page: Page,
  diagnostics?: WalletIframeAutoConfirmDiagnostics,
): Promise<readonly string[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const recoveryCodes = await acknowledgeWalletRecoveryCodeBackup(page, diagnostics);
    if (recoveryCodes) return recoveryCodes;
    await page.waitForTimeout(100);
  }
  throw new Error('Wallet registration did not present recovery codes');
}

async function autoConfirmWalletIframeUntil<T>(
  page: Page,
  task: Promise<T>,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    retryDelayMs?: number;
    stopAfterClick?: boolean;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    onRecoveryCodes?: (codes: readonly string[]) => void;
  },
): Promise<T> {
  const timeoutMs = Math.max(250, Math.floor(opts?.timeoutMs ?? 55_000));
  const intervalMs = Math.max(50, Math.floor(opts?.intervalMs ?? 250));
  const retryDelayMs = Math.max(0, Math.floor(opts?.retryDelayMs ?? intervalMs));
  const stopAfterClick = opts?.stopAfterClick === true;
  let done = false;
  const startedAtMs = Date.now();
  const diagnostics = opts?.diagnostics;
  if (diagnostics) {
    diagnostics.attempts = 0;
    diagnostics.clicked = false;
  }

  const loop = runWalletIframeAutoConfirmLoop({
    page,
    timeoutMs,
    intervalMs,
    retryDelayMs,
    stopAfterClick,
    diagnostics,
    onRecoveryCodes: opts?.onRecoveryCodes,
    startedAtMs,
    isDone: () => done,
  });
  const loopFailure = new Promise<never>((_resolve, reject) => {
    void loop.catch(reject);
  });

  try {
    return await Promise.race([task, loopFailure]);
  } finally {
    done = true;
    if (diagnostics) {
      diagnostics.totalMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    }
    await loop.catch(() => undefined);
  }
}

async function runWalletIframeAutoConfirmLoop(args: {
  page: Page;
  timeoutMs: number;
  intervalMs: number;
  retryDelayMs: number;
  stopAfterClick: boolean;
  diagnostics?: WalletIframeAutoConfirmDiagnostics;
  onRecoveryCodes?: (codes: readonly string[]) => void;
  startedAtMs: number;
  isDone: () => boolean;
}): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  const dispatchedConfirmations: WalletIframeConfirmationFingerprint[] = [];
  while (!args.isDone() && Date.now() < deadline) {
    const recoveryCodes = await acknowledgeWalletRecoveryCodeBackup(args.page, args.diagnostics);
    if (recoveryCodes) {
      args.onRecoveryCodes?.(recoveryCodes);
      if (args.stopAfterClick) return;
      if (args.retryDelayMs > 0) {
        await args.page.waitForTimeout(args.retryDelayMs);
      }
      continue;
    }
    const clicked = await clickWalletIframeConfirm(args.page, dispatchedConfirmations, {
      timeoutMs: Math.min(500, args.intervalMs),
      diagnostics: args.diagnostics,
      diagnosticsStartedAtMs: args.startedAtMs,
    });
    const authMenuError = await readWalletIframeAuthMenuError(args.page);
    if (authMenuError) {
      throw new Error(`Wallet auth menu failed: ${authMenuError}`);
    }
    if (clicked && args.stopAfterClick) return;
    if (args.retryDelayMs > 0) {
      await args.page.waitForTimeout(args.retryDelayMs);
    }
  }
}

async function readWalletIframeAuthMenuError(page: Page): Promise<string | null> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  if (!(await iframe.isVisible().catch(() => false))) return null;
  const surface = iframe.contentFrame().locator('seams-auth-menu-surface').first();
  if ((await surface.count().catch(() => 0)) === 0) return null;
  return await surface
    .evaluate((element) => {
      const authMenu = element as HTMLElement & {
        viewModel?: { readonly error?: unknown };
      };
      const error = String(authMenu.viewModel?.error || '').trim();
      return error || null;
    })
    .catch(() => null);
}

/**
 * The committed revoke request with one thing changed: its operation (the
 * time it names) or its proof (the code or the challenge digest it carries).
 */
function changedRevokeRequestBody(body: string, change: 'operation' | 'proof'): string {
  const request = JSON.parse(body) as {
    requestedAtMs: number;
    sourceProof:
      | { kind: 'email_otp'; otpCode: string }
      | { kind: 'webauthn_assertion'; expectedChallengeDigestB64u: string };
  };
  if (change === 'operation') {
    request.requestedAtMs += 1;
  } else if (request.sourceProof.kind === 'email_otp') {
    const last = request.sourceProof.otpCode.slice(-1);
    request.sourceProof.otpCode = `${request.sourceProof.otpCode.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  } else {
    const digest = request.sourceProof.expectedChallengeDigestB64u;
    request.sourceProof.expectedChallengeDigestB64u = `${digest.slice(0, -1)}${digest.endsWith('A') ? 'B' : 'A'}`;
  }
  return JSON.stringify(request);
}

type HeldWalletStoreWindow = Window & {
  __seamsHeldWalletStore?: { released: boolean; readonly done: Promise<void> };
};

/* Runs in the wallet's frame: keeps one read-write transaction on
   `storeName` busy until releaseHeldWalletStore, and resolves once it holds
   the store. */
async function startHeldWalletStore(storeName: string): Promise<void> {
  const names = (await indexedDB.databases()).map((database) => database.name ?? '');
  const name = names.includes('seams_wallet')
    ? 'seams_wallet'
    : names.find((candidate) => candidate.startsWith('seams_test_wallet_'));
  if (!name) throw new Error('The wallet IndexedDB is not open');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  const state = {
    released: false,
    done: new Promise<void>((resolve) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onabort = () => {
        db.close();
        resolve();
      };
    }),
  };
  (window as HeldWalletStoreWindow).__seamsHeldWalletStore = state;
  await new Promise<void>((resolve, reject) => {
    let holding = false;
    const keepBusy = (): void => {
      if (state.released) return;
      const request = store.count();
      request.onsuccess = () => {
        if (!holding) {
          holding = true;
          resolve();
        }
        keepBusy();
      };
      request.onerror = () => reject(request.error);
    };
    keepBusy();
  });
}

/* Runs in the wallet's frame: lets the held transaction commit. */
async function releaseHeldWalletStore(): Promise<void> {
  const holder = window as HeldWalletStoreWindow;
  const state = holder.__seamsHeldWalletStore;
  if (!state) return;
  state.released = true;
  holder.__seamsHeldWalletStore = undefined;
  await state.done;
}

function isNearRegistrationExecutionResponse(response: Response): boolean {
  return new URL(response.url()).pathname === ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1;
}

function isNearProvisioningFinalizeResponse(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1
  );
}
