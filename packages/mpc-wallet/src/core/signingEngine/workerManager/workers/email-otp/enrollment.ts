/** Email OTP enrollment: enrolls a device factor for a new factor secret and derives its unlock key. */
import { base64UrlEncode } from '@shared/utils/base64';
import {
  EMAIL_OTP_CHANNEL,
  emailOtpDeviceEnrollmentId,
  type WalletEmailOtpChannel,
} from '@shared/utils/emailOtpDomain';
import type { WalletEmailOtpEnrollmentMaterialV1 } from '@shared/utils/registrationAuthMethodInput';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type {
  EmailOtpWalletRegistrationEcdsaPrepareHandleRequest,
  EmailOtpWalletRegistrationEcdsaPrepareHandleResult,
  EmailOtpWorkerProgressCode,
} from '@/core/signingEngine/workerManager/workerTypes';
import { secp256k1_private_key_32_to_public_key_33 } from '../../../../../../../../wasm/evm_crypto/pkg/evm_crypto.js';
import { postEmailOtpJson } from './fetch';
import { enrollEmailOtpDeviceFactor } from './deviceFactor';
import {
  emailOtpRoutePath,
  type EmailOtpRoutePlan,
} from '../../../stepUpConfirmation/otpPrompt/authLane';
import {
  readString,
  requireFixed32ArrayBuffer,
  resolveEmailOtpAuthSubjectId,
} from './payloadParsing';
import {
  deriveEmailOtpUnlockAuthSeedInWorker,
  ensureEvmCryptoWasm,
  generateRandomSecret32,
} from './crypto';
import { emailOtpRouteSessionAuth } from './otpVerification';

const EMAIL_OTP_UNLOCK_KEY_VERSION = 'email-otp-unlock-v1';

export function emailOtpWalletRegistrationEcdsaHandleResult(
  request: EmailOtpWalletRegistrationEcdsaPrepareHandleRequest,
): EmailOtpWalletRegistrationEcdsaPrepareHandleResult {
  if (request.kind === 'requested') {
    throw new Error('Email OTP registration no longer derives an ECDSA root share');
  }
  return { kind: 'not_requested' };
}

export async function prepareEmailOtpEnrollmentFromSecret32(args: {
  relayUrl: string;
  walletId: string;
  userId: string;
  routePlan: EmailOtpRoutePlan;
  clientSecret32?: Uint8Array;
  onProgress?: (code: EmailOtpWorkerProgressCode) => void;
}): Promise<{
  otpChannel: WalletEmailOtpChannel;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  factorNonceB64u: string;
  wrappedFactorB64u: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  emailOtpEnrollment: WalletEmailOtpEnrollmentMaterialV1;
}> {
  await ensureEvmCryptoWasm();
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const userId = resolveEmailOtpAuthSubjectId({ userId: args.userId });
  let clientSecret32: Uint8Array | null = args.clientSecret32
    ? Uint8Array.from(args.clientSecret32)
    : generateRandomSecret32();
  let unlockPrivateKey32: Uint8Array | null = null;
  let unlockPublicKey33: Uint8Array | null = null;
  try {
    const sessionAuth = emailOtpRouteSessionAuth(args.routePlan);
    const enrollmentId = emailOtpDeviceEnrollmentId(walletId, userId);
    const factor = await enrollEmailOtpDeviceFactor({
      walletId,
      enrollmentId,
      factorSecret32: clientSecret32,
      evaluate: (blindedElementB64u) =>
        postEmailOtpJson({
          relayUrl,
          route: emailOtpRoutePath(args.routePlan, 'factor'),
          ...(sessionAuth ? { sessionAuth } : {}),
          body: { walletId, enrollmentId, blindedElementB64u },
        }),
    });

    unlockPrivateKey32 = await deriveEmailOtpUnlockAuthSeedInWorker({
      clientSecret32,
      walletId,
    });
    unlockPublicKey33 = secp256k1_private_key_32_to_public_key_33(unlockPrivateKey32);
    const clientUnlockPublicKeyB64u = base64UrlEncode(unlockPublicKey33);
    args.onProgress?.('signer.email_otp.enroll.started');
    args.onProgress?.('signer.email_otp.enroll.succeeded');

    const emailOtpEnrollment: WalletEmailOtpEnrollmentMaterialV1 = {
      enrollmentSealKeyVersion: factor.enrollmentSealKeyVersion,
      factorNonceB64u: factor.factorNonceB64u,
      wrappedFactorB64u: factor.wrappedFactorB64u,
      clientUnlockPublicKeyB64u,
      unlockKeyVersion: EMAIL_OTP_UNLOCK_KEY_VERSION,
    };
    return {
      otpChannel: EMAIL_OTP_CHANNEL,
      enrollmentId,
      ...emailOtpEnrollment,
      emailOtpEnrollment,
    };
  } finally {
    zeroizeBytes(clientSecret32);
    zeroizeBytes(unlockPrivateKey32);
    zeroizeBytes(unlockPublicKey33);
    clientSecret32 = null;
  }
}

/** A caller-chosen enrollment factor secret, when the request carries one. */
export function enrollmentClientSecret32(value: ArrayBuffer | undefined): {
  clientSecret32?: Uint8Array;
} {
  return value instanceof ArrayBuffer
    ? { clientSecret32: requireFixed32ArrayBuffer(value, 'clientSecret32') }
    : {};
}
