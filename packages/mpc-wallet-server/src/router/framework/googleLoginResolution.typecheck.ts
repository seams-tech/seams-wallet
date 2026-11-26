import type { RouterApiIdentityService } from './authServicePort';

type Resolution = Awaited<ReturnType<RouterApiIdentityService['resolveGoogleEmailOtpSession']>>;
declare const mismatch: Extract<Resolution, { readonly mode: 'wallet_identity_mismatch' }>;
declare const registration: Extract<Resolution, { readonly mode: 'register_started' }>;
// @ts-expect-error Mismatch must identify its verified provider.
const missingProvider: Resolution = {
  ok: false,
  mode: 'wallet_identity_mismatch',
  code: 'wallet_identity_mismatch',
  walletId: 'wallet',
  message: 'Mismatch',
};
// @ts-expect-error A mismatch cannot expose a registration offer through a spread.
const registrationFailure: Resolution = { ...registration, ...mismatch };
// @ts-expect-error The error code must agree with the mismatch mode.
const wrongCode: Resolution = { ...mismatch, code: 'wallet_id_collision' };
void [missingProvider, registrationFailure, wrongCode];
