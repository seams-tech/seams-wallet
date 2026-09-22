import {
  expect,
  type BrowserContext,
  type ConsoleMessage,
  type Route,
  type Page,
} from '@playwright/test';
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
  exhaustBudget?: boolean;
}): Promise<void> {
  const gate = new NearRegistrationGate();
  let pendingSession: Awaited<
    ReturnType<IntendedBehaviourHarness['readCurrentWalletSessionStatus']>
  > | null = null;
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
    if (input.exhaustBudget) await input.harness.signTempoTransaction('post_registration');
    pendingSession = await input.harness.readCurrentWalletSessionStatus();
    if (input.exhaustBudget) expect(pendingSession.remainingUses).toBe(0);
  } finally {
    gate.release();
    await input.context.unroute(`**${input.path}`, handler);
  }
  await input.harness.awaitNearReady();
  if (!pendingSession) throw new Error('NEAR gate did not capture the pending session');
  const readySession = await input.harness.readCurrentWalletSessionStatus();
  expect(readySession.walletSessionId).toBe(pendingSession.walletSessionId);
  expect(readySession.quotaId).toBe(pendingSession.quotaId);
  expect(readySession.remainingUses).toBe(pendingSession.remainingUses);
  expect(readySession.expiresAtMs).toBe(pendingSession.expiresAtMs);
  expect(readySession.authorization.authorizationId).toBe(
    pendingSession.authorization.authorizationId,
  );
  expect(readySession.authorization.issuedAtMs).toBe(pendingSession.authorization.issuedAtMs);
  expect(readySession.authorization.authorityRevocationEpoch).toBe(
    pendingSession.authorization.authorityRevocationEpoch,
  );
  expect(readySession.authorization.capabilitySubjects).toEqual(
    expect.arrayContaining([...pendingSession.authorization.capabilitySubjects]),
  );
  if (input.exhaustBudget && input.factor === 'passkey') {
    await input.harness.refreshPagePreservingWalletStorage();
  }
  await input.harness.signNearTransaction(
    input.exhaustBudget ? 'step_up_required' : 'post_registration',
  );
  if (input.exhaustBudget) {
    const afterStepUp = await input.harness.readCurrentWalletSessionStatus();
    expect(afterStepUp.walletSessionId).toBe(pendingSession.walletSessionId);
    expect(afterStepUp.quotaId).toBe(pendingSession.quotaId);
    expect(afterStepUp.remainingUses).toBe(0);
    expect(afterStepUp.expiresAtMs).toBe(pendingSession.expiresAtMs);
  }
}

class NearFinalizationResponseGate {
  private releaseGate: () => void = ignoreRelease;
  private readonly released = new Promise<void>(this.saveRelease.bind(this));
  private committed = false;
  private finished = false;

  private saveRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async hold(route: Route): Promise<void> {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    this.committed = true;
    await this.released;
    await route.fulfill({ response });
  }

  observe(message: ConsoleMessage): void {
    const text = message.text();
    if (
      text.startsWith('[Registration] NEAR timing ') &&
      text.includes('"stage":"provisioning_total"')
    )
      this.finished = true;
  }

  isCommitted(): boolean {
    return this.committed;
  }
  isFinished(): boolean {
    return this.finished;
  }
  release(): void {
    this.releaseGate();
  }
}

export async function assertLateNearCompletionKeepsWalletLocked(input: {
  readonly harness: IntendedBehaviourHarness;
  readonly context: BrowserContext;
  readonly factor: 'passkey' | 'email_otp';
  readonly lockSource: 'same_tab' | 'other_tab';
}): Promise<void> {
  const gate = new NearFinalizationResponseGate();
  const handler = gate.hold.bind(gate);
  const page = input.context.pages()[0];
  if (!page) throw new Error('Registration page is unavailable');
  page.on('console', gate.observe.bind(gate));
  await input.context.route('**/wallets/register/near-provisioning', handler);
  try {
    if (input.factor === 'passkey') await input.harness.registerPasskeyWallet();
    else await input.harness.registerEmailOtpWallet();
    await expect.poll(gate.isCommitted.bind(gate)).toBe(true);
    await input.harness.signTempoTransaction('post_registration');
    if (input.lockSource === 'other_tab') await lockWalletFromAnotherTab(input.context, page);
    else await input.harness.lockWallet();
    gate.release();
    await expect.poll(gate.isFinished.bind(gate)).toBe(true);
    await input.harness.assertWalletLocked();
  } finally {
    gate.release();
    await input.context.unroute('**/wallets/register/near-provisioning', handler);
  }
  if (input.factor === 'passkey') await input.harness.unlockPasskeyWithPendingNear();
  else await input.harness.unlockEmailOtpWithPendingNear();
  await input.harness.awaitNearReady();
  await input.harness.signNearTransaction('post_unlock');
}

export async function assertNearReadyTransactionRollsBack(input: {
  readonly harness: IntendedBehaviourHarness;
  readonly context: BrowserContext;
  readonly factor: 'passkey' | 'email_otp';
}): Promise<void> {
  const page = input.context.pages()[0];
  if (!page) throw new Error('Registration page is unavailable');
  const gate = new NearFinalizationResponseGate();
  page.on('console', gate.observe.bind(gate));
  // Abort after the ready write, precisely when the same transaction deletes its journal.
  await input.context.addInitScript({
    content: `
    const deleteBeforeNearFault = IDBObjectStore.prototype.delete;
    function abortNearReadyTransaction(key) {
      if (this.name === 'app_state' && typeof key === 'string' &&
          key.startsWith('pending_wallet_registration_commit_v1:') &&
          key.endsWith(':near_provisioning') &&
          this.transaction.objectStoreNames.contains('wallets') &&
          sessionStorage.getItem('near-ready-abort-injected') !== 'yes') {
        sessionStorage.setItem('near-ready-abort-injected', 'yes');
        IDBObjectStore.prototype.delete = deleteBeforeNearFault;
        this.transaction.abort();
        throw new DOMException('Injected NEAR readiness transaction abort', 'AbortError');
      }
      return deleteBeforeNearFault.call(this, key);
    }
    IDBObjectStore.prototype.delete = abortNearReadyTransaction;
  `,
  });
  if (input.factor === 'passkey') await input.harness.registerPasskeyWallet();
  else await input.harness.registerEmailOtpWallet();
  await expect.poll(gate.isFinished.bind(gate)).toBe(true);
  const persisted = await page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .contentFrame()
    .locator('body')
    .evaluate(readNearRegistrationPersistence);
  expect(persisted.phases).toEqual(['joined']);
  expect(persisted.statuses).not.toContain('near_ready');
  await input.harness.signTempoTransaction('post_registration');
  // The fault is injected once; ordinary unlock can repair the retained journal.
  if (input.factor === 'passkey') await input.harness.unlockPasskeyWithPendingNear();
  else await input.harness.unlockEmailOtpWithPendingNear();
  await input.harness.awaitNearReady();
  await input.harness.signNearTransaction('post_unlock');
}

async function readNearRegistrationPersistence(): Promise<{
  phases: string[];
  statuses: string[];
}> {
  const opening = indexedDB.open('seams_wallet');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    const transaction = database.transaction(['app_state', 'wallets'], 'readonly');
    const rows = transaction.objectStore('app_state').getAll();
    const profiles = transaction.objectStore('wallets').getAll();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    return {
      phases: rows.result
        .filter((row) => row.value?.record?.operation === 'near_provisioning')
        .map((row) => String(row.value.record.phase)),
      statuses: profiles.result.map((row) => String(row.record?.nearProvisioning?.status)),
    };
  } finally {
    database.close();
  }
}

async function lockWalletFromAnotherTab(context: BrowserContext, original: Page): Promise<void> {
  const other = await context.newPage();
  try {
    await other.goto(original.url(), { waitUntil: 'domcontentloaded' });
    await other.waitForFunction(walletLockHelperAvailable);
    await expect(other.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
    );
    await other.evaluate(lockCurrentWallet);
  } finally {
    await other.close();
  }
}

function walletLockHelperAvailable(): boolean {
  return typeof window.__seamsIntendedE2ELockWallet === 'function';
}

async function lockCurrentWallet(): Promise<void> {
  const lock = window.__seamsIntendedE2ELockWallet;
  if (!lock) throw new Error('Wallet lock helper is unavailable');
  await lock();
}

class NearHydrationGate {
  private releaseGate: () => void = ignoreRelease;
  private readonly released = new Promise<void>(this.saveRelease.bind(this));
  private published = false;
  private held = false;
  private installed = false;
  private finished = false;

  constructor(private readonly result: 'success' | 'failure' | 'lock') {}

  private saveRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  observe(message: ConsoleMessage): void {
    const text = message.text();
    if (!text.startsWith('[Registration] NEAR timing ')) return;
    if (text.includes('"stage":"local_publication"')) this.published = true;
    if (text.includes('"stage":"signer_activation"')) this.installed = true;
    if (text.includes('"stage":"provisioning_total"')) this.finished = true;
  }

  async hold(route: Route): Promise<void> {
    if (!this.published || this.held) {
      await route.continue();
      return;
    }
    this.held = true;
    await this.released;
    if (this.result === 'failure')
      await route.fulfill({ status: 503, body: 'Injected seal failure' });
    else await route.continue();
  }

  isInstalledWhileHeld(): boolean {
    return this.held && this.installed;
  }
  isFinished(): boolean {
    return this.finished;
  }
  release(): void {
    this.releaseGate();
  }
}

export async function assertPasskeyHydrationOverlapsInstallation(input: {
  readonly harness: IntendedBehaviourHarness;
  readonly context: BrowserContext;
  readonly result: 'success' | 'failure' | 'lock';
}): Promise<void> {
  const gate = new NearHydrationGate(input.result);
  const handler = gate.hold.bind(gate);
  const page = input.context.pages()[0];
  if (!page) throw new Error('Registration page is unavailable');
  page.on('console', gate.observe.bind(gate));
  await input.context.route('**/apply-server-seal', handler);
  try {
    await input.harness.registerPasskeyWallet();
    await expect.poll(gate.isInstalledWhileHeld.bind(gate)).toBe(true);
    expect(gate.isFinished()).toBe(false);
    const persisted = await page
      .locator('iframe[allow*="publickey-credentials-get"]')
      .last()
      .contentFrame()
      .locator('body')
      .evaluate(readNearRegistrationPersistence);
    expect(persisted.phases).toEqual(['joined']);
    expect(persisted.statuses).not.toContain('near_ready');
    if (input.result === 'lock') await input.harness.lockWallet();
    gate.release();
    await expect.poll(gate.isFinished.bind(gate)).toBe(true);
  } finally {
    gate.release();
    await input.context.unroute('**/apply-server-seal', handler);
  }
  if (input.result === 'lock') await input.harness.assertWalletLocked();
  if (input.result === 'failure') await input.harness.signTempoTransaction('post_registration');
  if (input.result !== 'success') await input.harness.unlockPasskeyWithPendingNear();
  await input.harness.awaitNearReady();
  await input.harness.signNearTransaction('post_registration');
  await input.harness.refreshPagePreservingWalletStorage();
  await input.harness.signNearTransactionAfterRefresh();
}
