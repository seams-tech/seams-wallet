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

class ObservedEmailChallenge extends ExpiringEmailChallenge {
  walletId = '';
  challengeId = '';

  async handle(route: Route): Promise<void> {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = await response.json();
    this.walletId = route.request().postDataJSON().walletId;
    this.challengeId = body.challenge.challengeId;
    this.challenges += 1;
    if (this.challenges === 1) {
      this.expiresAtMs = Date.now() + 3_000;
      body.challenge.expiresAtMs = this.expiresAtMs;
    }
    await route.fulfill({ response, json: body });
  }
}

for (const scenario of ['mixed', 'near_only', 'added_email'] as const) {
  test(`custom ${scenario} email unlock rejects expired and cancelled challenges, resends, and signs`, async ({
    harness,
    context,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (scenario === 'added_email') {
      await harness.registerPasskeyWallet();
      await harness.awaitNearReady();
      await harness.addEmailOtpAuthMethod();
    } else if (scenario === 'near_only') {
      await harness.registerEmailOtpEd25519OnlyWallet();
    } else {
      await harness.registerEmailOtpWallet();
    }
    await harness.awaitNearReady();
    const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
    if (!walletId) throw new Error('Registered wallet identity is missing');
    await page.evaluate(async () => {
      await window.__seamsIntendedE2ELockWallet?.();
    });
    const challenge = new ObservedEmailChallenge();
    const handle = challenge.handle.bind(challenge);
    const observe = challenge.observe.bind(challenge);
    await context.route('**/wallet/email-otp/challenge', handle);
    context.on('request', observe);
    try {
      await page.getByLabel('Email wallet to unlock', { exact: true }).fill(walletId);
      if (scenario === 'added_email') {
        const email = await page.evaluate(readGoogleEmail);
        await page.getByLabel('Email address for local method', { exact: true }).fill(email);
      }
      await page.getByRole('button', { name: 'Request email code', exact: true }).click();
      const result = page.getByTestId('email-code-result');
      await expect(result).toHaveText('Code requested');
      await expect.poll(challenge.hasExpired.bind(challenge)).toBe(true);
      await page.getByLabel('Email unlock code', { exact: true }).fill('000000');
      await page.getByRole('button', { name: 'Unlock with email code', exact: true }).click();
      await expect(result).toContainText('Email code expired');
      expect(challenge.unlockRequests).toBe(0);
      await page.getByRole('button', { name: 'Resend email code', exact: true }).click();
      await expect(result).toHaveText('Code resent');
      await page.getByRole('button', { name: 'Cancel email code', exact: true }).click();
      await expect(result).toHaveText('Code cancelled');
      await page.getByRole('button', { name: 'Unlock with email code', exact: true }).click();
      await expect(result).not.toHaveText('Code cancelled');
      await expect(result).toHaveAttribute('data-state', 'challenge');
      expect(challenge.unlockRequests).toBe(0);
      await page.getByRole('button', { name: 'Request email code', exact: true }).click();
      await expect(result).toHaveText('Code requested');
      const code = await page.evaluate(readCode, { walletId, challengeId: challenge.challengeId });
      await page.getByLabel('Email unlock code', { exact: true }).fill(code);
      await page.getByRole('button', { name: 'Unlock with email code', exact: true }).click();
      await expect(result).toHaveAttribute('data-state', 'unlocked', { timeout: 60_000 });
      if (scenario !== 'near_only') await harness.signArcEvmTransaction('post_unlock');
      await harness.signNearTransaction('post_unlock');
      const artifactPath = path.resolve(
        testInfo.config.rootDir,
        `../.artifacts/r170/custom-${scenario}-email-unlock.json`,
      );
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(
        artifactPath,
        JSON.stringify(
          {
            kind: 'custom_email_unlock_e2e_v1',
            expiredAndCancelledChallengesRejectedBeforeUnlock: true,
            resendSucceeded: true,
            challenges: challenge.challenges,
            nearSignatureVerified: true,
            evmSignatureVerified: scenario !== 'near_only',
          },
          null,
          2,
        ) + '\n',
      );
      await testInfo.attach('custom-email-unlock.json', {
        path: artifactPath,
        contentType: 'application/json',
      });
    } finally {
      context.off('request', observe);
      await context.unroute('**/wallet/email-otp/challenge', handle);
    }
  });
}

function readGoogleEmail(): string {
  const token = new URL(location.href).searchParams.get('googleIdToken');
  if (!token) throw new Error('Google token is missing');
  return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email;
}

class LostEmailActivation {
  walletId = '';
  ownerAddress = '';
  originalBody: string | null = null;
  replays = 0;

  async handle(route: Route): Promise<void> {
    const body = route.request().postData();
    if (this.originalBody === null) {
      this.originalBody = body;
      const first = await route.fetch();
      expect(first.ok()).toBe(true);
      const committed = await first.json();
      expect(committed.registrationEstablishedSession.kind).toBe('issued');
      this.walletId = committed.walletId;
      this.ownerAddress = committed.ecdsa.walletKeys.find(matchesArcKey).thresholdOwnerAddress;
    } else {
      expect(JSON.parse(body || 'null')).toEqual(JSON.parse(this.originalBody));
    }
    const replay = await route.fetch();
    const committed = await replay.json();
    expect(committed.registrationEstablishedSession.kind).toBe('already_committed');
    expect(committed.walletId).toBe(this.walletId);
    this.replays += 1;
    await route.fulfill({ response: replay });
  }
}

function matchesArcKey(key: { chainTarget: { chainId: number } }): boolean {
  return key.chainTarget.chainId === 5_042_002;
}

test('custom email unlock completes pending activation after reload and signs with the same wallet', async ({
  harness,
  context,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const activation = new LostEmailActivation();
  const handle = activation.handle.bind(activation);
  const challenge = new ObservedEmailChallenge();
  challenge.challenges = 1;
  const observeChallenge = challenge.handle.bind(challenge);
  await context.route('**/wallets/register/activate', handle);
  await context.route('**/wallet/email-otp/challenge', observeChallenge);
  try {
    await expect(harness.registerEmailOtpEcdsaOnlyWallet()).rejects.toThrow('exact-method unlock');
    expect(activation.replays).toBe(1);
    const resumeUrl = new URL(page.url());
    resumeUrl.searchParams.set('walletId', activation.walletId);
    await page.goto(resumeUrl.href);
    await page.getByLabel('Email wallet to unlock', { exact: true }).fill(activation.walletId);
    await page.getByRole('button', { name: 'Request email code', exact: true }).click();
    const result = page.getByTestId('email-code-result');
    await expect(result).toHaveText('Code requested', { timeout: 30_000 });
    const code = await page.evaluate(readCode, {
      walletId: activation.walletId,
      challengeId: challenge.challengeId,
    });
    await page.getByLabel('Email unlock code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Unlock with email code', exact: true }).click();
    await expect(result).toHaveAttribute('data-state', 'unlocked', { timeout: 60_000 });
    expect(activation.replays).toBe(2);
    await page.getByTestId('intended-sign-arc-evm').click();
    await page
      .frameLocator('iframe.seams-wallet-overlay-iframe')
      .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
      .last()
      .click({ timeout: 30_000 });
    const signedResult = page.getByTestId('intended-result-json');
    await expect(signedResult).toContainText('arc_evm_sign_success', { timeout: 60_000 });
    const signed = JSON.parse(await signedResult.innerText()).action.result;
    const { isHex, recoverTransactionAddress } = await import('viem');
    if (!isHex(signed.rawTxHex)) throw new Error('Signed transaction is missing');
    expect(
      (await recoverTransactionAddress({ serializedTransaction: signed.rawTxHex })).toLowerCase(),
    ).toBe(activation.ownerAddress.toLowerCase());
    const artifactPath = path.resolve(
      testInfo.config.rootDir,
      '../.artifacts/r170/pending-email-unlock.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          kind: 'pending_email_unlock_e2e_v1',
          exactActivationReplayed: activation.replays === 2,
          originalWalletSignatureVerified: true,
          resumedAfterReloadThroughPublicEmailApi: true,
        },
        null,
        2,
      ) + '\n',
    );
    await testInfo.attach('pending-email-unlock.json', {
      path: artifactPath,
      contentType: 'application/json',
    });
  } finally {
    await context.unroute('**/wallets/register/activate', handle);
    await context.unroute('**/wallet/email-otp/challenge', observeChallenge);
  }
});
