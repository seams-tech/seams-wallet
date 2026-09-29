import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';
import type { ThresholdEcdsaChainTarget } from '../../interfaces/ecdsaChainTarget';
import {
  buildEcdsaSessionIdentity,
  buildEcdsaSessionProvisionPlan,
  type EcdsaSigningKeyContext,
  type PasskeyEcdsaProvisionSecretSource,
} from './ecdsaProvisionPlan';
declare const chainTarget: ThresholdEcdsaChainTarget;
declare const webauthnAuthentication: WebAuthnAuthenticationCredential;

const identity = buildEcdsaSessionIdentity({
  thresholdSessionId: 'threshold-session-1',
});
export const signingKeyContext = {
  ecdsaThresholdKeyId: 'ecdsa-key-1',
  participantIds: [1, 2],
} satisfies EcdsaSigningKeyContext;

const invalidUnbrandedPasskeySecret: PasskeyEcdsaProvisionSecretSource = {
  kind: 'webauthn_prf_first_v1',
  // @ts-expect-error PRF.first must be normalized by the branch-specific builder.
  passkeyPrfFirstB64u: 'prf-first',
  webauthnAuthentication,
};
void invalidUnbrandedPasskeySecret;

void buildEcdsaSessionProvisionPlan({
  // @ts-expect-error Record-backed reconnect is a retired lifecycle branch.
  kind: 'ecdsa_session_reconnect',
  chainTarget,
  sessionIdentity: identity,
  sessionBudgetUses: 1,
});

export {};
