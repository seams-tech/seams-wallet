import { expect, type Request, type Route } from '@playwright/test';
import { intendedTest as test } from './harness';

class FirstSigningBatch {
  private releaseGate: () => void = () => {};
  private readonly released = new Promise<void>(this.captureRelease.bind(this));
  initializations = 0;
  terminalPrepares = 0;
  ordinaryPrepares = 0;
  finalizations = 0;

  private captureRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async holdInit(route: Route): Promise<void> {
    this.initializations += 1;
    await this.released;
    await route.continue();
  }

  release(): void {
    this.releaseGate();
  }
  observed(): number {
    return this.initializations;
  }

  record(request: Request): void {
    const path = new URL(request.url()).pathname;
    if (path === '/router-ab/ecdsa-derivation/sign/prepare') {
      const body = request.postDataJSON();
      if (body.presign_source?.kind === 'final_presign_batch') this.terminalPrepares += 1;
      else this.ordinaryPrepares += 1;
    }
    if (path === '/router-ab/ecdsa-derivation/sign') this.finalizations += 1;
  }
}

test('first ECDSA signing promotes a background final batch through live authorization', async ({
  harness,
  context,
  page,
}) => {
  const batch = new FirstSigningBatch();
  const path = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
  const hold = batch.holdInit.bind(batch);
  const record = batch.record.bind(batch);
  await context.route(path, hold);
  context.on('request', record);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(batch.observed.bind(batch)).toBeGreaterThan(0);
    const signing = harness.signTempoTransaction('post_registration');
    // Hold generation while the confirmed transaction reaches the empty-pool wait.
    await page.waitForTimeout(150);
    batch.release();
    await signing;
    expect(batch.terminalPrepares).toBe(1);
    expect(batch.ordinaryPrepares).toBe(0);
    expect(batch.finalizations).toBe(1);
    await harness.assertRegistrationOwnerSessionIsActive();
  } finally {
    batch.release();
    context.off('request', record);
    await context.unroute(path, hold);
  }
});

async function interruptAdmittedPrepare(
  harness: import('./harness').IntendedBehaviourHarness,
  mode: 'lost_response' | 'cancelled',
  counter: { admitted: number },
  route: Route,
): Promise<void> {
  const response = await route.fetch();
  expect(response.status()).toBe(200);
  counter.admitted += 1;
  if (mode === 'cancelled') await harness.lockWallet();
  await route.abort('connectionclosed');
}

for (const mode of ['lost_response', 'cancelled'] as const) {
  test(`admitted terminal prepare ${mode} does not restart signing`, async ({
    harness,
    context,
    page,
  }) => {
    const batch = new FirstSigningBatch();
    const counter = { admitted: 0 };
    const initPath = '**/router-ab/ecdsa-derivation/presignature-pool/fill/init';
    const preparePath = '**/router-ab/ecdsa-derivation/sign/prepare';
    const hold = batch.holdInit.bind(batch);
    const interrupt = interruptAdmittedPrepare.bind(undefined, harness, mode, counter);
    const record = batch.record.bind(batch);
    await context.route(initPath, hold);
    await context.route(preparePath, interrupt);
    context.on('request', record);
    try {
      await harness.registerPasskeyWallet();
      await expect.poll(batch.observed.bind(batch)).toBeGreaterThan(0);
      const signing = harness.signTempoTransaction('post_registration');
      const rejected = expect(signing).rejects.toThrow();
      await page.waitForTimeout(150);
      batch.release();
      await rejected;
      expect(counter.admitted).toBe(1);
      expect(batch.terminalPrepares).toBe(1);
      expect(batch.ordinaryPrepares).toBe(0);
      expect(batch.finalizations).toBe(0);
      if (mode === 'cancelled') await harness.assertWalletLocked();
    } finally {
      batch.release();
      context.off('request', record);
      await context.unroute(initPath, hold);
      await context.unroute(preparePath, interrupt);
    }
  });
}
