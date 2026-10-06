import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';
import { intendedTest as test, enableSigningSessionDebugInFrame } from './harness';
import { SigningTimingEvidence } from './signing-timing-evidence';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { walletFrame } from './session-restore-lock';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function serve(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: source });
}

async function readCount(frame: Frame, walletId: string): Promise<number> {
  return frame.evaluate(countInBrowser, walletId);
}

async function countInBrowser(walletId: string): Promise<number> {
  const url = '/__presign-generation-storage.js';
  const probe = await import(url);
  return probe.count(walletId);
}

async function runInBrowser(walletId: string): Promise<unknown> {
  const url = '/__presign-generation-storage.js';
  const probe = await import(url);
  return probe.run(walletId);
}

test('ownership advancement deletes durable presignatures and rejects delayed old admission', async ({
  harness,
  page,
}, info) => {
  info.setTimeout(180_000);
  await installProbe(page);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const frame = await walletFrame(page);
  await expect
    .poll(readCount.bind(null, frame, harness.walletId), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await harness.lockWallet();
  const evidence = await frame.evaluate(runInBrowser, harness.walletId);
  expect(evidence).toEqual({
    afterAdvance: 0,
    delayedOldAdmission: 'persistence_ambiguous',
    oldAvailable: 0,
    rollbackRejected: true,
    currentAdmission: 'stored',
    currentConsumption: 'opened',
  });
  await writeFile(
    info.outputPath('presign-generation-storage.json'),
    JSON.stringify(
      {
        scope:
          'Real registered material with a local storage generation transition; no regional relocation.',
        evidence,
      },
      null,
      2,
    ),
  );
});

async function installProbe(page: Page): Promise<void> {
  const root = path.resolve(import.meta.dirname, '../../..');
  const bundle = await build({
    entryPoints: [path.join(import.meta.dirname, 'presign-generation-storage.probe.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await page.route(
    '**/__presign-generation-storage.js',
    serve.bind(null, bundle.outputFiles[0]!.text),
  );
}

class DelayedPresignatureCompletion {
  private resume: () => void = this.notHeld;
  private readonly released = new Promise<void>(this.captureResume.bind(this));
  held = false;

  private notHeld(): void {}

  private captureResume(resolve: () => void): void {
    this.resume = resolve;
  }

  async intercept(route: Route): Promise<void> {
    const response = await route.fetch();
    const body: unknown = await response.json();
    if (isPlainObject(body) && body.event === 'presign_done' && !this.held) {
      this.held = true;
      await this.released;
    }
    await route.fulfill({ response });
  }

  isHeld(): boolean {
    return this.held;
  }
  release(): void {
    this.resume();
  }
}

async function advanceInBrowser(walletId: string): Promise<void> {
  const url = '/__presign-generation-storage.js';
  const probe = await import(url);
  await probe.advance(walletId);
}

function refillResultCount(timing: SigningTimingEvidence): number {
  return timing.refillResults.length;
}

test('a delayed completed refill cannot publish after ownership advancement', async ({
  harness,
  page,
  context,
}, info) => {
  info.setTimeout(180_000);
  await context.addInitScript(enableSigningSessionDebugInFrame);
  await page.evaluate(enableSigningSessionDebugInFrame);
  await installProbe(page);
  const completion = new DelayedPresignatureCompletion();
  const timing = new SigningTimingEvidence();
  page.on('console', timing.record.bind(timing));
  const intercept = completion.intercept.bind(completion);
  const route = '**/router-ab/ecdsa-derivation/presignature-pool/fill/step';
  await context.route(route, intercept);
  try {
    await harness.registerPasskeyEcdsaOnlyWallet();
    await expect.poll(completion.isHeld.bind(completion), { timeout: 30_000 }).toBe(true);
    const frame = await walletFrame(page);
    await frame.evaluate(advanceInBrowser, harness.walletId);
    completion.release();
    await expect.poll(refillResultCount.bind(null, timing), { timeout: 30_000 }).toBeGreaterThan(0);
    for (const result of timing.refillResults) {
      expect(result.outcome).toBe('failed');
      expect(result.depth).toBe(0);
    }
    expect(await readCount(frame, harness.walletId)).toBe(0);
    await writeFile(
      info.outputPath('delayed-client-refill.json'),
      JSON.stringify(
        {
          completedReplyDelayed: completion.held,
          acceptedGeneration: 2,
          refillResults: timing.refillResults,
          durablePresignatures: 0,
          scope:
            'Real Gateway and browser refill with local generation advancement; full regional relocation remains separate.',
        },
        null,
        2,
      ),
    );
  } finally {
    completion.release();
    await context.unroute(route, intercept);
  }
});

class ProtectedOperationRequests {
  readonly paths: string[] = [];

  record(request: import('@playwright/test').Request): void {
    const path = new URL(request.url()).pathname;
    if (/\/(?:sign|export)\/(?:prepare|start|finalize)$/u.test(path)) this.paths.push(path);
  }
}

test('observed relocation blocks both signing curves and export before remote dispatch', async ({
  harness,
  page,
  context,
}, info) => {
  info.setTimeout(180_000);
  await installProbe(page);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.signNearTransaction('post_registration');
  const frame = await walletFrame(page);
  await frame.evaluate(advanceInBrowser, harness.walletId);
  const requests = new ProtectedOperationRequests();
  const record = requests.record.bind(requests);
  context.on('request', record);
  try {
    const refusal = /ownership generation requires fresh authentication/u;
    await expect(harness.signTempoTransaction('post_registration')).rejects.toThrow(refusal);
    await expect(harness.signNearTransaction('post_registration')).rejects.toThrow(refusal);
    await expect(harness.exportEcdsaKey()).rejects.toThrow(refusal);
    expect(requests.paths).toEqual([]);
    await harness.lockWallet();
    await writeFile(
      info.outputPath('host-relocation-guard.json'),
      JSON.stringify(
        {
          scope:
            'Real registered wallet and public iframe signing/export commands after a parsed simulated relocation observation. The server remains at the source generation.',
          currentGenerationSignsBothCurves: true,
          obsoleteGenerationRejectsBothCurvesAndExport: true,
          remoteProtectedOperationRequests: requests.paths,
          localLockRemainsAvailable: true,
        },
        null,
        2,
      ),
    );
  } finally {
    context.off('request', record);
  }
});

declare global {
  interface Window {
    __seamsIntendedE2EReadWalletMove?: (
      moveId: string,
    ) => Promise<
      import('../../../packages/wallet/src/SeamsWeb/publicApi/placement').WalletMoveStatusResult
    >;
  }
}

class ActivationResponses {
  readonly moveId = `wmove_${'A'.repeat(43)}`;
  phase: 'copying' | 'cleanup' = 'copying';
  calls = 0;

  async respond(route: Route): Promise<void> {
    this.calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        state: 'moving',
        move: {
          moveId: this.moveId,
          sourceRegion: 'US',
          destinationRegion: 'APAC',
          sourceGeneration: 1,
          destinationGeneration: 2,
          admittedAtMs: 1000,
          nextMoveAtMs: 2000,
          progress: {
            state: this.phase,
            availability: this.phase === 'copying' ? 'paused' : 'active',
            execution: { state: 'running' },
          },
        },
      }),
    });
  }
}

async function readMoveFromApplication(moveId: string) {
  const read = window.__seamsIntendedE2EReadWalletMove;
  if (!read) throw new Error('Wallet move helper is unavailable');
  return read(moveId);
}

test('destination activation retires the old local session and reload stays locked', async ({
  harness,
  page,
  context,
}, info) => {
  info.setTimeout(180_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const responses = new ActivationResponses();
  const route = '**/wallet/placement/v1/relocations/*';
  const respond = responses.respond.bind(responses);
  await context.route(route, respond);
  try {
    const copying = await page.evaluate(readMoveFromApplication, responses.moveId);
    expect(copying.ok).toBe(true);
    await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
    );
    responses.phase = 'cleanup';
    expect(await page.evaluate(readMoveFromApplication, responses.moveId)).toEqual({
      ok: false,
      code: 'wallet_unlock_required',
    });
    await harness.assertWalletLocked();
    await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_out',
    );
    const callsAtLock = responses.calls;
    expect(await page.evaluate(readMoveFromApplication, responses.moveId)).toEqual({
      ok: false,
      code: 'wallet_unlock_required',
    });
    expect(responses.calls).toBe(callsAtLock);
    await page.reload();
    await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_out',
    );
    await harness.assertWalletLocked();
    await writeFile(
      info.outputPath('activation-lock.json'),
      JSON.stringify(
        {
          scope:
            'Real registered wallet, stored session, SDK iframe commands and lock flow. Regional copying and activation responses are simulated.',
          copyingPreservesProgressAuthentication: true,
          activatedDestinationRetiresOldLocalSession: true,
          cleanupDoesNotDelayFreshUnlockRequirement: true,
          lockedMoveReadMakesNoRequest: true,
          reloadStaysLocked: true,
          statusRequests: callsAtLock,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.unroute(route, respond);
  }
});
