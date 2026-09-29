import type {
  MpcWalletSigningQuotaId,
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '../authorization/capabilityKinds';
import type { WalletSessionOperationCredentialV1 } from '../device-linking/contracts';
import type { Ed25519AuthorityScope } from '../threshold/sessionPolicy';
import type { RuntimePolicyScope } from '../threshold/signingRootScope';
import type {
  RegisterWalletInput,
  RegistrationAuthMethodInput,
  RegistrationSignerSetSelection,
  WalletId,
} from './registrationIntent';
import type {
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from './routerAbEd25519Yao';
import type { WALLET_AUTH_METHODS } from './signerDomain';
import type { RouterAbEd25519NormalSigningState } from './signingSessionSeal';
import type { Variant } from './variant';

export type CreateRegistrationIntentRequest = {
  wallet: RegisterWalletInput;
  authMethod: RegistrationAuthMethodInput;
  signerSelection: RegistrationSignerSetSelection;
};

export type WalletRegistrationEd25519YaoStart = {
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
};

export type WalletRegistrationEd25519YaoActivationReference = {
  kind: 'router_ab_ed25519_yao_activation_reference_v1';
  lifecycle_id: string;
  session_id: RouterAbEd25519YaoBytes32V1;
};

export type WalletRegistrationFinalizeAuthMethod =
  | {
      kind: typeof WALLET_AUTH_METHODS.passkey;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
    }
  | {
      kind: typeof WALLET_AUTH_METHODS.emailOtp;
      registrationAuthorityId: string;
    };

export type PasskeyWalletRegistrationFinalizeAuthMethod = Variant<
  WalletRegistrationFinalizeAuthMethod,
  'kind',
  typeof WALLET_AUTH_METHODS.passkey
>;

export type EmailOtpWalletRegistrationFinalizeAuthMethod = Variant<
  WalletRegistrationFinalizeAuthMethod,
  'kind',
  typeof WALLET_AUTH_METHODS.emailOtp
>;

export type WalletRegistrationEd25519YaoSignerRuntimeBootstrap = {
  walletId: WalletId;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: Ed25519AuthorityScope;
  thresholdSessionId: string;
  authorizationId: WalletSessionAuthorizationId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  expiresAtMs: number;
  participantIds: readonly [number, number];
  remainingUses: number;
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicyScope: RuntimePolicyScope;
  routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

/**
 * The Ed25519 Yao view of one exact Wallet Session. A session this response
 * just issued carries its own primary operation credential; a session it
 * reuses carries none, because the credential was delivered once by the
 * issuing response and a committed digest cannot reproduce plaintext.
 */
export type WalletRegistrationEd25519YaoBootstrapSession =
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'issued_exact_wallet_session';
      operationCredential: WalletSessionOperationCredentialV1;
    })
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'already_committed_exact_wallet_session';
      operationCredential?: never;
    });

export type WalletEd25519YaoSignerPublicResult = {
  signerSlot: number;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  publicKey: string;
  relayerKeyId: string;
  keyVersion: string;
  recoveryExportCapable: true;
  participantIds: readonly [number, number];
};
