import { expect, test } from '@playwright/test';
import {
  EVM_ECDSA_MPC_OPERATION_KINDS,
  buildEvmEcdsaMpcOperationRef,
  parseCapabilityId,
  parseCapabilityOperationId,
  parsePrincipalId,
  parseTenantId,
} from '../../../packages/shared-ts/src/authorization/capabilityKinds';
import { buildCapabilityOperationEnvelope } from '../../../packages/shared-ts/src/authorization/operationFingerprint';
import { requireParsed } from '../../../packages/shared-ts/src/passkey-custody/primitives';
import { base64UrlEncode } from '../../../packages/shared-ts/src/utils/base64';
import { parseDigestB64u } from '../../../packages/shared-ts/src/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletId,
} from '../../../packages/shared-ts/src/utils/domainIds';
import {
  buildEmailOtpWalletAuthAuthority,
  buildPasskeyWalletAuthAuthority,
  buildVoiceIdWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '../../../packages/shared-ts/src/utils/walletAuthAuthority';
import { parseSessionOrigin } from '../../../packages/mpc-wallet-server/src/authorization/domain';
import { verifyEcdsaOperationStepUpFactor } from '../../../packages/mpc-wallet-server/src/router/transport/fetch/routes/ecdsaOperationStepUpFactor';
import {
  resolveEd25519WalletSessionOperation,
  revalidateEd25519StepUpOperation,
} from '../../../packages/mpc-wallet-server/src/router/transport/fetch/routes/ed25519AuthorizedOperationRevalidation';
import type { FetchRouterApiContext } from '../../../packages/mpc-wallet-server/src/router/transport/fetch/fetchRouter.types';
import { APP_ORIGIN, recordedCalls, webAuthnAssertion } from './routeHarness';

// The fresh proof that each signing or export operation needs (step-up). Each factor keeps its
// refusal codes and statuses, and a passkey proof is checked against the operation challenge.
// The Email OTP export grant has no check here yet.

const WALLET_ID = requireParsed(parseWalletId('step-up-wallet-1'), 'test');
const CREDENTIAL_ID = 'Y3JlZGVudGlhbC0x';
/** A canonical 32-byte digest whose bytes all equal `fill`. */
function digest(fill: number) {
  return parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(fill)));
}
const DEVICE_KEY_ID = digest(1);
const OPERATION_CHALLENGE = digest(2);
const PASSKEY = buildPasskeyWalletAuthAuthority({
  walletId: WALLET_ID,
  rpId: 'wallet.example.test',
  credentialIdB64u: CREDENTIAL_ID,
});
const EMAIL_OTP = buildEmailOtpWalletAuthAuthority({
  walletId: WALLET_ID,
  provider: 'google',
  providerUserId: 'google-subject-1',
  emailHashHex: 'ab'.repeat(32),
});
const VOICE_ID = buildVoiceIdWalletAuthAuthority({
  walletId: WALLET_ID,
  walletAuthMethodId: requireParsed(parseWalletAuthMethodId('voiceid-method-1'), 'test'),
  deviceKeyId: DEVICE_KEY_ID,
});

function ecdsaOperation(kind: 'evm.sign_transaction' | 'evm.export_key') {
  return buildCapabilityOperationEnvelope({
    tenantId: requireParsed(parseTenantId('conformance-tenant'), 'test'),
    principalId: requireParsed(parsePrincipalId(WALLET_ID), 'test'),
    capabilityId: requireParsed(parseCapabilityId('evm-signing'), 'test'),
    operationId: requireParsed(parseCapabilityOperationId(`operation:${kind}`), 'test'),
    operation: buildEvmEcdsaMpcOperationRef(kind),
    digests: {
      laneDigest: digest(3),
      intentDigest: digest(4),
      displayDigest: digest(5),
    },
  });
}

type StepUpInput = Parameters<typeof verifyEcdsaOperationStepUpFactor>[0];

async function stepUpInput(overrides: Partial<StepUpInput> = {}) {
  const webAuthn = recordedCalls({ success: true, verified: true });
  const emailOtp = recordedCalls({
    ok: true,
    challengeId: 'email-challenge-1',
    loginGrant: 'login-grant-1',
    grantExpiresAtMs: Date.now() + 60_000,
  });
  const consume = recordedCalls({ ok: true, challengeId: 'email-challenge-1' });
  const voiceId = recordedCalls({ kind: 'rejected' });
  const input: StepUpInput = {
    proof: {
      kind: 'passkey',
      authority: PASSKEY,
      webauthn_authentication: webAuthnAssertion(CREDENTIAL_ID),
    } as StepUpInput['proof'],
    operation: ecdsaOperation(EVM_ECDSA_MPC_OPERATION_KINDS.signTransaction),
    walletId: WALLET_ID,
    authorityRef: await walletAuthAuthorityRef({ authority: PASSKEY }),
    authSource: { kind: 'passkey', credentialIdB64u: CREDENTIAL_ID },
    requestOrigin: parseSessionOrigin(APP_ORIGIN),
    expectedChallenge: OPERATION_CHALLENGE,
    expiresAtMs: Date.now() + 60_000,
    webAuthn: { verifyWebAuthnAuthenticationLite: webAuthn.answer },
    emailOtp: { verifyEmailOtpChallenge: emailOtp.answer, consumeEmailOtpGrant: consume.answer },
    voiceId: { verifyVoiceIdOperation: voiceId.answer },
    ...overrides,
  } as StepUpInput;
  return { input, webAuthn, emailOtp, consume, voiceId };
}

async function refusalOf(result: Awaited<ReturnType<typeof verifyEcdsaOperationStepUpFactor>>) {
  if (result.ok) throw new Error('expected a refusal');
  return { status: result.response.status, body: await result.response.json() };
}

test('a passkey step-up verifies the assertion against the operation challenge', async () => {
  const fake = await stepUpInput();
  const result = await verifyEcdsaOperationStepUpFactor(fake.input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.unseal).toEqual({ kind: 'not_requested' });
  expect(fake.webAuthn.calls).toEqual([
    expect.objectContaining({
      userId: WALLET_ID,
      rpId: 'wallet.example.test',
      expectedChallenge: OPERATION_CHALLENGE,
      expected_origin: APP_ORIGIN,
    }),
  ]);
});

test('a passkey step-up refuses another passkey, a failed check and an expired operation', async () => {
  const cases = [
    {
      overrides: { authSource: { kind: 'passkey', credentialIdB64u: 'b3RoZXI' } },
      refusal: {
        status: 403,
        body: { ok: false, code: 'scope_mismatch', message: 'Passkey authority changed' },
      },
    },
    {
      overrides: {
        webAuthn: { verifyWebAuthnAuthenticationLite: async () => ({ success: false }) },
      },
      refusal: {
        status: 401,
        body: {
          ok: false,
          code: 'not_verified',
          message: 'WebAuthn authentication verification failed',
        },
      },
    },
    {
      overrides: { expiresAtMs: Date.now() - 1 },
      refusal: {
        status: 403,
        body: {
          ok: false,
          code: 'verified_step_up_rejected',
          message: 'Operation step-up authorization expired',
        },
      },
    },
  ];
  for (const testCase of cases) {
    const fake = await stepUpInput(testCase.overrides as Partial<StepUpInput>);
    expect(await refusalOf(await verifyEcdsaOperationStepUpFactor(fake.input))).toEqual(
      testCase.refusal,
    );
  }
});

test('an Email OTP signing step-up checks the code for transaction_sign and uses its grant', async () => {
  const fake = await stepUpInput({
    proof: {
      kind: 'email_otp',
      authority: EMAIL_OTP,
      challenge_id: 'email-challenge-1',
      otp_code: '123456',
    } as StepUpInput['proof'],
    authorityRef: await walletAuthAuthorityRef({ authority: EMAIL_OTP }),
  });
  const result = await verifyEcdsaOperationStepUpFactor(fake.input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.unseal).toEqual({ kind: 'not_requested' });
  expect(fake.emailOtp.calls).toEqual([
    expect.objectContaining({
      userId: 'google-subject-1',
      walletId: WALLET_ID,
      challengeId: 'email-challenge-1',
      otpCode: '123456',
      otpChannel: 'email_otp',
      operation: 'transaction_sign',
    }),
  ]);
  expect(fake.consume.calls).toEqual([
    expect.objectContaining({ loginGrant: 'login-grant-1', otpChannel: 'email_otp' }),
  ]);
});

test('an Email OTP step-up refusal is 400 for a bad body and 401 otherwise', async () => {
  for (const [code, status] of [
    ['invalid_body', 400],
    ['invalid_otp', 401],
    ['challenge_expired_or_invalid', 401],
  ] as const) {
    const refusal = { ok: false, code, message: code };
    const fake = await stepUpInput({
      proof: {
        kind: 'email_otp',
        authority: EMAIL_OTP,
        challenge_id: 'email-challenge-1',
        otp_code: '000000',
      } as StepUpInput['proof'],
      emailOtp: {
        verifyEmailOtpChallenge: async () => refusal,
        consumeEmailOtpGrant: async () => refusal,
      } as StepUpInput['emailOtp'],
    });
    expect(await refusalOf(await verifyEcdsaOperationStepUpFactor(fake.input))).toEqual({
      status,
      body: refusal,
    });
  }
});

test('a VoiceID step-up covers key export only, and a rejected proof is 401', async () => {
  const voiceProof = {
    kind: 'voiceid',
    authority: VOICE_ID,
    assertion: { kind: 'conformance' },
  } as unknown as StepUpInput['proof'];
  const signing = await stepUpInput({
    proof: voiceProof,
    authSource: { kind: 'voiceid', deviceKeyId: DEVICE_KEY_ID },
  });
  expect(await refusalOf(await verifyEcdsaOperationStepUpFactor(signing.input))).toEqual({
    status: 403,
    body: { ok: false, code: 'scope_mismatch', message: 'VoiceID authority changed' },
  });
  expect(signing.voiceId.calls).toEqual([]);

  const exporting = await stepUpInput({
    proof: voiceProof,
    authSource: { kind: 'voiceid', deviceKeyId: DEVICE_KEY_ID },
    operation: ecdsaOperation(EVM_ECDSA_MPC_OPERATION_KINDS.exportKey),
  });
  expect(await refusalOf(await verifyEcdsaOperationStepUpFactor(exporting.input))).toEqual({
    status: 401,
    body: { ok: false, code: 'not_verified', message: 'VoiceID operation proof was not verified' },
  });
  expect(exporting.voiceId.calls).toEqual([
    expect.objectContaining({
      walletId: WALLET_ID,
      operationKind: 'evm.export_key',
      operationChallenge: OPERATION_CHALLENGE,
      requestOrigin: APP_ORIGIN,
    }),
  ]);
});

// The Ed25519 routes keep a prepared operation and check it again before they sign.

function ed25519Context(authorizedOperations: object): FetchRouterApiContext {
  return { service: { authorizedOperations } } as unknown as FetchRouterApiContext;
}

function storedOperation(fields: Record<string, unknown>) {
  return {
    tenantId: 'conformance-tenant',
    authorizedOperationId: 'authorized-1',
    auditEventId: 'audit-1',
    operation: {
      operation: {
        capabilityKind: 'near_ed25519_mpc_signing',
        operationKind: 'near.sign_transaction',
      },
    },
    authorization: { kind: 'verified_step_up' },
    quota: { kind: 'quota_neutral' },
    ...fields,
  } as never;
}

test('an Ed25519 step-up operation is admitted again, and a rejection keeps its status', async () => {
  const quotaMismatch = await revalidateEd25519StepUpOperation({
    ctx: ed25519Context({}),
    operation: storedOperation({ quota: { kind: 'consume_reusable_wallet_session' } }),
  });
  expect(quotaMismatch.ok).toBe(false);
  if (!quotaMismatch.ok) {
    expect(quotaMismatch.response.status).toBe(403);
    expect(await quotaMismatch.response.json()).toMatchObject({
      code: 'verified_step_up_rejected',
    });
  }
  for (const [kind, status] of [
    ['verified_step_up_rejected', 403],
    ['authorization_grant_rejected', 403],
    ['billing_credit_exhausted', 409],
  ] as const) {
    const rejected = await revalidateEd25519StepUpOperation({
      ctx: ed25519Context({ admitAuthorizedOperation: async () => ({ kind }) }),
      operation: storedOperation({}),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.response.status).toBe(status);
      expect(await rejected.response.json()).toMatchObject({ ok: false, code: kind });
    }
  }
});

test('an Ed25519 reusable operation must exist, match its ID and not be a key export', async () => {
  const resolveWith = (result: object) =>
    resolveEd25519WalletSessionOperation({
      ctx: ed25519Context({ resolveEd25519WalletSessionOperation: async () => result }),
      tenantId: 'conformance-tenant' as never,
      authorizedOperationId: 'authorized-1' as never,
      operationFingerprintDigest: digest(6) as never,
      walletId: WALLET_ID,
    });
  const reusable = { kind: 'consume_reusable_wallet_session' };
  const cases = [
    [{ kind: 'authorized_operation_missing' }, 409, 'authorized_operation_missing'],
    [
      {
        kind: 'claimed',
        operation: storedOperation({ authorizedOperationId: 'other', quota: reusable }),
      },
      409,
      'authorized_operation_missing',
    ],
    [{ kind: 'claimed', operation: storedOperation({}) }, 403, 'authorization_grant_rejected'],
    [
      {
        kind: 'claimed',
        operation: storedOperation({
          quota: reusable,
          operation: {
            operation: {
              capabilityKind: 'near_ed25519_mpc_signing',
              operationKind: 'near.export_key',
            },
          },
        }),
      },
      403,
      'authorization_grant_rejected',
    ],
  ] as const;
  for (const [result, status, code] of cases) {
    const resolved = await resolveWith(result);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.response.status).toBe(status);
      expect(await resolved.response.json()).toMatchObject({ ok: false, code });
    }
  }
  const accepted = await resolveWith({
    kind: 'claimed',
    operation: storedOperation({ quota: reusable }),
  });
  expect(accepted).toMatchObject({ ok: true, ownerScope: null });
});
