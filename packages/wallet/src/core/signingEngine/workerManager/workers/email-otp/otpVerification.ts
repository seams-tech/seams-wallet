/** OTP challenges and the factor release that a verified OTP, grant or Wallet Session unlocks. */
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { asRecord } from '@shared/utils/validation';
import { normalizeOptionalTrimmedString } from '@shared/utils/normalize';
import type { WalletEmailOtpOperation } from '@shared/utils/emailOtpDomain';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { parseEmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/challengeDelivery';
import {
  parseEmailOtpUnlockEd25519Identity,
  parseEmailOtpUnlockEd25519Selection,
} from '@/core/signingEngine/session/emailOtp/publicTypes';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type {
  EmailOtpAuthoritySelector,
  EmailOtpWorkerOperationMap,
} from '@/core/signingEngine/workerManager/workerTypes';
import { postEmailOtpJson } from './fetch';
import {
  emailOtpRoutePath,
  type EmailOtpRoutePlan,
} from '../../../stepUpConfirmation/otpPrompt/authLane';
import { emailOtpAuthoritySelectorBody, readString } from './payloadParsing';
import {
  generateEmailOtpFactorReleaseKeyPair,
  openEmailOtpFactorReleaseCiphertext,
} from './crypto';

export function parseEmailOtpChallengeSignerSelection(
  value: unknown,
): EmailOtpWorkerOperationMap['requestEmailOtpChallenge']['result']['signerSelection'] {
  const selection = asRecord(value);
  if (!selection) {
    throw new Error('signerSelection must be an object');
  }
  const kind = Reflect.get(selection, 'kind');
  if (kind === 'ed25519_only') {
    return {
      kind: 'ed25519_only',
      ...parseEmailOtpUnlockEd25519Identity(selection),
    };
  }
  if (kind !== 'ecdsa') throw new Error('signerSelection.kind is invalid');
  return {
    kind: 'ecdsa',
    keyHandle: readString(Reflect.get(selection, 'keyHandle'), 'signerSelection.keyHandle'),
    runtimePolicyScope: normalizeRuntimePolicyScope(Reflect.get(selection, 'runtimePolicyScope')),
    ed25519: parseEmailOtpUnlockEd25519Selection(Reflect.get(selection, 'ed25519')),
  };
}

function assertEmailOtpChallengeAction(args: {
  response: Record<string, unknown>;
  expectedAction: string;
  label: string;
}): void {
  const challenge = asRecord(args.response.challenge);
  const action = normalizeOptionalTrimmedString(challenge?.action);
  if (action && action !== args.expectedAction) {
    throw new Error(`${args.label} returned ${action}; expected ${args.expectedAction}`);
  }
}

export function emailOtpRouteSessionAuth(
  routePlan: EmailOtpRoutePlan,
): WalletSessionOperationCredentialV1 | undefined {
  return routePlan.routeFamily === 'signing_session'
    ? routePlan.authLane.operationCredential
    : undefined;
}

/** Posts an Email OTP challenge request and rejects a challenge issued for another action. */
export async function postEmailOtpChallenge(args: {
  readonly relayUrl: string;
  readonly routePlan: EmailOtpRoutePlan;
  readonly body: Record<string, unknown>;
  readonly expectedAction: string;
  readonly label: string;
}): Promise<Record<string, unknown>> {
  const sessionAuth = emailOtpRouteSessionAuth(args.routePlan);
  const response = await postEmailOtpJson({
    relayUrl: args.relayUrl,
    route: emailOtpRoutePath(args.routePlan, 'challenge'),
    ...(sessionAuth ? { sessionAuth } : {}),
    body: args.body,
  });
  assertEmailOtpChallengeAction({
    response,
    expectedAction: args.expectedAction,
    label: args.label,
  });
  return response;
}

/** A challenge the caller answers directly, with its delivery details. */
export async function requestEmailOtpChallenge(args: Parameters<typeof postEmailOtpChallenge>[0]) {
  const response = await postEmailOtpChallenge(args);
  const challenge = response.challenge as Record<string, unknown>;
  const delivery = parseEmailOtpChallengeDelivery(response.delivery, `${args.label} delivery`);
  return { response, challenge, delivery, expiresAtMs: Number(challenge?.expiresAtMs) };
}

export async function releaseEmailOtpFactorSecret(
  args: {
    relayUrl: string;
    walletId: string;
  } & (
    | {
        kind: 'verified_grant';
        challengeId: string;
        loginGrant: string;
        sessionAuth: WalletSessionOperationCredentialV1 | undefined;
        otpCode?: never;
        operation?: never;
      }
    | {
        kind: 'email_otp';
        authoritySelector: EmailOtpAuthoritySelector;
        challengeId: string;
        otpCode: string;
        operation: WalletEmailOtpOperation;
        sessionAuth: WalletSessionOperationCredentialV1 | undefined;
        loginGrant?: never;
      }
    | {
        kind: 'wallet_session';
        sessionAuth: WalletSessionOperationCredentialV1;
        challengeId?: never;
        loginGrant?: never;
        otpCode?: never;
        operation?: never;
      }
  ),
): Promise<{
  challengeId: string;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  factorSecret32: Uint8Array;
}> {
  const { subtle, privateKey, workerPublicKey } = await generateEmailOtpFactorReleaseKeyPair(
    'Email OTP factor release',
  );
  if (workerPublicKey.length !== 65) {
    throw new Error('Email OTP factor release generated an invalid public key');
  }
  let serverPublicKey: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  try {
    const released = await postEmailOtpJson({
      relayUrl: args.relayUrl,
      route: '/wallet/email-otp/factor-release',
      ...(args.sessionAuth ? { sessionAuth: args.sessionAuth } : {}),
      body: {
        walletId: args.walletId,
        ...(args.kind === 'verified_grant'
          ? { kind: 'verified_grant', loginGrant: args.loginGrant }
          : args.kind === 'email_otp'
            ? {
                kind: 'email_otp',
                ...emailOtpAuthoritySelectorBody(args.authoritySelector),
                challengeId: args.challengeId,
                otpCode: args.otpCode,
                operation: args.operation,
              }
            : { kind: 'wallet_session' }),
        workerEphemeralPublicKey65B64u: base64UrlEncode(workerPublicKey),
      },
    });
    if (readString(released.kind, 'factor-release.kind') !== 'email_otp_factor_release_v1') {
      throw new Error('Email OTP factor release returned an invalid response kind');
    }
    const releasedChallengeId = readString(released.challengeId, 'factor-release.challengeId');
    if (args.kind !== 'wallet_session' && releasedChallengeId !== args.challengeId) {
      throw new Error('Email OTP factor release challenge binding changed');
    }
    const enrollmentId = readString(released.enrollmentId, 'factor-release.enrollmentId');
    const enrollmentSealKeyVersion = readString(
      released.enrollmentSealKeyVersion,
      'factor-release.enrollmentSealKeyVersion',
    );
    serverPublicKey = base64UrlDecode(
      readString(
        released.serverEphemeralPublicKey65B64u,
        'factor-release.serverEphemeralPublicKey65B64u',
      ),
    );
    if (serverPublicKey.length !== 65) {
      throw new Error('Email OTP factor release returned an invalid server public key');
    }
    nonce = base64UrlDecode(readString(released.nonce12B64u, 'factor-release.nonce12B64u'));
    if (nonce.length !== 12) {
      throw new Error('Email OTP factor release returned an invalid nonce');
    }
    ciphertext = base64UrlDecode(
      readString(released.ciphertextB64u, 'factor-release.ciphertextB64u'),
    );
    if (ciphertext.length < 16) {
      throw new Error('Email OTP factor release returned an invalid ciphertext');
    }
    return {
      challengeId: releasedChallengeId,
      enrollmentId,
      enrollmentSealKeyVersion,
      factorSecret32: await openEmailOtpFactorReleaseCiphertext({
        subtle,
        workerPrivateKey: privateKey,
        serverPublicKey,
        nonce,
        ciphertext,
        walletId: args.walletId,
        enrollmentId,
        enrollmentSealKeyVersion,
        challengeId: releasedChallengeId,
      }),
    };
  } finally {
    zeroizeBytes(workerPublicKey);
    zeroizeBytes(serverPublicKey);
    zeroizeBytes(nonce);
    zeroizeBytes(ciphertext);
  }
}
