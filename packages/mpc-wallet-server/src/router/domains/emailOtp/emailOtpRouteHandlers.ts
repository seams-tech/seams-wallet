import type {
  EmailOtpDeviceFactorBlindV1,
  EmailOtpFactorEvaluationV1,
} from '@shared/utils/emailOtpDomain';
import { isPlainObject, toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import type { RouterApiEmailOtpRouteService } from '../../framework/authServicePort';
import { emailOtpStatusCode } from './emailOtpSessionRouteHelpers';

type EmailOtpRouteResponse = {
  status: number;
  body: Record<string, unknown>;
};

type EmailOtpFactorFailure = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

type StoredEmailOtpFactor = {
  readonly factorNonceB64u: string;
  readonly wrappedFactorB64u: string;
};

/**
 * Picks the enrollment factor that this device holds: the first device factor,
 * newest first, whose nonce names a stored factor. Run it before a code or
 * grant is used, so a device without a factor fails without using the code.
 */
export function selectEmailOtpDeviceFactor<Factor extends StoredEmailOtpFactor>(input: {
  readonly enrollment: { readonly factors: readonly Factor[] };
  readonly deviceFactors: readonly EmailOtpDeviceFactorBlindV1[];
}):
  | { readonly ok: true; readonly factor: Factor; readonly blindedElementB64u: string }
  | EmailOtpFactorFailure {
  for (const deviceFactor of input.deviceFactors) {
    const factor = input.enrollment.factors.find(
      (stored) => stored.factorNonceB64u === deviceFactor.factorNonceB64u,
    );
    if (factor) return { ok: true, factor, blindedElementB64u: deviceFactor.blindedElementB64u };
  }
  return failure(
    'email_otp_device_factor_missing',
    'This device has no Email OTP factor for this wallet. Use the recovery code, or link this device from one that has the wallet.',
  );
}

/**
 * Evaluates the selected factor for the device's blinded input. The response
 * carries S encrypted under the device's OPRF output, which only the device
 * can compute, so the server never holds or sends S.
 */
export async function evaluateEmailOtpFactorForDevice(input: {
  readonly factorKey: Pick<RouterApiEmailOtpRouteService, 'evaluateEmailOtpFactor'>;
  readonly walletId: string;
  readonly enrollment: {
    readonly enrollmentId: string;
    readonly enrollmentSealKeyVersion: string;
  };
  readonly factor: StoredEmailOtpFactor;
  readonly blindedElementB64u: string;
  readonly challengeId: string;
}): Promise<
  { readonly ok: true; readonly evaluation: EmailOtpFactorEvaluationV1 } | EmailOtpFactorFailure
> {
  const evaluated = await input.factorKey.evaluateEmailOtpFactor({
    walletId: input.walletId,
    enrollmentId: input.enrollment.enrollmentId,
    factorNonceB64u: input.factor.factorNonceB64u,
    enrollmentSealKeyVersion: input.enrollment.enrollmentSealKeyVersion,
    blindedElementB64u: input.blindedElementB64u,
  });
  if (!evaluated.ok) return evaluated;
  return {
    ok: true,
    evaluation: {
      kind: 'email_otp_factor_evaluation_v1',
      challengeId: input.challengeId,
      enrollmentId: input.enrollment.enrollmentId,
      enrollmentSealKeyVersion: input.enrollment.enrollmentSealKeyVersion,
      factorNonceB64u: input.factor.factorNonceB64u,
      publicKeyB64u: evaluated.publicKeyB64u,
      evaluatedElementB64u: evaluated.evaluatedElementB64u,
      proofB64u: evaluated.proofB64u,
      wrappedFactorB64u: input.factor.wrappedFactorB64u,
    },
  };
}

export async function handleEmailOtpRegistrationFactorRoute(input: {
  body: unknown;
  service: RouterApiEmailOtpRouteService;
}): Promise<EmailOtpRouteResponse> {
  if (!isPlainObject(input.body)) {
    return { status: 400, body: failure('invalid_body', 'Invalid body') };
  }
  const allowedFields = new Set(['walletId', 'enrollmentId', 'blindedElementB64u']);
  for (const field of Object.keys(input.body)) {
    if (!allowedFields.has(field)) {
      return {
        status: 400,
        body: failure('invalid_body', `Unsupported field: ${field}`),
      };
    }
  }
  const walletId = toOptionalTrimmedString(input.body.walletId);
  const enrollmentId = toOptionalTrimmedString(input.body.enrollmentId);
  if (!walletId || !enrollmentId) {
    return {
      status: 400,
      body: failure('invalid_body', 'Missing walletId or enrollmentId'),
    };
  }
  // The server picks a new factor nonce for each call, so this unauthenticated
  // route never evaluates the function of an existing enrollment. The finalize
  // step stores the enrollment ID that the server derives from the verified subject.
  const result = await input.service.enrollEmailOtpFactor({
    walletId,
    enrollmentId,
    blindedElementB64u: input.body.blindedElementB64u,
  });
  return {
    status: result.ok ? 200 : emailOtpStatusCode(result.code),
    body: result.ok ? { ...result, walletId } : result,
  };
}

export async function handleEmailOtpDevOutboxRoute(input: {
  body: unknown;
  service: RouterApiEmailOtpRouteService;
}): Promise<EmailOtpRouteResponse> {
  if (!isPlainObject(input.body)) {
    return { status: 400, body: failure('invalid_body', 'Invalid body') };
  }
  const allowedFields = new Set(['idToken', 'walletId', 'challengeId', 'challengeSubjectId']);
  for (const field of Object.keys(input.body)) {
    if (!allowedFields.has(field)) {
      return {
        status: 400,
        body: failure('invalid_body', `Unsupported field: ${field}`),
      };
    }
  }
  const idToken = toOptionalTrimmedString(input.body.idToken);
  const walletId = toOptionalTrimmedString(input.body.walletId);
  const challengeId = toOptionalTrimmedString(input.body.challengeId);
  /* An intended-test affordance, and nothing more. A challenge's subject is not
     always a Google identity — an Email OTP method added by address alone is
     enrolled under that address — so a reader restricted to the token's own
     subject could never see its code.

     Three things keep it from becoming permission to read arbitrary OTPs. The
     store refuses entirely unless the dev outbox is enabled, which requires the
     dev delivery mode and a non-production runtime. The lookup admits only a
     live challenge whose wallet is the one named here and whose subject is the
     one asked for. And an override must name the exact challenge, below: a
     caller can only have that id from the wallet's own flow, so the token says
     which harness is asking rather than whose code it may read. */
  const challengeSubjectId = toOptionalTrimmedString(input.body.challengeSubjectId);
  if (!idToken || !walletId) {
    return {
      status: 400,
      body: failure('invalid_body', 'Missing idToken or walletId'),
    };
  }
  if (challengeSubjectId && !challengeId) {
    return {
      status: 400,
      body: failure(
        'invalid_body',
        'challengeSubjectId requires the exact challengeId it belongs to',
      ),
    };
  }
  const verified = await input.service.verifyGoogleLogin({ idToken });
  if (!verified.ok || !verified.verified || !verified.userId) {
    const code = verified.code || 'not_verified';
    return {
      status: code === 'internal' ? 500 : code === 'not_configured' ? 501 : 401,
      body: failure(code, verified.message || 'Google login failed'),
    };
  }
  const result = await input.service.readEmailOtpOutboxEntry({
    userId: challengeSubjectId || verified.providerSubject || verified.userId,
    walletId,
    ...(challengeId ? { challengeId } : {}),
  });
  return { status: result.ok ? 200 : emailOtpStatusCode(result.code), body: result };
}
