import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import type { NearEd25519WalletSessionAuthorizationDisposition } from '../../packages/wallet/src/core/signingEngine/session/material/nearEd25519YaoSigningPreparation';
import type { EcdsaSessionPresignaturePrefillInput } from '../../packages/wallet/src/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill';
import type { RouterAbEcdsaDerivationClientPresignatureRefillInput } from '../../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool';
import type {
  AuthorizedEcdsaPreprocessingCapability,
  CanonicalEvmFamilyEcdsaSigningCapability,
} from '../../packages/wallet/src/core/signingEngine/session/material/ecdsaSigningCapability';
import {
  fullWalletLoginRequired,
  invalidWalletSigningMaterial,
} from '../../packages/wallet/src/core/signingEngine/session/material/walletSigningStateFailure';

declare const disposition: NearEd25519WalletSessionAuthorizationDisposition;

switch (disposition.kind) {
  case 'authorized':
    void disposition.authorization;
    break;
  case 'operation_step_up':
  case 'full_login_required':
  case 'temporarily_unavailable':
    void disposition.reason;
    break;
  default:
    disposition satisfies never;
}

// @ts-expect-error An authorized state must carry its exact authorization.
const missingAuthorization: NearEd25519WalletSessionAuthorizationDisposition = {
  kind: 'authorized',
};
void missingAuthorization;

// @ts-expect-error Expiry requires operation-scoped step-up, never full login.
const expiredAsFullLogin: NearEd25519WalletSessionAuthorizationDisposition = {
  kind: 'full_login_required',
  reason: 'expired',
};
void expiredAsFullLogin;

// @ts-expect-error A persistence outage is retryable, never invalid material.
invalidWalletSigningMaterial('persistence_unavailable');

// @ts-expect-error Revoked material requires full login, never recovery classification.
invalidWalletSigningMaterial('revoked');

fullWalletLoginRequired('revoked');
fullWalletLoginRequired('wallet_locked');

declare const authorizedEcdsa: AuthorizedEcdsaPreprocessingCapability;
declare const durableEcdsa: CanonicalEvmFamilyEcdsaSigningCapability;

const prefill: EcdsaSessionPresignaturePrefillInput = { capability: authorizedEcdsa };
void prefill;

const unauthorizedPrefill: EcdsaSessionPresignaturePrefillInput = {
  // @ts-expect-error Durable material alone cannot authorize preprocessing.
  capability: durableEcdsa,
};
void unauthorizedPrefill;

const lostPrefillAuthorization: EcdsaSessionPresignaturePrefillInput = {
  // @ts-expect-error A broad spread cannot erase the exact session proof.
  capability: { ...authorizedEcdsa, authorization: undefined },
};
void lostPrefillAuthorization;

declare const refillInput: RouterAbEcdsaDerivationClientPresignatureRefillInput;
const { keyHandle: _keyHandle, ...refillWithoutKeyHandle } = refillInput;
// @ts-expect-error A refill must name its validated key handle.
const missingRefillKeyHandle: RouterAbEcdsaDerivationClientPresignatureRefillInput =
  refillWithoutKeyHandle;
void missingRefillKeyHandle;

// A step-up response cannot carry reusable session facts, even through a spread.
type NearPrepareResult = Awaited<ReturnType<typeof import('../../packages/wallet/src/core/rpcClients/relayer/routerAbNormalSigning').prepareRouterAbNormalSigningV2>>;
declare const reusableNearPrepare: Variant<NearPrepareResult, 'kind', 'reusable_wallet_session'>;
// @ts-expect-error Changing only the branch cannot retain session authority.
const stepUpWithSession: NearPrepareResult = { ...reusableNearPrepare, kind: 'operation_step_up' };
// @ts-expect-error A reusable prepare result requires its admitted session facts.
const reusableWithoutSession: NearPrepareResult = { kind: 'reusable_wallet_session', signing: reusableNearPrepare.signing };
// @ts-expect-error A direct step-up literal cannot carry session authority.
const stepUpLiteral: NearPrepareResult = {
  kind: 'operation_step_up',
  signing: reusableNearPrepare.signing,
  sessionStatus: reusableNearPrepare.sessionStatus,
};
void [stepUpWithSession, reusableWithoutSession, stepUpLiteral];

type EcdsaStepUpTransport = import('../../packages/wallet/src/core/signingEngine/threshold/ecdsa/operationStepUp').EcdsaOperationStepUpTransport;
declare const authenticatedStepUp: Variant<EcdsaStepUpTransport, 'kind', 'wallet_session'>;
// @ts-expect-error A session transport requires its canonical operation credential.
const credentiallessStepUp: EcdsaStepUpTransport = { kind: 'wallet_session' };
// @ts-expect-error A factor-only export cannot carry session authority through a spread.
const factorOnlyWithSession: EcdsaStepUpTransport = { ...authenticatedStepUp, kind: 'factor_proof' };
void [credentiallessStepUp, factorOnlyWithSession];


import type { EmailOtpRoutePlan } from '../../packages/wallet/src/core/signingEngine/stepUpConfirmation/otpPrompt/authLane';
import { WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION } from '../../packages/shared-ts/src/utils/emailOtpDomain';
declare const emailOtpOperationStepUp: Variant<EmailOtpRoutePlan, 'routeFamily', 'operation_step_up'>;
// @ts-expect-error An operation step-up must carry its exact session credential.
const emailOtpStepUpWithoutCredential: EmailOtpRoutePlan = { routeFamily: 'operation_step_up', operation: WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION };
// @ts-expect-error A spread cannot turn operation step-up into unauthenticated login.
const emailOtpLoginWithStepUpCredential: EmailOtpRoutePlan = { ...emailOtpOperationStepUp, routeFamily: 'login' };
void emailOtpStepUpWithoutCredential;
void emailOtpLoginWithStepUpCredential;

import type {
  RequestEmailOtpTransactionChallengeArgs,
  RequestEmailOtpExportChallengeArgs,
} from '../../packages/wallet/src/core/signingEngine/session/emailOtp/exportRecoveryRuntime';
declare const emailOtpExportLogin: Variant<RequestEmailOtpExportChallengeArgs, 'kind', 'wallet_login_challenge'>;
// @ts-expect-error Transaction signing cannot use an unauthenticated login challenge.
const transactionLoginChallenge: RequestEmailOtpTransactionChallengeArgs = emailOtpExportLogin;
void transactionLoginChallenge;
