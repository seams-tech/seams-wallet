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
