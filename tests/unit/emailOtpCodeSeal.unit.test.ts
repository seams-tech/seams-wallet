import { expect, test } from '@playwright/test';
import {
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { createEmailOtpCodeSeal } from '../../packages/mpc-wallet-server/src/core/authService/emailOtpCodeSeal';
import { CloudflareD1EmailOtpChallengeStore } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeStore';
import { emailOtpChallengeRecord } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';

const rootA = Buffer.alloc(32, 1).toString('base64url');
const rootB = Buffer.alloc(32, 2).toString('base64url');

test('a sealed code opens with its key and its challenge only', async () => {
  const sealA = createEmailOtpCodeSeal(rootA);
  const sealed = await sealA.seal({ challengeId: 'challenge-1', otpCode: '123456' });

  expect(sealed).not.toContain('123456');
  expect(await sealA.seal({ challengeId: 'challenge-1', otpCode: '123456' })).not.toBe(sealed);
  expect(await sealA.open({ challengeId: 'challenge-1', otpCodeSealedB64u: sealed })).toBe(
    '123456',
  );
  await expect(
    sealA.open({ challengeId: 'challenge-2', otpCodeSealedB64u: sealed }),
  ).rejects.toThrow();
  await expect(
    createEmailOtpCodeSeal(rootB).open({ challengeId: 'challenge-1', otpCodeSealedB64u: sealed }),
  ).rejects.toThrow();
});

test('a root secret that is not 32 bytes is refused at the first use', async () => {
  const seal = createEmailOtpCodeSeal(Buffer.alloc(16, 1).toString('base64url'));
  await expect(seal.seal({ challengeId: 'challenge-1', otpCode: '123456' })).rejects.toThrow(
    '32 bytes',
  );
});

test('D1 keeps the sealed challenge code and never the code', async () => {
  const runtime = await openSignerD1();
  try {
    const store = new CloudflareD1EmailOtpChallengeStore({
      database: runtime.database,
      namespace: 'test',
      orgId: 'org-1',
      projectId: 'project-1',
      envId: 'env-1',
    });
    const otpCode = '135790';
    const otpCodeSealedB64u = await createEmailOtpCodeSeal(rootA).seal({
      challengeId: 'challenge-1',
      otpCode,
    });
    const nowMs = Date.now();
    await store.put(
      emailOtpChallengeRecord({
        challengeId: 'challenge-1',
        challengeSubjectId: 'subject-1',
        walletId: 'wallet-1',
        orgId: 'org-1',
        email: 'owner@example.com',
        otpCodeSealedB64u,
        ownerProofBindingDigest: 'binding-digest',
        action: WALLET_EMAIL_OTP_ACTIONS.login,
        operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + 300_000,
        maxAttempts: 5,
      }),
    );

    const row = await runtime.database
      .prepare('SELECT * FROM email_otp_challenges WHERE challenge_id = ?1')
      .bind('challenge-1')
      .first<Record<string, unknown>>();
    expect(row?.otp_code_sealed).toBe(otpCodeSealedB64u);
    expect(JSON.stringify(row)).not.toContain(otpCode);
    expect((await store.read('challenge-1'))?.otpCodeSealedB64u).toBe(otpCodeSealedB64u);
  } finally {
    await runtime.close();
  }
});
