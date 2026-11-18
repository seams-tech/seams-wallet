import { expect, test } from '@playwright/test';
import {
  WALLET_EMAIL_OTP_ACTIONS,
  WALLET_EMAIL_OTP_UNLOCK_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { CloudflareD1EmailOtpChallengeStore } from '../../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeStore';
import { emailOtpChallengeRecord } from '../../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';

function challenge(maxAttempts: number) {
  const nowMs = Date.now();
  return emailOtpChallengeRecord({
    challengeId: 'challenge-1',
    challengeSubjectId: 'subject-1',
    walletId: 'wallet-1',
    orgId: 'org-1',
    email: 'owner@example.com',
    otpCode: '123456',
    ownerProofBindingDigest: 'binding-digest',
    action: WALLET_EMAIL_OTP_ACTIONS.login,
    operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + 300_000,
    maxAttempts,
  });
}

test('parallel guesses on one read of a challenge reserve one attempt, not one each', async () => {
  const runtime = await openSignerD1();
  try {
    const store = new CloudflareD1EmailOtpChallengeStore({
      database: runtime.database,
      namespace: 'test',
      orgId: 'org-1',
      projectId: 'project-1',
      envId: 'env-1',
    });
    await store.put(challenge(3));
    const read = await store.read('challenge-1');
    if (!read) throw new Error('challenge was not stored');

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => store.reserveAttempt(read)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.read('challenge-1'))?.attemptCount).toBe(1);

    // A request that lost reads again and counts on the newer record.
    const again = await store.read('challenge-1');
    if (!again) throw new Error('challenge disappeared');
    expect((await store.reserveAttempt(again))?.attemptCount).toBe(2);
    expect(await store.reserveAttempt(again)).toBeNull();
  } finally {
    await runtime.close();
  }
});

test('a verified challenge is consumed after a parallel request counted another attempt', async () => {
  const runtime = await openSignerD1();
  try {
    const store = new CloudflareD1EmailOtpChallengeStore({
      database: runtime.database,
      namespace: 'test',
      orgId: 'org-1',
      projectId: 'project-1',
      envId: 'env-1',
    });
    await store.put(challenge(5));
    const read = await store.read('challenge-1');
    if (!read) throw new Error('challenge was not stored');
    const first = await store.reserveAttempt(read);
    if (!first) throw new Error('first reservation failed');
    const second = await store.reserveAttempt(first);
    expect(second?.attemptCount).toBe(2);

    // The first request verified its record before the second counted an attempt.
    await runtime.database.batch([...store.prepareConsumeInBatchStatements(first, Date.now())]);
    expect(await store.read('challenge-1')).toBeNull();
  } finally {
    await runtime.close();
  }
});
