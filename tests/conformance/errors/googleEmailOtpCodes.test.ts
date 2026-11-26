import { expect, test } from '@playwright/test';
import { seamsTestnetConfig } from '@/core/config/defineConfig';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import type {
  EmailOtpOperationChallengeResult,
  GoogleEmailOtpWalletAuthFailureCode,
} from '@/SeamsWeb/publicApi/types';
import {
  requestEmailCode,
  startGoogleSignIn,
  type GoogleEmailOtpWalletAuthDeps,
} from '../../../packages/mpc-wallet/src/SeamsWeb/operations/authMethods/emailOtp/googleEmailOtpWalletAuthFlow';
import { expectKnownFault } from '../knownFault';

const WALLET_ID = 'conformance-wallet-1';
const EMAIL = 'alice@example.test';
const RELAY_URL = 'https://relay.example.test';
const CONFIGS = buildConfigsFromEnv(
  seamsTestnetConfig({
    relayerUrl: RELAY_URL,
    walletOrigin: 'https://wallet.example.test',
    publishableKey: 'pk_dev_test',
    projectEnvironmentId: 'proj_test:dev',
  }),
);

/**
 * The 15 public failure codes of the Google and Email OTP flow. The flow produces 12 of them;
 * nothing produces the three marked `unused` today, but apps can branch on every one.
 */
const FLOW_CODES: Record<GoogleEmailOtpWalletAuthFailureCode, 'produced' | 'unused'> = {
  google_verification_failed: 'produced',
  google_account_registration_required: 'produced',
  email_otp_challenge_failed: 'produced',
  email_otp_device_factor_missing: 'produced',
  email_otp_invalid_code: 'produced',
  email_otp_expired: 'produced',
  email_otp_rate_limited: 'produced',
  registration_failed: 'produced',
  registration_restore_required: 'produced',
  unlock_failed: 'produced',
  recovery_code_backup_incomplete: 'produced',
  flow_expired: 'produced',
  local_signing_session_not_ready: 'unused',
  wallet_iframe_unavailable: 'unused',
  flow_cancelled: 'unused',
};

/** A server failure as the Email OTP routes send it, with its code kept on the error. */
function serverError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

// The server messages of the Email OTP code check (d1EmailOtpChallengeVerifier.ts).
const SERVER_MESSAGES = {
  invalid_otp: 'OTP code is invalid',
  challenge_expired_or_invalid: 'Email OTP challenge expired or invalid',
  rate_limited: 'Email OTP rate limit exceeded',
  otp_locked_out: 'Email OTP is temporarily locked for this wallet',
  otp_attempts_exhausted: 'Email OTP challenge exceeded the maximum number of attempts',
} as const;

function challenge(expiresAtMs = Date.now() + 60_000): EmailOtpOperationChallengeResult {
  return {
    challengeId: 'challenge-1',
    otpChannel: 'email_otp',
    delivery: { kind: 'provider', status: 'sent', emailHint: EMAIL },
    expiresAtMs,
    ownerProofBindingDigest: 'owner-proof-digest',
    walletAuthMethodId: 'wallet-auth-method:email-1',
    // The flow reads only `kind` of the signer selection on this path.
    signerSelection: { kind: 'ed25519_only' } as EmailOtpOperationChallengeResult['signerSelection'],
  };
}

function flowDeps(overrides: Partial<GoogleEmailOtpWalletAuthDeps>): GoogleEmailOtpWalletAuthDeps {
  const unused = async (): Promise<never> => {
    throw new Error('not used by this check');
  };
  return {
    configs: CONFIGS,
    resolveGoogleEmailOtpProvider: async () => ({
      mode: 'existing_wallet',
      walletId: WALLET_ID,
      providerSubject: 'google-subject-1',
      email: EMAIL,
      hasEmailOtpEnrollment: true,
    }),
    requestEmailOtpChallenge: async () => challenge(),
    prewarmEmailOtpYao: async () => {},
    hasEmailOtpDeviceFactor: async () => true,
    registerWallet: unused,
    loginWithEmailOtpEcdsaCapability: unused,
    loginWithEmailOtpEd25519YaoCapability: unused,
    resolveLinkedEmailOtpWalletAuth: async () => ({
      kind: 'selected',
      walletAuthMethodId: 'wallet-auth-method:email-1',
      execution: 'authority',
    }),
    loginWithLinkedEmailOtpWallet: unused,
    getWalletSession: unused,
    ...overrides,
  };
}

function startLogin(deps: GoogleEmailOtpWalletAuthDeps) {
  return startGoogleSignIn(deps, {
    mode: 'login',
    idToken: 'google-id-token',
    loginTarget: { kind: 'wallet', walletId: WALLET_ID },
    ecdsaTargets: { kind: 'none' },
    relayUrl: RELAY_URL,
  });
}

async function startCode(deps: GoogleEmailOtpWalletAuthDeps) {
  const started = await startLogin(deps);
  return started.ok ? 'started' : started.error;
}

/** Starts a login and submits a code with the given dependencies. */
async function submitWith(deps: GoogleEmailOtpWalletAuthDeps, otpCode = '123456') {
  const started = await startLogin(deps);
  if (!started.ok || started.value.mode !== 'login') throw new Error('login did not start');
  const submitted = await started.value.submit({ otpCode });
  return submitted.ok ? { code: 'submitted' } : submitted.error;
}

/** Starts a login and submits a code; the code check ends with `error`. */
function submitCode(error: unknown, otpCode = '123456') {
  return submitWith(
    flowDeps({
      loginWithLinkedEmailOtpWallet: async () => {
        throw error;
      },
    }),
    otpCode,
  );
}

test('the flow has 15 public failure codes; three of them are never produced', () => {
  const unused = Object.entries(FLOW_CODES).filter(([, use]) => use === 'unused');
  expect(Object.keys(FLOW_CODES)).toHaveLength(15);
  expect(unused.map(([code]) => code)).toEqual([
    'local_signing_session_not_ready',
    'wallet_iframe_unavailable',
    'flow_cancelled',
  ]);
});

test('Google verification and the challenge request give their codes', async () => {
  const failing = (error: unknown) =>
    flowDeps({
      resolveGoogleEmailOtpProvider: async () => {
        throw error;
      },
    });
  expect(await startCode(failing(serverError('stale_identity_mapping', 'stale')))).toMatchObject({
    code: 'google_account_registration_required',
  });
  expect(await startCode(failing(new Error('Invalid ID token')))).toMatchObject({
    code: 'google_verification_failed',
  });

  const challengeFailing = (error: unknown) =>
    flowDeps({
      requestEmailOtpChallenge: async () => {
        throw error;
      },
    });
  // A Google account with no Email OTP enrollment is asked to register.
  expect(
    await startCode(
      challengeFailing(serverError('not_found', 'Email OTP enrollment not found for this wallet')),
    ),
  ).toEqual({
    code: 'google_account_registration_required',
    message: "Account doesn't exist. Create your account to continue.",
  });
  expect(await startCode(challengeFailing(new Error('network down')))).toMatchObject({
    code: 'email_otp_challenge_failed',
  });
});

test('a device with no Email OTP factor for the wallet gets no code', async () => {
  let codeRequests = 0;
  const deps = flowDeps({
    hasEmailOtpDeviceFactor: async (walletId) => walletId !== WALLET_ID,
    requestEmailOtpChallenge: async () => {
      codeRequests += 1;
      return challenge();
    },
  });
  expect(await startCode(deps)).toMatchObject({ code: 'email_otp_device_factor_missing' });
  const byEmail = await requestEmailCode(deps, {
    method: 'email',
    walletId: WALLET_ID,
    email: EMAIL,
  });
  expect(byEmail.ok ? 'started' : byEmail.error).toMatchObject({
    code: 'email_otp_device_factor_missing',
  });
  expect(codeRequests).toBe(0);
});

test('a wrong, malformed or expired code and a rate limit keep their codes', async () => {
  expect(await submitCode(new Error('unused'), '12ab')).toMatchObject({
    code: 'email_otp_invalid_code',
  });
  for (const [code, expected] of [
    ['invalid_otp', 'email_otp_invalid_code'],
    ['challenge_expired_or_invalid', 'email_otp_expired'],
  ] as const) {
    // With the server code on the error, and with the server message only.
    expect(await submitCode(serverError(code, SERVER_MESSAGES[code]))).toMatchObject({
      code: expected,
    });
    expect(await submitCode(new Error(SERVER_MESSAGES[code]))).toMatchObject({ code: expected });
  }
  expect(
    await submitCode(
      serverError('rate_limited', SERVER_MESSAGES.rate_limited, { retryAfterMs: 5_000.7 }),
    ),
  ).toEqual({ code: 'email_otp_rate_limited', message: SERVER_MESSAGES.rate_limited, retryAfterMs: 5_000 });

  const started = await startLogin(
    flowDeps({ requestEmailOtpChallenge: async () => challenge(Date.now() + 20) }),
  );
  if (!started.ok || started.value.mode !== 'login') throw new Error('login did not start');
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(await started.value.submit({ otpCode: '123456' })).toMatchObject({
    ok: false,
    error: { code: 'email_otp_expired' },
  });
});

test('a server lockout with its code reports a wait, not a wrong code', async () => {
  expectKnownFault(
    '8.6',
    'googleEmailOtpWalletAuthFlow.ts:209 maps every code that contains "otp" to ' +
      'email_otp_invalid_code, so otp_locked_out and otp_attempts_exhausted read as a wrong code',
  );
  const lockouts = ['otp_locked_out', 'otp_attempts_exhausted'] as const;
  const codes = [];
  for (const code of lockouts) {
    codes.push((await submitCode(serverError(code, SERVER_MESSAGES[code]))).code);
  }
  expect(codes).toEqual(lockouts.map(() => 'email_otp_rate_limited'));
});

test('a rate limit or lockout that reaches the flow as a message only reports a wait', async () => {
  expectKnownFault(
    '8.6',
    'the Email OTP worker throws the server message without its code ' +
      '(workers/email-otp/fetch.ts:44), and the message rules of ' +
      'googleEmailOtpWalletAuthFlow.ts:211-214 have no rate or lock rule, so these give unlock_failed',
  );
  const waits = ['rate_limited', 'otp_locked_out', 'otp_attempts_exhausted'] as const;
  const codes = [];
  for (const code of waits) codes.push((await submitCode(new Error(SERVER_MESSAGES[code]))).code);
  expect(codes).toEqual(waits.map(() => 'email_otp_rate_limited'));
});

test('a valid code with no local signing session gives local_signing_session_not_ready', async () => {
  expectKnownFault(
    '8.6',
    'assertLoggedIn throws a plain message (googleEmailOtpWalletAuthFlow.ts:605) that the submit ' +
      'rules map to unlock_failed; nothing produces local_signing_session_not_ready',
  );
  expect(
    await submitWith(
      flowDeps({
        loginWithLinkedEmailOtpWallet: async () => {},
        // The session read that the flow makes after a valid code finds no session.
        getWalletSession: async () => {
          throw new Error('Wallet auth completed, but the local signing session is not ready yet.');
        },
      }),
    ),
  ).toMatchObject({ code: 'local_signing_session_not_ready' });
});

test('a failed Google registration gives its registration code', async () => {
  const register = async (registerWallet: GoogleEmailOtpWalletAuthDeps['registerWallet']) => {
    const started = await startGoogleSignIn(
      flowDeps({
        registerWallet,
        resolveGoogleEmailOtpProvider: async () => ({
          mode: 'register_started',
          walletId: WALLET_ID,
          providerSubject: 'google-subject-1',
          email: EMAIL,
          registrationAttemptId: 'attempt-1',
          expiresAtMs: Date.now() + 60_000,
          offer: {
            offerId: 'offer-1',
            selectedCandidateId: 'candidate-1',
            candidates: [{ candidateId: 'candidate-1', walletId: WALLET_ID }],
          },
        }),
      }),
      {
        mode: 'register',
        idToken: 'google-id-token',
        ecdsaTargets: { kind: 'none' },
        signerSelection: { kind: 'signer_set', signers: [] },
        relayUrl: RELAY_URL,
      },
    );
    if (!started.ok || started.value.mode !== 'register') throw new Error('register did not start');
    const completed = await started.value.completeRegistration();
    return completed.ok ? 'completed' : completed.error.code;
  };
  const throwing = (message: string) => async (): Promise<never> => {
    throw new Error(message);
  };
  expect(
    await register(async () => ({
      success: false,
      error: 'Registration was finalized earlier',
      errorCode: 'already_finalized_restore_required',
    })),
  ).toBe('registration_restore_required');
  expect(await register(throwing('Wallet is already finalized; restore or unlock it'))).toBe(
    'registration_restore_required',
  );
  expect(await register(throwing('Recovery code backup was not acknowledged'))).toBe(
    'recovery_code_backup_incomplete',
  );
  expect(await register(throwing('Registration ceremony expired'))).toBe('flow_expired');
  expect(await register(throwing('Signer setup failed'))).toBe('registration_failed');
});
