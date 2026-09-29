/** Email OTP enrollment: seals a new factor secret with the Router and derives its unlock key. */
import { base64UrlEncode } from '@shared/utils/encoders';
import { toOptionalTrimmedNonEmptyString } from '@shared/utils/validation';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_ACTIONS,
  type WalletEmailOtpChannel,
} from '@shared/utils/emailOtpDomain';
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
import { emailOtpRouteSessionAuth, postEmailOtpChallenge } from './otpVerification';

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

export async function completeEmailOtpEnrollmentFromSecret32(args: {
  relayUrl: string;
  walletId: string;
  userId: string;
  challengeId?: string;
  otpCode?: string;
  groupId: string;
  routePlan: EmailOtpRoutePlan;
  clientSecret32?: Uint8Array;
  returnClientSecret32?: boolean;
  skipServerFinalize?: boolean;
  googleEmailOtpRegistrationAttemptId?: string;
  onProgress?: (code: EmailOtpWorkerProgressCode) => void;
}): Promise<{
  challengeId: string;
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
  clientSecret32?: Uint8Array;
}> {
  await ensureEvmCryptoWasm();
  const runtime = await getShamir3PassRuntime();
  const relayUrl = readString(args.relayUrl, 'relayUrl');
  const walletId = readString(args.walletId, 'walletId');
  const userId = resolveEmailOtpAuthSubjectId({
    walletId,
    userId: args.userId,
    routePlan: args.routePlan,
  });
  readSigningSessionSealGroupId(args.groupId);
  const otpCode = args.skipServerFinalize ? '' : readString(args.otpCode, 'otpCode');
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
    let challengeId = toOptionalTrimmedNonEmptyString(args.challengeId);
    if (!challengeId && !args.skipServerFinalize) {
      const challenge = await postEmailOtpChallenge({
        relayUrl,
        routePlan: args.routePlan,
        body: {
          walletId,
          otpChannel: EMAIL_OTP_CHANNEL,
        },
        expectedAction: WALLET_EMAIL_OTP_ACTIONS.registration,
        label: 'Email OTP registration challenge',
      });
      challengeId = readString(
        (challenge.challenge as Record<string, unknown>)?.challengeId,
        'challengeId',
      );
    }
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
    unlockPublicKey33 = secp256k1_private_key_32_to_public_key_33(unlockPrivateKey32) as Uint8Array;
    const clientUnlockPublicKeyB64u = base64UrlEncode(unlockPublicKey33);
    const enrollmentId = emailOtpDeviceEnrollmentId(walletId, userId);
    if (!args.skipServerFinalize) {
      const googleEmailOtpRegistrationAttemptId = toOptionalTrimmedNonEmptyString(
        args.googleEmailOtpRegistrationAttemptId,
      );
      await postEmailOtpJson({
        relayUrl,
        route: emailOtpRoutePath(args.routePlan, 'finalize'),
        ...(sessionAuth ? { sessionAuth } : {}),
        body: {
          walletId,
          challengeId,
          otpCode,
          otpChannel: EMAIL_OTP_CHANNEL,
          enrollmentSealKeyVersion,
          serverSealedFactorCiphertextB64u,
          clientUnlockPublicKeyB64u,
          unlockKeyVersion: EMAIL_OTP_UNLOCK_KEY_VERSION,
          ...(googleEmailOtpRegistrationAttemptId ? { googleEmailOtpRegistrationAttemptId } : {}),
        },
      });
      args.onProgress?.('otp.verify.succeeded');
    }
    args.onProgress?.('signer.email_otp.enroll.started');
    args.onProgress?.('signer.email_otp.enroll.succeeded');

    const returnedClientSecret32 =
      args.returnClientSecret32 && clientSecret32 ? clientSecret32 : null;
    if (returnedClientSecret32) {
      clientSecret32 = null;
    }

    return {
      challengeId: challengeId || '',
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
      ...(returnedClientSecret32 ? { clientSecret32: returnedClientSecret32 } : {}),
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

/** The enrollment facts both enrollment requests return to the main thread. */
export function emailOtpEnrollmentFacts(
  result: Awaited<ReturnType<typeof completeEmailOtpEnrollmentFromSecret32>>,
) {
  return {
    otpChannel: result.otpChannel,
    enrollmentId: result.enrollmentId,
    enrollmentSealKeyVersion: result.enrollmentSealKeyVersion,
    serverSealedFactorCiphertextB64u: result.serverSealedFactorCiphertextB64u,
    clientUnlockPublicKeyB64u: result.clientUnlockPublicKeyB64u,
    unlockKeyVersion: result.unlockKeyVersion,
  };
}
