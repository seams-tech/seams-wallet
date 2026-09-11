import { TransactionInputWasm } from '@/core/types';
import { ConfirmationConfig } from '@/core/types';
import { TransactionContext } from '@/core/types/rpc';
import { RpcCallPayload } from '@/core/types/signer-worker';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';
import type {
  EmailOtpConfirmPrompt,
  ForbiddenMainThreadSecrets,
  RegistrationConfirmationDiagnostics,
  SerializableCredential,
  SigningAuthPlan,
  UserConfirmDecision,
  UserConfirmProgressEvent,
  WalletSessionExpiredConfirmationFailure,
  WebAuthnChallenge,
} from '../types';
import type { NonceLeaseRef } from '../../interfaces/nonceLease';
import type {
  NearFundingRequest,
  NearTransactionReadiness,
} from '../../nonce/nearTransactionReadiness';
import type { NearOperationStepUpPreparationRef } from '../../interfaces/operationStepUpPreparation';
import type { WalletRecoveryRegistrationOptions } from '@/core/rpcClients/relayer/walletRecoveryPrepare';
import type { WalletAddAuthMethodRegistrationOptions } from '@/core/rpcClients/relayer/walletRegistration';
import { UserConfirmationType } from '../userConfirmationType';

export { UserConfirmationType } from '../userConfirmationType';

export type {
  ForbiddenMainThreadSecrets,
  RegistrationConfirmationDiagnostics,
  SerializableCredential,
  UserConfirmDecision,
  WalletSessionExpiredConfirmationFailure,
  WebAuthnChallenge,
} from '../types';

// === SECURE CONFIRM TYPES (V2) ===

export enum UserConfirmMessageType {
  PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD = 'PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD',
  USER_PASSKEY_CONFIRM_RESPONSE = 'USER_PASSKEY_CONFIRM_RESPONSE',
  USER_PASSKEY_CONFIRM_PROGRESS = 'USER_PASSKEY_CONFIRM_PROGRESS',
}

export interface UserConfirmPromptEnvelope {
  type: UserConfirmMessageType.PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD;
  requestId: string;
  channelToken: string;
  data: UserConfirmRequest;
}

export type ConfirmPrompt =
  | { kind: 'pending_request'; requestId: string; requestToken: string; request?: never }
  | { kind: 'export_request'; request: WorkerExportConfirmRequest; requestId?: never };

export interface WorkerUserConfirmPromptEnvelope {
  type: UserConfirmMessageType.PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD;
  requestId: string;
  channelToken: string;
  data: ConfirmPrompt;
}

/**
 * Type-level guardrail: these secrets must never appear in main-thread
 * request/response envelopes. PRF outputs are extracted from credentials and
 * passed directly to signer-worker payloads in wallet origin only.
 */
export interface UserConfirmResponseEnvelope {
  type: UserConfirmMessageType.USER_PASSKEY_CONFIRM_RESPONSE;
  requestId: string;
  channelToken?: string;
  data: UserConfirmDecision;
}

export interface UserConfirmProgressEnvelope {
  type: UserConfirmMessageType.USER_PASSKEY_CONFIRM_PROGRESS;
  requestId: string;
  channelToken?: string;
  data: UserConfirmProgressEvent;
}

export interface TransactionSummary {
  totalAmount?: string;
  title?: string;
  body?: string;
  method?: string;
  operation?: string;
  warning?: string;
  intentDigest?: string;
  receiverId?: string;
  type?: string;
  delegate?: {
    senderId?: string;
    receiverId?: string;
    nonce?: string;
    maxBlockHeight?: string;
  };
  summary?: unknown;
}

type WorkerConfirmationResponseBase = {
  request_id: string;
  intent_digest?: string;
};

type WorkerConfirmationSuccessBase = WorkerConfirmationResponseBase & {
  confirmed: true;
  credential?: SerializableCredential;
  operation_step_up_preparation?: NearOperationStepUpPreparationRef;
  otp_code?: string;
  email_otp_challenge_id?: string;
  registration_diagnostics?: RegistrationConfirmationDiagnostics;
  error?: never;
};

// Payload to return to Rust WASM is snake_case.
export type WorkerConfirmationResponse =
  | (WorkerConfirmationSuccessBase & {
      transaction_context: TransactionContext;
      nonce_leases: NonceLeaseRef[];
      near_transaction_readiness?: never;
    })
  | (WorkerConfirmationSuccessBase & {
      near_transaction_readiness: NearTransactionReadiness;
      transaction_context?: never;
      nonce_leases?: never;
    })
  | (WorkerConfirmationSuccessBase & {
      near_transaction_readiness?: never;
      transaction_context?: never;
      nonce_leases?: never;
    })
  | (WorkerConfirmationResponseBase & {
      confirmed: false;
      registration_diagnostics?: RegistrationConfirmationDiagnostics;
      credential?: never;
      otp_code?: never;
      email_otp_challenge_id?: never;
      near_transaction_readiness?: never;
      transaction_context?: never;
      nonce_leases?: never;
    } & (
        | {
            wallet_session_failure: WalletSessionExpiredConfirmationFailure;
            error?: never;
          }
        | {
            wallet_session_failure?: never;
            error?: string;
          }
      ));

// ===== V2 MESSAGE TYPES =====

// V2 summaries (render-oriented / UI hints)
export interface TxSummary {
  totalAmount?: string;
  method?: string;
  receiverId?: string;
}
export interface RegistrationSummary {
  walletId: string;
  nearAccountId?: string;
  signerSlot?: number;
  title?: string;
  body?: string;
}
export type ExportOperation = 'Export Private Key' | 'Export Recovery Key';
export interface ExportSummary {
  operation: ExportOperation;
  accountId: string;
  publicKey: string;
  warning: string;
}
export interface Nep413Summary {
  operation: 'Sign NEP-413 Message';
  message: string;
  recipient: string;
  accountId: string;
}

// V2 request envelope
export type UserConfirmPayloadByType = {
  [UserConfirmationType.SIGN_TRANSACTION]: SignTransactionPayload;
  [UserConfirmationType.REGISTER_ACCOUNT]: RegisterAccountPayload;
  [UserConfirmationType.LINK_DEVICE]: RegisterAccountPayload;
  [UserConfirmationType.AUTHORIZE_KEY_EXPORT]: AuthorizeKeyExportPayload;
  [UserConfirmationType.SIGN_NEP413_MESSAGE]: SignNep413Payload;
  [UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI]: ShowSecurePrivateKeyUiPayload;
  [UserConfirmationType.SIGN_INTENT_DIGEST]: SignIntentDigestPayload;
};

export type UserConfirmSummaryByType = {
  [UserConfirmationType.SIGN_TRANSACTION]: TransactionSummary;
  [UserConfirmationType.REGISTER_ACCOUNT]: RegistrationSummary;
  [UserConfirmationType.LINK_DEVICE]: RegistrationSummary;
  [UserConfirmationType.AUTHORIZE_KEY_EXPORT]: ExportSummary;
  [UserConfirmationType.SIGN_NEP413_MESSAGE]: TransactionSummary;
  [UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI]: ExportSummary;
  [UserConfirmationType.SIGN_INTENT_DIGEST]: TransactionSummary | ExportSummary;
};

interface UserConfirmRequestBase {
  requestId: string;
  // Allow partial override from callers; effective config is computed later
  confirmationConfig?: Partial<ConfirmationConfig>;
  // Optional intent digest to echo back in responses for flows that
  // do not have a tx-centric payload (e.g., registration/link flows)
  intentDigest?: string;
}

export type UserConfirmRequest = {
  [TType in UserConfirmationType]: UserConfirmRequestBase & {
    type: TType;
    summary: UserConfirmSummaryByType[TType];
    payload: UserConfirmPayloadByType[TType] & ForbiddenMainThreadSecrets;
  };
}[UserConfirmationType];

// V2 payloads
type SignTransactionPayloadBase = {
  walletId: string;
  txSigningRequests: TransactionInputWasm[];
  intentDigest: string;
  displayModel?: TxDisplayModel;
  rpcCall: RpcCallPayload;
  nearPublicKeyStr?: string;
};

type NearTransactionSigningPayload = SignTransactionPayloadBase & { signingKind: 'transaction' } & (
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'warmSession' }>;
        nearFundingRequest: NearFundingRequest;
        webauthnChallenge?: never;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'active_wallet_authority' }>;
        nearFundingRequest: NearFundingRequest;
        webauthnChallenge?: never;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'passkeyReauth' }>;
        nearFundingRequest: NearFundingRequest;
        webauthnChallenge?: WebAuthnChallenge;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'emailOtpReauth' }>;
        nearFundingRequest: NearFundingRequest;
        webauthnChallenge?: never;
        emailOtpPrompt: EmailOtpConfirmPrompt;
      }
  );

type NearDelegateSigningPayload = SignTransactionPayloadBase & {
  signingKind: 'delegate';
  nearFundingRequest?: never;
} & (
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'warmSession' }>;
        webauthnChallenge?: never;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'active_wallet_authority' }>;
        webauthnChallenge?: never;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'passkeyReauth' }>;
        webauthnChallenge?: WebAuthnChallenge;
        emailOtpPrompt?: never;
      }
    | {
        signingAuthPlan: Extract<SigningAuthPlan, { kind: 'emailOtpReauth' }>;
        webauthnChallenge?: never;
        emailOtpPrompt: EmailOtpConfirmPrompt;
      }
  );

export type SignTransactionPayload = NearTransactionSigningPayload | NearDelegateSigningPayload;

export type RegisterAccountPayload =
  | {
      walletId: string;
      nearAccountId?: string;
      signerSlot?: number;
      webauthnChallenge?: Extract<WebAuthnChallenge, { kind: 'intent_digest' }>;
      walletRecoveryRegistration?: never;
      walletAddAuthMethodRegistration?: never;
    }
  | {
      walletId: string;
      walletRecoveryRegistration: WalletRecoveryRegistrationOptions;
      nearAccountId?: never;
      signerSlot?: never;
      webauthnChallenge?: never;
      walletAddAuthMethodRegistration?: never;
    }
  | {
      walletId: string;
      walletAddAuthMethodRegistration: WalletAddAuthMethodRegistrationOptions;
      nearAccountId?: never;
      signerSlot?: never;
      webauthnChallenge?: never;
      walletRecoveryRegistration?: never;
    };

export type LocalOnlyExportSubject =
  | {
      kind: 'near_wallet';
      nearAccountId: string;
      walletId?: never;
    }
  | {
      kind: 'evm_wallet';
      walletId: string;
      nearAccountId?: never;
    };

export interface AuthorizeKeyExportPayload {
  subject: LocalOnlyExportSubject;
  credentialIdB64u: string;
  publicKey: string;
  challengeB64u?: string;
}

export type ExportPrivateKeyScheme = 'ed25519' | 'secp256k1';

export interface ExportPrivateKeyDisplayEntry {
  scheme: ExportPrivateKeyScheme;
  label: string;
  publicKey: string;
  privateKey: string;
  address?: string;
}

export interface ExportGuidance {
  title: string;
  body?: string;
  steps?: string[];
}

export interface ShowSecurePrivateKeyUiPayload {
  subject: LocalOnlyExportSubject;
  viewerSessionId?: string;
  publicKey: string;
  privateKey?: string;
  keys?: ExportPrivateKeyDisplayEntry[];
  guidance?: ExportGuidance;
  variant?: 'drawer' | 'modal';
  theme?: 'dark' | 'light';
  loading?: boolean;
  errorMessage?: string;
  onLifecycle?: (event: 'opened' | 'closed') => void;
}

export interface SignNep413Payload {
  walletId: string;
  nearAccountId: string;
  nearPublicKeyStr?: string;
  message: string;
  recipient: string;
  displayModel?: TxDisplayModel;
  webauthnChallenge?: WebAuthnChallenge;
  signingAuthPlan: SigningAuthPlan;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
}

export type SignIntentDigestSubject =
  | {
      kind: 'near_wallet';
      walletId: string;
      nearAccountId: string;
    }
  | {
      kind: 'evm_wallet';
      walletId: string;
      nearAccountId?: never;
    };

type SignIntentDigestPayloadBase = {
  signingSubject: SignIntentDigestSubject;
  /**
   * Base64url-encoded 32-byte digest used as WebAuthn challenge when the
   * derived signing auth display mode is WebAuthn.
   */
  challengeB64u: string;
  displayModel?: TxDisplayModel;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
};

export type SignIntentDigestPayload =
  | (SignIntentDigestPayloadBase & {
      signingAuthPlan: Extract<SigningAuthPlan, { kind: 'passkeyReauth' }>;
      webauthnChallenge: WebAuthnChallenge;
    })
  | (SignIntentDigestPayloadBase & {
      signingAuthPlan: Exclude<
        SigningAuthPlan,
        Extract<SigningAuthPlan, { kind: 'passkeyReauth' }>
      >;
      webauthnChallenge?: WebAuthnChallenge;
    });

// Discriminated unions to bind `type` to payload shape
export type UserConfirmRequestByType<TType extends UserConfirmationType> = Extract<
  UserConfirmRequest,
  { type: TType }
>;

export type LocalOnlyUserConfirmRequest =
  | UserConfirmRequestByType<UserConfirmationType.AUTHORIZE_KEY_EXPORT>
  | UserConfirmRequestByType<UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI>;

export type WorkerExportConfirmRequest =
  | UserConfirmRequestByType<UserConfirmationType.AUTHORIZE_KEY_EXPORT>
  | (Omit<UserConfirmRequestByType<UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI>, 'payload'> & {
      payload: Omit<
        UserConfirmRequestByType<UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI>['payload'],
        'onLifecycle'
      > & { onLifecycle?: never };
    });

export type RegistrationUserConfirmRequest =
  | UserConfirmRequestByType<UserConfirmationType.REGISTER_ACCOUNT>
  | UserConfirmRequestByType<UserConfirmationType.LINK_DEVICE>;

export type SigningUserConfirmRequest =
  | UserConfirmRequestByType<UserConfirmationType.SIGN_TRANSACTION>
  | UserConfirmRequestByType<UserConfirmationType.SIGN_NEP413_MESSAGE>;

export type IntentDigestUserConfirmRequest =
  UserConfirmRequestByType<UserConfirmationType.SIGN_INTENT_DIGEST>;
