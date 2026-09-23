import { expect, type BrowserContext, type Request, type Route } from '@playwright/test';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import type { IntendedBehaviourHarness } from './harness';

class InterruptedNearRequest {
  readonly executeBodies: string[] = [];
  private interrupted = 0;

  constructor(private readonly interruption: 'before_request' | 'lost_response') {}

  record(request: Request): void {
    if (new URL(request.url()).pathname === ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1) {
      this.executeBodies.push(request.postData() ?? '');
    }
  }

  count(): number {
    return this.interrupted;
  }

  async reject(route: Route): Promise<void> {
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
  readonly retainedCompletion?: 'sealed_material';
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
  if (input.retainedCompletion === 'sealed_material') {
    const page = input.context.pages()[0];
    if (!page) throw new Error('Registration page is unavailable');
    await page
      .locator('iframe[allow*="publickey-credentials-get"]')
      .last()
      .contentFrame()
      .locator('body')
      .evaluate(retainJoinedMaterialWithoutCheckpoint);
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

async function retainJoinedMaterialWithoutCheckpoint(): Promise<void> {
  const open = indexedDB.open('seams_wallet');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    const transaction = database.transaction('app_state', 'readwrite');
    const completion = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const store = transaction.objectStore('app_state');
    const request = store.getAll();
    request.onsuccess = () => {
      let retained = 0;
      for (const row of request.result) {
        if (
          row.value?.record?.operation === 'near_provisioning' &&
          row.value.record.phase === 'joined'
        ) {
          // Exercise the persisted format that predates encrypted completion checkpoints.
          delete row.value.record.completion;
          store.put(row);
          retained += 1;
        }
      }
      if (retained !== 1) transaction.abort();
    };
    await completion;
  } finally {
    database.close();
  }
}
