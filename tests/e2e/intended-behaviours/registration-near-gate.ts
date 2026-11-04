import {
  expect,
  test,
  type BrowserContext,
  type ConsoleMessage,
  type Route,
  type Page,
} from '@playwright/test';
import type { IntendedBehaviourHarness } from './harness';

export class NearRegistrationGate {
  private releaseGate: () => void = ignoreRelease;
  private readonly released = new Promise<void>(this.saveRelease.bind(this));
  private requests = 0;

  private saveRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async hold(route: Route): Promise<void> {
    // Only the operation's POST is handled. An SDK preflight warm-up passes.
    if (route.request().method() !== 'POST') return await route.fallback();
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

async function releaseAfterPendingNearWait(page: Page, gate: NearRegistrationGate): Promise<void> {
  try {
    const status = page.getByTestId('intended-action-status');
    await expect(status).toHaveAttribute('data-action', 'awaitNearReady');
    await expect(status).toHaveAttribute('data-state', 'running');
    await page.waitForTimeout(250);
    await expect(status).toHaveAttribute('data-state', 'running');
  } finally {
    gate.release();
  }
}

export async function assertIndependentNearRegistration(input: {
  harness: IntendedBehaviourHarness;
  context: BrowserContext;
  factor: 'passkey' | 'email_otp';
  path: string;
  exhaustBudget?: boolean;
}): Promise<void> {
  const gate = new NearRegistrationGate();
  const preparation = new NearFinalizationResponseGate();
  const page = input.context.pages()[0];
  if (!page) throw new Error('Registration page is unavailable');
  const observePreparation = preparation.observe.bind(preparation);
  page.on('console', observePreparation);
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
    if (input.factor === 'passkey') {
      await expect.poll(preparation.isPrepared.bind(preparation)).toBe(true);
      expect(preparation.isFinished()).toBe(false);
    }
    await input.harness.signTempoTransaction('post_registration');
    await input.harness.signArcEvmTransaction('post_registration');
    if (input.exhaustBudget) await input.harness.signTempoTransaction('post_registration');
    pendingSession = await input.harness.readCurrentWalletSessionStatus();
    if (input.exhaustBudget) expect(pendingSession.remainingUses).toBe(0);
    await Promise.all([input.harness.awaitNearReady(), releaseAfterPendingNearWait(page, gate)]);
  } finally {
    gate.release();
    await input.context.unroute(`**${input.path}`, handler);
    page.off('console', observePreparation);
  }
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
  await test.info().attach('near-account-readiness.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      factor: input.factor,
      heldPath: input.path,
      defaultWaitRemainedPendingForMs: 250,
      accountReadyAfterRelease: true,
      sessionAuthorityUnchanged: true,
      nearSigningAfterRelease: 'passed',
    }),
  });
}

class NearFinalizationResponseGate {
  private releaseGate: () => void = ignoreRelease;
  private readonly released = new Promise<void>(this.saveRelease.bind(this));
  private committed = false;
  private prepared = false;
  private finished = false;

  private saveRelease(resolve: () => void): void {
    this.releaseGate = resolve;
  }

  async hold(route: Route): Promise<void> {
    // Only the operation's POST is handled. An SDK preflight warm-up passes.
    if (route.request().method() !== 'POST') return await route.fallback();
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
      text.includes('"stage":"session_seal_preparation"') &&
      text.includes('"outcome":"success"')
    )
      this.prepared = true;
    if (
      text.startsWith('[Registration] NEAR timing ') &&
      text.includes('"stage":"provisioning_total"')
    )
      this.finished = true;
  }

  isPrepared(): boolean {
    return this.prepared;
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
