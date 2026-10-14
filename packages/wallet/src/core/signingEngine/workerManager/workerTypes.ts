import type { WalletCustodyCeremonyWorkerOperationMap } from './walletCustodyWorkerChannels';
export type {
  WalletCustodyCeremonyWorkerOperationMap,
  UnlockedWalletEd25519ExportRootCapabilityV1,
  UnlockedEd25519ExportRootLinkingCapabilityV1,
  UnlockedWalletEd25519ExportRootCapabilityDestroyScopeV1,
} from './walletCustodyWorkerChannels';
import {
  type NearWorkerProgressEvent,
  NearSignerWorkerCustomRequestType,
  type ThresholdEd25519ComputeNep413SigningDigestRequest,
  type ThresholdEd25519ComputeSigningDigestResult,
  type ThresholdEd25519BuildDelegateSigningPayloadRequest,
  type ThresholdEd25519BuildDelegateSigningPayloadResult,
  type ThresholdEd25519FinalizeDelegateFromSignatureRequest,
  type ThresholdEd25519FinalizeNearTxFromSignatureRequest,
  type ThresholdEd25519FinalizeNearTxFromSignatureResult,
  type ThresholdEd25519BuildNearTxUnsignedBorshRequest,
  type ThresholdEd25519NearTxUnsignedBorsh,
  type ThresholdEd25519DecodeSignedNearTxBorshRequest,
  type ThresholdEd25519DecodeSignedNearTxBorshResult,
  type WorkerResponseDiagnostics,
  type DelegatePayload,
  type WasmSignedDelegate,
  type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapRequest,
  type WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapResult,
  type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapRequest,
  type WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapResult,
} from '@/core/types/signer-worker';
import type { MultichainWorkerKind } from '@/core/walletRuntimePaths/multichainWorkers';
import type { ThresholdEcdsaChainTarget } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { MpcMaterialActivationRef, ThresholdEd25519SessionId } from '@shared/utils/domainIds';
import type {
  PasskeyCustodyEnvelopeRecord,
  WalletCustodyEvmFamilyPublicFacts,
} from '@shared/passkey-custody';
import type {
  EcdsaRoleLocalPersistedMaterialRef,
  SigningSessionSealKeyVersion,
} from '@/core/signingEngine/session/keyMaterialBrands';
import type { EcdsaClientPresignPoolIdentity } from './ecdsaPresignPoolIdentity';
import type {
  EcdsaClientPresignAdmissionStorage,
  EcdsaClientPresignReservationResult,
} from './ecdsaPresignLifecycle';
import type { ThresholdRuntimePolicyScope } from '../threshold/sessionPolicy';
import type { WalletEmailOtpChannel } from '@shared/utils/emailOtpDomain';
import type {
  EmailOtpChallengeDelivery,
  EmailOtpUnlockSignerSelection,
  EmailOtpVerifiedAuthorityProjection,
} from '../session/emailOtp/publicTypes';
import type { EmailOtpRoutePlan } from '../stepUpConfirmation/otpPrompt/authLane';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { EcdsaRoleLocalReadyStateBlob } from '@/core/platform';
import type {
  CloseRouterAbEcdsaPostRegistrationCeremonyRequestV1,
  CloseRouterAbEcdsaPostRegistrationCeremonyResultV1,
  CreateRouterAbEcdsaPostRegistrationCeremonyRequestV1,
  CreateRouterAbEcdsaPostRegistrationCeremonyResultV1,
  FinalizeRouterAbEcdsaExplicitExportRequestV1,
  FinalizeRouterAbEcdsaExplicitExportResultV1,
  RehydrateEcdsaRoleLocalSigningMaterialRequestV1,
  RehydrateEcdsaRoleLocalSigningMaterialResultV1,
  VerifyRouterAbEcdsaPostRegistrationProofsRequestV1,
  VerifyRouterAbEcdsaPostRegistrationProofsResultV1,
  SignWalletRecoveryEcdsaMaterialPossessionProofRequestV1,
  SignWalletRecoveryEcdsaMaterialPossessionProofResultV1,
  PrepareLinkedDeviceEcdsaSourceContributionRequestV1,
  PrepareLinkedDeviceEcdsaSourceContributionResultV1,
  CreateEcdsaHolderOrdinaryExportRequestV1,
  CreateEcdsaHolderOrdinaryExportResultV1,
  FinalizeEcdsaHolderOrdinaryExportRequestV1,
  FinalizeEcdsaHolderOrdinaryExportResultV1,
} from '@/core/signingEngine/workerManager/ecdsaClientWorkerChannels';
import type {
  Ed25519OperationStepUpProof,
  IssuedEd25519OperationStepUpAuthorization,
} from '../threshold/ed25519/walletSession';
import type {
  CloseRouterAbEcdsaRegistrationCeremonyRequestV1,
  CloseRouterAbEcdsaRegistrationCeremonyResultV1,
  CreateRouterAbEcdsaRegistrationCeremonyRequestV1,
  CreateRouterAbEcdsaRegistrationCeremonyResultV1,
  FinalizeRouterAbEcdsaRegistrationActivationRequestV1,
  FinalizeRouterAbEcdsaRegistrationActivationResultV1,
  PersistInitialCanonicalEcdsaActivationRequestV1,
  PersistInitialCanonicalEcdsaActivationResultV1,
  ReconcileCanonicalEcdsaActivationRequestV1,
  ReconcileCanonicalEcdsaActivationWorkerResultV1,
  VerifyRouterAbEcdsaRegistrationClientProofsRequestV1,
  VerifyRouterAbEcdsaRegistrationClientProofsResultV1,
} from '@/core/signingEngine/routerAb/ecdsaDerivation/clientCeremony';
import type {
  RouterAbEd25519YaoActiveClientMetadataV1,
  RouterAbEd25519YaoClientSigningInputV1,
  RouterAbEd25519YaoClientSigningShareV1,
} from '../threshold/ed25519/yaoClient';
import {
  ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1,
  type RouterAbEd25519YaoApplicationBindingFactsV1,
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoBytes32V1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type { ExactWalletSessionAuthorization } from '../session/persistence/walletSessionAuthorizationProjection';
import type { WalletRegistrationEd25519YaoSignerRuntimeBootstrap } from '@shared/utils/registrationContracts';
import type { WalletRecoverySetRotationWorkerResultV1 } from '@shared/wallet-recovery/walletRecoveryRotation';
import type {
  RouterAbEcdsaCredentialFreeSessionActivationResponseV1,
  RouterAbEcdsaPostRegistrationSessionActivationPolicyV1,
  RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
  RouterAbEcdsaDerivationPublicCapabilityV1,
  RouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { LoadedWalletCustodyEd25519MaterialV1 } from '../walletCustody/ed25519SeedMaterial';
import type { WalletCustodyCacheEnvelopeV1 } from '../walletCustody/openCustodyCache';
import type { RouterAbNormalSigningPrepareRequestV2Wire } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking';

export type EmailOtpAuthoritySelector =
  | { readonly kind: 'wallet' }
  | {
      readonly kind: 'wallet_auth_method';
      readonly walletAuthMethodId: string;
    };

export type EmailOtpEd25519YaoRecoveryAugmentationV1 = {
  readonly kind: typeof ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1;
  readonly signerSlot: number;
  readonly remainingUses: number;
  readonly orgId: string;
};

export type EmailOtpEd25519YaoActiveCapabilityDescriptorV1 = {
  readonly kind: 'router_ab_ed25519_yao_active_capability_v1';
  readonly materialActivation: MpcMaterialActivationRef;
  readonly activeCapabilityBinding: RouterAbEd25519YaoBytes32V1;
  readonly registeredPublicKey: RouterAbEd25519YaoBytes32V1;
  readonly signingWorkerVerifyingShare: RouterAbEd25519YaoBytes32V1;
  readonly nearAccountId: string;
  readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
  readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
  readonly participantIds: readonly [number, number];
  readonly lifecycle: {
    readonly lifecycleId: string;
    readonly rootShareEpoch: string;
    readonly accountId: string;
    readonly thresholdSessionId: ThresholdEd25519SessionId;
    readonly signerSetId: string;
    readonly signingWorkerId: string;
  };
  readonly stateEpoch: number;
  readonly registrationContinuity:
    | {
        readonly kind: 'registration';
        readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
        readonly admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
        readonly activationTranscript: readonly number[];
      }
    | {
        readonly kind: 'recovery';
        readonly activationTranscript: readonly number[];
      };
};

export type EmailOtpEd25519YaoExportMaterialV1 =
  | {
      readonly kind: 'active_capability';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1;
    }
  | {
      readonly kind: 'sealed_custody';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly walletCustodyEd25519Material: LoadedWalletCustodyEd25519MaterialV1;
      readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
    }
  | {
      readonly kind: 'sealed_export_root';
      readonly materialActivation: MpcMaterialActivationRef;
      readonly capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1;
      readonly exportRootEnvelope: PasskeyCustodyEnvelopeRecord;
    };

export type EmailOtpEd25519YaoWorkerActivationResult = {
  readonly activeClientHandle: string;
  readonly metadata: RouterAbEd25519YaoActiveClientMetadataV1;
  readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
};

export type EmailOtpWalletCustodyEd25519MaterialRequest =
  | { readonly kind: 'found'; readonly material: LoadedWalletCustodyEd25519MaterialV1 }
  | { readonly kind: 'absent' };

export type EmailOtpEd25519YaoRecoveryBootstrapV1 = {
  readonly kind: typeof ROUTER_AB_ED25519_YAO_EMAIL_OTP_RECOVERY_BOOTSTRAP_KIND_V1;
  readonly session: WalletRegistrationEd25519YaoSignerRuntimeBootstrap;
  readonly capability: EmailOtpEd25519YaoActiveCapabilityDescriptorV1;
};

export type EmailOtpEcdsaCustodySignerV1 = {
  readonly chainTarget: ThresholdEcdsaChainTarget;
  readonly walletKey: {
    readonly walletId: string;
    readonly keyHandle: string;
    readonly ecdsaThresholdKeyId: string;
    readonly signingRootId: string;
    readonly signingRootVersion: string;
    readonly relayerKeyId: string;
    readonly contextBinding32B64u: string;
    readonly derivationClientSharePublicKey33B64u: string;
    readonly participantIds: readonly [number, number];
    readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  };
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
};

export type EmailOtpEcdsaCustodyContinuityV1 = {
  readonly kind: 'wallet_custody_ecdsa_sync_continuity_v1';
  readonly signers: readonly EmailOtpEcdsaCustodySignerV1[];
};

export type EmailOtpEcdsaCustodyRestoreV1 = {
  readonly continuity: EmailOtpEcdsaCustodyContinuityV1;
  readonly readyStateBlobB64u: string;
  readonly publicFacts: WalletCustodyEvmFamilyPublicFacts;
};

export type EmailOtpWalletUnlockMaterialRequest =
  | ({
      readonly kind: 'ecdsa';
      readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
      readonly walletSessionAuth?: never;
      readonly ed25519YaoRecovery?: never;
      readonly ed25519YaoCapability?: never;
      readonly providerSubject?: never;
    } & (
      | {
          readonly ecdsaSessionHandleBinding: Extract<
            EmailOtpEcdsaSessionBootstrapHandleBinding,
            { operation: 'wallet_unlock' }
          >;
          readonly ecdsaSessionPolicy: RouterAbEcdsaPostRegistrationSessionActivationPolicyV1;
        }
      | {
          readonly ecdsaSessionHandleBinding: Exclude<
            EmailOtpEcdsaSessionBootstrapHandleBinding,
            { operation: 'wallet_unlock' }
          >;
          readonly ecdsaSessionPolicy?: never;
        }
    ))
  | {
      readonly kind: 'ed25519_yao_recovery';
      readonly ed25519YaoRecovery: EmailOtpEd25519YaoRecoveryAugmentationV1;
      readonly providerSubject: string;
      readonly nearAccountId: string;
      readonly expectedOperationalPublicKey: string;
      readonly expectedThresholdSessionId: string;
      readonly walletCustodyEd25519Material: EmailOtpWalletCustodyEd25519MaterialRequest;
      readonly ecdsaSessionPolicy?: never;
      readonly walletSessionAuth?: never;
      readonly ecdsaSessionHandleBinding?: never;
      readonly runtimePolicyScope?: never;
      readonly ed25519YaoCapability?: never;
    }
  | {
      readonly kind: 'wallet_unlock_capabilities';
      readonly ecdsa: {
        readonly sessionHandleBinding: Extract<
          EmailOtpEcdsaSessionBootstrapHandleBinding,
          { operation: 'wallet_unlock' }
        >;
        readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
        readonly sessionPolicy: RouterAbEcdsaPostRegistrationSessionActivationPolicyV1;
      };
      readonly ed25519Yao: {
        readonly recovery: EmailOtpEd25519YaoRecoveryAugmentationV1;
        readonly providerSubject: string;
        readonly nearAccountId: string;
        readonly expectedOperationalPublicKey: string;
        readonly expectedThresholdSessionId: string;
        readonly walletCustodyEd25519Material: EmailOtpWalletCustodyEd25519MaterialRequest;
      };
      readonly walletSessionAuth?: never;
    };

export type EmailOtpWalletUnlockMaterialResult =
  | ({
      readonly kind: 'ecdsa';
      readonly emailOtpSessionHandle: EmailOtpEcdsaSessionBootstrapHandlePayload;
      readonly walletSessionAuthorization?: never;
      readonly pendingFactorHandle?: never;
      readonly ed25519YaoRecovery?: never;
    } & (
      | {
          readonly operation: 'wallet_unlock';
          readonly ecdsaSession: RouterAbEcdsaPostRegistrationSessionActivationResponseV1;
          readonly ecdsaCustody: EmailOtpEcdsaCustodyRestoreV1;
        }
      | {
          readonly operation: Exclude<EmailOtpWorkerSessionHandleOperation, 'wallet_unlock'>;
          readonly ecdsaSession?: never;
        }
    ))
  | {
      readonly kind: 'wallet_custody_cache_absent';
      readonly ed25519YaoRecovery: EmailOtpEd25519YaoRecoveryBootstrapV1;
      readonly emailOtpSessionHandle?: never;
      readonly walletSessionAuthorization?: never;
    }
  | {
      readonly kind: 'ed25519_yao_capability';
      readonly activeClientHandle: string;
      readonly metadata: RouterAbEd25519YaoActiveClientMetadataV1;
      readonly ed25519YaoCapability: EmailOtpEd25519YaoRecoveryBootstrapV1;
      readonly walletCustodyEd25519Material?: LoadedWalletCustodyEd25519MaterialV1;
      /** The export-root custody an unlock derives, for the unlocked capability. */
      readonly ed25519ExportRootCustody: {
        readonly existingEnvelope: PasskeyCustodyEnvelopeRecord;
        readonly factorSecret32: Uint8Array;
      };
      readonly walletSessionAuthorization: ExactWalletSessionAuthorization;
      readonly emailOtpSessionHandle?: never;
      readonly pendingFactorHandle?: never;
      readonly ed25519YaoRecovery?: never;
    }
  | {
      readonly kind: 'wallet_unlock_capabilities';
      readonly operation: 'wallet_unlock';
      readonly walletSessionAuthorization: ExactWalletSessionAuthorization;
      readonly ed25519ExportRootCustody: {
        readonly existingEnvelope: PasskeyCustodyEnvelopeRecord;
        readonly factorSecret32: Uint8Array;
      };
      readonly ecdsa: {
        readonly emailOtpSessionHandle: EmailOtpEcdsaSessionBootstrapHandlePayload;
        readonly session: RouterAbEcdsaCredentialFreeSessionActivationResponseV1;
        readonly custody: EmailOtpEcdsaCustodyRestoreV1;
      };
      readonly ed25519Yao:
        | {
            readonly kind: 'wallet_custody_cache_absent';
            readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
          }
        | {
            readonly kind: 'capability';
            readonly activeClientHandle: string;
            readonly metadata: RouterAbEd25519YaoActiveClientMetadataV1;
            readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
          };
    };

/**
 * Control messages exchanged between worker shims and the main thread.
 *
 * These messages are JS-only and do NOT go through the Rust WASM JSON request/response pipeline.
 * They are used for:
 * - Readiness signals for persisted signer-worker availability.
 */
export const WorkerControlMessage = {
  WORKER_READY: 'WORKER_READY',
} as const;

type ThresholdEcdsaPresignStage = 'triples' | 'triples_done' | 'presign' | 'done';

export type ThresholdEcdsaPresignProgressResult<Bytes = ArrayBuffer> = {
  outgoingMessages: Bytes[];
} & (
  | {
      stage: ThresholdEcdsaPresignStage;
      event: 'none' | 'triples_done';
      candidateBigR33?: never;
      presignatureHandle?: never;
      presignatureBigR33?: never;
    }
  | {
      stage: 'presign';
      event: 'final_batch_ready';
      candidateBigR33: Bytes;
      presignatureHandle?: never;
      presignatureBigR33?: never;
    }
  | {
      stage: 'done';
      event: 'presign_done';
      candidateBigR33?: never;
      presignatureHandle: string;
      presignatureBigR33: Bytes;
    }
);

export type ThresholdEcdsaPresignAbortResult = {
  kind: 'threshold_ecdsa_presign_session_aborted';
  sessionId: string;
};

export type RpcSignerWorkerProgressEvent = {
  phase: string;
  status: 'running' | 'succeeded' | 'failed';
  message: string;
  data?: Record<string, unknown>;
};

interface EvmCryptoWorkerOperationMap {
  computeEip1559TxHash: {
    payload: { tx: unknown };
    result: ArrayBuffer;
  };
  encodeEip1559SignedTxFromSignature65: {
    payload: { tx: unknown; signature65: ArrayBuffer };
    result: ArrayBuffer;
  };
  verifySecp256k1RecoverableSignatureAgainstPublicKey33: {
    payload: { digest32: ArrayBuffer; signature65: ArrayBuffer; publicKey33: ArrayBuffer };
    result: ArrayBuffer;
  };
  validateSecp256k1PublicKey33: {
    payload: { publicKey33: ArrayBuffer };
    result: ArrayBuffer;
  };
  addSecp256k1PublicKeys33: {
    payload: { left33: ArrayBuffer; right33: ArrayBuffer };
    result: ArrayBuffer;
  };
  buildWebauthnP256Signature: {
    payload: {
      challenge32: ArrayBuffer;
      authenticatorData: ArrayBuffer;
      clientDataJSON: ArrayBuffer;
      signatureDer: ArrayBuffer;
      pubKeyX32: ArrayBuffer;
      pubKeyY32: ArrayBuffer;
    };
    result: ArrayBuffer;
  };
  decodeCoseP256PublicKey: {
    payload: { cosePublicKey: ArrayBuffer };
    result: ArrayBuffer;
  };
}

interface TempoSignerWorkerOperationMap {
  computeTempoSenderHash: {
    payload: { tx: unknown };
    result: ArrayBuffer;
  };
  encodeTempoSignedTx: {
    payload: { tx: unknown; senderSignature: ArrayBuffer };
    result: ArrayBuffer;
  };
}

export type EmailOtpWorkerProgressCode =
  | 'otp.verify.succeeded'
  | 'signer.email_otp.enroll.started'
  | 'signer.email_otp.enroll.succeeded'
  | 'signer.ecdsa.bootstrap.started'
  | 'signer.ecdsa.bootstrap.prepared'
  | 'signer.ecdsa.bootstrap.responded'
  | 'signer.ecdsa.bootstrap.succeeded';

export type EmailOtpWorkerProgressEvent = {
  code: EmailOtpWorkerProgressCode;
};

export type EmailOtpWorkerSessionHandleOperation =
  | 'registration'
  | 'wallet_unlock'
  | 'sign'
  | 'export';

type EmailOtpEcdsaSessionBootstrapHandlePayloadBase = {
  kind: 'email_otp_worker_session_handle_v1';
  sessionId: string;
  walletId: string;
  authSubjectId: string;
  action: 'threshold_ecdsa_bootstrap';
  chainTarget: ThresholdEcdsaChainTarget;
};

type EmailOtpEcdsaRuntimeHandleOperation = Exclude<
  EmailOtpWorkerSessionHandleOperation,
  'registration'
>;

type EmailOtpEcdsaRuntimeSessionBootstrapHandlePayload = {
  [Operation in EmailOtpEcdsaRuntimeHandleOperation]: EmailOtpEcdsaSessionBootstrapHandlePayloadBase & {
    operation: Operation;
    keyHandle: string;
    evmFamilySigningKeySlotId?: never;
  };
}[EmailOtpEcdsaRuntimeHandleOperation];

export type EmailOtpEcdsaSessionBootstrapHandlePayload =
  EmailOtpEcdsaRuntimeSessionBootstrapHandlePayload;

export type EmailOtpWalletRegistrationEcdsaPrepareHandlePayload = {
  kind: 'email_otp_worker_session_handle_v1';
  sessionId: string;
  walletId: string;
  evmFamilySigningKeySlotId: string;
  authSubjectId: string;
  action: 'wallet_registration_ecdsa_prepare';
  operation: 'registration';
  keyScope: 'evm-family';
  chainTarget: ThresholdEcdsaChainTarget;
};

type EmailOtpEcdsaSessionBootstrapHandleBindingBase = {
  authSubjectId: string;
  action?: 'threshold_ecdsa_bootstrap';
  chainTarget: ThresholdEcdsaChainTarget;
};

type EmailOtpEcdsaRuntimeSessionBootstrapHandleBinding = {
  [Operation in EmailOtpEcdsaRuntimeHandleOperation]: EmailOtpEcdsaSessionBootstrapHandleBindingBase & {
    operation: Operation;
    keyHandle: string;
    evmFamilySigningKeySlotId?: never;
  };
}[EmailOtpEcdsaRuntimeHandleOperation];

export type EmailOtpEcdsaSessionBootstrapHandleBinding =
  EmailOtpEcdsaRuntimeSessionBootstrapHandleBinding;

export type EmailOtpWalletRegistrationEcdsaPrepareHandleBinding = {
  evmFamilySigningKeySlotId: string;
  authSubjectId: string;
  action: 'wallet_registration_ecdsa_prepare';
  operation: 'registration';
  keyScope: 'evm-family';
  chainTarget: ThresholdEcdsaChainTarget;
};

type EmailOtpWalletRegistrationEcdsaPrepareHandleBindings = readonly [
  EmailOtpWalletRegistrationEcdsaPrepareHandleBinding,
  ...EmailOtpWalletRegistrationEcdsaPrepareHandleBinding[],
];

type EmailOtpWalletRegistrationEcdsaPrepareHandlePayloads = readonly [
  EmailOtpWalletRegistrationEcdsaPrepareHandlePayload,
  ...EmailOtpWalletRegistrationEcdsaPrepareHandlePayload[],
];

export type EmailOtpWalletRegistrationEcdsaPrepareHandleRequest =
  | {
      kind: 'requested';
      bindings: EmailOtpWalletRegistrationEcdsaPrepareHandleBindings;
      handle?: never;
    }
  | {
      kind: 'not_requested';
      bindings?: never;
      handle?: never;
    };

export type EmailOtpWalletRegistrationEcdsaPrepareHandleResult =
  | {
      kind: 'available';
      handles: EmailOtpWalletRegistrationEcdsaPrepareHandlePayloads;
    }
  | {
      kind: 'not_requested';
      handles?: never;
    };

export type EmailOtpEcdsaSessionHandleBinding =
  | EmailOtpEcdsaSessionBootstrapHandleBinding
  | EmailOtpWalletRegistrationEcdsaPrepareHandleBinding;

type EmailOtpYaoPrewarmFailureStage = 'worker_ready' | 'yao_wasm_init';

export type EmailOtpYaoPrewarmRequest = { kind: 'not_requested' } | { kind: 'requested' };

type EmailOtpYaoPrewarmWorkerResult =
  | {
      kind: 'succeeded';
      elapsedMs: number;
      failureStage?: never;
    }
  | {
      kind: 'failed';
      elapsedMs: number;
      failureStage: 'yao_wasm_init';
    };

export type EmailOtpWarmMaterialTarget =
  | {
      readonly kind: 'ecdsa';
      readonly thresholdSessionId: string;
      readonly materialActivation?: never;
    }
  | {
      readonly kind: 'ed25519_yao';
      readonly thresholdSessionId: string;
      readonly materialActivation: MpcMaterialActivationRef;
    };

export type EmailOtpEd25519YaoOperationMaterialRequest = {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly orgId: string;
  readonly providerSubjectId: string;
  readonly nearAccountId: string;
  readonly signerSlot: number;
  readonly expectedOperationalPublicKey: string;
  readonly expectedThresholdSessionId: ThresholdEd25519SessionId;
  readonly expectedMaterialActivation: MpcMaterialActivationRef;
  readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
  readonly ed25519YaoRecovery: EmailOtpEd25519YaoRecoveryAugmentationV1;
  readonly walletCustodyEd25519Material: EmailOtpWalletCustodyEd25519MaterialRequest;
  readonly normalSigningRequest: RouterAbNormalSigningPrepareRequestV2Wire;
  readonly displayDigest: string;
  readonly proof: Extract<Ed25519OperationStepUpProof, { kind: 'email_otp' }>;
  readonly operationCredential: WalletSessionOperationCredentialV1;
};

export interface EmailOtpWorkerOperationMap {
  prewarmEmailOtpRegistrationCrypto: {
    payload: Record<string, never>;
    result: EmailOtpYaoPrewarmWorkerResult;
  };
  requestEmailOtpChallenge: {
    payload: {
      relayUrl: string;
      walletId: string;
      walletAuthMethodId?: string;
      routePlan: EmailOtpRoutePlan;
      otpChannel?: WalletEmailOtpChannel;
      operationFingerprintDigest?: DigestB64u;
    };
    result: {
      challengeId: string;
      otpChannel: WalletEmailOtpChannel;
      delivery: EmailOtpChallengeDelivery;
      emailHint?: string;
      expiresAtMs?: number;
      ownerProofBindingDigest: string;
      walletAuthMethodId: string;
      signerSelection: EmailOtpUnlockSignerSelection;
    };
  };
  requestEmailOtpEnrollmentChallenge: {
    payload: {
      relayUrl: string;
      walletId: string;
      routePlan: EmailOtpRoutePlan;
      otpChannel?: WalletEmailOtpChannel;
    };
    result: {
      challengeId: string;
      otpChannel: WalletEmailOtpChannel;
      delivery: EmailOtpChallengeDelivery;
      emailHint?: string;
      expiresAtMs?: number;
    };
  };
  prepareEmailOtpRegistrationEnrollmentMaterial: {
    payload: {
      relayUrl: string;
      walletId: string;
      userId: string;
      groupId: string;
      routePlan: EmailOtpRoutePlan;
      otpChannel?: WalletEmailOtpChannel;
      clientSecret32?: ArrayBuffer;
      ecdsaSessionHandle: EmailOtpWalletRegistrationEcdsaPrepareHandleRequest;
    };
    result: {
      otpChannel: WalletEmailOtpChannel;
      enrollmentId: string;
      enrollmentSealKeyVersion: string;
      serverSealedFactorCiphertextB64u: string;
      clientUnlockPublicKeyB64u: string;
      unlockKeyVersion: string;
      emailOtpSessionHandle: EmailOtpWalletRegistrationEcdsaPrepareHandleResult;
      emailOtpEnrollment: {
        enrollmentSealKeyVersion: string;
        serverSealedFactorCiphertextB64u: string;
        clientUnlockPublicKeyB64u: string;
        unlockKeyVersion: string;
      };
    };
  };
  releaseWalletRecoveryEmailOtpFactor: {
    payload: {
      relayUrl: string;
      walletId: string;
      recoveryOperationId: string;
      reservationId: string;
    };
    result:
      | {
          kind: 'existing';
          recoveryOperationId: string;
          reservationId: string;
          providerSubject: string;
          verifiedEmail: string;
          enrollmentId: string;
          enrollmentSealKeyVersion: string;
          factorSecret32: ArrayBuffer;
        }
      | {
          kind: 'create';
          recoveryOperationId: string;
          reservationId: string;
          providerSubject: string;
          verifiedEmail: string;
        };
  };
  createEmailOtpEd25519YaoSigningShare: {
    payload: {
      activeClientHandle: string;
      input: RouterAbEd25519YaoClientSigningInputV1;
    };
    result: RouterAbEd25519YaoClientSigningShareV1;
  };
  disposeEmailOtpEd25519YaoActiveClient: {
    payload: { activeClientHandle: string };
    result: { removed: boolean };
  };
  rotateEmailOtpWalletRecoverySet: {
    payload: {
      relayUrl: string;
      walletId: string;
      walletAuthMethodId: string;
      userId: string;
      groupId: string;
      routePlan: EmailOtpRoutePlan;
      verification: {
        kind: 'otp';
        challengeId: string;
        otpCode: string;
      };
      recoveryCodesJson: string;
    };
    result: WalletRecoverySetRotationWorkerResultV1;
  };
  loginWithEmailOtpWallet: {
    payload: {
      relayUrl: string;
      walletId: string;
      authoritySelector: EmailOtpAuthoritySelector;
      userId: string;
      groupId: string;
      routePlan: EmailOtpRoutePlan;
      otpChannel?: WalletEmailOtpChannel;
      verification:
        | {
            kind: 'otp';
            challengeId?: string;
            otpCode: string;
          }
        | {
            kind: 'email_otp_unseal_grant';
            grant: string;
            challengeId: string;
          };
      material: EmailOtpWalletUnlockMaterialRequest;
    };
    result: {
      recovery: {
        challengeId: string;
        enrollmentSealKeyVersion: string;
        unlockChallengeId: string;
        unlockChallengeB64u: string;
        clientUnlockPublicKeyB64u: string;
        unlockSignatureB64u: string;
        verifiedAuthorityProjection: EmailOtpVerifiedAuthorityProjection;
      };
    } & EmailOtpWalletUnlockMaterialResult;
  };
  unlockEmailOtpAuthorityWallet: {
    payload: {
      relayUrl: string;
      walletId: string;
      walletAuthMethodId: string;
      challengeId: string;
      otpCode: string;
      /**
       * Which branch is unlocking, and what that branch requires.
       *
       * A linked device opens sealed material of its own after this call and
       * sends none of it here. An owner authority has no such material and
       * instead needs the runtime built inside this unlock, from the custody
       * projection the verify response already returns. Neither can hold the
       * other's fields, so a caller cannot ask for an owner runtime on the
       * linked branch or omit it on the owner one.
       */
      ed25519:
        | { readonly kind: 'no_ed25519'; readonly recovery?: never }
        | {
            readonly kind: 'owner_authority';
            readonly signerSlot: number;
            readonly remainingUses: number;
            readonly recovery: {
              readonly ed25519YaoRecovery: EmailOtpEd25519YaoRecoveryAugmentationV1;
              readonly providerSubject: string;
              readonly nearAccountId: string;
              readonly expectedOperationalPublicKey: string;
              readonly expectedThresholdSessionId: string;
              readonly walletCustodyEd25519Material: EmailOtpWalletCustodyEd25519MaterialRequest;
            };
          }
        | {
            readonly kind: 'linked_device';
            readonly signerSlot: number;
            readonly remainingUses: number;
            readonly recovery?: never;
          };
    };
    result: {
      readonly kind: 'email_otp_authority_wallet_unlock_v1';
      readonly factorSecret32: Uint8Array;
      readonly walletSession: ActiveWalletSessionV1;
      readonly operationCredential: WalletSessionOperationCredentialV1;
      readonly verifiedAuthorityProjection: EmailOtpVerifiedAuthorityProjection;
      /**
       * Owner authorities unlock the wallet custody seed envelope. A linked
       * authority opens its separately provisioned signer material instead.
       */
      readonly walletCustodySeed:
        | {
            readonly kind: 'owner_authority_seed_envelope';
            readonly existingEnvelope: PasskeyCustodyEnvelopeRecord;
          }
        | {
            readonly kind: 'linked_device_seed_unavailable';
            readonly existingEnvelope?: never;
          };
      /**
       * Either the runtime is ready and every part of it is present, or there
       * is none. Three optional fields would let a caller hold a handle with no
       * metadata to check it against.
       */
      readonly ed25519Activation:
        | {
            readonly kind: 'ed25519_activation_ready';
            readonly activeClientHandle: string;
            readonly metadata: RouterAbEd25519YaoActiveClientMetadataV1;
            readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
          }
        /* A linked device gets its bootstrap here and opens its own sealed
           material afterwards; no runtime is built in this call, so it carries
           no handle to hold or dispose. */
        | {
            readonly kind: 'ed25519_bootstrap_only';
            readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
            readonly activeClientHandle?: never;
            readonly metadata?: never;
          }
        | {
            readonly kind: 'ed25519_activation_absent';
            readonly bootstrap?: never;
            readonly activeClientHandle?: never;
            readonly metadata?: never;
          };
    };
  };
  getEmailOtpWarmSessionStatus: {
    payload: {
      target: EmailOtpWarmMaterialTarget;
    };
    result:
      | { ok: true; remainingUses: number; expiresAtMs: number }
      | { ok: false; code: string; message: string };
  };
  consumeEmailOtpWarmSessionUses: {
    payload: {
      target: EmailOtpWarmMaterialTarget;
      uses?: number;
    };
    result:
      | { ok: true; remainingUses: number; expiresAtMs: number }
      | { ok: false; code: string; message: string };
  };
  sealEmailOtpWarmSessionMaterial: {
    payload: {
      target: EmailOtpWarmMaterialTarget;
      transport: {
        relayerUrl: string;
        authorizationThresholdSessionId: string;
        operationCredential?: WalletSessionOperationCredentialV1;
        signingSessionSealKeyVersion?: SigningSessionSealKeyVersion;
        groupId?: string;
      };
    };
    result:
      | ({
          ok: true;
          sealedSecretB64u: string;
          keyVersion?: string;
          remainingUses: number;
          expiresAtMs: number;
        } & (
          | {
              materialKind: 'ecdsa';
              materialActivation?: never;
            }
          | {
              materialKind: 'ed25519_yao';
              materialActivation: MpcMaterialActivationRef;
            }
        ))
      | { ok: false; code: string; message: string };
  };
  rehydrateEmailOtpEcdsaWarmSessionMaterial: {
    payload: {
      target: Extract<EmailOtpWarmMaterialTarget, { kind: 'ecdsa' }>;
      sealedSecretB64u: string;
      remainingUses: number;
      expiresAtMs: number;
      transport: {
        relayerUrl: string;
        authorizationThresholdSessionId: string;
        operationCredential?: WalletSessionOperationCredentialV1;
        signingSessionSealKeyVersion?: SigningSessionSealKeyVersion;
        groupId?: string;
      };
      restore: {
        thresholdSessionId: string;
        walletId: string;
        keyHandle: string;
        chainTarget: ThresholdEcdsaChainTarget;
        authSubjectId: string;
      };
    };
    result:
      | {
          ok: true;
          remainingUses: number;
          expiresAtMs: number;
          emailOtpSessionHandle: EmailOtpEcdsaSessionBootstrapHandlePayload;
        }
      | { ok: false; code: string; message: string };
  };
  rehydrateEmailOtpEd25519YaoOperationMaterial: {
    payload: EmailOtpEd25519YaoOperationMaterialRequest;
    result: {
      activeClientHandle: string;
      metadata: RouterAbEd25519YaoActiveClientMetadataV1;
      bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
      walletCustodyEd25519Material?: LoadedWalletCustodyEd25519MaterialV1;
      issuedAuthorization: IssuedEd25519OperationStepUpAuthorization;
    };
  };
  rehydrateActiveEmailOtpEd25519YaoSessionMaterial: {
    payload: {
      readonly relayUrl: string;
      readonly walletId: string;
      readonly walletAuthMethodId: string;
      readonly orgId: string;
      readonly providerSubjectId: string;
      readonly nearAccountId: string;
      readonly signerSlot: number;
      readonly remainingUses: number;
      readonly expectedOperationalPublicKey: string;
      readonly expectedThresholdSessionId: ThresholdEd25519SessionId;
      readonly operationCredential: WalletSessionOperationCredentialV1;
      readonly ecdsa:
        | {
            readonly kind: 'required';
            readonly sessionHandleBinding: Extract<
              EmailOtpEcdsaSessionBootstrapHandleBinding,
              { readonly operation: 'wallet_unlock' }
            >;
            readonly runtimePolicyScope: ThresholdRuntimePolicyScope;
            readonly sessionPolicy: RouterAbEcdsaPostRegistrationSessionActivationPolicyV1;
          }
        | {
            readonly kind: 'absent';
            readonly sessionHandleBinding?: never;
            readonly runtimePolicyScope?: never;
            readonly sessionPolicy?: never;
          };
      readonly walletCustodyEd25519Material: Extract<
        EmailOtpWalletCustodyEd25519MaterialRequest,
        { readonly kind: 'found' }
      >;
    };
    result: EmailOtpEd25519YaoWorkerActivationResult & {
      readonly ecdsa:
        | { readonly kind: 'absent'; readonly session?: never }
        | {
            readonly kind: 'activated';
            readonly session: RouterAbEcdsaCredentialFreeSessionActivationResponseV1;
          };
      readonly walletSessionAuthorization: ExactWalletSessionAuthorization;
    };
  };
  activateEmailOtpEd25519YaoRegistrationMaterial: {
    payload: {
      readonly material: LoadedWalletCustodyEd25519MaterialV1;
      readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
      readonly envelope: WalletCustodyCacheEnvelopeV1;
      readonly factorSecret32: ArrayBuffer;
    };
    result: {
      readonly activeClientHandle: string;
      readonly metadata: RouterAbEd25519YaoActiveClientMetadataV1;
    };
  };
  clearEmailOtpWarmSessionMaterial: {
    payload: {
      target: EmailOtpWarmMaterialTarget;
    };
    result: {
      ok: true;
      cleared: true;
    };
  };
  exportEmailOtpEd25519YaoSeed: {
    payload: {
      relayUrl: string;
      challengeId: string;
      otpCode: string;
      lane: {
        walletId: string;
        providerSubjectId: string;
        /** The exact method this export acts as; linked wallets have several. */
        walletAuthMethodId: string;
        nearAccountId: string;
        nearEd25519SigningKeyId: string;
        signerSlot: number;
      };
      material: EmailOtpEd25519YaoExportMaterialV1;
    };
    result:
      | {
          kind: 'exported';
          artifactKind: 'near-ed25519-seed-v1';
          publicKey: string;
          privateKey: string;
        }
      | {
          kind: 'exported_and_rehydrated';
          artifactKind: 'near-ed25519-seed-v1';
          publicKey: string;
          privateKey: string;
          activeClientHandle: string;
          metadata: RouterAbEd25519YaoActiveClientMetadataV1;
          bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
        };
  };
}

type EmailOtpWorkerOperationRequestEnvelopeFor<T extends keyof EmailOtpWorkerOperationMap> = {
  id: string;
  type: T;
  payload: EmailOtpWorkerOperationMap[T]['payload'];
};

export type EmailOtpWorkerOperationRequestEnvelope = {
  [T in keyof EmailOtpWorkerOperationMap]: EmailOtpWorkerOperationRequestEnvelopeFor<T>;
}[keyof EmailOtpWorkerOperationMap];

interface MultichainSignerWorkerOperationMapByKind {
  evmCrypto: EvmCryptoWorkerOperationMap;
  tempoSigner: TempoSignerWorkerOperationMap;
}

export type MultichainOperationType<K extends MultichainWorkerKind> =
  keyof MultichainSignerWorkerOperationMapByKind[K];

type MultichainWorkerOperationEntry<
  K extends MultichainWorkerKind,
  T extends MultichainOperationType<K>,
> = MultichainSignerWorkerOperationMapByKind[K][T] extends {
  payload: infer P;
  result: infer R;
}
  ? { payload: P; result: R }
  : never;

export type MultichainWorkerOperationRequest<
  K extends MultichainWorkerKind,
  T extends MultichainOperationType<K>,
> = {
  type: T;
  payload: MultichainWorkerOperationEntry<K, T>['payload'];
  onEvent?: (update: RpcSignerWorkerProgressEvent) => void;
  timeoutMs?: number;
  transfer?: Transferable[];
};

export type MultichainWorkerOperationResult<
  K extends MultichainWorkerKind,
  T extends MultichainOperationType<K>,
> = MultichainWorkerOperationEntry<K, T>['result'];

type NearSignerWorkerOperationMap = {
  [NearSignerWorkerCustomRequestType.ThresholdEd25519ComputeNep413SigningDigest]: {
    payload: ThresholdEd25519ComputeNep413SigningDigestRequest;
    result: ThresholdEd25519ComputeSigningDigestResult;
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519ComputeDelegateSigningDigest]: {
    payload: { delegate: DelegatePayload };
    result: ThresholdEd25519ComputeSigningDigestResult;
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519BuildDelegateSigningPayload]: {
    payload: ThresholdEd25519BuildDelegateSigningPayloadRequest;
    result: ThresholdEd25519BuildDelegateSigningPayloadResult;
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519FinalizeDelegateFromSignature]: {
    payload: ThresholdEd25519FinalizeDelegateFromSignatureRequest;
    result: WasmSignedDelegate;
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519FinalizeNearTxFromSignature]: {
    payload: ThresholdEd25519FinalizeNearTxFromSignatureRequest;
    result: ThresholdEd25519FinalizeNearTxFromSignatureResult;
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519BuildNearTxUnsignedBorsh]: {
    payload: ThresholdEd25519BuildNearTxUnsignedBorshRequest;
    result: readonly ThresholdEd25519NearTxUnsignedBorsh[];
  };
  [NearSignerWorkerCustomRequestType.ThresholdEd25519DecodeSignedNearTxBorsh]: {
    payload: ThresholdEd25519DecodeSignedNearTxBorshRequest;
    result: ThresholdEd25519DecodeSignedNearTxBorshResult;
  };
};

export type NearWorkerOperationType = keyof NearSignerWorkerOperationMap;

type NearWorkerOperationEntry<T extends NearWorkerOperationType> = NearSignerWorkerOperationMap[T];

export type NearWorkerOperationRequest<T extends NearWorkerOperationType> = {
  type: T;
  payload: NearWorkerOperationEntry<T>['payload'];
  onEvent?: (update: NearWorkerProgressEvent) => void;
  timeoutMs?: number;
  transfer?: Transferable[];
};

export type NearWorkerOperationResult<T extends NearWorkerOperationType> =
  NearWorkerOperationEntry<T>['result'];

export const EcdsaDerivationClientCustomRequestType = {
  PrepareThresholdEcdsaDerivationRoleLocalClientBootstrap: 70_000,
  FinalizeThresholdEcdsaDerivationRoleLocalClientBootstrap: 70_001,
  CreateRouterAbEcdsaRegistrationCeremony: 70_005,
  VerifyRouterAbEcdsaRegistrationClientProofs: 70_006,
  CloseRouterAbEcdsaRegistrationCeremony: 70_007,
  FinalizeRouterAbEcdsaRegistrationActivation: 70_008,
  CreateRouterAbEcdsaPostRegistrationCeremony: 70_009,
  FinalizeRouterAbEcdsaExplicitExport: 70_010,
  CloseRouterAbEcdsaPostRegistrationCeremony: 70_011,
  StoreThresholdEcdsaRoleLocalSigningMaterial: 70_004,
  RehydrateEcdsaRoleLocalSigningMaterial: 70_015,
  PersistInitialCanonicalEcdsaActivation: 70_016,
  ReconcileCanonicalEcdsaActivation: 70_017,
  PrewarmEcdsaRegistrationCrypto: 70_018,
  VerifyRouterAbEcdsaPostRegistrationProofs: 70_019,
  SignWalletRecoveryEcdsaMaterialPossessionProof: 70_020,
  PrepareLinkedDeviceEcdsaSourceContribution: 70_022,
  StoreLinkedDeviceEcdsaHolderMaterial: 70_023,
  DisposeLinkedDeviceEcdsaHolderMaterials: 70_024,
  CreateEcdsaHolderOrdinaryExportRequest: 70_027,
  FinalizeEcdsaHolderOrdinaryExport: 70_028,
} as const;

export type EcdsaDerivationClientCustomRequestType =
  (typeof EcdsaDerivationClientCustomRequestType)[keyof typeof EcdsaDerivationClientCustomRequestType];

export const EcdsaDerivationClientCustomResponseType = {
  PrepareThresholdEcdsaDerivationRoleLocalClientBootstrapSuccess: 70_100,
  FinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapSuccess: 70_101,
  CreateRouterAbEcdsaRegistrationCeremonySuccess: 70_105,
  VerifyRouterAbEcdsaRegistrationClientProofsSuccess: 70_106,
  CloseRouterAbEcdsaRegistrationCeremonySuccess: 70_107,
  FinalizeRouterAbEcdsaRegistrationActivationSuccess: 70_108,
  CreateRouterAbEcdsaPostRegistrationCeremonySuccess: 70_109,
  FinalizeRouterAbEcdsaExplicitExportSuccess: 70_110,
  CloseRouterAbEcdsaPostRegistrationCeremonySuccess: 70_111,
  StoreThresholdEcdsaRoleLocalSigningMaterialSuccess: 70_104,
  RehydrateEcdsaRoleLocalSigningMaterialSuccess: 70_115,
  PersistInitialCanonicalEcdsaActivationSuccess: 70_116,
  ReconcileCanonicalEcdsaActivationSuccess: 70_117,
  PrewarmEcdsaRegistrationCryptoSuccess: 70_118,
  VerifyRouterAbEcdsaPostRegistrationProofsSuccess: 70_119,
  SignWalletRecoveryEcdsaMaterialPossessionProofSuccess: 70_120,
  PrepareLinkedDeviceEcdsaSourceContributionSuccess: 70_122,
  StoreLinkedDeviceEcdsaHolderMaterialSuccess: 70_123,
  DisposeLinkedDeviceEcdsaHolderMaterialsSuccess: 70_124,
  CreateEcdsaHolderOrdinaryExportRequestSuccess: 70_127,
  FinalizeEcdsaHolderOrdinaryExportSuccess: 70_128,
} as const;

export type EcdsaDerivationClientCustomResponseType =
  (typeof EcdsaDerivationClientCustomResponseType)[keyof typeof EcdsaDerivationClientCustomResponseType];

export type StoreThresholdEcdsaRoleLocalSigningMaterialRequest = {
  materialHandle: string;
  bindingDigest: string;
  stateBlob: EcdsaRoleLocalReadyStateBlob;
};

export type StoreThresholdEcdsaRoleLocalSigningMaterialResult = {
  materialHandle: string;
  bindingDigest: string;
};

type StoreThresholdEcdsaRoleLocalSigningMaterialResponse = {
  type: typeof EcdsaDerivationClientCustomResponseType.StoreThresholdEcdsaRoleLocalSigningMaterialSuccess;
  payload: StoreThresholdEcdsaRoleLocalSigningMaterialResult;
  diagnostics?: WorkerResponseDiagnostics;
};

export type StoreLinkedDeviceEcdsaHolderMaterialRequestV1 = {
  readonly holderHandleId: string;
  readonly ownedSigningShare32: ArrayBuffer;
  readonly activationReceiptJson: string;
};

type StoreLinkedDeviceEcdsaHolderMaterialResponseV1 = {
  readonly type: typeof EcdsaDerivationClientCustomResponseType.StoreLinkedDeviceEcdsaHolderMaterialSuccess;
  readonly payload: { readonly holderHandleId: string };
  readonly diagnostics?: WorkerResponseDiagnostics;
};

export type DisposeLinkedDeviceEcdsaHolderMaterialsRequestV1 =
  | {
      readonly kind: 'all';
      readonly holderHandleId?: never;
    }
  | {
      readonly kind: 'one';
      readonly holderHandleId: string;
    };

type DisposeLinkedDeviceEcdsaHolderMaterialsResponseV1 = {
  readonly type: typeof EcdsaDerivationClientCustomResponseType.DisposeLinkedDeviceEcdsaHolderMaterialsSuccess;
  readonly payload:
    | { readonly kind: 'all'; readonly holderHandleId?: never }
    | { readonly kind: 'one'; readonly holderHandleId: string };
  readonly diagnostics?: WorkerResponseDiagnostics;
};

type CreateEcdsaHolderOrdinaryExportRequestWorkerV1 = CreateEcdsaHolderOrdinaryExportRequestV1;

type CreateEcdsaHolderOrdinaryExportResponseWorkerV1 = {
  readonly type: typeof EcdsaDerivationClientCustomResponseType.CreateEcdsaHolderOrdinaryExportRequestSuccess;
  readonly payload: CreateEcdsaHolderOrdinaryExportResultV1;
  readonly diagnostics?: WorkerResponseDiagnostics;
};

type FinalizeEcdsaHolderOrdinaryExportRequestWorkerV1 = FinalizeEcdsaHolderOrdinaryExportRequestV1;

type FinalizeEcdsaHolderOrdinaryExportResponseWorkerV1 = {
  readonly type: typeof EcdsaDerivationClientCustomResponseType.FinalizeEcdsaHolderOrdinaryExportSuccess;
  readonly payload: FinalizeEcdsaHolderOrdinaryExportResultV1;
  readonly diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientSessionParameters = {
  sessionId: string;
  groupPublicKey33: ArrayBuffer;
  ceremonyExpiresAtMs: number;
  materialExpiresAtMs: number;
  poolIdentity: EcdsaClientPresignPoolIdentity;
};

export type EcdsaPresignClientSessionInitRequest = EcdsaPresignClientSessionParameters &
  (
    | {
        authority: {
          kind: 'role_local_derivation_handle';
          materialHandle: string;
          material:
            | {
                kind: 'persisted';
                materialRef: EcdsaRoleLocalPersistedMaterialRef;
                expectedBindingDigest?: never;
              }
            | {
                kind: 'runtime_loaded';
                expectedBindingDigest: string;
                materialRef?: never;
              };
        };
      }
    | {
        authority: {
          kind: 'linked_holder_signing_material';
          holderHandleId: string;
          materialHandle?: never;
          material?: never;
        };
      }
  );

type EcdsaPresignClientSessionInitResult =
  | {
      authority: { kind: 'role_local_derivation_handle' };
      progress: ThresholdEcdsaPresignProgressResult;
    }
  | {
      authority: { kind: 'linked_holder_signing_material' };
      progress: ThresholdEcdsaPresignProgressResult;
    };

type EcdsaPresignClientSessionInitResponse = {
  type: typeof EcdsaPresignClientResponseType.SessionInitSuccess;
  payload: EcdsaPresignClientSessionInitResult;
  diagnostics?: WorkerResponseDiagnostics;
};

export type EcdsaPresignClientSessionStepRequest = {
  sessionId: string;
  stage: 'triples' | 'presign';
  incomingMessages: ArrayBuffer[];
};

type EcdsaPresignClientSessionStepResponse = {
  type: typeof EcdsaPresignClientResponseType.SessionStepSuccess;
  payload: ThresholdEcdsaPresignProgressResult;
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientSessionAbortRequest = {
  sessionId: string;
};

type EcdsaPresignClientSessionAbortResponse = {
  type: typeof EcdsaPresignClientResponseType.SessionAbortSuccess;
  payload: ThresholdEcdsaPresignAbortResult;
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientAdmitRequest = {
  materialHandle: string;
  expectedPresignatureId: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
  admissionMode: 'durable' | 'resident';
};

type EcdsaPresignClientAdmitResponse = {
  type: typeof EcdsaPresignClientResponseType.AdmitSuccess;
  payload: {
    kind: 'ecdsa_client_presignature_admitted_v1';
    materialHandle: string;
    presignatureId: string;
    storage: EcdsaClientPresignAdmissionStorage;
  };
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientDestroyRequest = {
  materialHandle: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
};

type EcdsaPresignClientDestroyResponse = {
  type: typeof EcdsaPresignClientResponseType.DestroySuccess;
  payload: {
    kind: 'ecdsa_client_presignature_destroyed_v1';
    materialHandle: string;
  };
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientClearWalletRequest = {
  walletId: string;
};

type EcdsaPresignClientClearWalletResponse = {
  type: typeof EcdsaPresignClientResponseType.ClearWalletSuccess;
  payload: {
    kind: 'ecdsa_client_wallet_worker_state_cleared_v1';
    walletId: string;
    clearedCount: number;
  };
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientUseBinding = {
  materialHandle: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
  requestBinding: string;
  reservationId: string;
};

type EcdsaPresignClientReserveRequest = EcdsaPresignClientUseBinding & {
  expectedPresignatureId: string;
  leaseExpiresAtMs: number;
};

type EcdsaPresignClientReserveResponse = {
  type: typeof EcdsaPresignClientResponseType.ReserveSuccess;
  payload: EcdsaClientPresignReservationResult;
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientCommitResponse = {
  type: typeof EcdsaPresignClientResponseType.CommitSuccess;
  payload: {
    kind: 'ecdsa_client_presignature_lifecycle_advanced_v1';
    materialHandle: string;
  };
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaPresignClientListAvailableRequest = {
  authority: { kind: 'role_local_derivation_handle' | 'linked_holder_signing_material' };
  poolIdentity: EcdsaClientPresignPoolIdentity;
};

type EcdsaPresignClientListAvailableResponse = {
  type: typeof EcdsaPresignClientResponseType.ListAvailableSuccess;
  payload: Array<{
    presignatureId: string;
    materialHandle: string;
    bigR33: ArrayBuffer;
    createdAtMs: number;
    expiresAtMs: number;
  }>;
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaOnlineClientComputeSignatureShareRequest = {
  materialHandle: string;
  poolIdentity: EcdsaClientPresignPoolIdentity;
  requestBinding: string;
  reservationId: string;
  groupPublicKey33: ArrayBuffer;
  expectedPresignBigR33: ArrayBuffer;
  digest32: ArrayBuffer;
  clientRerandomizationContribution32: ArrayBuffer;
  signingWorkerRerandomizationContribution32: ArrayBuffer;
};

type EcdsaOnlineClientComputeSignatureShareResponse = {
  type: typeof EcdsaOnlineClientResponseType.ComputeSignatureShareSuccess;
  payload: ArrayBuffer;
  diagnostics?: WorkerResponseDiagnostics;
};

type EcdsaDerivationClientCustomOperationMap = {
  [EcdsaDerivationClientCustomRequestType.CreateRouterAbEcdsaRegistrationCeremony]: {
    payload: CreateRouterAbEcdsaRegistrationCeremonyRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.CreateRouterAbEcdsaRegistrationCeremonySuccess;
      payload: CreateRouterAbEcdsaRegistrationCeremonyResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.VerifyRouterAbEcdsaRegistrationClientProofs]: {
    payload: VerifyRouterAbEcdsaRegistrationClientProofsRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.VerifyRouterAbEcdsaRegistrationClientProofsSuccess;
      payload: VerifyRouterAbEcdsaRegistrationClientProofsResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.PersistInitialCanonicalEcdsaActivation]: {
    payload: PersistInitialCanonicalEcdsaActivationRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.PersistInitialCanonicalEcdsaActivationSuccess;
      payload: PersistInitialCanonicalEcdsaActivationResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.FinalizeRouterAbEcdsaRegistrationActivation]: {
    payload: FinalizeRouterAbEcdsaRegistrationActivationRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.FinalizeRouterAbEcdsaRegistrationActivationSuccess;
      payload: FinalizeRouterAbEcdsaRegistrationActivationResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.ReconcileCanonicalEcdsaActivation]: {
    payload: ReconcileCanonicalEcdsaActivationRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.ReconcileCanonicalEcdsaActivationSuccess;
      payload: ReconcileCanonicalEcdsaActivationWorkerResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.PrewarmEcdsaRegistrationCrypto]: {
    payload: Record<string, never>;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.PrewarmEcdsaRegistrationCryptoSuccess;
      payload: {
        kind: 'ecdsa_registration_crypto_prewarm_result_v1';
        wasmInitMs: number;
      };
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.CloseRouterAbEcdsaRegistrationCeremony]: {
    payload: CloseRouterAbEcdsaRegistrationCeremonyRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.CloseRouterAbEcdsaRegistrationCeremonySuccess;
      payload: CloseRouterAbEcdsaRegistrationCeremonyResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.CreateRouterAbEcdsaPostRegistrationCeremony]: {
    payload: CreateRouterAbEcdsaPostRegistrationCeremonyRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.CreateRouterAbEcdsaPostRegistrationCeremonySuccess;
      payload: CreateRouterAbEcdsaPostRegistrationCeremonyResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.FinalizeRouterAbEcdsaExplicitExport]: {
    payload: FinalizeRouterAbEcdsaExplicitExportRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.FinalizeRouterAbEcdsaExplicitExportSuccess;
      payload: FinalizeRouterAbEcdsaExplicitExportResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.CloseRouterAbEcdsaPostRegistrationCeremony]: {
    payload: CloseRouterAbEcdsaPostRegistrationCeremonyRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.CloseRouterAbEcdsaPostRegistrationCeremonySuccess;
      payload: CloseRouterAbEcdsaPostRegistrationCeremonyResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.VerifyRouterAbEcdsaPostRegistrationProofs]: {
    payload: VerifyRouterAbEcdsaPostRegistrationProofsRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.VerifyRouterAbEcdsaPostRegistrationProofsSuccess;
      payload: VerifyRouterAbEcdsaPostRegistrationProofsResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.PrepareThresholdEcdsaDerivationRoleLocalClientBootstrap]: {
    payload: WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapRequest;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.PrepareThresholdEcdsaDerivationRoleLocalClientBootstrapSuccess;
      payload: WasmPrepareThresholdEcdsaDerivationRoleLocalClientBootstrapResult;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.FinalizeThresholdEcdsaDerivationRoleLocalClientBootstrap]: {
    payload: WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapRequest;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.FinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapSuccess;
      payload: WasmFinalizeThresholdEcdsaDerivationRoleLocalClientBootstrapResult;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.StoreThresholdEcdsaRoleLocalSigningMaterial]: {
    payload: StoreThresholdEcdsaRoleLocalSigningMaterialRequest;
    result: StoreThresholdEcdsaRoleLocalSigningMaterialResponse;
  };
  [EcdsaDerivationClientCustomRequestType.StoreLinkedDeviceEcdsaHolderMaterial]: {
    payload: StoreLinkedDeviceEcdsaHolderMaterialRequestV1;
    result: StoreLinkedDeviceEcdsaHolderMaterialResponseV1;
  };
  [EcdsaDerivationClientCustomRequestType.DisposeLinkedDeviceEcdsaHolderMaterials]: {
    payload: DisposeLinkedDeviceEcdsaHolderMaterialsRequestV1;
    result: DisposeLinkedDeviceEcdsaHolderMaterialsResponseV1;
  };
  [EcdsaDerivationClientCustomRequestType.CreateEcdsaHolderOrdinaryExportRequest]: {
    payload: CreateEcdsaHolderOrdinaryExportRequestWorkerV1;
    result: CreateEcdsaHolderOrdinaryExportResponseWorkerV1;
  };
  [EcdsaDerivationClientCustomRequestType.FinalizeEcdsaHolderOrdinaryExport]: {
    payload: FinalizeEcdsaHolderOrdinaryExportRequestWorkerV1;
    result: FinalizeEcdsaHolderOrdinaryExportResponseWorkerV1;
  };
  [EcdsaDerivationClientCustomRequestType.RehydrateEcdsaRoleLocalSigningMaterial]: {
    payload: RehydrateEcdsaRoleLocalSigningMaterialRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.RehydrateEcdsaRoleLocalSigningMaterialSuccess;
      payload: RehydrateEcdsaRoleLocalSigningMaterialResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.SignWalletRecoveryEcdsaMaterialPossessionProof]: {
    payload: SignWalletRecoveryEcdsaMaterialPossessionProofRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.SignWalletRecoveryEcdsaMaterialPossessionProofSuccess;
      payload: SignWalletRecoveryEcdsaMaterialPossessionProofResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
  [EcdsaDerivationClientCustomRequestType.PrepareLinkedDeviceEcdsaSourceContribution]: {
    payload: PrepareLinkedDeviceEcdsaSourceContributionRequestV1;
    result: {
      type: typeof EcdsaDerivationClientCustomResponseType.PrepareLinkedDeviceEcdsaSourceContributionSuccess;
      payload: PrepareLinkedDeviceEcdsaSourceContributionResultV1;
      diagnostics?: WorkerResponseDiagnostics;
    };
  };
};

export const EcdsaPresignClientRequestType = {
  SessionInit: 71_000,
  SessionStep: 71_001,
  SessionAbort: 71_002,
  Admit: 71_003,
  Destroy: 71_004,
  Reserve: 71_005,
  Commit: 71_006,
  ListAvailable: 71_007,
  ClearWallet: 71_008,
} as const;

export const EcdsaPresignClientResponseType = {
  SessionInitSuccess: 71_100,
  SessionStepSuccess: 71_101,
  SessionAbortSuccess: 71_102,
  AdmitSuccess: 71_103,
  DestroySuccess: 71_104,
  ReserveSuccess: 71_105,
  CommitSuccess: 71_106,
  ListAvailableSuccess: 71_107,
  ClearWalletSuccess: 71_108,
} as const;

export type EcdsaPresignClientOperationMap = {
  [EcdsaPresignClientRequestType.SessionInit]: {
    payload: EcdsaPresignClientSessionInitRequest;
    result: EcdsaPresignClientSessionInitResponse;
  };
  [EcdsaPresignClientRequestType.SessionStep]: {
    payload: EcdsaPresignClientSessionStepRequest;
    result: EcdsaPresignClientSessionStepResponse;
  };
  [EcdsaPresignClientRequestType.SessionAbort]: {
    payload: EcdsaPresignClientSessionAbortRequest;
    result: EcdsaPresignClientSessionAbortResponse;
  };
  [EcdsaPresignClientRequestType.Admit]: {
    payload: EcdsaPresignClientAdmitRequest;
    result: EcdsaPresignClientAdmitResponse;
  };
  [EcdsaPresignClientRequestType.Destroy]: {
    payload: EcdsaPresignClientDestroyRequest;
    result: EcdsaPresignClientDestroyResponse;
  };
  [EcdsaPresignClientRequestType.Reserve]: {
    payload: EcdsaPresignClientReserveRequest;
    result: EcdsaPresignClientReserveResponse;
  };
  [EcdsaPresignClientRequestType.Commit]: {
    payload: EcdsaPresignClientUseBinding;
    result: EcdsaPresignClientCommitResponse;
  };
  [EcdsaPresignClientRequestType.ListAvailable]: {
    payload: EcdsaPresignClientListAvailableRequest;
    result: EcdsaPresignClientListAvailableResponse;
  };
  [EcdsaPresignClientRequestType.ClearWallet]: {
    payload: EcdsaPresignClientClearWalletRequest;
    result: EcdsaPresignClientClearWalletResponse;
  };
};

export const EcdsaOnlineClientRequestType = {
  ComputeSignatureShare: 72_000,
} as const;

export const EcdsaOnlineClientResponseType = {
  ComputeSignatureShareSuccess: 72_100,
} as const;

export type EcdsaOnlineClientOperationMap = {
  [EcdsaOnlineClientRequestType.ComputeSignatureShare]: {
    payload: EcdsaOnlineClientComputeSignatureShareRequest;
    result: EcdsaOnlineClientComputeSignatureShareResponse;
  };
};

export type EcdsaDerivationWorkerOperationType = keyof EcdsaDerivationClientCustomOperationMap;

type EcdsaDerivationWorkerOperationEntry<T extends EcdsaDerivationWorkerOperationType> =
  EcdsaDerivationClientCustomOperationMap[T];

export type EcdsaDerivationWorkerOperationRequest<T extends EcdsaDerivationWorkerOperationType> = {
  type: T;
  payload: EcdsaDerivationWorkerOperationEntry<T>['payload'];
  timeoutMs?: number;
  transfer?: Transferable[];
};

export type EcdsaDerivationWorkerOperationResult<T extends EcdsaDerivationWorkerOperationType> =
  EcdsaDerivationWorkerOperationEntry<T>['result'];

type DerivationSignerWorkerOperationMap = {
  [T in EcdsaDerivationWorkerOperationType]: {
    payload: EcdsaDerivationWorkerOperationEntry<T>['payload'];
    result: EcdsaDerivationWorkerOperationEntry<T>['result'];
  };
};

export type EcdsaDerivationRoleLocalMaterialOperationType =
  | typeof EcdsaDerivationClientCustomRequestType.CreateRouterAbEcdsaRegistrationCeremony
  | typeof EcdsaDerivationClientCustomRequestType.VerifyRouterAbEcdsaRegistrationClientProofs
  | typeof EcdsaDerivationClientCustomRequestType.PersistInitialCanonicalEcdsaActivation
  | typeof EcdsaDerivationClientCustomRequestType.FinalizeRouterAbEcdsaRegistrationActivation
  | typeof EcdsaDerivationClientCustomRequestType.ReconcileCanonicalEcdsaActivation
  | typeof EcdsaDerivationClientCustomRequestType.CloseRouterAbEcdsaRegistrationCeremony
  | typeof EcdsaDerivationClientCustomRequestType.CreateRouterAbEcdsaPostRegistrationCeremony
  | typeof EcdsaDerivationClientCustomRequestType.FinalizeRouterAbEcdsaExplicitExport
  | typeof EcdsaDerivationClientCustomRequestType.CloseRouterAbEcdsaPostRegistrationCeremony
  | typeof EcdsaDerivationClientCustomRequestType.VerifyRouterAbEcdsaPostRegistrationProofs
  | typeof EcdsaDerivationClientCustomRequestType.PrepareThresholdEcdsaDerivationRoleLocalClientBootstrap
  | typeof EcdsaDerivationClientCustomRequestType.FinalizeThresholdEcdsaDerivationRoleLocalClientBootstrap
  | typeof EcdsaDerivationClientCustomRequestType.StoreThresholdEcdsaRoleLocalSigningMaterial
  | typeof EcdsaDerivationClientCustomRequestType.RehydrateEcdsaRoleLocalSigningMaterial
  | typeof EcdsaDerivationClientCustomRequestType.SignWalletRecoveryEcdsaMaterialPossessionProof
  | typeof EcdsaDerivationClientCustomRequestType.PrepareLinkedDeviceEcdsaSourceContribution
  | typeof EcdsaDerivationClientCustomRequestType.StoreLinkedDeviceEcdsaHolderMaterial
  | typeof EcdsaDerivationClientCustomRequestType.DisposeLinkedDeviceEcdsaHolderMaterials;

export type EcdsaDerivationRoleLocalMaterialOperationRequest<
  T extends EcdsaDerivationRoleLocalMaterialOperationType,
> = EcdsaDerivationWorkerOperationRequest<T>;

export type EcdsaHolderOrdinaryExportOperationType =
  | typeof EcdsaDerivationClientCustomRequestType.CreateEcdsaHolderOrdinaryExportRequest
  | typeof EcdsaDerivationClientCustomRequestType.FinalizeEcdsaHolderOrdinaryExport;

export type EcdsaDerivationHolderOrdinaryExportOperationRequest<
  T extends EcdsaHolderOrdinaryExportOperationType,
> = EcdsaDerivationWorkerOperationRequest<T>;

interface SignerWorkerOperationMapByKind {
  nearSigner: NearSignerWorkerOperationMap;
  ecdsaDerivationClient: DerivationSignerWorkerOperationMap;
  ecdsaPresignClient: EcdsaPresignClientOperationMap;
  ecdsaOnlineClient: EcdsaOnlineClientOperationMap;
  evmCrypto: EvmCryptoWorkerOperationMap;
  tempoSigner: TempoSignerWorkerOperationMap;
  emailOtp: EmailOtpWorkerOperationMap;
  walletCustodyCeremony: WalletCustodyCeremonyWorkerOperationMap;
}

export type SignerWorkerKind = keyof SignerWorkerOperationMapByKind;

export type SignerWorkerOperationType<K extends SignerWorkerKind> =
  keyof SignerWorkerOperationMapByKind[K];

type SignerWorkerProgressEvent<K extends SignerWorkerKind> = K extends 'nearSigner'
  ? NearWorkerProgressEvent
  : K extends 'evmCrypto' | 'tempoSigner'
    ? RpcSignerWorkerProgressEvent
    : K extends 'emailOtp'
      ? EmailOtpWorkerProgressEvent
      : never;

type SignerWorkerOperationEntry<
  K extends SignerWorkerKind,
  T extends SignerWorkerOperationType<K>,
> = SignerWorkerOperationMapByKind[K][T] extends { payload: infer P; result: infer R }
  ? { payload: P; result: R }
  : never;

export type SignerWorkerOperationRequest<
  K extends SignerWorkerKind,
  T extends SignerWorkerOperationType<K>,
> = K extends 'nearSigner'
  ? NearWorkerOperationRequest<Extract<T, NearWorkerOperationType>>
  : K extends 'ecdsaDerivationClient'
    ? EcdsaDerivationWorkerOperationRequest<Extract<T, EcdsaDerivationWorkerOperationType>>
    : K extends 'emailOtp' | 'evmCrypto' | 'tempoSigner'
      ? {
          type: T;
          payload: SignerWorkerOperationEntry<K, T>['payload'];
          onEvent?: (update: SignerWorkerProgressEvent<K>) => void;
          timeoutMs?: number;
          transfer?: Transferable[];
        }
      : {
          type: T;
          payload: SignerWorkerOperationEntry<K, T>['payload'];
          timeoutMs?: number;
          transfer?: Transferable[];
        };

export type SignerWorkerOperationResult<
  K extends SignerWorkerKind,
  T extends SignerWorkerOperationType<K>,
> = SignerWorkerOperationEntry<K, T>['result'];

type EmailOtpYaoPrewarmDiagnostics = {
  workerPrewarmMs: number;
  yaoWasmInitMs: number;
};

export type EmailOtpYaoPrewarmOutcome =
  | (EmailOtpYaoPrewarmDiagnostics & {
      kind: 'not_requested';
      elapsedMs: 0;
      failureStage?: never;
    })
  | (EmailOtpYaoPrewarmDiagnostics & {
      kind: 'succeeded';
      elapsedMs: number;
      failureStage?: never;
    })
  | (EmailOtpYaoPrewarmDiagnostics & {
      kind: 'failed';
      elapsedMs: number;
      failureStage: EmailOtpYaoPrewarmFailureStage;
    });

export interface SignerWorkerTransportProtocol {
  setWorkerBaseOrigin(origin: string | undefined): void;
  prewarmEmailOtpYao(request?: EmailOtpYaoPrewarmRequest): Promise<EmailOtpYaoPrewarmOutcome>;
  requestOperation<K extends SignerWorkerKind, T extends SignerWorkerOperationType<K>>(args: {
    kind: K;
    request: SignerWorkerOperationRequest<K, T>;
  }): Promise<SignerWorkerOperationResult<K, T>>;
}

type SignerHostErrorCode =
  | 'SIGNER_INVALID_INPUT'
  | 'SIGNER_INVALID_LENGTH'
  | 'SIGNER_DECODE_ERROR'
  | 'SIGNER_ENCODE_ERROR'
  | 'SIGNER_KDF_ERROR'
  | 'SIGNER_CRYPTO_ERROR'
  | 'SIGNER_UTF8_ERROR'
  | 'SIGNER_UNSUPPORTED'
  | 'SIGNER_INTERNAL'
  | 'WORKER_RUNTIME_ERROR'
  | 'WORKER_POSTMESSAGE_ERROR'
  | 'WORKER_PROTOCOL_ERROR'
  | 'TIMEOUT';

const DEFAULT_SIGNER_HOST_ERROR_CODE: SignerHostErrorCode = 'SIGNER_INTERNAL';

export class SignerWorkerOperationError extends Error {
  readonly code: string;
  readonly coreCode?: string;
  readonly workerKind?: SignerWorkerKind;

  constructor(args: {
    message: string;
    code?: string | null;
    coreCode?: string | null;
    workerKind?: SignerWorkerKind;
  }) {
    super(args.message);
    this.name = 'SignerWorkerOperationError';
    this.code = (args.code || DEFAULT_SIGNER_HOST_ERROR_CODE).trim();
    this.coreCode = args.coreCode?.trim() || undefined;
    this.workerKind = args.workerKind;
  }
}

export function getSignerWorkerOperationErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  const trimmed = code.trim();
  return trimmed.length ? trimmed : undefined;
}

export function getSignerWorkerOperationCoreCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { coreCode?: unknown }).coreCode;
  if (typeof code !== 'string') return undefined;
  const trimmed = code.trim();
  return trimmed.length ? trimmed : undefined;
}
