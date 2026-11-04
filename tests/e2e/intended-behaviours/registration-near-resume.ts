import { expect, type BrowserContext, type Request, type Route } from '@playwright/test';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import type { IntendedBehaviourHarness } from './harness';

class InterruptedNearRequest {
  readonly executeBodies: string[] = [];
  private interrupted = 0;

  constructor(private readonly interruption: 'before_request' | 'lost_response') {}

  record(request: Request): void {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1
    ) {
      this.executeBodies.push(request.postData() ?? '');
    }
  }

  count(): number {
    return this.interrupted;
  }

  async reject(route: Route): Promise<void> {
    // Only the operation's POST is interrupted. An SDK preflight warm-up passes.
    if (route.request().method() !== 'POST') return await route.fallback();
    if (this.interruption === 'lost_response') {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
    }
    this.interrupted += 1;
    await route.abort('failed');
  }
}

export async function assertResumedNearRegistration(input: {
  readonly harness: IntendedBehaviourHarness;
  readonly context: BrowserContext;
  readonly factor: 'passkey' | 'email_otp';
  readonly path: string;
  readonly interruption: 'before_request' | 'lost_response';
}): Promise<void> {
  const interrupted = new InterruptedNearRequest(input.interruption);
  const path = `**${input.path}`;
  const reject = interrupted.reject.bind(interrupted);
  input.context.on('request', interrupted.record.bind(interrupted));
  await input.context.route(path, reject);
  try {
    switch (input.factor) {
      case 'passkey':
        await input.harness.registerPasskeyWallet();
        break;
      case 'email_otp':
        await input.harness.registerEmailOtpWallet();
        break;
    }
    await expect.poll(interrupted.count.bind(interrupted)).toBeGreaterThan(0);
    await input.harness.signTempoTransaction('post_registration');
  } finally {
    await input.context.unroute(path, reject);
  }
  switch (input.factor) {
    case 'passkey':
      await input.harness.unlockPasskeyWithPendingNear();
      break;
    case 'email_otp':
      await input.harness.unlockEmailOtpWithPendingNear();
      break;
  }
  await input.harness.signArcEvmTransaction('post_unlock');
  await input.harness.awaitNearReady();
  await input.harness.signNearTransaction('post_unlock');
  if (input.path === ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1) {
    expect(interrupted.executeBodies.length).toBeGreaterThan(1);
  }
  for (const body of interrupted.executeBodies) {
    expect(body).toBe(interrupted.executeBodies[0]);
  }
}
