import type {
  CredentialIdB64u,
  EcdsaRoleLocalReadyRecord,
  EmailOtpWorkerIssuedSessionHandle,
  RelayerKeyId,
} from '@/core/platform';
import type { AccountId } from '@/core/types/accountIds';
import type {
  EvmEip155ChainTarget,
  TempoChainTarget,
  ThresholdEcdsaChainTarget,
  WalletId,
} from '../interfaces/ecdsaChainTarget';
import type {
  NearDelegateActionPayload,
  NearDelegateActionResult,
  NearNep413Payload,
  NearNep413Result,
  NearTransactionWithActionsPayload,
  NearTransactionWithActionsResult,
} from '../interfaces/near';
import type { EvmAddress, EvmSigningRequest, Hex } from '../chains/evm/evmSigning.types';
import type { TempoSigningRequest } from '../chains/tempo/tempoSigning.types';
import type { EmailOtpAuthSubjectId } from '../session/identity/emailOtpEcdsaDerivationIdentity';
import type { RpId } from '../session/identity/evmFamilyEcdsaIdentity';
import type {
  EmailOtpChallengeId,
  SigningOperationId,
  ThresholdSessionId,
} from '../session/operationState/types';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];
type PositiveInt = number & { readonly __brand: 'PositiveInt' };
export type UnixTimeMs = number & { readonly __brand: 'UnixTimeMs' };
type IdempotencyKey = string & { readonly __brand: 'IdempotencyKey' };
export type Ed25519RelayerKeyId = RelayerKeyId & { readonly __curve: 'ed25519' };
export type EcdsaRelayerKeyId = RelayerKeyId & { readonly __curve: 'ecdsa' };
export type WarmSessionRemainingUses = number & {
  readonly __brand: 'WarmSessionRemainingUses';
};

type UseCaseFailureSource =
  | 'authenticator'
  | 'email_otp'
  | 'signer_crypto'
  | 'storage'
  | 'relayer'
  | 'http'
  | 'budget'
  | 'presign_pool'
  | 'clock'
  | 'random'
  | 'domain';

export type UseCaseFailure<Code extends string> = {
  ok: false;
  code: Code;
  source: UseCaseFailureSource;
  message: string;
  retryable: boolean;
  cause?: unknown;
  value?: never;
};

export function useCaseFailure<Code extends string>(input: {
  code: Code;
  source: UseCaseFailureSource;
  message: string;
  retryable: boolean;
  cause?: unknown;
}): UseCaseFailure<Code> {
  return {
    ok: false,
    code: input.code,
    source: input.source,
    message: input.message,
    retryable: input.retryable,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  };
}

type ConfiguredEcdsaTargets = {
  kind: 'configured';
  targets?: never;
};

type ExplicitEcdsaTargets = {
  kind: 'explicit';
  targets: NonEmptyReadonlyArray<ThresholdEcdsaChainTarget>;
};

type EcdsaTargetSelection = ConfiguredEcdsaTargets | ExplicitEcdsaTargets;

export type ReadyEd25519Lane = {
  kind: 'ed25519_ready_lane_v1';
  walletId: WalletId;
  rpId: RpId;
  thresholdSessionId: ThresholdSessionId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  relayerKeyId: Ed25519RelayerKeyId;
  remainingUses: WarmSessionRemainingUses;
  expiresAtMs: UnixTimeMs;
  chainTarget?: never;
  readyRecord?: never;
};

export type EcdsaUseCaseReadyLane = {
  kind: 'ecdsa_ready_lane_v1';
  walletId: WalletId;
  evmFamilySigningKeySlotId?: never;
  rpId: RpId;
  chainTarget: ThresholdEcdsaChainTarget;
  readyRecord: EcdsaRoleLocalReadyRecord;
  relayerKeyId: EcdsaRelayerKeyId;
  thresholdSessionId: ThresholdSessionId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  remainingUses: WarmSessionRemainingUses;
  expiresAtMs: UnixTimeMs;
};

export type ReauthRequiredLane =
  | {
      kind: 'ed25519_reauth_required_v1';
      walletId: WalletId;
      rpId: RpId;
      reason: 'missing_auth' | 'expired_session' | 'stale_sealed_session' | 'malformed_record';
      chainTarget?: never;
    }
  | {
      kind: 'ecdsa_reauth_required_v1';
      walletId: WalletId;
      rpId: RpId;
      chainTarget: ThresholdEcdsaChainTarget;
      reason:
        | 'missing_auth'
        | 'expired_session'
        | 'stale_sealed_session'
        | 'malformed_record'
        | 'missing_ready_material';
    };

export type UseCaseWalletSessionReadiness =
  | {
      kind: 'ready';
      walletId: WalletId;
      ed25519: NonEmptyReadonlyArray<ReadyEd25519Lane>;
      ecdsa: readonly EcdsaUseCaseReadyLane[];
      reauthRequired?: never;
    }
  | {
      kind: 'partial';
      walletId: WalletId;
      ed25519: readonly ReadyEd25519Lane[];
      ecdsa: readonly EcdsaUseCaseReadyLane[];
      reauthRequired: NonEmptyReadonlyArray<ReauthRequiredLane>;
    }
  | {
      kind: 'reauth_required';
      walletId: WalletId;
      ed25519: readonly [];
      ecdsa: readonly [];
      reauthRequired: NonEmptyReadonlyArray<ReauthRequiredLane>;
    };

export type ReadyWalletSessionReadiness = Extract<UseCaseWalletSessionReadiness, { kind: 'ready' }>;

export type WalletPreferenceWrite = {
  kind: 'wallet_preference_write_v1';
  walletId: WalletId;
  rpId: RpId;
};

export type WalletSignerWrite =
  | {
      kind: 'ed25519_wallet_signer_write_v1';
      lane: ReadyEd25519Lane;
      ecdsa?: never;
    }
  | {
      kind: 'ecdsa_wallet_signer_write_v1';
      lane: EcdsaUseCaseReadyLane;
      ed25519?: never;
    };

export type WarmSessionBudgetSpend = {
  kind: 'warm_session_budget_spend_v1';
  walletId: WalletId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  thresholdSessionId: ThresholdSessionId;
  uses: PositiveInt;
  remainingUses: WarmSessionRemainingUses;
};

type AuthenticatorCreateRequest = {
  kind: 'authenticator_create_request_v1';
  challengeB64u: string;
  userHandleB64u: string;
};

type AuthenticatorGetRequest = {
  kind: 'authenticator_get_request_v1';
  challengeB64u: string;
  credentialIdB64u: CredentialIdB64u;
};

export type WebAuthnUserHandle = string & { readonly __brand: 'WebAuthnUserHandle' };
type WebAuthnCredentialId = CredentialIdB64u;
export type EmailAddress = string & { readonly __brand: 'EmailAddress' };
export type EmailOtpCode = string & { readonly __brand: 'EmailOtpCode' };
export type RegisterWalletAuth =
  | {
      kind: 'passkey_registration';
      credentialCreation: AuthenticatorCreateRequest;
      userHandle: WebAuthnUserHandle;
      email?: never;
      otp?: never;
    }
  | {
      kind: 'email_otp_registration';
      email: EmailAddress;
      challengeId: EmailOtpChallengeId;
      otp: EmailOtpCode;
      credentialCreation?: never;
      userHandle?: never;
    };

export type RegisterWalletInput = {
  walletId: WalletId;
  rpId: RpId;
  auth: RegisterWalletAuth;
  ecdsaTargets: EcdsaTargetSelection;
  idempotencyKey: IdempotencyKey;
};

export type RegistrationReadyLanes = {
  ed25519: ReadyEd25519Lane;
  ecdsa: readonly EcdsaUseCaseReadyLane[];
};

export type RegisterWalletSuccess = {
  ok: true;
  walletId: WalletId;
  readiness: ReadyWalletSessionReadiness;
  lanes: RegistrationReadyLanes;
  sealedWrites: NonEmptyReadonlyArray<SigningSessionSealWriteInput>;
  walletPreferenceWrite: WalletPreferenceWrite;
  walletSignerWrites: NonEmptyReadonlyArray<WalletSignerWrite>;
  code?: never;
  message?: never;
  retryable?: never;
};

export type RegisterWalletFailureCode =
  | 'authenticator_failed'
  | 'email_otp_failed'
  | 'wallet_id_collision'
  | 'registration_incomplete'
  | 'stale_identity_mapping'
  | 'signer_crypto_command_failed'
  | 'signer_crypto_invocation_failed'
  | 'relayer_failed'
  | 'storage_failed'
  | 'invalid_state';

export type RegisterWalletResult =
  | RegisterWalletSuccess
  | UseCaseFailure<RegisterWalletFailureCode>;

export type RegisterWalletLifecycleState =
  | ({ kind: 'received_input' } & RegisterWalletInput)
  | {
      kind: 'authenticating';
      walletId: WalletId;
      rpId: RpId;
      auth: RegisterWalletAuth;
      ecdsaTargets: EcdsaTargetSelection;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'provisioning_ed25519';
      walletId: WalletId;
      rpId: RpId;
      auth: RegisterWalletAuth;
      ecdsaTargets: EcdsaTargetSelection;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'provisioning_ecdsa';
      walletId: WalletId;
      rpId: RpId;
      auth: RegisterWalletAuth;
      ecdsaTargets: EcdsaTargetSelection;
      ed25519: ReadyEd25519Lane;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'sealing_sessions';
      walletId: WalletId;
      rpId: RpId;
      lanes: RegistrationReadyLanes;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'persisting_wallet';
      walletId: WalletId;
      readiness: ReadyWalletSessionReadiness;
      lanes: RegistrationReadyLanes;
      sealedWrites: NonEmptyReadonlyArray<SigningSessionSealWriteInput>;
      idempotencyKey: IdempotencyKey;
    }
  | ({ kind: 'ready' } & RegisterWalletSuccess)
  | ({
      kind: 'failed';
      value?: never;
    } & UseCaseFailure<RegisterWalletFailureCode>);

export type UnlockWalletAuth =
  | {
      kind: 'passkey_unlock';
      credentialId: WebAuthnCredentialId;
      assertionRequest: AuthenticatorGetRequest;
      challengeId?: never;
      otp?: never;
    }
  | {
      kind: 'email_otp_unlock';
      challengeId: EmailOtpChallengeId;
      otp: EmailOtpCode;
      credentialId?: never;
      assertionRequest?: never;
    };

export type UnlockWalletInput = {
  walletId: WalletId;
  rpId: RpId;
  auth: UnlockWalletAuth;
  ecdsaTargets: EcdsaTargetSelection;
  idempotencyKey: IdempotencyKey;
};

export type UnlockWalletSuccess = {
  ok: true;
  walletId: WalletId;
  readiness: UseCaseWalletSessionReadiness;
  restored: readonly (ReadyEd25519Lane | EcdsaUseCaseReadyLane)[];
  provisioned: readonly EcdsaUseCaseReadyLane[];
  sealedWrites: NonEmptyReadonlyArray<SigningSessionSealWriteInput>;
  code?: never;
  message?: never;
  retryable?: never;
};

export type UnlockWalletFailureCode =
  | 'missing_auth'
  | 'authenticator_failed'
  | 'email_otp_failed'
  | 'session_expired'
  | 'stale_sealed_session'
  | 'storage_cleanup_failed'
  | 'signer_crypto_command_failed'
  | 'signer_crypto_invocation_failed'
  | 'relayer_failed'
  | 'budget_exhausted'
  | 'invalid_state';

export type UnlockWalletResult = UnlockWalletSuccess | UseCaseFailure<UnlockWalletFailureCode>;

export type UnlockWalletLifecycleState =
  | ({ kind: 'received_input' } & UnlockWalletInput)
  | {
      kind: 'authenticating';
      walletId: WalletId;
      rpId: RpId;
      auth: UnlockWalletAuth;
      ecdsaTargets: EcdsaTargetSelection;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'restoring_sessions';
      walletId: WalletId;
      rpId: RpId;
      auth: UnlockWalletAuth;
      ecdsaTargets: EcdsaTargetSelection;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'provisioning_missing_ecdsa';
      walletId: WalletId;
      rpId: RpId;
      restored: readonly (ReadyEd25519Lane | EcdsaUseCaseReadyLane)[];
      ecdsaTargets: EcdsaTargetSelection;
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'sealing_sessions';
      walletId: WalletId;
      restored: readonly (ReadyEd25519Lane | EcdsaUseCaseReadyLane)[];
      provisioned: readonly EcdsaUseCaseReadyLane[];
      idempotencyKey: IdempotencyKey;
    }
  | {
      kind: 'ready';
      result: UnlockWalletSuccess;
      failed?: never;
    }
  | ({
      kind: 'failed';
      result?: never;
    } & UseCaseFailure<UnlockWalletFailureCode>);

type SigningSessionActivationPasskeyAuth = {
  kind: 'passkey';
  walletId: WalletId;
  rpId: RpId;
  credentialIdB64u: CredentialIdB64u;
  authSubjectId?: never;
  workerHandle?: never;
};

export type SigningSessionActivationEmailOtpEd25519Auth = {
  kind: 'email_otp';
  walletId: WalletId;
  rpId: RpId;
  authSubjectId: EmailOtpAuthSubjectId;
  workerHandle: Extract<EmailOtpWorkerIssuedSessionHandle, { action: 'threshold_ed25519_session' }>;
  credentialIdB64u?: never;
  evmFamilySigningKeySlotId?: never;
};

export type SigningSessionActivationEmailOtpEcdsaAuth = {
  kind: 'email_otp';
  walletId: WalletId;
  evmFamilySigningKeySlotId?: never;
  authSubjectId: EmailOtpAuthSubjectId;
  workerHandle: Extract<EmailOtpWorkerIssuedSessionHandle, { action: 'threshold_ecdsa_bootstrap' }>;
  rpId?: never;
  credentialIdB64u?: never;
};

type SigningSessionActivationEmailOtpAuth =
  | SigningSessionActivationEmailOtpEd25519Auth
  | SigningSessionActivationEmailOtpEcdsaAuth;

export type SigningSessionActivationAuth =
  | SigningSessionActivationPasskeyAuth
  | SigningSessionActivationEmailOtpAuth;

export type SigningSessionActivationMaterial =
  | {
      kind: 'ed25519_session';
      thresholdSessionId: ThresholdSessionId;
      relayerKeyId: Ed25519RelayerKeyId;
      record?: never;
    }
  | {
      kind: 'ecdsa_session';
      thresholdSessionId: ThresholdSessionId;
      record: EcdsaRoleLocalReadyRecord;
      relayerKeyId?: never;
    };

export type SigningSessionSealWriteInput =
  | {
      kind: 'passkey_ed25519_seal_write_v1';
      auth: SigningSessionActivationPasskeyAuth;
      material: Extract<SigningSessionActivationMaterial, { kind: 'ed25519_session' }>;
      expiresAtMs: UnixTimeMs;
      remainingUses: WarmSessionRemainingUses;
    }
  | {
      kind: 'passkey_ecdsa_seal_write_v1';
      auth: SigningSessionActivationPasskeyAuth;
      material: Extract<SigningSessionActivationMaterial, { kind: 'ecdsa_session' }>;
      expiresAtMs: UnixTimeMs;
      remainingUses: WarmSessionRemainingUses;
    }
  | {
      kind: 'email_otp_ed25519_seal_write_v1';
      auth: SigningSessionActivationEmailOtpEd25519Auth;
      material: Extract<SigningSessionActivationMaterial, { kind: 'ed25519_session' }>;
      expiresAtMs: UnixTimeMs;
      remainingUses: WarmSessionRemainingUses;
    }
  | {
      kind: 'email_otp_ecdsa_seal_write_v1';
      auth: SigningSessionActivationEmailOtpEcdsaAuth;
      material: Extract<SigningSessionActivationMaterial, { kind: 'ecdsa_session' }>;
      expiresAtMs: UnixTimeMs;
      remainingUses: WarmSessionRemainingUses;
    };

type SignEvmFamilyAuthPolicy =
  | { kind: 'warm_session_only'; auth?: never }
  | {
      kind: 'warm_session_or_same_method_step_up';
      auth: SigningSessionActivationAuth;
    };

export type SignEvmFamilyInput =
  | {
      kind: 'evm_transaction';
      operationId: SigningOperationId;
      walletId: WalletId;
      rpId: RpId;
      chainTarget: EvmEip155ChainTarget;
      request: EvmSigningRequest;
      authPolicy: SignEvmFamilyAuthPolicy;
    }
  | {
      kind: 'tempo_transaction';
      operationId: SigningOperationId;
      walletId: WalletId;
      rpId: RpId;
      chainTarget: TempoChainTarget;
      request: TempoSigningRequest;
      authPolicy: SignEvmFamilyAuthPolicy;
    };

type EvmSignature = {
  kind: 'ecdsa_secp256k1_signature_v1';
  signatureHex: Hex;
};

type TempoTransactionHash = Hex & { readonly __brand: 'TempoTransactionHash' };

type SignEvmFamilySuccessBase = {
  ok: true;
  walletId: WalletId;
  usedAuth: 'warm_session' | 'same_method_step_up';
  signerLane: EcdsaUseCaseReadyLane;
  budgetSpend: WarmSessionBudgetSpend;
  code?: never;
  message?: never;
  retryable?: never;
};

export type SignEvmFamilySuccess =
  | (SignEvmFamilySuccessBase & {
      kind: 'evm_transaction';
      chainTarget: EvmEip155ChainTarget;
      result: {
        kind: 'evm_signature';
        signature: EvmSignature;
        nonceSender: EvmAddress;
      };
    })
  | (SignEvmFamilySuccessBase & {
      kind: 'tempo_transaction';
      chainTarget: TempoChainTarget;
      result: {
        kind: 'tempo_submission';
        signature: EvmSignature;
        nonceSender: EvmAddress;
        transactionHash: TempoTransactionHash;
      };
    });

export type SignEvmFamilyFailureCode =
  | 'missing_ready_ecdsa_material'
  | 'auth_mismatch'
  | 'budget_exhausted'
  | 'relayer_failed'
  | 'signer_failed'
  | 'ambiguous_signer_selection'
  | 'nonce_sender_unavailable'
  | 'chain_target_mismatch'
  | 'invalid_state';

export type SignEvmFamilyResult = SignEvmFamilySuccess | UseCaseFailure<SignEvmFamilyFailureCode>;

export type SignEvmFamilyLifecycleState =
  | {
      kind: 'received_input';
      input: SignEvmFamilyInput;
    }
  | {
      kind: 'resolving_ready_lane';
      input: SignEvmFamilyInput;
    }
  | {
      kind: 'activating_same_method_session';
      input: SignEvmFamilyInput;
      staleLane: EcdsaUseCaseReadyLane | ReauthRequiredLane;
    }
  | {
      kind: 'reserving_budget';
      input: SignEvmFamilyInput;
      lane: EcdsaUseCaseReadyLane;
    }
  | {
      kind: 'signing';
      input: SignEvmFamilyInput;
      lane: EcdsaUseCaseReadyLane;
      budgetSpend: WarmSessionBudgetSpend;
    }
  | {
      kind: 'signed';
      result: SignEvmFamilySuccess;
      failed?: never;
    }
  | ({
      kind: 'failed';
      result?: never;
    } & UseCaseFailure<SignEvmFamilyFailureCode>);

export type NearTransactionDigest = string & { readonly __brand: 'NearTransactionDigest' };
type Nep413Digest = string & { readonly __brand: 'Nep413Digest' };
type NearDelegateActionDigest = string & { readonly __brand: 'NearDelegateActionDigest' };
type Nep413Scope = string & { readonly __brand: 'Nep413Scope' };
type NearDelegateActionScope = string & { readonly __brand: 'NearDelegateActionScope' };

type SignNearAuthPolicy =
  | { kind: 'warm_session_only'; auth?: never }
  | {
      kind: 'warm_session_or_same_method_step_up';
      auth: SigningSessionActivationAuth;
    };

export type SignNearInput =
  | {
      kind: 'transaction_with_actions';
      operationId: SigningOperationId;
      walletId: WalletId;
      rpId: RpId;
      accountId: AccountId;
      request: NearTransactionWithActionsPayload;
      transactionDigests: NonEmptyReadonlyArray<NearTransactionDigest>;
      requiredSignatureUses: PositiveInt;
      authPolicy: SignNearAuthPolicy;
    }
  | {
      kind: 'nep413_message';
      operationId: SigningOperationId;
      walletId: WalletId;
      rpId: RpId;
      accountId: AccountId;
      request: NearNep413Payload;
      digest: Nep413Digest;
      scope: Nep413Scope;
      authPolicy: SignNearAuthPolicy;
    }
  | {
      kind: 'delegate_action';
      operationId: SigningOperationId;
      walletId: WalletId;
      rpId: RpId;
      accountId: AccountId;
      request: NearDelegateActionPayload;
      digest: NearDelegateActionDigest;
      scope: NearDelegateActionScope;
      authPolicy: SignNearAuthPolicy;
    };

type SignNearSuccessBase = {
  ok: true;
  walletId: WalletId;
  accountId: AccountId;
  usedAuth: 'warm_session' | 'same_method_step_up';
  signerLane: ReadyEd25519Lane;
  signingPath: 'presign_pool' | 'two_rtt_fallback' | 'same_method_step_up';
  budgetSpend: WarmSessionBudgetSpend;
  code?: never;
  message?: never;
  retryable?: never;
};

export type SignNearSuccess =
  | (SignNearSuccessBase & {
      kind: 'transaction_with_actions';
      transactionDigests: NonEmptyReadonlyArray<NearTransactionDigest>;
      result: {
        kind: 'near_transaction_with_actions';
        signed: NearTransactionWithActionsResult;
      };
    })
  | (SignNearSuccessBase & {
      kind: 'nep413_message';
      digest: Nep413Digest;
      scope: Nep413Scope;
      result: {
        kind: 'nep413_message';
        signedMessage: NearNep413Result;
      };
    })
  | (SignNearSuccessBase & {
      kind: 'delegate_action';
      digest: NearDelegateActionDigest;
      scope: NearDelegateActionScope;
      result: {
        kind: 'near_delegate_action';
        signedDelegate: NearDelegateActionResult;
      };
    });

export type SignNearFailureCode =
  | 'missing_ready_ed25519_material'
  | 'budget_exhausted'
  | 'presign_pool_failed'
  | 'relayer_failed'
  | 'digest_mismatch'
  | 'scope_mismatch'
  | 'ambiguous_lane_selection'
  | 'step_up_required'
  | 'dispatch_ambiguous'
  | 'invalid_state';

export type SignNearResult = SignNearSuccess | UseCaseFailure<SignNearFailureCode>;

export type SignNearLifecycleState =
  | {
      kind: 'received_input';
      input: SignNearInput;
    }
  | {
      kind: 'resolving_ready_lane';
      input: SignNearInput;
    }
  | {
      kind: 'validating_request';
      input: SignNearInput;
      lane: ReadyEd25519Lane;
    }
  | {
      kind: 'reserving_budget';
      input: SignNearInput;
      lane: ReadyEd25519Lane;
    }
  | {
      kind: 'signing';
      input: SignNearInput;
      lane: ReadyEd25519Lane;
      budgetSpend: WarmSessionBudgetSpend;
    }
  | {
      kind: 'signed';
      result: SignNearSuccess;
      failed?: never;
    }
  | ({
      kind: 'failed';
      result?: never;
    } & UseCaseFailure<SignNearFailureCode>);
