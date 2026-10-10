import {
  expect,
  type APIResponse,
  type BrowserContext,
  type Request,
  type Route,
} from '@playwright/test';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import type { IntendedBehaviourHarness } from './harness';

class InterruptedNearRequest {
  readonly executeBodies: string[] = [];
  private interrupted = 0;
  private refused = 0;

  constructor(
    private readonly interruption: 'before_request' | 'lost_response' | 'in_progress',
  ) {}

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

  refusals(): number {
    return this.refused;
  }

  /**
   * Sends the first resumed request twice at the same time. The Router runs one
   * send and answers the other that the execution is in progress. The page
   * gets that answer, so it must send the exact request again.
   */
  async refuseWhileExecuting(route: Route): Promise<void> {
    if (this.refused > 0 || route.request().method() !== 'POST') return await route.fallback();
    this.refused += 1;
    const answers = await Promise.all([route.fetch(), route.fetch()]);
    expect(answers.map(responseStatus).sort()).toEqual([200, 409]);
    const refusal = answers.find(isConflict);
    if (!refusal) throw new Error('Neither send was refused');
    expect(await refusal.json()).toMatchObject({ ok: false, code: 'execution_in_progress' });
    await route.fulfill({ response: refusal });
  }
}

function responseStatus(response: APIResponse): number {
  return response.status();
}

function isConflict(response: APIResponse): boolean {
  return response.status() === 409;
}

export async function assertResumedNearRegistration(input: {
  readonly harness: IntendedBehaviourHarness;
  readonly context: BrowserContext;
  readonly factor: 'passkey' | 'email_otp';
  readonly path: string;
  /** `in_progress` also makes the resumed request meet an execution that still runs. */
  readonly interruption: 'before_request' | 'lost_response' | 'in_progress';
  readonly retainedCompletion?: 'sealed_material';
}): Promise<void> {
  const interrupted = new InterruptedNearRequest(input.interruption);
  const path = `**${input.path}`;
  const reject = interrupted.reject.bind(interrupted);
  const refuse = interrupted.refuseWhileExecuting.bind(interrupted);
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
  if (input.interruption === 'in_progress') await input.context.route(path, refuse);
  try {
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
  } finally {
    await input.context.unroute(path, refuse);
  }
  if (input.interruption === 'in_progress') expect(interrupted.refusals()).toBe(1);
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
