import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { IntendedBehaviourHarness, autoConfirmWalletIframeUntil } from './harness';
import {
  runMlDsaBrowserLifecycle,
  runMlDsaDeviceOwnerParity,
  prepareMlDsaPool,
  signMlDsaTransaction,
  openSigningKeys,
} from './ml-dsa-lifecycle-scenario';
import { runMlDsaHostedSettingsTimes } from './ml-dsa-registration-reserve-scenario';
import { mlDsaHostedTarget, forwardMlDsaHostedRequest } from '../../helpers/mlDsaHostedFixture';
import { requireCanonicalString } from '@shared/utils/validation';
import { fundImplicitWallet } from './ml-dsa-testnet';
import { assetFixture } from './wallet-asset-fixture';
import type { WalletAssetEvidence } from './wallet-asset-evidence';

const test = base.extend<{ harness: IntendedBehaviourHarness; assets: WalletAssetEvidence }>({
  harness: hostedWallet,
  assets: [assetFixture, { auto: true }],
});

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Hosted ML-DSA completes the normal SDK lifecycle', runMlDsaBrowserLifecycle);
test('Hosted ML-DSA owner export survives onward linking and recovery', runMlDsaDeviceOwnerParity);

test('Hosted Settings times the empty pool, ready job and first signature', async (
  { browser, request },
  testInfo,
) => {
  await runMlDsaHostedSettingsTimes(
    { browser, request, openHarness: initializeHostedHarness },
    testInfo,
  );
});

test('Hosted ECDSA-only lifecycle skips optional ML-DSA cryptography', async ({
  harness,
  assets,
}) => {
  assets.setPhase('ecdsa-only-registration');
  await harness.registerPasskeyEcdsaOnlyWallet();
  assets.setPhase('ecdsa-only-reload');
  await harness.assertLockedPageReloadStaysLocked();
  assets.setPhase('ecdsa-only-unlock');
  await harness.unlockPasskeyWallet();
  assets.setPhase('ecdsa-tempo-sign');
  await harness.signTempoTransaction('post_unlock');
  assets.setPhase('ecdsa-evm-sign');
  await harness.signArcEvmTransaction('post_unlock');
  assets.setPhase('ecdsa-only-export');
  await harness.exportEcdsaKey();
  for (const phase of [
    'hosted-initialization',
    'ecdsa-only-registration',
    'ecdsa-only-reload',
    'ecdsa-only-unlock',
    'ecdsa-tempo-sign',
    'ecdsa-evm-sign',
    'ecdsa-only-export',
  ]) {
    for (const url of assets.getRequestedAssetUrlsForPhase(phase)) {
      expect(new URL(url).pathname).not.toMatch(
        /(?:ml_dsa_signer|pkg-ml-dsa|mlDsa(?:RootInstallation|RootLinking|SeedExport))/u,
      );
    }
  }
  assets.setPhase('completed');
});

async function initializeHostedHarness(
  context: BrowserContext,
  page: Page,
  request: APIRequestContext,
) {
  const target = await mlDsaHostedTarget();
  process.env.SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN = target.accessToken;
  await context.route(
    `${target.gatewayUrl}/**`,
    forwardMlDsaHostedRequest.bind(undefined, target.accessToken),
  );
  const harness = new IntendedBehaviourHarness({
    context,
    page,
    request,
    flow: 'passkey.registration',
    networkMode: 'external_staging',
  });
  await harness.initialize();
  return harness;
}

async function hostedWallet(
  {
    context,
    page,
    request,
    assets,
  }: {
    context: BrowserContext;
    page: Page;
    request: APIRequestContext;
    assets: WalletAssetEvidence;
  },
  use: (harness: IntendedBehaviourHarness) => Promise<void>,
  testInfo: TestInfo,
) {
  assets.setPhase('hosted-initialization');
  const harness = await initializeHostedHarness(context, page, request);
  try {
    await use(harness);
  } finally {
    await harness.attachTrace(testInfo);
    await harness.closeLinkedDevice(testInfo);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
  }
}

type SigningMeasurement =
  | {
      kind: 'signed';
      round: number;
      wallet: number;
      sdkElapsedMs: number;
      harnessElapsedMs: number;
      signatureVerified: true;
    }
  | { kind: 'failed'; round: number; wallet: number; error: string };

test('Hosted ML-DSA measures simultaneous wallets at unchanged capacity', async ({
  harness,
  browser,
  request,
}, testInfo) => {
  testInfo.setTimeout(900_000);
  const context = await browser.newContext();
  const second = await initializeHostedHarness(context, await context.newPage(), request);
  const samples: SigningMeasurement[] = [];
  const wallets: Awaited<ReturnType<typeof prepareSigningWallet>>[] = [];
  let failure: string | null = null;
  try {
    wallets.push(await prepareSigningWallet(harness));
    wallets.push(await prepareSigningWallet(second));
    for (let round = 0; round < 4; round += 1) {
      if (round > 0) await delay(61_000);
      const policy = round === 0 ? { maxOperations: 4, durationMs: 900_000 } : null;
      const pair = await Promise.allSettled([
        signMlDsaTransaction(harness, wallets[0].signer, policy),
        signMlDsaTransaction(second, wallets[1].signer, policy),
      ]);
      for (const [wallet, result] of pair.entries()) {
        samples.push(
          result.status === 'fulfilled'
            ? {
                round,
                wallet,
                kind: 'signed',
                sdkElapsedMs: result.value.sdkElapsedMs,
                harnessElapsedMs: result.value.harnessElapsedMs,
                signatureVerified: true,
              }
            : { round, wallet, kind: 'failed', error: String(result.reason) },
        );
      }
      expect(samples.every(signedSample)).toBe(true);
    }
  } catch (error: unknown) {
    failure = String(error);
    throw error;
  } finally {
    const functionalPassed =
      failure === null &&
      wallets.length === 2 &&
      samples.length === 8 &&
      samples.every(signedSample);
    const evidence = {
      observedAt: new Date().toISOString(),
      scope:
        'Normal browser SDK against Cloudflare Workers. Two simultaneous wallets. Up to eight requests across four rounds, stopping after a failed pair. Includes automatic UI approval and excludes stock preparation and NEAR enrollment. This sample establishes no percentile or long-term capacity claim.',
      wallets,
      samples,
      failure,
      policy: {
        preparationGroupSize: 4,
        candidateGroupSize: 2,
        poolCapacityCandidates: 32,
        minimumReadyCandidates: 16,
        walletCooldownMs: 60_000,
        serviceActiveOperations: 1,
      },
      functionalPassed,
      fiveSecondTargetMet:
        functionalPassed &&
        wallets.every(registrationUnderTarget) &&
        samples.every(signingUnderTarget),
    };
    const text = JSON.stringify(evidence, null, 2) + '\n';
    await testInfo.attach('ml-dsa-hosted-capacity', {
      body: text,
      contentType: 'application/json',
    });
    const directory = requireCanonicalString(
      process.env.SEAMS_INTENDED_TRACE_DIR,
      'evidence directory',
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'ml-dsa-hosted-capacity.json'), text);
    await second.attachTrace(testInfo);
    await context.close();
  }
});

async function prepareSigningWallet(harness: IntendedBehaviourHarness) {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const actor = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('walletId' in actor) || !('nearAccountId' in actor))
    throw new Error('Wallet identity is absent');
  const walletId = requireCanonicalString(actor.walletId, 'walletId');
  const accountId = requireCanonicalString(actor.nearAccountId, 'nearAccountId');
  await fundImplicitWallet(accountId);
  const preparingAt = performance.now();
  await prepareMlDsaPool(walletId);
  const preparationMs = performance.now() - preparingAt;
  const result = await harness.runMlDsaCommand({ kind: 'publish' });
  if (!('kind' in result) || result.kind !== 'sdk_published')
    throw new Error('ML-DSA publication failed');
  await harness.useLiveNearTestnetRpc();
  expect(await harness.runMlDsaCommand({ kind: 'enroll', signer: result.signer })).toMatchObject({
    kind: 'enrolled',
  });
  return {
    walletId,
    accountId,
    preparationMs,
    registrationMs: result.sdkElapsedMs,
    signer: result.signer,
  };
}

function signedSample(sample: SigningMeasurement): boolean {
  return sample.kind === 'signed';
}
function registrationUnderTarget(wallet: { registrationMs: number }): boolean {
  return wallet.registrationMs < 5000;
}
function signingUnderTarget(sample: SigningMeasurement): boolean {
  return sample.kind === 'signed' && sample.sdkElapsedMs < 5000;
}


test('Hosted Signing keys creates ML-DSA without fixture preparation', runColdSigningKeyCreation);

async function runColdSigningKeyCreation(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(600_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const actor = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('nearAccountId' in actor)) throw new Error('The cold setup wallet has no NEAR identity');
  await fundImplicitWallet(requireCanonicalString(actor.nearAccountId, 'NEAR account'));
  await harness.useLiveNearTestnetRpc();
  const before = await harness.runMlDsaCommand({ kind: 'default_signer' });
  await openSigningKeys(page);
  await page.getByRole('button', { name: 'Add signer', exact: true }).click();
  const startedAtMs = Date.now();
  const publishedResponse = page.waitForResponse(isMlDsaPublication, { timeout: 300_000 });
  const confirming = autoConfirmWalletIframeUntil(page, publishedResponse, { timeoutMs: 300_000 });
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  const response = await confirming;
  expect(response.status()).toBe(200);
  const creationElapsedMs = Date.now() - startedAtMs;
  const key = await readColdPublishedKey(harness);
  expect(await harness.runMlDsaCommand({ kind: 'default_signer' })).toEqual(before);
  await harness.refreshPagePreservingWalletStorage();
  await harness.unlockPasskeyWallet();
  expect(await readColdPublishedKey(harness)).toEqual(key);
  expect(await harness.runMlDsaCommand({ kind: 'default_signer' })).toEqual(before);
  const evidence = {
    observedAt: new Date().toISOString(),
    scope: 'Normal Signing keys settings against Cloudflare. This case never calls the private preparation fixture. Backend stock may already exist; Worker traces determine whether preparation was cold.',
    walletId: harness.walletId,
    createClickedAtMs: startedAtMs,
    publishedAtMs: startedAtMs + creationElapsedMs,
    creationElapsedMs,
    signer: key,
    fixturePreparationCalled: false,
    signerPersistsAfterReload: true,
    defaultSignerUnchanged: true,
  };
  const text = JSON.stringify(evidence, null, 2) + '\n';
  await writeFile(testInfo.outputPath('ml-dsa-cold-ui-creation.json'), text);
  const directory = requireCanonicalString(process.env.SEAMS_INTENDED_TRACE_DIR, 'evidence directory');
  await writeFile(path.join(directory, 'ml-dsa-cold-ui-creation.json'), text);
  await testInfo.attach('ml-dsa-cold-ui-creation', { body: text, contentType: 'application/json' });
}

function isMlDsaPublication(response: import('@playwright/test').Response): boolean {
  return response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/signers/ml-dsa/publish');
}

async function readColdPublishedKey(harness: IntendedBehaviourHarness) {
  const metadata = await harness.runMlDsaCommand({ kind: 'metadata' });
  if (!('kind' in metadata) || metadata.kind !== 'inventory' || metadata.entries.length !== 1)
    throw new Error('Cold UI creation did not publish exactly one signer');
  const entry = metadata.entries[0];
  if (entry.kind !== 'published') throw new Error('Cold UI creation remains unpublished');
  return entry.key;
}
