import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { verifyNearSessionObservation } from './near-session-observation';
import {
  expect,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';
import {
  intendedTest as test,
  signAndVerifyNearMessage,
  type IntendedBehaviourHarness,
} from './harness';

test(
  'NEAR registration publishes its session without a status request, keeps queries fresh, and respects lock',
  verifyNearSessionObservation,
);

class NearRegistrationReplay {
  readonly requests: string[] = [];
  admissionReceiptDigest: string | null = null;
  finalizedWalletId: string | null = null;
  finalizationReplays = 0;
  finalizationRequestDigest: string | null = null;
  private finalizationCommit: unknown = null;
  signerPublicFacts: { nearAccountId: string; operationalPublicKey: string } | null = null;

  constructor(private readonly delivery: 'primary' | 'replay') {}

  observe(request: Request): void {
    if (request.method() === 'POST') this.requests.push(new URL(request.url()).pathname);
  }

  async handle(route: Route): Promise<void> {
    // Only the operation's POST is handled. An SDK preflight warm-up passes.
    if (route.request().method() !== 'POST') return await route.fallback();
    try {
      const path = new URL(route.request().url()).pathname;
      if (path === '/wallets/register/respond') {
        await this.replayRespond(route);
      } else {
        await this.replayFinalization(route);
      }
    } catch (error) {
      await route.abort('failed');
      throw error;
    }
  }

  private async replayRespond(route: Route): Promise<void> {
    const first = await route.fetch();
    expect(first.status()).toBe(200);
    const original = await first.json();
    expect(original.kind).toBe('near_ed25519');
    expect(original.ed25519.status).toBe('admitted');
    const replay = await route.fetch();
    expect(replay.status()).toBe(200);
    const repeated = await replay.json();
    expect(repeated.registrationCeremonyId).toBe(original.registrationCeremonyId);
    expect(repeated.ed25519).toEqual(original.ed25519);
    this.admissionReceiptDigest = createHash('sha256')
      .update(JSON.stringify(original.ed25519.admissionReceipt))
      .digest('hex');
    // Discard the first reply. The SDK receives the exact admitted replay.
    await route.fulfill({ response: replay });
  }

  private async replayFinalization(route: Route): Promise<void> {
    // Recovery obtains a fresh session. The persisted wallet commit stays identical.
    const { sessionSeal: _sessionSeal, ...commit } = route.request().postDataJSON();
    const requestDigest = createHash('sha256').update(JSON.stringify(commit)).digest('hex');
    if (this.finalizationRequestDigest === null) {
      this.finalizationRequestDigest = requestDigest;
      this.finalizationCommit = commit;
    } else {
      expect(isDeepStrictEqual(commit, this.finalizationCommit)).toBe(true);
    }
    const first = await route.fetch();
    expect(first.status()).toBe(200);
    const original = await first.json();
    expect(original.registrationEstablishedSession.kind).toBe(
      this.finalizedWalletId === null ? 'issued' : 'already_committed',
    );
    if (this.finalizedWalletId !== null) {
      expect(original.walletId).toBe(this.finalizedWalletId);
    }
    const replay = await route.fetch();
    expect(replay.status()).toBe(200);
    const repeated = await replay.json();
    expect(repeated.registrationEstablishedSession.kind).toBe('already_committed');
    expect(repeated.registrationEstablishedSession.session).not.toHaveProperty(
      'operationCredential',
    );
    expect(repeated.walletId).toBe(original.walletId);
    expect(repeated.ed25519).toEqual(original.ed25519);
    expect(repeated.registrationEstablishedSession.session.walletSessionId).toBe(
      original.registrationEstablishedSession.session.walletSessionId,
    );
    this.finalizedWalletId = original.walletId;
    this.signerPublicFacts = {
      nearAccountId: original.ed25519.nearAccountId,
      operationalPublicKey: original.ed25519.publicKey,
    };
    this.finalizationReplays += 1;
    await route.fulfill({ response: this.delivery === 'primary' ? first : replay });
  }
}

async function verifyNearRegistrationCommit(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  const probe = new NearRegistrationReplay('primary');
  const handle = probe.handle.bind(probe);
  const observe = probe.observe.bind(probe);
  const respondPath = '**/wallets/register/respond';
  const finalizePath = '**/wallets/register/near-provisioning';
  context.on('request', observe);
  await context.route(respondPath, handle);
  await context.route(finalizePath, handle);
  try {
    await harness.registerPasskeyEd25519YaoWallet();
    const firstSignature = await harness.signNearMessage(
      'First signature after registration replay',
    );
    await harness.lockWallet();
    await harness.unlockPasskeyWallet();
    await harness.refreshPagePreservingWalletStorage();
    const reloadedSignature = await harness.signNearMessage(
      'Verified after reload and a fresh unlock',
    );
    expect(reloadedSignature.publicKey).toBe(firstSignature.publicKey);
    expect(probe.requests).not.toContain('/wallets/register/activate');
    expect(probe.requests).not.toContain('/router-ab/ed25519/yao/registration/admit');
    expect(probe.requests.filter(isNearFinalization)).toHaveLength(1);
    expect(probe.finalizationReplays).toBe(1);
    expect(probe.admissionReceiptDigest).not.toBeNull();
    const artifact = testInfo.outputPath('near-registration-commit.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          kind: 'near_registration_commit_e2e_v1',
          reproduce:
            'pnpm exec playwright test -c playwright.wallet-intended.ci.config.ts passkey.near-registration-commit.contract.test.ts',
          walletId: probe.finalizedWalletId,
          admissionReceiptDigest: probe.admissionReceiptDigest,
          finalizationReplays: probe.finalizationReplays,
          requests: probe.requests,
          firstSignature,
          reloadedSignature,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('near-registration-commit', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    context.off('request', observe);
    await context.unroute(respondPath, handle);
    await context.unroute(finalizePath, handle);
  }
}

function isNearFinalization(path: string): boolean {
  return path === '/wallets/register/near-provisioning';
}

test(
  'NEAR-only registration replays admitted work, commits once and signs across reload',
  verifyNearRegistrationCommit,
);

async function verifyLostNearFinalization(
  {
    harness,
    context,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    context: BrowserContext;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
  const probe = new NearRegistrationReplay('replay');
  const handle = probe.handle.bind(probe);
  const observe = probe.observe.bind(probe);
  const path = '**/wallets/register/near-provisioning';
  context.on('request', observe);
  await context.route(path, handle);
  try {
    await expect(harness.registerPasskeyEd25519YaoWallet()).rejects.toThrow('exact-method unlock');
    if (probe.finalizedWalletId === null) throw new Error('Finalization did not commit');
    expect(probe.finalizationReplays).toBe(1);
    await page.goto(page.url());
    await page.getByLabel('Wallet to unlock', { exact: true }).fill(probe.finalizedWalletId);
    await page.getByLabel('Require NEAR', { exact: true }).check();
    await page.getByRole('button', { name: 'Unlock wallet', exact: true }).click();
    await expect(page.getByTestId('wallet-unlock-result')).toHaveAttribute(
      'data-state',
      'unlocked',
      { timeout: 60_000 },
    );
    if (probe.signerPublicFacts === null) throw new Error('Finalized signer is missing');
    const signature = await signAndVerifyNearMessage(
      page,
      'Verified after a lost finalization reply',
      probe.signerPublicFacts,
    );
    expect(probe.finalizationReplays).toBeGreaterThanOrEqual(2);
    expect(probe.requests).not.toContain('/wallets/register/activate');
    const artifact = testInfo.outputPath('near-registration-lost-finalization.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          kind: 'near_registration_lost_finalization_e2e_v1',
          walletId: probe.finalizedWalletId,
          finalizationRequestDigest: probe.finalizationRequestDigest,
          finalizationReplays: probe.finalizationReplays,
          requests: probe.requests,
          signature,
          reproduce:
            'pnpm exec playwright test -c playwright.wallet-intended.ci.config.ts passkey.near-registration-commit.contract.test.ts',
        },
        null,
        2,
      ),
    );
    await testInfo.attach('near-registration-lost-finalization', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    context.off('request', observe);
    await context.unroute(path, handle);
  }
}

test(
  'NEAR-only registration recovers a lost finalization credential after reload',
  verifyLostNearFinalization,
);
