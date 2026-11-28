export { parseWalletMoveId } from './SeamsWeb/publicApi/placement';
export type {
  WalletMoveId,
  WalletMoveRequest,
  WalletMoveStatus,
  WalletMoveStatusResult,
  WalletPlacement,
  WalletPlacementCapability,
  WalletPlacementResult,
  WalletRegion,
} from './SeamsWeb/publicApi/placement';
export { SeamsWeb } from './SeamsWeb';
export type {
  WalletAuthMethodPlugin,
  VoiceIdAuthMethodPlugin,
} from './core/authMethods/plugins';
export type {
  SpokenApprovalPlugin,
  SpeakToSignNetwork,
  WalletApprovalPlugin,
} from './core/transactionFeatures/plugins';
export { spoken } from './core/transactionFeatures/plugins';
export type {
  SpeakToSignBetRequest,
  SpeakToSignDelegateRequest,
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignPrepareResult,
  SpeakToSignHostPlugin,
  SpeakToSignMessageRefusalReason,
  SpeakToSignMessageRequest,
  SpeakToSignNoteRefusalReason,
  SpeakToSignNoteRequest,
  SpeakToSignProgress,
  SpeakToSignRefusalReason,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignRatingRequest,
  SpeakToSignSignedMessage,
  SpeakToSignTransactionRequest,
  SpeakToSignTransferRequest,
  SpeakToSignTransferTimes,
  SpeakToSignUnavailableReason,
} from './core/transactionFeatures/hostPlugin';
export {
  MAX_SUMMARY_WORDS,
  summaryRefusal,
  type NoteRating,
  type SummaryRefusal,
} from './core/transactionFeatures/spokenNote';
export type {
  SpeakToSignCall,
  SpeakToSignResult,
  SpeakToSignSentTransaction,
} from './SeamsWeb/publicApi/speakToSign';
export type {
  NearCapability,
  SpokenApproval,
  SpokenCalls,
  SpokenPrepareRequest,
  SpokenNearSigner,
} from './SeamsWeb/publicApi/spoken';
export { normalizeWalletLocale } from './core/ui/locale';
export type { WalletLocale } from './core/ui/locale';
export type {
  AuthMenuCapability,
  ClientConnectionState,
  ConfigCapability,
  ConnectionCapability,
  EventsCapability,
} from './SeamsWeb';
export type {
  ExternalAuthenticateInput,
  ExternalAuthAttempt,
  ExternalAuthResult,
  ExternalWalletAuthentication,
  ExternalWalletSettings,
} from '@shared/auth/externalAuth';
export {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuExternalAuthRequestIdFromBoundary,
  hostedAuthMenuSessionIdFromBoundary,
} from './SeamsWeb/walletIframe/shared/messages';
export type {
  HostedAuthMenuCopy,
  HostedAuthMenuCopyInput,
  HostedAuthMenuFooterBrand,
  HostedAuthMenuRecoveryOptions,
  HostedAuthMenuExternalAuthEvidence,
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuExternalAuthRequestId,
  HostedAuthMenuExternalAuthResolutionInput,
  HostedAuthMenuExternalProvider,
  HostedAuthMenuMode,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuRegistrationAccountInput,
  HostedAuthMenuSessionId,
} from './SeamsWeb/walletIframe/shared/messages';
export type {
  WalletStepChrome,
  WalletStepEvents,
  WalletStepExit,
  WalletStepPress,
  WalletStepProgress,
  WalletStepSize,
  WalletStepTransition,
} from './SeamsWeb/walletIframe/shared/walletStep';
export type {
  AnchoredSurfaceLayer,
  AnchoredSurfaceStep,
} from './SeamsWeb/walletIframe/client/anchoredSurface';
export type {
  AnchoredWalletPresentation,
  WalletSurfacePresentation,
} from './SeamsWeb/walletIframe/shared/walletStep';
export type {
  AuthMenuModalSteps,
  MountedWalletSurface,
  WalletSurfaceMountOptions,
  WalletSurfaceSend,
  WalletSurfacesCapability,
} from './SeamsWeb/publicApi/surfaces';
export type {
  WalletModalAfterControls,
  WalletModalBeforeControls,
  WalletModalSteps,
} from './SeamsWeb/publicApi/walletModalSteps';
export { BrowserCapabilityUnavailableError } from './SeamsWeb/publicApi/capabilitySelection';
export type {
  BrowserCapabilitySelectionResult,
  BrowserCapabilityUnavailableReason,
  BrowserCapabilityUnavailableSelection,
} from './SeamsWeb/publicApi/capabilitySelection';
export type {
  WalletIframeExactSessionIdentity,
  WalletIframeExactSessionState,
} from './SeamsWeb/walletIframe/shared/exactSessionState';

export * from './config';
export {
  defineSeamsConfig,
  seamsTestnetConfig,
  type DefineSeamsConfigInput,
  type SeamsRequiredConfigInput,
} from './core/config/defineConfig';

// === Boundary references (exact subject + target for every wallet operation) ===
export {
  configuredThresholdEcdsaChainTargets,
  nearAccountRefFromAccountId,
  thresholdEcdsaChainTargetFromChainFamily,
  thresholdEcdsaChainTargetFromConfig,
  thresholdEcdsaChainTargetFromConfiguredRequest,
  thresholdEcdsaChainTargetFromRequest,
  thresholdEcdsaChainTargetKey,
  thresholdEcdsaChainTargetsEqual,
  toWalletId,
  walletIdFromWalletProfile,
  walletSessionRefFromSession,
} from './boundary/walletRefs';
export type {
  EcdsaCommandSubject,
  EvmEip155ChainTarget,
  NearAccountRef,
  NearCommandSubject,
  TempoChainTarget,
  ThresholdEcdsaChainTarget,
  WalletId,
  WalletSessionRef,
} from './boundary/walletRefs';

export { PASSKEY_MANAGER_DEFAULT_CONFIGS } from './core/config/defaultConfigs';
export { buildConfigsFromEnv } from './core/config/defaultConfigs';
export type {
  AddSignerIntentV1,
  RegistrationIntentGrant,
  RegistrationIntentV1,
  WalletId as RegistrationWalletId,
} from '@shared/utils/registrationIntent';
export type {
  AddSignerSelection,
  RegistrationEvmFamilyEcdsaSignerRequest,
  RegistrationNearEd25519SignerRequest,
  RegistrationSignerRequest,
  RegistrationSignerSetSelection,
  ThresholdEcdsaAddSignerSpec,
  ThresholdEd25519AddSignerSpec,
} from '@shared/utils/registrationSignerPlan';
export type { RegisterWalletInput } from '@shared/utils/registrationAuthMethodInput';

export type {
  SeamsConfigsReadonly,
  SeamsClientConfig,
  SeamsConfigsInput,
  // Registration
  AddedEvmFamilyEcdsaSignerCapability,
  AddedNearEd25519SignerCapability,
  RegisteredEvmFamilyEcdsaCapability,
  RegisteredNearEd25519Capability,
  RegistrationResult,
  NearProvisioningState,
  // Login
  LoginResult,
  LoginAndCreateSessionResult,
  WalletSession,
  SigningSessionStatus,
  // Actions
  ActionResult,
} from './core/types/seams';

export type {
  // Hooks Options
  LoginHooksOptions,
  KeyExportHooksOptions,
  RegistrationHooksOptions,
  ActionHooksOptions,
  SignNEP413HooksOptions,
  AfterCall,
  EventCallback,
  RegistrationTimingSpanV1,
  NearProvisioningStateChangedEvent,
} from './core/types/sdkSentEvents';

// === Email OTP wallet auth flow ===
// The flow is a plain `seams.auth.*` client call with nothing React-specific
// about it, so its types belong on the main entry too.
export type {
  GoogleEmailOtpWalletAuthDelivery,
  GoogleEmailOtpWalletAuthEcdsaTargets,
  GoogleEmailOtpWalletAuthFailure,
  GoogleEmailOtpWalletAuthFailureCode,
  GoogleEmailOtpWalletAuthFlow,
  GoogleEmailOtpWalletAuthLoginTarget,
  GoogleEmailOtpWalletAuthLoginFlow,
  RequestEmailCodeInput,
  GoogleEmailOtpWalletAuthPromptCopy,
  GoogleEmailOtpWalletAuthRegistrationCompleted,
  GoogleEmailOtpWalletAuthRegistrationFlow,
  GoogleEmailOtpWalletAuthRequestedMode,
  GoogleEmailOtpWalletAuthResolvedMode,
  GoogleEmailOtpWalletAuthResult,
  GoogleEmailOtpWalletAuthStartInput,
  GoogleEmailOtpWalletAuthSubmitSuccess,
} from './SeamsWeb';
export type { DemoEmailOtpCodeResponse } from './SeamsWeb';
export type { EmailOtpAuthPolicy } from './core/types/seams';
export {
  MinimalNearClient,
  encodeSignedTransactionBase64,
  type NearClient,
  type AccessKeyList,
} from './core/rpcClients/near/NearClient';

export { DEFAULT_WAIT_STATUS } from './core/types/rpc';

// === Device Linking Types ===
export {
  AccountSyncEventPhase,
  KeyExportEventPhase,
  LinkDeviceEventPhase,
  RegistrationEventPhase,
  SigningEventPhase,
  UnlockEventPhase,
  WALLET_FLOW_EVENT_MESSAGES,
  WALLET_FLOW_EVENT_STEPS,
  WALLET_FLOW_EVENT_VERSION,
  createAccountSyncFlowEvent,
  createKeyExportFlowEvent,
  createLinkDeviceFlowEvent,
  createRegistrationFlowEvent,
  createSigningFlowEvent,
  createUnlockFlowEvent,
  createWalletFlowEvent,
  isWalletFlowEvent,
} from './core/types/sdkSentEvents';
export type {
  AccountSyncFlowEvent,
  KeyExportFlowEvent,
  LinkDeviceFlowEvent,
  RegistrationFlowEvent,
  SigningFlowEvent,
  UnlockFlowEvent,
  WalletFlowEvent,
  WalletFlowEventBase,
  WalletFlowEventInteraction,
  WalletFlowEventStatus,
} from './core/types/sdkSentEvents';
export type {
  DeviceLinkingSession,
  LinkDeviceResult,
  DeviceLinkingError,
  DeviceLinkingErrorCode,
  LinkedDeviceEmailOtpActivationStateV1,
  LinkedDeviceTargetEmailOtpActivationV1,
  LinkedDeviceTargetFactorActivationV1,
  LinkedDeviceTargetFactorV1,
  LinkedDeviceTargetPasskeyActivationV1,
  StartDevice2LinkingFlowArgs,
  StartDevice2LinkingFlowResults,
  StartDeviceLinkingOptionsDevice2,
} from './core/types/linkDevice';
export type {
  LinkedDeviceListRequestV1,
  LinkedDeviceListResultV1,
  LinkedDeviceManagementRequestV1,
  LinkedDeviceRevokeRequestV1,
  LinkedDeviceRevokeResultV1,
  LinkedDeviceSummaryV1,
  QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking';

// === AccountID Types ===
export type { AccountId } from './core/types/accountIds';
export { toAccountId } from './core/types/accountIds';

export type {
  SignNEP413MessageParams,
  SignNEP413MessageResult,
} from './core/types/sdkPublicResults';

// === Action Types ===
export { ActionType } from './core/types/actions';
export type {
  ActionArgs,
  FunctionCallAction,
  TransferAction,
  CreateAccountAction,
  DeployContractAction,
  StakeAction,
  AddKeyAction,
  DeleteKeyAction,
  DeleteAccountAction,
} from './core/types/actions';

// === Action builders ===
export {
  addKey,
  createAccount,
  deleteAccount,
  deleteKey,
  deployContract,
  functionCall,
  stake,
  transfer,
} from './core/types/actionBuilders';
export { AmountError, parseEther, parseNear, parseUnits, yoctoNear } from './core/types/amounts';
export type { AmountErrorCode, NearAmount, YoctoNear } from './core/types/amounts';

// === Event logging ===
export { logWalletEvents } from './core/types/eventLogging';

// === ERROR TYPES ===

// === CONFIRMATION TYPES ===
export type {
  ConfirmationConfig,
  ConfirmationUIMode,
  ConfirmationBehavior,
} from './core/types/signer-worker';

export type { OwnerNearOperation, OwnerNearOperationState, OwnerNearRecovery, OwnerNearOutcome, NearTransactionRejection, OwnerNearReplacementProof, OwnerNearRetirementProof, OwnerNearRetirementWait, OwnerNearShortfall, OwnerNearSubmissionEvidence, OwnerNearUnverifiedExecutionProof, PrepareOwnerNearTransaction, ResumeOwnerNearTransaction } from './SeamsWeb/publicApi/ownerNearOperation';

export { parseOwnerNearRecovery } from './SeamsWeb/walletIframe/shared/ownerNearOperation';

export type {
  WalletAlternatives,
  WalletAlternativeDescriptor,
  WalletConnectionRequest,
  WalletConnectionResolutionInput,
  WalletConnectionResult,
} from './SeamsWeb/walletIframe/shared/walletAlternatives';

// === NEAR and EVM RPC clients, encoders and Tempo fee tokens ===
export {
  createEvmClient,
  parseRpcHexQuantity as parseEvmRpcHexQuantity,
  type EvmClient,
  type EvmTransactionReceipt,
  type EvmBlockHeader,
  type WaitForEvmTransactionReceiptArgs,
} from '@shared/utils/evmClient';
export { base64UrlEncode, base64UrlDecode } from '@shared/utils/base64';
export { keccak256Bytes } from '@shared/utils/keccak';
export { normalizeLowercaseString, normalizeTrimmedString } from '@shared/utils/normalize';
export {
  DEFAULT_WALLET_SESSION_REMAINING_USES,
  DEFAULT_WALLET_SESSION_TTL_MS,
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
} from '@shared/threshold/sessionPolicy';
export {
  DEFAULT_TENANT_WALLET_SESSION_LIMITS,
  parseWalletSessionLimits,
  type WalletSessionLimits,
} from '@shared/threshold/walletSessionBudget';
export { parseWebAuthnRpId, type WebAuthnRpId } from '@shared/utils/domainIds';
export { createIntentId } from './core/idempotency/createIntentId';
export {
  TEMPO_FEE_MANAGER_CONTRACT,
  TEMPO_FEE_MANAGER_ABI,
  TEMPO_ALPHA_USD_FEE_TOKEN,
  TEMPO_SET_USER_TOKEN_SELECTOR,
  TEMPO_USER_TOKENS_SELECTOR,
  TEMPO_TOKEN_CURRENCY_SELECTOR,
  TEMPO_TOKEN_PAUSED_SELECTOR,
  encodeTempoSetUserTokenCalldata,
  encodeTempoUserTokensCalldata,
  decodeTempoUserTokenResult,
  buildTempoSetUserTokenCall,
  buildTempoSetUserTokenRequest,
  readTempoFeeTokenPreference,
  validateTempoFeeToken,
  type TempoFeeTokenValidation,
} from './core/signingEngine/chains/tempo/feeToken';

// === Threshold session policy and PRF salts ===
export {
  THRESHOLD_SESSION_POLICY_VERSION,
  buildEd25519SessionPolicy,
  computeEd25519SessionPolicyDigest32,
  type Ed25519SessionPolicy,
} from './core/signingEngine/threshold/sessionPolicy';
export {
  PRF_FIRST_SALT_V1,
  PRF_SECOND_SALT_V1,
} from './core/signingEngine/threshold/crypto/prfSalts';
export { computeThresholdEcdsaKeygenIntentDigest } from './utils/intentDigest';

// === A signing runtime built from explicit platform ports ===
export type {
  SigningRuntime,
  SigningRuntimeConfig,
  SigningRuntimeDeps,
  SigningRuntimeEcdsaStatePorts,
  SigningRuntimeServices,
  SigningRuntimeStatePorts,
  SigningRuntimeUiDeps,
  SigningRuntimeWarmSessionUiPorts,
} from './core/runtime';
export { createSigningRuntime, createSigningRuntimeStatePorts } from './core/runtime';
export type {
  AuthenticatorPort,
  ClockPort,
  DurableRecordStore,
  HttpTransport,
  RuntimePortsKind,
  RuntimePorts,
  RandomSource,
  SecureSecretStore,
  SignerCryptoPort,
} from './core/platform/types';
