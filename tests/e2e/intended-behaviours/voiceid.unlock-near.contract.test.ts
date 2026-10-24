import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import {
  readNearIdentity,
  startReviewedTransfer,
  VoiceIdNearSigningEvidence,
} from './voiceid-near-signing';
import type {} from '../../intended-app/src/voiceIdHelpers';
import type {} from '../../fixtures/ui/VoiceIdDeviceCaptureProbe';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import type { Route } from '@playwright/test';

test('VoiceID issues a fresh Wallet Session and signs a reviewed NEAR transfer', verifyUnlock);
test.use({ video: 'off', trace: 'off' });
test.setTimeout(180_000);

async function verifyUnlock(
  {
    harness,
    page,
    context,
  }: {
    harness: IntendedBehaviourHarness;
    page: Page;
    context: BrowserContext;
  },
  testInfo: TestInfo,
): Promise<void> {
  const chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdDeviceCaptureProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: chunks[0].code });
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  const identity = await readNearIdentity(page);
  const ownerSession = await page.evaluate(readSession);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const activation = page.evaluate(activate);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  const method = await activation;
  expect(method.walletId).toBe(identity.walletId);

  await page.evaluate(lock);
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
  await verifyLockDuringUnlock(context, page, method.walletAuthMethodId);
  const verifiedResponse = page.waitForResponse(isVerifyResponse);
  const unlocked = page.evaluate(unlock, method.walletAuthMethodId);
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  expect(await unlocked).toMatchObject({
    success: true,
    kind: 'near_wallet_unlocked',
    walletId: identity.walletId,
    operationalPublicKey: identity.publicKey,
  });
  const verified = requireRecord(await (await verifiedResponse).json(), 'VoiceID response');
  const freshSession = requireRecord(verified.walletSession, 'fresh Wallet Session');
  expect(freshSession.authMethodId).toBe(method.walletAuthMethodId);
  const credential = requireRecord(verified.operationCredential, 'operation credential');
  const freshSessionId = requireCanonicalString(credential.walletSessionId, 'fresh session ID');
  const session = await page.evaluate(readSession);
  expect(session.authentication).toMatchObject({
    kind: 'authenticated',
    walletId: identity.walletId,
    authMethod: 'voiceid',
  });
  expect(session.appIdentity.kind).toBe('resolved');
  if (session.appIdentity.kind !== 'resolved') throw new Error('Wallet identity is unavailable');
  expect(session.appIdentity.authMethods).toContainEqual(
    expect.objectContaining({
      kind: 'voiceid',
      walletAuthMethodId: method.walletAuthMethodId,
    }),
  );

  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  await startReviewedTransfer(page);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    {
      timeout: 60_000,
    },
  );
  expect(evidence.transfers).toHaveLength(1);
  expect(evidence.snapshot().finalizations).toBeGreaterThan(0);
  const budget = await harness.readCurrentWalletSessionStatus();
  expect(budget.status).toBe('active');
  const report = testInfo.outputPath('voiceid-unlock-near.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        nativeHost: 'fake_device_key_and_factor',
        microphoneAndKeychainUsed: false,
        priorAuthentication: ownerSession.authentication,
        voiceIdMethodId: method.walletAuthMethodId,
        freshSessionId,
        concurrentLockRejectedStaleUnlock: true,
        authentication: session.authentication,
        signing: 'real_ed25519_yao_mpc',
        signatureVerification: 'registered_wallet_public_key',
        identity,
        chain: 'deterministic_near_rpc',
        onChainConfirmed: false,
        remainingUses: budget.remainingUses,
        transfers: evidence.transfers,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-unlock-near.json', {
    path: report,
    contentType: 'application/json',
  });
}

class HeldVerification {
  readonly captured = new WorkerDeferred<void>();
  readonly release = new WorkerDeferred<void>();

  async serve(route: Route): Promise<void> {
    const response = await route.fetch();
    this.captured.resolve();
    await this.release.promise;
    await route.fulfill({ response });
  }
}

async function verifyLockDuringUnlock(
  context: BrowserContext,
  page: Page,
  walletAuthMethodId: string,
): Promise<void> {
  const held = new HeldVerification();
  const handler = held.serve.bind(held);
  await context.route('**/wallet/voiceid/verify', handler);
  const result = page.evaluate(unlock, walletAuthMethodId).then(unexpectedUnlock, rejectedUnlock);
  await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .getByRole('button', { name: 'Unlock with VoiceID', exact: true })
    .click();
  await held.captured.promise;
  await page.evaluate(lock);
  held.release.resolve();
  const rejected = await result;
  expect(rejected.kind).toBe('rejected');
  if (rejected.kind !== 'rejected') throw new Error('A stale unlock overrode the wallet lock');
  expect(rejected.message).toContain('Wallet lock state changed during unlock');
  await context.unroute('**/wallet/voiceid/verify', handler);
  expect((await page.evaluate(readSession)).authentication.kind).toBe('signed_out');
}

function unexpectedUnlock(): { kind: 'succeeded' } {
  return { kind: 'succeeded' };
}
function rejectedUnlock(error: unknown): { kind: 'rejected'; message: string } {
  return { kind: 'rejected', message: error instanceof Error ? error.message : String(error) };
}

function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}
function unlock(walletAuthMethodId: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.unlock(walletAuthMethodId);
}
function readSession() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.session();
}
async function lock(): Promise<void> {
  if (!window.__seamsIntendedE2ELockWallet) throw new Error('Wallet lock helper is unavailable');
  await window.__seamsIntendedE2ELockWallet();
}
function isVerifyResponse(response: import('@playwright/test').Response): boolean {
  return new URL(response.url()).pathname === '/wallet/voiceid/verify';
}
