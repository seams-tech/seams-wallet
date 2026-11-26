import { thresholdEcdsaChainTargetFromChainFamily } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  buildEmailOtpRoutePlan,
  type EmailOtpSigningSessionAuthLane,
} from '../../stepUpConfirmation/otpPrompt/authLane';
import {
  type EmailOtpEcdsaBootstrapAuthorization,
  type EmailOtpEcdsaBootstrapRouteAuth,
} from './routePlan';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';

declare const operationCredential: WalletSessionOperationCredentialV1;

const chainTarget = thresholdEcdsaChainTargetFromChainFamily({
  chain: 'tempo',
  chainId: 42431,
});
void ({
  kind: 'signing_session',
  operationCredential,
  thresholdSessionId: 'threshold-session',
  curve: 'ecdsa',
  chainTarget,
} satisfies EmailOtpSigningSessionAuthLane);

void buildEmailOtpRoutePlan({
  routeFamily: 'signing_session',
  authLane: {
    kind: 'signing_session',
    operationCredential,
    thresholdSessionId: 'threshold-session',
    curve: 'ecdsa',
    chainTarget,
  },
  operation: 'transaction_sign',
});

const ecdsaBootstrapRouteAuth = {
  kind: 'threshold_ecdsa_session',
  operationCredential,
  curve: 'ecdsa',
  thresholdSessionId: 'ecdsa-threshold-session',
  chainTarget,
} satisfies EmailOtpEcdsaBootstrapRouteAuth;

void ({
  kind: 'explicit_route_auth',
  routeAuth: ecdsaBootstrapRouteAuth,
} satisfies EmailOtpEcdsaBootstrapAuthorization);

export {};
