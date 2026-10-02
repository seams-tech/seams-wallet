import type { TransactionContext } from './rpc.js';
import type { ActionArgsWasm } from './actions.js';
import type {
  FinalizeEcdsaClientBootstrapCommand as GeneratedFinalizeEcdsaClientBootstrapCommand,
  FinalizeEcdsaClientBootstrapOutput as GeneratedFinalizeEcdsaClientBootstrapOutput,
  PrepareEcdsaClientBootstrapCommand as GeneratedPrepareEcdsaClientBootstrapCommand,
  PrepareEcdsaClientBootstrapOutput as GeneratedPrepareEcdsaClientBootstrapOutput,
} from '../platform/generated/signerCoreCommands.js';

// The NEAR transaction and delegate shapes the signer WASM returns. It serializes plain
// objects; these types are the ones its bindings declared when the same structs were also
// exported as classes, so `free` and `to_borsh_bytes` stay part of the declared shape.
interface WasmPublicKey {
  free(): void;
  keyType: number;
  keyData: Uint8Array;
}

export interface WasmSignature {
  free(): void;
  keyType: number;
  signatureData: Uint8Array;
}

export interface WasmTransaction {
  free(): void;
  signerId: string;
  publicKey: WasmPublicKey;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  actions: any;
}

interface WasmSignedTransaction {
  free(): void;
  transaction: WasmTransaction;
  signature: WasmSignature;
  borshBytes: Uint8Array;
}

interface WasmDelegateAction {
  free(): void;
  senderId: string;
  receiverId: string;
  actions: any;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: WasmPublicKey;
}

export interface WasmSignedDelegate {
  free(): void;
  to_borsh_bytes(): Uint8Array;
  delegateAction: WasmDelegateAction;
  signature: WasmSignature;
  borshBytes: Uint8Array;
}

export enum WorkerRequestType {
  SignTransactionsWithActions = 0,
  SignNep413Message = 1,
  SignDelegateAction = 2,
}

export enum WorkerResponseType {
  SignTransactionsWithActionsSuccess = 0,
  SignNep413MessageSuccess = 1,
  SignDelegateActionSuccess = 2,
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

type SignerWorkerResponseType = WorkerResponseType;

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

export type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapRequest =
  GeneratedPrepareEcdsaClientBootstrapCommand;
export type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapResult =
  GeneratedPrepareEcdsaClientBootstrapOutput;
export type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapRequest =
  GeneratedFinalizeEcdsaClientBootstrapCommand;
export type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapResult =
  GeneratedFinalizeEcdsaClientBootstrapOutput;
export interface DelegatePayload {
  senderId: string;
  receiverId: string;
  actions: ActionArgsWasm[];
  nonce: string;
  maxBlockHeight: string;
  publicKey: string;
}

// The NEAR signing results the Router A/B flows build. The signer WASM used to return these
// shapes, so the accessor pairs and `free` are the ones its bindings declared.
interface NearTransactionSignResult {
  free(): void;
  success: boolean;
  get transactionHashes(): string[] | undefined;
  set transactionHashes(value: string[] | null | undefined);
  get signedTransactions(): WasmSignedTransaction[] | undefined;
  set signedTransactions(value: WasmSignedTransaction[] | null | undefined);
  logs: string[];
  get error(): string | undefined;
  set error(value: string | null | undefined);
}

interface NearDelegateSignResult {
  free(): void;
  success: boolean;
  get hash(): string | undefined;
  set hash(value: string | null | undefined);
  get signedDelegate(): WasmSignedDelegate | undefined;
  set signedDelegate(value: WasmSignedDelegate | null | undefined);
  logs: string[];
  get error(): string | undefined;
  set error(value: string | null | undefined);
}

interface NearNep413SignResult {
  free(): void;
  accountId: string;
  publicKey: string;
  signature: string;
  get state(): string | undefined;
  set state(value: string | null | undefined);
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
interface RequestResponseMap {
  [WorkerRequestType.SignTransactionsWithActions]: NearTransactionSignResult;
  [WorkerRequestType.SignDelegateAction]: NearDelegateSignResult;
  [WorkerRequestType.SignNep413Message]: NearNep413SignResult;
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
