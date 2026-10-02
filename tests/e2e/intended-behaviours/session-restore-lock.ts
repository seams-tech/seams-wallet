import { expect, type Frame, type Page, type Route, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IntendedBehaviourHarness } from './harness';

type PersistenceSnapshot = {
  readonly lockState: string;
  readonly lockGeneration: number;
  readonly sessions: readonly {
    readonly walletSessionId: string;
    readonly quotaId: string;
    readonly capabilityCount: number;
  }[];
};

// Injected into the wallet origin; all session rows come from real registration.
class RestorePersistenceProbe {
  static open(resolve: (database: IDBDatabase) => void, reject: (error: unknown) => void): void {
    const request = indexedDB.open('seams_wallet');
    request.onsuccess = RestorePersistenceProbe.opened.bind(undefined, resolve, request);
    request.onerror = RestorePersistenceProbe.failed.bind(undefined, reject, request);
  }

  static opened(resolve: (database: IDBDatabase) => void, request: IDBOpenDBRequest): void {
    resolve(request.result);
  }

  static failed(reject: (error: unknown) => void, request: IDBRequest): void {
    reject(request.error);
  }

  static observeRequest(
    request: IDBRequest,
    resolve: (result: unknown) => void,
    reject: (error: unknown) => void,
  ): void {
    request.onsuccess = RestorePersistenceProbe.succeeded.bind(undefined, resolve, request);
    request.onerror = RestorePersistenceProbe.failed.bind(undefined, reject, request);
  }

  static succeeded(resolve: (result: unknown) => void, request: IDBRequest): void {
    resolve(request.result);
  }

  static observeTransaction(
    transaction: IDBTransaction,
    resolve: () => void,
    reject: (error: unknown) => void,
  ): void {
    transaction.oncomplete = resolve;
    transaction.onabort = RestorePersistenceProbe.aborted.bind(undefined, reject, transaction);
    transaction.onerror = RestorePersistenceProbe.aborted.bind(undefined, reject, transaction);
  }

  static aborted(reject: (error: unknown) => void, transaction: IDBTransaction): void {
    reject(transaction.error);
  }

  static object(value: unknown): object {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Wallet persistence probe expected an object');
    }
    return value;
  }

  static sessionSummary(value: unknown): PersistenceSnapshot['sessions'][number] {
    const row = RestorePersistenceProbe.object(value);
    const record = RestorePersistenceProbe.object(Reflect.get(row, 'record'));
    const subjects = Reflect.get(record, 'capabilitySubjects');
    if (!Array.isArray(subjects)) throw new Error('Session capability subjects are missing');
    return {
      walletSessionId: String(Reflect.get(row, 'wallet_session_id')),
      quotaId: String(Reflect.get(record, 'quotaId')),
      capabilityCount: subjects.length,
    };
  }

  static async read(): Promise<PersistenceSnapshot> {
    const database = await new Promise<IDBDatabase>(RestorePersistenceProbe.open);
    try {
      const transaction = database.transaction(
        ['wallet_session_authorizations', 'wallet_selections'],
        'readonly',
      );
      const done = new Promise<void>(
        RestorePersistenceProbe.observeTransaction.bind(undefined, transaction),
      );
      const sessions = await new Promise<unknown>(
        RestorePersistenceProbe.observeRequest.bind(
          undefined,
          transaction.objectStore('wallet_session_authorizations').getAll(),
        ),
      );
      const selections = await new Promise<unknown>(
        RestorePersistenceProbe.observeRequest.bind(
          undefined,
          transaction.objectStore('wallet_selections').getAll(),
        ),
      );
      await done;
      if (!Array.isArray(sessions) || !Array.isArray(selections) || selections.length !== 1) {
        throw new Error('Expected one wallet selection');
      }
      const selection = RestorePersistenceProbe.object(selections[0]);
      const record = RestorePersistenceProbe.object(Reflect.get(selection, 'record'));
      return {
        lockState: String(Reflect.get(record, 'lockState')),
        lockGeneration: Number(Reflect.get(record, 'lockGeneration')),
        sessions: sessions.map(RestorePersistenceProbe.sessionSummary),
      };
    } finally {
      database.close();
    }
  }

  static async retainEarlierCapabilityProjection(): Promise<void> {
    const database = await new Promise<IDBDatabase>(RestorePersistenceProbe.open);
    try {
      const transaction = database.transaction('wallet_session_authorizations', 'readwrite');
      const done = new Promise<void>(
        RestorePersistenceProbe.observeTransaction.bind(undefined, transaction),
      );
      const store = transaction.objectStore('wallet_session_authorizations');
      const rows = await new Promise<unknown>(
        RestorePersistenceProbe.observeRequest.bind(undefined, store.getAll()),
      );
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Expected one exact session');
      const row = RestorePersistenceProbe.object(rows[0]);
      const record = RestorePersistenceProbe.object(Reflect.get(row, 'record'));
      const subjects = Reflect.get(record, 'capabilitySubjects');
      if (!Array.isArray(subjects) || subjects.length < 2) {
        transaction.abort();
        throw new Error('Expected the mixed-wallet session capability projection');
      }
      // A valid older projection makes the real status response need reconciliation.
      Reflect.set(record, 'capabilitySubjects', subjects.slice(0, 1));
      store.put(row);
      await done;
    } finally {
      database.close();
    }
  }
}

class RestorationResponseGate {
  held = false;
  finished = false;
  private released = false;

  async hold(route: Route): Promise<void> {
    if (this.released) {
      await route.continue();
      return;
    }
    const request = route.request();
    const origin = process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202';
    const response = await route.fetch({ headers: { ...request.headers(), origin } });
    this.held = true;
    while (!this.released) await new Promise<void>(resolveGatePoll);
    await route.fulfill({ response });
    this.finished = true;
  }

  release(): void {
    this.released = true;
  }
}

function resolveGatePoll(resolve: () => void): void {
  setTimeout(resolve, 10);
}

async function walletFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('iframe[src*="/wallet-service"]').last();
  await iframe.waitFor({ state: 'attached' });
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('Wallet service frame is missing');
  return frame;
}

type ScenarioFixtures = {
  readonly harness: IntendedBehaviourHarness;
  readonly page: Page;
};

async function verifyRestorationRace(
  fixtures: ScenarioFixtures,
  testInfo: TestInfo,
  outcome: 'locked' | 'fresh_unlock',
): Promise<void> {
  testInfo.setTimeout(180_000);
  const { harness, page } = fixtures;
  console.log('[session-restore] registering wallet');
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  console.log('[session-restore] preparing earlier capability projection');
  let frame = await walletFrame(page);
  await frame.addScriptTag({ content: RestorePersistenceProbe.toString() });
  const before = await frame.evaluate<PersistenceSnapshot>('RestorePersistenceProbe.read()');
  expect(before.sessions).toHaveLength(1);
  await frame.evaluate('RestorePersistenceProbe.retainEarlierCapabilityProjection()');

  const restoringTab = await page.context().newPage();
  const gate = new RestorationResponseGate();
  const handler = gate.hold.bind(gate);
  await restoringTab.route('**/wallet/session/status', handler);
  try {
    await restoringTab.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await expect.poll(gateHeld.bind(undefined, gate)).toBe(true);
    console.log('[session-restore] authoritative response held; locking the other tab');
    await harness.lockWallet();
    console.log('[session-restore] lock completed');
    const locked = await frame.evaluate<PersistenceSnapshot>('RestorePersistenceProbe.read()');
    expect(locked.lockState).toBe('locked');
    expect(locked.sessions).toHaveLength(0);
    let expected = locked;
    if (outcome === 'fresh_unlock') {
      await harness.unlockPasskeyWallet();
      frame = await walletFrame(page);
      await frame.addScriptTag({ content: RestorePersistenceProbe.toString() });
      expected = await frame.evaluate<PersistenceSnapshot>('RestorePersistenceProbe.read()');
      expect(expected.sessions).toHaveLength(1);
      expect(expected.sessions[0].walletSessionId).not.toBe(before.sessions[0].walletSessionId);
    }
    gate.release();
    console.log('[session-restore] releasing delayed response');
    await expect.poll(gateFinished.bind(undefined, gate)).toBe(true);
    await expect(restoringTab.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      outcome === 'locked' ? 'logged_out' : 'logged_in',
    );
    const after = await frame.evaluate<PersistenceSnapshot>('RestorePersistenceProbe.read()');
    const artifact = testInfo.outputPath('cross-tab-restoration.json');
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(artifact, `${JSON.stringify({ outcome, before, locked, expected, after }, null, 2)}\n`);
    await testInfo.attach('cross-tab restoration persistence', {
      path: artifact,
      contentType: 'application/json',
    });
    expect(after).toEqual(expected);
  } finally {
    gate.release();
    await restoringTab.unrouteAll({ behavior: 'wait' });
    await restoringTab.close();
  }
  if (outcome === 'locked') await harness.unlockPasskeyWallet();
  console.log('[session-restore] checking fresh-session signing');
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
}

function gateHeld(gate: RestorationResponseGate): boolean {
  return gate.held;
}

function gateFinished(gate: RestorationResponseGate): boolean {
  return gate.finished;
}

export async function verifyLockWins(
  { harness, page }: ScenarioFixtures,
  testInfo: TestInfo,
): Promise<void> {
  await verifyRestorationRace({ harness, page }, testInfo, 'locked');
}

export async function verifyFreshUnlockWins(
  { harness, page }: ScenarioFixtures,
  testInfo: TestInfo,
): Promise<void> {
  await verifyRestorationRace({ harness, page }, testInfo, 'fresh_unlock');
}
