import type { NearEd25519WalletSessionAuthorizationDisposition } from '../../packages/wallet/src/core/signingEngine/session/material/nearEd25519YaoSigningPreparation';
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
