import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { RouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import type {
  PasskeyWalletAuthAuthority,
  WalletAuthAuthority,
  WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import type { WebAuthnAuthenticationCredential } from '../../../../core/types';
import { thresholdEd25519AuthorityScopeFromWalletAuthAuthority } from '../../../../core/ThresholdService/validation';
import type { WalletRegistrationEd25519YaoBootstrapSession } from '@shared/utils/registrationContracts';
import type { RouterAbEd25519YaoActiveCapabilityDescriptorV1 } from '../recovery/routerAbEd25519YaoRecovery';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import type {
  WalletSessionAlreadyCommittedResponseV1,
  WalletSessionRejectionV1,
} from '@shared/authorization/walletSessionIssuance';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { ThresholdEd25519SessionId } from '@shared/utils/domainIds';
import type {
  RouterAbEd25519OperationStepUpMaterialRecoveryRequest,
  RouterAbEd25519OperationStepUpMaterialRecoveryResponse,
} from '@shared/utils/routerAbNormalSigningIdentity';
import type { VerifiedOwnerProof } from '../../../../authorization/factorEvidence';

export type RouterAbEd25519YaoSessionPolicyV1 = {
  readonly version: 'threshold_session_v1';
  readonly nearAccountId: string;
  readonly nearEd25519SigningKeyId: string;
  readonly authority: WalletAuthAuthority;
  readonly relayerKeyId: string;
  readonly thresholdSessionId: ThresholdEd25519SessionId;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly routerAbNormalSigning: RouterAbEd25519NormalSigningState;
  readonly participantIds: readonly [number, number];
  readonly ttlMs: number;
  readonly remainingUses: number;
};

export type RouterAbEd25519YaoSessionRouteCommandV1 = {
  readonly relayerKeyId: string;
  readonly sessionPolicy: RouterAbEd25519YaoSessionPolicyV1;
  readonly projectEnvironmentId?: string;
  readonly routeAuth: {
    readonly kind: 'passkey';
    readonly webauthnAuthentication: WebAuthnAuthenticationCredential;
  };
  readonly walletSessionTarget: { readonly kind: 'new_wallet_session' };
  readonly sessionKind: 'opaque';
};

type RouterAbEd25519YaoOperationStepUpMaterialRecoveryRequest =
  Readonly<RouterAbEd25519OperationStepUpMaterialRecoveryRequest>;

export type RouterAbEd25519YaoOperationStepUpMaterialRecoveryResponse =
  Readonly<RouterAbEd25519OperationStepUpMaterialRecoveryResponse>;

type RouterAbEd25519YaoOperationStepUpGrantCommandBase = {
  readonly kind: 'router_ab_ed25519_yao_operation_step_up_grant_v1';
  readonly normalSigningRequest: Record<string, unknown>;
  readonly displayDigest: string;
};

export type RouterAbEd25519YaoOperationStepUpGrantCommandV1 =
  RouterAbEd25519YaoOperationStepUpGrantCommandBase &
    (
      | {
          readonly proof: {
            readonly kind: 'passkey';
            readonly authority: PasskeyWalletAuthAuthority;
            readonly webauthnAuthentication: WebAuthnAuthenticationCredential;
            readonly challengeId?: never;
            readonly otpCode?: never;
          };
          readonly materialRecovery: Extract<
            RouterAbEd25519YaoOperationStepUpMaterialRecoveryRequest,
            { kind: 'not_requested' }
          >;
        }
      | {
          readonly proof: {
            readonly kind: 'email_otp';
            readonly authorityRef: WalletAuthAuthorityRef;
            readonly providerSubjectId: string;
            readonly challengeId: string;
            readonly otpCode: string;
            readonly webauthnAuthentication?: never;
            readonly authority?: never;
          };
          readonly materialRecovery: RouterAbEd25519YaoOperationStepUpMaterialRecoveryRequest;
        }
    );

export type RouterAbEd25519YaoBudgetRefreshAuthorizationV1 = {
  readonly kind: 'verified_passkey_assertion_router_ab_ed25519_yao_budget_refresh_v1';
  readonly authority: PasskeyWalletAuthAuthority;
  readonly proof: Extract<VerifiedOwnerProof, { readonly purpose: 'wallet_session' }>;
  readonly verifiedChallengeId: string;
};

export type RouterAbEd25519YaoBudgetRefreshRequestV1 =
  {
    readonly kind: 'router_ab_ed25519_yao_budget_refresh_v1';
    readonly sessionPolicy: RouterAbEd25519YaoSessionPolicyV1;
    readonly authorization: RouterAbEd25519YaoBudgetRefreshAuthorizationV1;
  };

export type RouterAbEd25519YaoAlreadyCommittedResponseV1 = WalletSessionAlreadyCommittedResponseV1;

type RouterAbEd25519YaoBudgetRefreshSessionV1 = {
  readonly ok: true;
  readonly walletId: string;
  readonly nearAccountId: string;
  readonly nearEd25519SigningKeyId: string;
  readonly authorityScope: ReturnType<typeof thresholdEd25519AuthorityScopeFromWalletAuthAuthority>;
  readonly thresholdSessionId: string;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly walletSessionId: WalletSessionId;
  readonly quotaId: MpcWalletSigningQuotaId;
  readonly expiresAtMs: number;
  readonly expiresAt: string;
  readonly participantIds: readonly [number, number];
  readonly remainingUses: number;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

export type RouterAbEd25519YaoBudgetRefreshResponseV1 =
  | (RouterAbEd25519YaoBudgetRefreshSessionV1 & {
      readonly sessionKind: 'issued_exact_wallet_session';
      readonly operationCredential: WalletSessionOperationCredentialV1;
    })
  | (RouterAbEd25519YaoBudgetRefreshSessionV1 & {
      readonly sessionKind: 'already_committed_exact_wallet_session';
      readonly operationCredential?: never;
    })
  | RouterAbEd25519YaoAlreadyCommittedResponseV1
  | WalletSessionRejectionV1;

type RouterAbEd25519YaoVerifiedWalletUnlockRequestBaseV1 = {
  readonly walletId: string;
  readonly signerSlot: number;
  readonly remainingUses: number;
  readonly verifiedChallengeId: string;
  readonly authority: WalletAuthAuthority;
  readonly proof: Extract<VerifiedOwnerProof, { readonly purpose: 'wallet_session' }>;
};

type RouterAbEd25519YaoWalletSessionIdentityV1 =
  | { readonly kind: 'new_wallet_session' }
  | {
      readonly kind: 'reuse_wallet_session_v2';
      readonly authorizationId: WalletSessionAuthorizationId;
      readonly walletSessionId: WalletSessionId;
      readonly quotaId: MpcWalletSigningQuotaId;
      readonly expiresAtMs: number;
      readonly remainingUses: number;
    };

export type RouterAbEd25519YaoVerifiedWalletUnlockRequestV1 =
  RouterAbEd25519YaoVerifiedWalletUnlockRequestBaseV1 & {
    readonly walletSessionIdentity: RouterAbEd25519YaoWalletSessionIdentityV1;
  };

export type RouterAbEd25519YaoVerifiedWalletUnlockResponseV1 =
  | {
      readonly ok: true;
      readonly session: WalletRegistrationEd25519YaoBootstrapSession;
      readonly capability: RouterAbEd25519YaoActiveCapabilityDescriptorV1;
    }
  | RouterAbEd25519YaoAlreadyCommittedResponseV1
  | WalletSessionRejectionV1;
