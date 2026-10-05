import { expect, type Request, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intendedTest as test } from './harness';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

class ExpiringEmailChallenge {
  expiresAtMs = 0;
  challenges = 0;
  unlockRequests = 0;

  async shortenFirstChallenge(route: Route): Promise<void> {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = await response.json();
    this.challenges += 1;
    if (this.challenges === 1) {
      this.expiresAtMs = Date.now() + 3_000;
      body.challenge.expiresAtMs = this.expiresAtMs;
    }
    await route.fulfill({ response, json: body });
  }

  observe(request: Request): void {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === 'POST' &&
      (pathname === '/wallet/email-otp/factor-release' || pathname === '/wallet/unlock/verify')
    ) {
      this.unlockRequests += 1;
    }
  }

  hasExpired(): boolean {
    return this.expiresAtMs > 0 && Date.now() >= this.expiresAtMs;
  }
}

async function readCode(input: { walletId: string; challengeId: string }): Promise<string> {
  const reader = window.__seamsIntendedE2EReadEmailOtpCode;
  if (!reader) throw new Error('Email code reader is unavailable');
  return await reader({ kind: 'challenge', ...input });
}

test('expired email code stays local, resend refreshes the challenge and signs', async ({
  harness,
  context,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  const challenge = new ExpiringEmailChallenge();
  const handle = challenge.shortenFirstChallenge.bind(challenge);
  const observe = challenge.observe.bind(challenge);
  const challengePath = '**/wallet/email-otp/challenge';
  await context.route(challengePath, handle);
  context.on('request', observe);
  try {
    await page.getByTestId('intended-unlock-email-otp').click({ timeout: 10_000 });
    const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
    await frame.locator('[data-auth-menu-provider="google"]').click({ timeout: 10_000 });
    const input = frame.locator('#seams-auth-menu-google-otp');
    await expect(input).toBeVisible();
    await expect.poll(challenge.hasExpired.bind(challenge)).toBe(true);
    await input.fill('000000');
    await expect(
      frame
        .locator('.seams-auth-footer-text')
        .filter({ hasText: 'Email code expired. Request a new code.' }),
    ).toBeVisible();
    await expect(frame.getByRole('alert')).toHaveText('Email code expired. Request a new code.');
    expect(challenge.unlockRequests).toBe(0);
    console.info('[email-expiry] expired code rejected');
    await frame
      .getByRole('button', { name: 'Resend Code', exact: true })
      .click({ timeout: 10_000 });
    await expect.poll(() => challenge.challenges).toBe(2);
    await expect(input).toHaveValue('');
    console.info('[email-expiry] challenge refreshed');
    const walletId = await input.getAttribute('data-email-otp-wallet-id');
    const challengeId = await input.getAttribute('data-email-otp-challenge-id');
    if (!walletId || !challengeId) throw new Error('Fresh challenge identity is missing');
    const code = await page.evaluate(readCode, { walletId, challengeId });
    console.info('[email-expiry] code read');
    await input.fill(code);
    await expect(page.getByTestId('intended-result-json')).toContainText(
      'email_otp_unlock_success',
      {
        timeout: 60_000,
      },
    );
    expect(challenge.challenges).toBe(2);
    expect(challenge.unlockRequests).toBeGreaterThan(0);
    console.info('[email-expiry] unlock completed');
    await harness.signArcEvmTransaction('post_unlock');
    console.info('[email-expiry] signature verified');
    const artifactPath = path.resolve(
      testInfo.config.rootDir,
      '../.artifacts/r170/email-challenge-expiry.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          kind: 'email_challenge_expiry_e2e_v1',
          expiredCodeRejectedBeforeUnlock: true,
          refreshedChallengeUnlockSucceeded: true,
          challenges: challenge.challenges,
          signedAfterResend: true,
          reproduce:
            'SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- e2e/intended-behaviours/email-otp.challenge-expiry.contract.test.ts',
        },
        null,
        2,
      ) + '\n',
    );
    await testInfo.attach('email-challenge-expiry.json', {
      path: artifactPath,
      contentType: 'application/json',
    });
  } finally {
    context.off('request', observe);
    await context.unroute(challengePath, handle);
  }
});
