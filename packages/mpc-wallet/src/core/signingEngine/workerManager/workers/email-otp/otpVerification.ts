/** OTP challenges and the factor release that a verified OTP or its grant unlocks. */
import { asRecord } from '@shared/utils/validation';
import { normalizeOptionalTrimmedString } from '@shared/utils/normalize';
import {
  readEmailOtpFactorEvaluation,
  type WalletEmailOtpLoginOperation,
} from '@shared/utils/emailOtpDomain';
import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { parseEmailOtpChallengeDelivery } from '@/core/signingEngine/session/emailOtp/challengeDelivery';
import {
  parseEmailOtpUnlockEd25519Identity,
  parseEmailOtpUnlockEd25519Selection,
} from '@/core/signingEngine/session/emailOtp/publicTypes';
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
  blindEmailOtpDeviceFactors,
  discardEmailOtpDeviceFactorBlinds,
  openEmailOtpFactorEvaluation,
} from './deviceFactor';

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
  if (routePlan.routeFamily === 'operation_step_up') return routePlan.operationCredential;
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

/**
 * Releases S for one operation. The server needs a fresh email code for that operation, or the
 * grant of one, and the blinded inputs of this device's factors.
 */
export async function releaseEmailOtpFactorSecret(
  args: {
    relayUrl: string;
    walletId: string;
    challengeId: string;
    operation: WalletEmailOtpLoginOperation;
    sessionAuth: WalletSessionOperationCredentialV1 | undefined;
  } & (
    | { kind: 'verified_grant'; loginGrant: string }
    | { kind: 'email_otp'; authoritySelector: EmailOtpAuthoritySelector; otpCode: string }
  ),
): Promise<{
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  factorSecret32: Uint8Array;
}> {
  const blinds = await blindEmailOtpDeviceFactors(args.walletId);
  try {
    const released = await postEmailOtpJson({
      relayUrl: args.relayUrl,
      route: '/wallet/email-otp/factor-release',
      ...(args.sessionAuth ? { sessionAuth: args.sessionAuth } : {}),
      body: {
        walletId: args.walletId,
        ...(args.kind === 'verified_grant'
          ? { kind: 'verified_grant', loginGrant: args.loginGrant }
          : {
              kind: 'email_otp',
              ...emailOtpAuthoritySelectorBody(args.authoritySelector),
              challengeId: args.challengeId,
              otpCode: args.otpCode,
            }),
        operation: args.operation,
        deviceFactors: blinds.deviceFactors,
      },
    });
    const evaluation = readEmailOtpFactorEvaluation(released);
    if (evaluation.challengeId !== args.challengeId) {
      throw new Error('Email OTP factor release challenge binding changed');
    }
    return {
      enrollmentId: evaluation.enrollmentId,
      enrollmentSealKeyVersion: evaluation.enrollmentSealKeyVersion,
      factorSecret32: await openEmailOtpFactorEvaluation({ blinds, evaluation }),
    };
  } finally {
    discardEmailOtpDeviceFactorBlinds(blinds);
  }
}
