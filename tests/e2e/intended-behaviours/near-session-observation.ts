import { expect, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { IntendedBehaviourHarness } from './harness';

class SessionReadEvidence {
  readonly requests: { stage: string; path: string }[] = [];
  stage = 'registration';

  record(request: Request): void {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === '/wallet/session/status') {
      this.requests.push({ stage: this.stage, path });
    }
  }
}

async function readWalletAuthentication(): Promise<string> {
  const read = window.__seamsIntendedE2EReadWalletLockState;
  if (!read) throw new Error('Wallet session reader is unavailable');
  return (await read()).authenticationKind;
}

export async function verifyNearSessionObservation(
  { harness, context, page }: {
    harness: IntendedBehaviourHarness;
    context: BrowserContext;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
  const evidence = new SessionReadEvidence();
  const record = evidence.record.bind(evidence);
  context.on('request', record);
  const held = await harness.holdWalletSessionStatusAnswers();
  const registration = harness.registerPasskeyEd25519YaoWallet();
  let sharedRegistrationStatusRequests = 0;
  try {
    await expect.poll(held.heldCount).toBeGreaterThan(0);
    // Keep the real reply pending while the explicit registration query arrives.
    await page.waitForTimeout(250);
    sharedRegistrationStatusRequests = held.heldCount();
    expect(sharedRegistrationStatusRequests).toBe(1);
  } finally {
    await held.dispose();
  }
  await registration;
  const signature = await harness.signNearMessage('Verify the shared registration observation');
  try {
    evidence.stage = 'first_explicit_query';
    const beforeFirst = evidence.requests.length;
    expect(await page.evaluate(readWalletAuthentication)).toBe('authenticated');
    expect(evidence.requests.length - beforeFirst).toBe(1);
    evidence.stage = 'second_explicit_query';
    const beforeSecond = evidence.requests.length;
    expect(await page.evaluate(readWalletAuthentication)).toBe('authenticated');
    expect(evidence.requests.length - beforeSecond).toBe(1);

    evidence.stage = 'lock_during_query';
    const delayed = await harness.holdWalletSessionStatusAnswers();
    const pendingAuthentication = page.evaluate(readWalletAuthentication);
    let locking: Promise<void> = Promise.resolve();
    try {
      await expect.poll(delayed.heldCount).toBeGreaterThan(0);
      locking = harness.lockWallet();
      await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
        'data-login-state', 'logged_out',
      );
    } finally {
      await delayed.dispose();
    }
    await locking;
    expect(await pendingAuthentication).toBe('signed_out');
    await harness.assertWalletLocked();
    const artifact = testInfo.outputPath('near-session-observation.json');
    await writeFile(artifact, JSON.stringify({
      sharedRegistrationStatusRequests,
      laterQueriesReadFreshStatus: true,
      lockWinsOverDelayedStatus: true,
      signature,
      requests: evidence.requests,
    }, null, 2));
    await testInfo.attach('near-session-observation', { path: artifact, contentType: 'application/json' });
  } finally {
    context.off('request', record);
  }
}
