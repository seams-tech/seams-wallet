// Trusted Wallet-host API used by the separately installed VoiceID implementation.
// Keep these exports in the host bundle so the plugin shares Wallet state and workers.
export const VOICE_ID_HOST_API_VERSION = 2;
export type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
export type { WalletCapabilitySubjectV1 } from '@shared/device-linking/contracts';
export {
  type RegistrationCapability,
  type RegistrationWebContext,
} from './SeamsWeb/signingSurface/types';
export { authMenuSuccessCopy } from './SeamsWeb/walletIframe/host/auth-menu/domain';
export {
  type WalletIframeSurfaceMeasurementReporter,
  createWalletIframeSurfaceMeasurementReporter,
} from './SeamsWeb/walletIframe/host/surface-measurement-reporter';
export { backIcon } from './SeamsWeb/walletIframe/host/ui/auth-menu/icons';
export { walletForHostRequest } from './SeamsWeb/walletIframe/host/walletMutationGuard';
export {
  type ConfiguredWalletHost,
  walletHostExecutionFingerprint,
} from './SeamsWeb/walletIframe/shared/configuration';
export { type ParentToChildEnvelope } from './SeamsWeb/walletIframe/shared/messages';
export {
  TransactionReviewError,
  type TransactionReviewWire,
  parseTransactionReviewWire,
} from './SeamsWeb/walletIframe/shared/transactionReview';
export {
  availabilityKey,
  parseStoredAuthMethodAvailability,
  readAuthMethodEnabled,
} from './core/authMethods/availability';
export {
  type AuthMethodApprovalResult,
  type AuthMethodCaptureMount,
  type AuthMethodCaptureSettlement,
  type AuthMethodNearInstallation,
  type AuthMethodSessionInstaller,
  type AuthMethodUnlockSuccess,
  type WalletAuthMethodHostPlugin,
} from './core/authMethods/hostPlugin';
export { type VoiceIdAuthMethodPlugin } from './core/authMethods/plugins';
export {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from './core/browser/walletIframe/csp-stylesheet';
export { resolveNearNetwork } from './core/config/chains';
export { IndexedDBManager } from './core/indexedDB';
export { SEAMS_WALLET_STORES } from './core/indexedDB/schemaNames';
export {
  parseWalletAuthMethodV2StorageRow,
  parseWalletAuthorityStorageRow,
  parseWalletSelectionStorageRow,
} from './core/indexedDB/seamsWalletDB/repositories';
export { walletSessionAuthorizations } from './core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
export {
  buildRelayerJsonPostRequestInit,
  buildWalletSessionAuthorizationHeaders,
  fetchWithWalletHomeDiscovery,
  normalizeRelayerBaseUrl,
} from './core/rpcClients/relayer/relayerHttp';
export { createRelayerExactWalletSessionStatusPort } from './core/rpcClients/relayer/walletSessionAuthorizationStatus';
export {
  buildWebauthnP256SignatureWasm,
  decodeCoseP256PublicKeyWasm,
} from './core/signingEngine/chains/evm/evmCryptoWasm';
export { parseEd25519YaoRecoveryCapabilityV1 } from './core/signingEngine/session/passkey/ed25519YaoRecoveryCapability';
export { SeamsWordmark } from './core/signingEngine/uiConfirm/ui/preact/SeamsWordmark';
export { type UiConfirmSurfaceMeasurementBinding } from './core/signingEngine/uiConfirm/uiConfirm.types';
export { type WalletCustodyCeremonyTransportPort } from './core/signingEngine/walletCustody/ceremonyStepRunner';
export { parseResealedEnvelopeResult } from './core/signingEngine/walletCustody/resealedEnvelopeResult';
export {
  readUnlockedWalletEd25519ExportRootCapabilityV1,
  walletCustodyCeremonyTransportFromWorkerContextV1,
} from './core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
export { type WorkerOperationContext } from './core/signingEngine/workerManager/executeWorkerOperation';
export { WorkerDeferred } from './core/signingEngine/workerManager/workerDeferred';
export { type UnlockedWalletEd25519ExportRootCapabilityV1 } from './core/signingEngine/workerManager/workerTypes';
export { type WalletSessionId } from '@shared/authorization/capabilityKinds';
export {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
export {
  type VoiceIdDeviceAssertion,
  type VoiceIdDevicePublicKeyB64u,
  type VoiceIdWalletSessionChallenge,
  parseVoiceIdDeviceAssertion,
  parseVoiceIdDevicePublicKeyB64u,
  parseVoiceIdWalletSessionChallenge,
  voiceIdWalletSessionChallengeBytes,
} from '@shared/authorization/voiceIdDeviceAssertion';
export { type OwnerDeviceSummaryV1, parseLinkedDeviceListResultV1 } from '@shared/device-linking';
export {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
} from '@shared/device-linking/activeWalletSession';
export {
  type ActiveWalletSessionV1,
  type WalletSessionOperationCredentialV1,
} from '@shared/device-linking/contracts';
export { ActionType } from '@shared/near/actions';
export {
  type VoiceIdSeedEnvelope,
  buildMethodBoundEnvelopeOwnership,
  buildPasskeyCustodyEnvelopeRecord,
  buildVoiceIdEnvelopeFactor,
  buildWalletCustodySeedBinding,
  custodyEnvelopeBindingJsonV1,
  isVoiceIdSeedEnvelope,
  parseEnvelopeRevision,
  parsePasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
export { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
export {
  type DigestB64u,
  parseDigestB64u,
  sha256DigestB64u,
} from '@shared/utils/canonicalPrimitives';
export { alphabetizeStringify } from '@shared/utils/digests';
export {
  type PasskeyEnvelopeId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
  allocateWalletAuthMethodId,
  mpcMaterialActivationRefsEqual,
  parsePasskeyEnvelopeId,
  parseWalletAuthMethodId,
  parseWalletId,
} from '@shared/utils/domainIds';
export { toError } from '@shared/utils/errors';
export { rejectUnknownFields } from '@shared/utils/exactRecord';
export { joinNormalizedUrl } from '@shared/utils/normalize';
export { secureRandomId } from '@shared/utils/secureRandomId';
export { isFiniteNumber, isPlainObject, requireRecord } from '@shared/utils/validation';
export { type Variant } from '@shared/utils/variant';
export {
  type ActiveVoiceIdWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
  parseWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
