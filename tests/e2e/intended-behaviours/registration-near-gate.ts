import { expect, type BrowserContext, type Route } from '@playwright/test';
import type { IntendedBehaviourHarness } from './harness';

class NearRegistrationGate {
  private releaseGate: () => void = ignoreRelease;
  private readonly released = new Promise<void>(this.saveRelease.bind(this));
  private requests = 0;

  private saveRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async hold(route: Route): Promise<void> {
    this.requests += 1;
    await this.released;
    await route.continue();
  }

  release(): void {
    this.releaseGate();
  }

  observed(): number {
    return this.requests;
  }
}

function ignoreRelease(): void {}

export async function assertIndependentNearRegistration(input: {
  harness: IntendedBehaviourHarness;
  context: BrowserContext;
  factor: 'passkey' | 'email_otp';
  path: string;
}): Promise<void> {
  const gate = new NearRegistrationGate();
  const handler = gate.hold.bind(gate);
  await input.context.route(`**${input.path}`, handler);
  try {
    switch (input.factor) {
      case 'passkey':
        await input.harness.registerPasskeyWallet();
        break;
      case 'email_otp':
        await input.harness.registerEmailOtpWallet();
        break;
    }
    await expect.poll(gate.observed.bind(gate)).toBeGreaterThan(0);
    await input.harness.signTempoTransaction('post_registration');
    await input.harness.signArcEvmTransaction('post_registration');
  } finally {
    gate.release();
    await input.context.unroute(`**${input.path}`, handler);
  }
  await input.harness.awaitNearReady();
  await input.harness.signNearTransaction('post_registration');
}
