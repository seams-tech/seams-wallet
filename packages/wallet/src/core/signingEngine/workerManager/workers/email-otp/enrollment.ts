/** Email OTP enrollment: seals a new factor secret with the Router and derives its unlock key. */
import { base64UrlEncode } from '@shared/utils/base64';
import { EMAIL_OTP_CHANNEL, type WalletEmailOtpChannel } from '@shared/utils/emailOtpDomain';
import { SIGNING_SESSION_SEAL_GROUP_ID } from '@shared/utils/signingSessionSeal';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type {
  EmailOtpWalletRegistrationEcdsaPrepareHandleRequest,
  EmailOtpWalletRegistrationEcdsaPrepareHandleResult,
  EmailOtpWorkerProgressCode,
} from '@/core/signingEngine/workerManager/workerTypes';
import { secp256k1_private_key_32_to_public_key_33 } from '../../../../../../../../wasm/evm_crypto/pkg/evm_crypto.js';
import { postEmailOtpJson } from './fetch';
import { getShamir3PassRuntime } from '../shamir3pass/runtime';
import {
  emailOtpRoutePath,
  type EmailOtpRoutePlan,
} from '../../../stepUpConfirmation/otpPrompt/authLane';
import {
  readSigningSessionSealGroupId,
  readString,
  requireFixed32ArrayBuffer,
  resolveEmailOtpAuthSubjectId,
} from './payloadParsing';
import {
  addClientSealFromBytes,
  deriveEmailOtpUnlockAuthSeedInWorker,
  ensureEvmCryptoWasm,
  generateRandomSecret32,
} from './crypto';
import { emailOtpRouteSessionAuth } from './otpVerification';

const EMAIL_OTP_UNLOCK_KEY_VERSION = 'email-otp-unlock-v1';

function emailOtpDeviceEnrollmentId(walletId: string, authSubjectId: string): string {
  return `email-otp-device-enrollment-v1:${walletId}:${authSubjectId}`;
}

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
  groupId: string;
  routePlan: EmailOtpRoutePlan;
  clientSecret32?: Uint8Array;
  onProgress?: (code: EmailOtpWorkerProgressCode) => void;
}): Promise<{
  otpChannel: WalletEmailOtpChannel;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  emailOtpEnrollment: {
    enrollmentSealKeyVersion: string;
    serverSealedFactorCiphertextB64u: string;
    clientUnlockPublicKeyB64u: string;
    unlockKeyVersion: string;
  };
}> {
  await ensureEvmCryptoWasm();
  const runtime = await getShamir3PassRuntime();
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const userId = resolveEmailOtpAuthSubjectId({ userId: args.userId });
  readSigningSessionSealGroupId(args.groupId);
  const keyHandle = readString(
    (await runtime.createClientKeyHandle({ groupId: SIGNING_SESSION_SEAL_GROUP_ID })).keyHandle,
    'keyHandle',
  );
  let clientSecret32: Uint8Array | null = args.clientSecret32
    ? Uint8Array.from(args.clientSecret32)
    : generateRandomSecret32();
  let unlockPrivateKey32: Uint8Array | null = null;
  let unlockPublicKey33: Uint8Array | null = null;
  try {
    const sessionAuth = emailOtpRouteSessionAuth(args.routePlan);
    const wrappedCiphertext = await addClientSealFromBytes({
      runtime,
      keyHandle,
      ciphertext: clientSecret32,
    });
    const applied = await postEmailOtpJson({
      relayUrl,
      route: emailOtpRoutePath(args.routePlan, 'seal'),
      ...(sessionAuth ? { sessionAuth } : {}),
      body: {
        walletId,
        wrappedCiphertext,
      },
    });
    const enrollmentSealKeyVersion = readString(
      applied.enrollmentSealKeyVersion,
      'enrollmentSealKeyVersion',
    );
    const clientCiphertext = readString(applied.ciphertext, 'ciphertext');
    const serverSealedFactorCiphertextB64u = readString(
      await runtime.removeClientSealWithKeyHandle({
        ciphertextB64u: clientCiphertext,
        keyHandle,
      }),
      'serverSealedFactorCiphertextB64u',
    );

    unlockPrivateKey32 = await deriveEmailOtpUnlockAuthSeedInWorker({
      clientSecret32,
      walletId,
    });
    unlockPublicKey33 = secp256k1_private_key_32_to_public_key_33(unlockPrivateKey32);
    const clientUnlockPublicKeyB64u = base64UrlEncode(unlockPublicKey33);
    const enrollmentId = emailOtpDeviceEnrollmentId(walletId, userId);
    args.onProgress?.('signer.email_otp.enroll.started');
    args.onProgress?.('signer.email_otp.enroll.succeeded');

    return {
      otpChannel: EMAIL_OTP_CHANNEL,
      enrollmentId,
      enrollmentSealKeyVersion,
      serverSealedFactorCiphertextB64u,
      clientUnlockPublicKeyB64u,
      unlockKeyVersion: EMAIL_OTP_UNLOCK_KEY_VERSION,
      emailOtpEnrollment: {
        enrollmentSealKeyVersion,
        serverSealedFactorCiphertextB64u,
        clientUnlockPublicKeyB64u,
        unlockKeyVersion: EMAIL_OTP_UNLOCK_KEY_VERSION,
      },
    };
  } finally {
    zeroizeBytes(clientSecret32);
    zeroizeBytes(unlockPrivateKey32);
    zeroizeBytes(unlockPublicKey33);
    await runtime.destroyClientKeyHandle({ keyHandle }).catch(() => undefined);
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
