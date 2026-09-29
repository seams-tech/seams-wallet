// === IMPORT AUTO-GENERATED WASM TYPES ===
// These are the source of truth generated from Rust structs via wasm-bindgen
// Import as instance types from the WASM module classes
import type * as wasmModule from '../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';

import type { StripFree } from './index.js';
import type { TransactionContext } from './rpc.js';
import type { ActionArgsWasm } from './actions.js';
import type {
  FinalizeEcdsaClientBootstrapCommand as GeneratedFinalizeEcdsaClientBootstrapCommand,
  FinalizeEcdsaClientBootstrapOutput as GeneratedFinalizeEcdsaClientBootstrapOutput,
  PrepareEcdsaClientBootstrapCommand as GeneratedPrepareEcdsaClientBootstrapCommand,
  PrepareEcdsaClientBootstrapOutput as GeneratedPrepareEcdsaClientBootstrapOutput,
} from '../platform/generated/signerCoreCommands.js';

export type WasmTransaction = wasmModule.WasmTransaction;
export type WasmSignature = wasmModule.WasmSignature;

export enum WorkerRequestType {
  SignTransactionsWithActions = 0,
  SignNep413Message = 1,
  SignDelegateAction = 2,
  DeriveThresholdEd25519ClientVerifyingShare = 3,
}

export enum WorkerResponseType {
  SignTransactionsWithActionsSuccess = 0,
  SignNep413MessageSuccess = 1,
  SignDelegateActionSuccess = 2,
  SignTransactionsWithActionsFailure = 3,
  SignNep413MessageFailure = 4,
  SignDelegateActionFailure = 5,
  RegistrationProgress = 6,
  RegistrationComplete = 7,
  ExecuteActionsProgress = 8,
  ExecuteActionsComplete = 9,
  DeriveThresholdEd25519ClientVerifyingShareSuccess = 10,
  DeriveThresholdEd25519ClientVerifyingShareFailure = 11,
}

export const NearSignerWorkerCustomRequestType = {
  ThresholdEd25519ComputeNep413SigningDigest: 'thresholdEd25519ComputeNep413SigningDigest',
  ThresholdEd25519ComputeDelegateSigningDigest: 'thresholdEd25519ComputeDelegateSigningDigest',
  ThresholdEd25519BuildDelegateSigningPayload: 'thresholdEd25519BuildDelegateSigningPayload',
  ThresholdEd25519FinalizeDelegateFromSignature: 'thresholdEd25519FinalizeDelegateFromSignature',
  ThresholdEd25519FinalizeNearTxFromSignature: 'thresholdEd25519FinalizeNearTxFromSignature',
  ThresholdEd25519BuildNearTxUnsignedBorsh: 'thresholdEd25519BuildNearTxUnsignedBorsh',
  ThresholdEd25519DecodeSignedNearTxBorsh: 'thresholdEd25519DecodeSignedNearTxBorsh',
} as const;

export type NearSignerWorkerCustomRequestType =
  (typeof NearSignerWorkerCustomRequestType)[keyof typeof NearSignerWorkerCustomRequestType];

export type SignerWorkerRequestType = WorkerRequestType | NearSignerWorkerCustomRequestType;
type SignerWorkerResponseType = WorkerResponseType;

interface ThresholdSignerConfig {
  /** Base URL of the Router API server (e.g. https://router-api.example.com) */
  relayerUrl: string;
  /** Identifies which relayer-held key share to use */
  relayerKeyId: string;
  /** FROST participant identifier used for the client share (2P only, optional). */
  clientParticipantId?: number;
  /** FROST participant identifier used for the relayer share (2P only, optional). */
  relayerParticipantId?: number;
  /** Optional participant ids (signer set) associated with this threshold key/session. */
  participantIds?: number[];
}

export type ThresholdEd25519ComputeNep413SigningDigestRequest = {
  message: string;
  recipient: string;
  nonce: string;
  state?: string;
};

export type ThresholdEd25519ComputeSigningDigestResult = {
  signingDigestB64u: string;
};

export type ThresholdEd25519BuildDelegateSigningPayloadRequest = {
  delegate: DelegatePayload;
};

export type ThresholdEd25519BuildDelegateSigningPayloadResult = {
  canonicalDelegateBorshB64u: string;
  signingDigestB64u: string;
};

export type ThresholdEd25519FinalizeDelegateFromSignatureRequest = {
  delegate: DelegatePayload;
  signingDigestB64u: string;
  signatureB64u: string;
};

export type ThresholdEd25519FinalizeNearTxFromSignatureRequest = {
  unsignedTransactionBorshB64u: string;
  signingDigestB64u: string;
  signatureB64u: string;
  expectedNearAccountId: string;
  expectedSignerPublicKey: string;
};

export type ThresholdEd25519FinalizeNearTxFromSignatureResult = {
  signedTransactionBorshB64u: string;
  transactionHash: string;
};

export type ThresholdEd25519BuildNearTxUnsignedBorshRequest = {
  txSigningRequests: readonly TransactionPayload[];
  transactionContext: TransactionContext;
};

export type ThresholdEd25519NearTxUnsignedBorsh = {
  unsignedTransactionBorshB64u: string;
  signingDigestB64u: string;
};

export type ThresholdEd25519DecodeSignedNearTxBorshRequest = {
  signedTransactionBorshB64u: string;
};

export type ThresholdEd25519DecodeSignedNearTxBorshResult = {
  signedTransaction: WasmSignedTransaction;
  transactionHash: string;
};

export interface TransactionPayload {
  nearAccountId: string;
  receiverId: string;
  actions: ActionArgsWasm[];
}
export interface RpcCallPayload {
  nearRpcUrl: string;
  nearAccountId: string;
}
/**
 * RPC call parameters for NEAR operations
 * Used to pass essential parameters for background operations
 * export interface RpcCallPayload {
 *    nearRpcUrl: string;    // NEAR RPC endpoint URL
 *    nearAccountId: string; // Account ID for the current user/session
 * }
 */

type DirectPrfFields = {
  prfFirstB64u?: string;
  wrapKeySalt?: string;
};

type WasmDeriveThresholdEd25519ClientVerifyingShareRequest =
  StripFree<wasmModule.DeriveThresholdEd25519ClientVerifyingShareRequest> & DirectPrfFields;
export type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapRequest =
  GeneratedPrepareEcdsaClientBootstrapCommand;
export type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapResult =
  GeneratedPrepareEcdsaClientBootstrapOutput;
export type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapRequest =
  GeneratedFinalizeEcdsaClientBootstrapCommand;
export type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapResult =
  GeneratedFinalizeEcdsaClientBootstrapOutput;
interface WasmSignTransactionsWithActionsRequest {
  rpcCall: RpcCallPayload;
  sessionId: string;
  createdAt?: number;
  threshold: ThresholdSignerConfig;
  txSigningRequests: TransactionPayload[];
  intentDigest?: string;
  transactionContext?: TransactionContext;
  credential?: string;
}

interface WasmSignDelegateActionRequest {
  rpcCall: RpcCallPayload;
  sessionId: string;
  createdAt?: number;
  threshold: ThresholdSignerConfig;
  delegate: DelegatePayload;
  intentDigest?: string;
  transactionContext?: TransactionContext;
  credential?: string;
}
export interface DelegatePayload {
  senderId: string;
  receiverId: string;
  actions: ActionArgsWasm[];
  nonce: string;
  maxBlockHeight: string;
  publicKey: string;
}
interface WasmSignNep413MessageRequest {
  sessionId: string;
  accountId: string;
  nearPublicKey: string;
  threshold: ThresholdSignerConfig;
  message: string;
  recipient: string;
  nonce: string;
  state?: string;
  credential?: string;
}
export type WasmRequestPayload =
  | WasmDeriveThresholdEd25519ClientVerifyingShareRequest
  | WasmSignTransactionsWithActionsRequest
  | WasmSignDelegateActionRequest
  | WasmSignNep413MessageRequest;

// WASM Worker Response Types
type WasmSignedTransaction = InstanceType<typeof wasmModule.WasmSignedTransaction>;
export type WasmSignedDelegate = wasmModule.WasmSignedDelegate;
type WasmTransactionSignResult = InstanceType<typeof wasmModule.TransactionSignResult>;
type WasmDelegateSignResult = wasmModule.DelegateSignResult;
// wasm-bindgen may generate classes with private constructors, which breaks
// `InstanceType<typeof Class>`. Use the class name directly for the instance type.
export type WasmDeriveThresholdEd25519ClientVerifyingShareResult =
  wasmModule.DeriveThresholdEd25519ClientVerifyingShareResult;

// === WORKER REQUEST TYPE MAPPING ===
// Define the complete type mapping for each worker request
export interface WorkerRequestTypeMap {
  [WorkerRequestType.DeriveThresholdEd25519ClientVerifyingShare]: {
    type: WorkerRequestType.DeriveThresholdEd25519ClientVerifyingShare;
    request: WasmDeriveThresholdEd25519ClientVerifyingShareRequest;
    result: WasmDeriveThresholdEd25519ClientVerifyingShareResult;
  };
  [WorkerRequestType.SignTransactionsWithActions]: {
    type: WorkerRequestType.SignTransactionsWithActions;
    request: WasmSignTransactionsWithActionsRequest;
    result: WasmTransactionSignResult;
  };
  [WorkerRequestType.SignDelegateAction]: {
    type: WorkerRequestType.SignDelegateAction;
    request: WasmSignDelegateActionRequest;
    result: WasmDelegateSignResult;
  };
  [WorkerRequestType.SignNep413Message]: {
    type: WorkerRequestType.SignNep413Message;
    request: WasmSignNep413MessageRequest;
    result: wasmModule.SignNep413Result;
  };
}

/**
 * Validation rules for ConfirmationConfig to ensure behavior conforms to UI mode:
 *
 * - uiMode: 'none' → behavior is ignored, autoProceedDelay is ignored
 * - uiMode: 'modal' | 'drawer' → behavior: 'requireClick' | 'skipClick', autoProceedDelay only used with 'skipClick'
 *
 * The WASM worker automatically validates and overrides these settings:
 * - For 'none' mode: behavior is set to 'skipClick' with autoProceedDelay: 0
 * - For 'modal' and 'drawer' modes: behavior and autoProceedDelay are used as specified
 *
 * The actual type would be the following, but we use the flat interface for simplicity:
 * export interface ConfirmationConfig {
 *   uiMode: 'none' | 'modal' | 'drawer'
 *
 * }
 */
export type ConfirmationUIMode = 'none' | 'modal' | 'drawer';
export type ConfirmationBehavior = 'requireClick' | 'skipClick';
export interface ConfirmationConfig {
  /** Type of UI to display for confirmation: 'none' | 'modal' | 'drawer' */
  uiMode: ConfirmationUIMode;
  /** How the confirmation UI behaves: 'requireClick' | 'skipClick' */
  behavior: ConfirmationBehavior;
  /** Delay in milliseconds before auto-proceeding (only used with skipClick) */
  autoProceedDelay?: number;
}

export const DEFAULT_CONFIRMATION_CONFIG: ConfirmationConfig = {
  uiMode: 'modal',
  behavior: 'requireClick',
  autoProceedDelay: 0,
};

// Type guard for basic progress message validation during development

export enum ProgressMessageType {
  REGISTRATION_PROGRESS = 'REGISTRATION_PROGRESS',
  REGISTRATION_COMPLETE = 'REGISTRATION_COMPLETE',
  EXECUTE_ACTIONS_PROGRESS = 'EXECUTE_ACTIONS_PROGRESS',
  EXECUTE_ACTIONS_COMPLETE = 'EXECUTE_ACTIONS_COMPLETE',
}

// Step identifiers for progress tracking
// This enum exactly matches the Rust WASM ProgressStep enum from:
// packages/passkey/wasm/near_signer/src/types/progress.rs
// The string values come from the progress_step_name() function in that file
export enum ProgressStep {
  PREPARATION = 'preparation', // Rust: Preparation
  WEBAUTHN_AUTHENTICATION = 'webauthn-authentication', // Rust: WebauthnAuthentication
  AUTHENTICATION_COMPLETE = 'authentication-complete', // Rust: AuthenticationComplete
  TRANSACTION_SIGNING_PROGRESS = 'transaction-signing-progress', // Rust: TransactionSigningProgress
  TRANSACTION_SIGNING_COMPLETE = 'transaction-signing-complete', // Rust: TransactionSigningComplete
  ERROR = 'error', // Rust: Error
}

type NearWorkerProgressStatus = 'progress' | 'success' | 'error';

export interface NearWorkerProgressEvent {
  step: number;
  phase: string;
  status: NearWorkerProgressStatus;
  message: string;
  data?: Record<string, unknown>;
  logs?: string[];
}

// === RESPONSE MESSAGE INTERFACES ===

// Base interface for all worker responses
interface BaseWorkerResponse<TPayload = unknown> {
  type: SignerWorkerResponseType;
  payload: TPayload;
}

// Map request types to their expected success response payloads (WASM types)
export interface RequestResponseMap {
  [WorkerRequestType.DeriveThresholdEd25519ClientVerifyingShare]: WasmDeriveThresholdEd25519ClientVerifyingShareResult;
  [WorkerRequestType.SignTransactionsWithActions]: WasmTransactionSignResult;
  [WorkerRequestType.SignDelegateAction]: WasmDelegateSignResult;
  [WorkerRequestType.SignNep413Message]: wasmModule.SignNep413Result;
}

type RequestTypeKey = keyof RequestResponseMap;

// Generic success response type that uses WASM types
export interface WorkerSuccessResponse<T extends RequestTypeKey> extends BaseWorkerResponse<
  RequestResponseMap[T]
> {
  type: SignerWorkerResponseType;
  diagnostics?: WorkerResponseDiagnostics;
}

export type WorkerResponseDiagnostics = {
  kind: 'worker_response_diagnostics_v1';
  worker: 'ecdsaDerivationClient';
  requestType: number;
  queueWaitMs: number;
  wasmInitWaitMs: number;
  wasmCallMs: number;
  totalMs: number;
  requestPayloadBytes: number;
  responsePayloadBytes: number;
  requestPayloadBreakdown: Record<string, number>;
  responsePayloadBreakdown: Record<string, number>;
  wasmOperationTimings?: Record<string, number>;
};

// Generic error response type
export interface WorkerErrorResponse extends BaseWorkerResponse<{
  error: string;
  errorCode?: WorkerErrorCode;
  context?: Record<string, unknown>;
}> {
  type: SignerWorkerResponseType;
}

enum WorkerErrorCode {
  WASM_INIT_FAILED = 'WASM_INIT_FAILED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  TIMEOUT = 'TIMEOUT',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  SIGNING_FAILED = 'SIGNING_FAILED',
  STORAGE_FAILED = 'STORAGE_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface WorkerProgressResponse extends BaseWorkerResponse<NearWorkerProgressEvent> {
  type: SignerWorkerResponseType;
}

// === MAIN RESPONSE TYPE ===

export type WorkerResponseForRequest<T extends RequestTypeKey> =
  | WorkerSuccessResponse<T>
  | WorkerErrorResponse
  | WorkerProgressResponse;

// === TYPE GUARDS FOR GENERIC RESPONSES ===

export function isWorkerProgress<T extends RequestTypeKey>(
  response: WorkerResponseForRequest<T>,
): response is WorkerProgressResponse {
  return (
    response.type === WorkerResponseType.RegistrationProgress ||
    response.type === WorkerResponseType.RegistrationComplete ||
    response.type === WorkerResponseType.ExecuteActionsProgress ||
    response.type === WorkerResponseType.ExecuteActionsComplete
  );
}

export function isWorkerSuccess<T extends RequestTypeKey>(
  response: WorkerResponseForRequest<T>,
): response is WorkerSuccessResponse<T> {
  return (
    response.type === WorkerResponseType.SignTransactionsWithActionsSuccess ||
    response.type === WorkerResponseType.SignDelegateActionSuccess ||
    response.type === WorkerResponseType.SignNep413MessageSuccess ||
    response.type === WorkerResponseType.DeriveThresholdEd25519ClientVerifyingShareSuccess
  );
}

export function isWorkerError<T extends RequestTypeKey>(
  response: WorkerResponseForRequest<T>,
): response is WorkerErrorResponse {
  return (
    response.type === WorkerResponseType.SignTransactionsWithActionsFailure ||
    response.type === WorkerResponseType.SignDelegateActionFailure ||
    response.type === WorkerResponseType.SignNep413MessageFailure ||
    response.type === WorkerResponseType.DeriveThresholdEd25519ClientVerifyingShareFailure
  );
}

// === SPECIFIC TYPE GUARDS FOR COMMON OPERATIONS ===
