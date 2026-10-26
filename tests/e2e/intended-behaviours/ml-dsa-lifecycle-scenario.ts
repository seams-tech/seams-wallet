import type { WalletAssetEvidence } from './wallet-asset-evidence';
import { MlDsaEmailProofProbe } from './ml-dsa-email-proof-probe';
import { test, expect, type TestInfo, type Page, type Route, type Browser } from '@playwright/test';
import {
  createHash,
  createPublicKey,
  createPrivateKey,
  sign as ordinarySign,
  verify,
} from 'node:crypto';
import { base58Encode } from '@shared/utils/base58';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openReadOnlyGatewayD1 } from './local-gateway-database';
import {
  autoConfirmWalletIframeUntil,
  waitForWalletIframeConfirmationSettlement,
  type IntendedBehaviourHarness,
} from './harness';
import type { MlDsaBrowserCommand } from '../../intended-app/src/mlDsaLifecycle';
import { mlDsaHostedFixture } from '../../helpers/mlDsaHostedFixture';
import type { AddedMlDsaSignerCapability } from '../../../packages/wallet/src/core/types/seams';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import { fundImplicitWallet, testnetRpc } from './ml-dsa-testnet';

export async function runMlDsaBrowserLifecycle(
  {
    harness,
    browser,
    page,
    assets,
  }: {
    harness: IntendedBehaviourHarness;
    browser: Browser;
    page: Page;
    assets: WalletAssetEvidence;
  },
  testInfo: TestInfo,
) {
  testInfo.setTimeout(900_000);
  const discoveryTrace = new SignerDiscoveryTrace();
  page.on('request', discoveryTrace.request.bind(discoveryTrace));
  page.on('response', discoveryTrace.response.bind(discoveryTrace));
  page.on('requestfinished', discoveryTrace.finished.bind(discoveryTrace));
  page.on('requestfailed', discoveryTrace.failed.bind(discoveryTrace));
  const optionalAssets: string[] = [];
  page.on('request', recordOptionalAsset.bind(null, optionalAssets));
  assets.setPhase('ordinary-registration');
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const context = await harness.runMlDsaCommand({ kind: 'context' });
  if (
    !('walletId' in context) ||
    typeof context.walletId !== 'string' ||
    !('nearAccountId' in context) ||
    typeof context.nearAccountId !== 'string' ||
    !('credentialIdB64u' in context) ||
    typeof context.credentialIdB64u !== 'string'
  )
    throw new Error('Missing browser wallet identity');
  const funding = await fundImplicitWallet(context.nearAccountId);
  await harness.useLiveNearTestnetRpc();
  const initialWalletFrame = page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .contentFrame();
  await initialWalletFrame.locator('body').evaluate(blockPasskeyPrompts);
  try {
    await openSigningKeys(page);
    await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add signer', exact: true })).toBeVisible();
  } finally {
    await initialWalletFrame.locator('body').evaluate(restorePasskeyPrompts);
  }
  await page.keyboard.press('Escape');
  assets.setPhase('ordinary-signing');
  const ordinarySigning = await harness.runMlDsaCommand({
    kind: 'normal_sign_default',
    sessionPolicy: null,
  });
  verifyOrdinarySignature(ordinarySigning);
  const ordinaryOptionalAssets = optionalAssets.slice();
  expect(ordinaryOptionalAssets).toEqual([]);
  for (const phase of ['hosted-initialization', 'ordinary-registration', 'ordinary-signing']) {
    expect(assets.getRequestedAssetUrlsForPhase(phase).filter(isOptionalMlDsaCryptoAsset)).toEqual(
      [],
    );
  }
  assets.setPhase('ml-dsa-registration');
  await page.keyboard.press('Escape');
  await prepareMlDsaPool(context.walletId);
  const signer = await publishAcrossReload(page, harness);
  await harness.useLiveNearTestnetRpc();
  await openSigningKeys(page);
  try {
    await page.getByRole('button', { name: 'Review NEAR key addition', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Approve NEAR key addition', exact: true }),
    ).toBeVisible();
  } finally {
    await discoveryTrace.save(testInfo);
  }
  const activated = expect(
    page
      .getByRole('group', { name: 'ML-DSA-65 signing key', exact: true })
      .getByText('Active on NEAR', { exact: true }),
  ).toBeVisible({
    timeout: 120_000,
  });
  const activating = autoConfirmWalletIframeUntil(page, activated, { timeoutMs: 120_000 });
  await page.getByRole('button', { name: 'Approve NEAR key addition', exact: true }).click();
  await activating;
  await waitForWalletIframeConfirmationSettlement(page);
  await page
    .getByRole('group', { name: 'ML-DSA-65 signing key', exact: true })
    .getByRole('button', { name: 'Make default', exact: true })
    .click({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: 'Default signing key', exact: true }),
  ).toBeDisabled();
  await expect
    .poll(readDefaultSigner.bind(null, harness))
    .toEqual({ kind: 'near_ml_dsa_65', signingKeyId: signer.signingKeyId });
  await expect(page.getByRole('heading', { name: 'Signing key added', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('ml-dsa-signing-keys.png') });
  await page.keyboard.press('Escape');
  await harness.refreshPagePreservingWalletStorage();
  await harness.unlockPasskeyWallet();
  await harness.useLiveNearTestnetRpc();
  expect(await readDefaultSigner(harness)).toEqual({
    kind: 'near_ml_dsa_65',
    signingKeyId: signer.signingKeyId,
  });
  await page.route('**/ml-dsa/metadata', hidePublishedSigner);
  try {
    await expect(
      harness.runMlDsaCommand({ kind: 'normal_sign_default', sessionPolicy: null }),
    ).rejects.toThrow('default ML-DSA signer is unavailable');
  } finally {
    await page.unroute('**/ml-dsa/metadata', hidePublishedSigner);
  }
  assets.setPhase('ml-dsa-signing');
  const original = await signFromDefaultPicker(page, harness, signer, testInfo);
  expect(optionalAssets.some(isOptionalWasm)).toBe(true);
  expect(
    ['ml-dsa-registration', 'ml-dsa-signing']
      .flatMap(assets.getRequestedAssetUrlsForPhase.bind(assets))
      .some(isOptionalWasm),
  ).toBe(true);
  assets.setPhase('ml-dsa-owner-lifecycle');
  await pause(60_000);
  const walletFrame = page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .contentFrame();
  await walletFrame.locator('body').evaluate(blockPasskeyPrompts);
  let warm;
  try {
    warm = await signMlDsaTransaction(harness, signer);
    await expect(signMlDsaTransaction(harness, signer)).rejects.toThrow();
  } finally {
    await walletFrame.locator('body').evaluate(restorePasskeyPrompts);
  }

  await harness.addEmailOtpAuthMethod();
  await harness.unlockWithAddedEmailOtp();
  await harness.useLiveNearTestnetRpc();
  const emailMetadata = await harness.runMlDsaCommand({ kind: 'metadata' });
  expect('kind' in emailMetadata && emailMetadata.kind).toBe('inventory');
  expect(await readDefaultSigner(harness)).toEqual({
    kind: 'near_ml_dsa_65',
    signingKeyId: signer.signingKeyId,
  });
  await pause(60_000);
  const emailFrame = page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .contentFrame();
  await emailFrame.locator('body').evaluate(blockPasskeyPrompts);
  const emailProofProbe = new MlDsaEmailProofProbe();
  await emailProofProbe.install(page);
  let emailFresh;
  let emailGrant;
  let emailWarm;
  try {
    emailFresh = await signMlDsaTransaction(harness, signer);
    await pause(60_000);
    emailGrant = await signMlDsaTransaction(harness, signer, {
      maxOperations: 2,
      durationMs: 600_000,
    });
    await pause(60_000);
    emailWarm = await signMlDsaTransaction(harness, signer);
  } finally {
    await emailFrame.locator('body').evaluate(restorePasskeyPrompts);
    await emailProofProbe.remove(page);
  }
  await harness.unlockPasskeyWallet();
  await harness.useLiveNearTestnetRpc();

  const linked = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(linked);
  await linked.useLiveNearTestnetRpc();
  const linkedActor = await readActor(linked);
  expect(linkedActor.credentialIdB64u).not.toBe(context.credentialIdB64u);
  await discover(linked, signer, linkedActor.credentialIdB64u);
  await assertCanonicalExport(linked.page, linked, signer);
  await pause(60_000);
  const device = await signMlDsaTransaction(linked, signer);

  await harness.discardPasskeyCredentials();
  await harness.recoverPasskeyWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await harness.assertSourceWalletSessionRemainsActive();
  await harness.refreshPagePreservingWalletStorage();
  await harness.unlockPasskeyWallet();
  const recoveredActor = await readActor(harness);
  expect(recoveredActor.credentialIdB64u).not.toBe(context.credentialIdB64u);
  expect(recoveredActor.credentialIdB64u).not.toBe(linkedActor.credentialIdB64u);
  await discover(harness, signer, recoveredActor.credentialIdB64u);
  await assertCanonicalExport(page, harness, signer);
  await pause(60_000);
  const recovered = await signMlDsaTransaction(harness, signer);
  await test.step(
    'Revoke the linked owner after recovered signing',
    harness.revokeLinkedDeviceWithOwnerPasskey.bind(harness),
    { timeout: 90_000 },
  );
  const revoked = await linked.runMlDsaCommand({
    kind: 'inventory',
    credentialIdB64u: linkedActor.credentialIdB64u,
  });
  expect('kind' in revoked && revoked.kind).toBe('refused');
  const revokedMetadata = await linked.runMlDsaCommand({ kind: 'metadata' });
  expect('kind' in revokedMetadata && revokedMetadata.kind).toBe('refused');
  await discover(harness, signer, recoveredActor.credentialIdB64u);
  await prepareMlDsaPool(context.walletId);
  const restoration = await harness.runMlDsaCommand({ kind: 'restore', recordedSigner: signer });
  if (!('kind' in restoration) || restoration.kind !== 'restored')
    throw new Error(`Browser restoration failed: ${JSON.stringify(restoration)}`);
  expect(restoration.signer.publicKeyB64u).toBe(signer.publicKeyB64u);
  expect(restoration.signer.keyManifestDigestB64u).toBe(signer.keyManifestDigestB64u);
  expect(restoration.signer.materialEpoch).toBeGreaterThan(signer.materialEpoch);
  await discover(harness, restoration.signer, recoveredActor.credentialIdB64u);
  await verifyRestorationOwner(context.walletId, recoveredActor.walletAuthMethodId);
  await pause(60_000);
  const restored = await signMlDsaTransaction(harness, restoration.signer);
  const broadcast = await harness.runMlDsaCommand({ kind: 'broadcast_last' });
  expect('success' in broadcast && broadcast.success).toBe(true);
  const final = await testnetRpc('tx', {
    tx_hash: restored.transactionHash,
    sender_account_id: context.nearAccountId,
    wait_until: 'FINAL',
  });
  expect(final.final_execution_status).toBe('FINAL');
  expect(requireRecord(final.status, 'threshold transaction status')).toHaveProperty(
    'SuccessValue',
  );
  const onChainTransaction = requireRecord(final.transaction, 'final threshold transaction');
  expect(onChainTransaction.signer_id).toBe(context.nearAccountId);
  expect(onChainTransaction.public_key).toBe(
    'ml-dsa-65:' + base58Encode(Buffer.from(signer.publicKeyB64u, 'base64url')),
  );
  expect(onChainTransaction.hash).toBe(restored.transactionHash);
  expect(onChainTransaction.actions).toEqual([{ Transfer: { deposit: '0' } }]);
  await harness.assertConsumedRecoveryCodeReportedAsUsed();
  await saveEvidence(testInfo, {
    observedAt: new Date().toISOString(),
    scope: process.env.ML_DSA_HOSTED_DEPLOYMENT
      ? 'Chromium, real recovery-code ceremony, separate QR target browser and authenticators, normal SDK, real Cloudflare Gateway/D1/Router/A/B Workers. Console admission uses a disposable static authority. Browser assets use local test origins. Live testnet RPC qualifies Wallet-approved key enrollment and a finalized ML-DSA threshold transaction.'
      : 'Chromium, real recovery-code ceremony, separate QR target browser and authenticators, public SDK and Gateway, local Cloudflare workerd with separate ML-DSA Router, participants, and preparers. Live testnet RPC qualifies Wallet-approved key enrollment and a finalized ML-DSA threshold transaction.',
    walletId: context.walletId,
    signer,
    testnet: {
      accountId: context.nearAccountId,
      funding,
      transaction: onChainTransaction,
      finalStatus: final.status,
    },
    signatures: {
      original,
      warm,
      emailFresh,
      emailGrant,
      emailWarm,
      recovered,
      linked: device,
      restored,
    },
    restoredSigner: restoration.signer,
    actors: {
      original: context.credentialIdB64u,
      linked: linkedActor.credentialIdB64u,
      recovered: recoveredActor.credentialIdB64u,
    },
    checks: {
      emailProof: emailProofProbe.evidence(),
      emailOtpSigningAndWarmGrant: true,
      emailOtpMetadataAndDefaultSigner: true,
      samePublicKeyAfterRecovery: true,
      samePublicKeyAfterQrLink: true,
      sourceAuthorityRetained: true,
      recoveryCodeReuseRefused: true,
      linkedAuthorityRevoked: true,
      recoveredAuthorityRetained: true,
      independentSignaturesVerified: true,
      normalWalletTransactionApi: true,
      verifiedPublicationResumesAfterBrowserReload: true,
      reusableSessionRequiresNoPasskeyPrompt: true,
      exhaustedSessionRequiresFreshApproval: true,
      thresholdTransactionBroadcast: true,
      independentCanonicalSeedImport: true,
      publicRestorationFromRecoveredFactor: true,
      distinctOwnerCredentials: true,
      signingKeysSettingsCreationAndActivation: true,
      defaultSignerSelection: true,
      defaultSignerPersistsAfterReload: true,
      unavailableDefaultRefusedWithoutFallback: true,
      ordinaryEd25519SignatureVerified: true,
      ordinaryFlowsSkipOptionalMlDsaCryptography: true,
      mlDsaFlowLoadsOptionalWasm: true,
      revokedOwnerMetadataRefused: true,
      metadataUsesExistingSession: true,
      noOptionalAssetsBeforeEnrollment: true,
      restorationOwnerMatchesRecoveredMethod: true,
    },
    optionalAssetRequests: optionalAssets,
    ordinaryOptionalAssets,
    policy: {
      candidateGroupSize: 2,
      preparationGroupSize: 4,
      minimumReadyCandidates: 16,
      poolCapacityCandidates: 32,
      walletCooldownMs: 60_000,
    },
  });
}

async function publishAcrossReload(
  page: Page,
  harness: IntendedBehaviourHarness,
): Promise<AddedMlDsaSignerCapability> {
  const pattern = '**/wallets/*/signers/ml-dsa/publish';
  await page.route(pattern, abortPublication);
  const pendingRequest = page.waitForRequest(pattern, { timeout: 120_000 });
  await openSigningKeys(page);
  const publishing = autoConfirmWalletIframeUntil(page, pendingRequest, { timeoutMs: 120_000 });
  await page.getByRole('button', { name: 'Add signer', exact: true }).click();
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  await publishing;
  await harness.refreshPagePreservingWalletStorage();
  await page.unroute(pattern, abortPublication);
  await harness.unlockPasskeyWallet();
  const inventory = await harness.runMlDsaCommand({ kind: 'metadata' });
  if (
    !('kind' in inventory) ||
    inventory.kind !== 'inventory' ||
    inventory.entries.length !== 1 ||
    inventory.entries[0].kind !== 'published'
  )
    throw new Error('The retained ML-DSA completion did not publish after browser reload');
  const key = inventory.entries[0].key;
  return {
    kind: 'near_ml_dsa_65',
    signingKeyId: key.signingKeyId,
    publicKeyB64u: key.publicKeyB64u,
    keyManifestDigestB64u: key.keyManifestDigestB64u,
    materialEpoch: key.materialEpoch,
  };
}
async function abortPublication(route: Route): Promise<void> {
  await route.abort('failed');
}

async function discover(
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
  credentialIdB64u: string,
): Promise<void> {
  const result = await harness.runMlDsaCommand({ kind: 'inventory', credentialIdB64u });
  if (!('kind' in result) || result.kind !== 'inventory')
    throw new Error(`Inventory failed: ${JSON.stringify(result)}`);
  expect(result.entries).toHaveLength(1);
  const metadata = await harness.runMlDsaCommand({ kind: 'metadata' });
  expect(metadata).toEqual(result);
  const entry = result.entries[0];
  if (entry.kind !== 'published') throw new Error('Recovered signer is unpublished');
  expect(entry.key.publicKeyB64u).toBe(signer.publicKeyB64u);
  expect(entry.key.keyManifestDigestB64u).toBe(signer.keyManifestDigestB64u);
  expect(entry.key.materialEpoch).toBe(signer.materialEpoch);
}

export async function signMlDsaTransaction(
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
  sessionPolicy: import('@shared/near/mlDsaSigningSession').MlDsaSigningSessionPolicy | null = null,
) {
  const startedAt = performance.now();
  const result = await harness.runMlDsaCommand({
    kind: 'normal_sign',
    signer,
    sessionPolicy,
  });
  const harnessElapsedMs = performance.now() - startedAt;
  return verifyBrowserSignature(result, signer, harnessElapsedMs);
}
function verifyBrowserSignature(
  result: Awaited<ReturnType<IntendedBehaviourHarness['runMlDsaCommand']>>,
  signer: AddedMlDsaSignerCapability,
  harnessElapsedMs: number,
) {
  if (!('kind' in result) || result.kind !== 'sdk_signed')
    throw new Error(`Browser signature failed: ${JSON.stringify(result)}`);
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(signer.publicKeyB64u, 'base64url'),
    ]),
    format: 'der',
    type: 'spki',
  });
  const signed = Buffer.from(result.signedTransactionBorshB64u, 'base64url');
  expect(signed[signed.length - 3310]).toBe(2);
  expect(signed.subarray(-3309).equals(Buffer.from(result.signatureB64u, 'base64url'))).toBe(true);
  const hash = createHash('sha256').update(signed.subarray(0, -3310)).digest();
  expect(verify(null, hash, key, Buffer.from(result.signatureB64u, 'base64url'))).toBe(true);
  return {
    sdkElapsedMs: result.sdkElapsedMs,
    harnessElapsedMs,
    signatureVerified: true,
    signedTransactionBorshB64u: result.signedTransactionBorshB64u,
    signatureB64u: result.signatureB64u,
    transactionHash: base58Encode(hash),
  };
}

function blockPasskeyPrompts(): void {
  Reflect.set(navigator.credentials, '__mlDsaSavedGet', navigator.credentials.get);
  Reflect.set(
    navigator.credentials,
    'get',
    Promise.reject.bind(Promise, new Error('ML-DSA warm signing requested a passkey')),
  );
}
function restorePasskeyPrompts(): void {
  const saved = Reflect.get(navigator.credentials, '__mlDsaSavedGet');
  if (typeof saved !== 'function')
    throw new Error('The passkey prompt override lost its saved method');
  Reflect.set(navigator.credentials, 'get', saved);
  Reflect.deleteProperty(navigator.credentials, '__mlDsaSavedGet');
}

export async function prepareMlDsaPool(walletId: string): Promise<void> {
  if (process.env.ML_DSA_HOSTED_DEPLOYMENT) {
    const body = await mlDsaHostedFixture('/fixture/prepare', { walletId });
    expect(body.ready).toBe(true);
    return;
  }
  const root = process.env.SEAMS_INTENDED_ROUTER_AB_ROOT;
  if (!root) throw new Error('ML-DSA requires an isolated local runtime');
  const vars = await readFile(
    path.join(root, '.runtime', 'router-ab-strict', '.dev.vars.router'),
    'utf8',
  );
  const line = vars.split('\n').find(gatewayCredentialLine);
  if (!line) throw new Error('Missing private fixture admission credential');
  const token = line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '');
  const offset = Number(process.env.SEAMS_LOCAL_PORT_OFFSET ?? 0);
  const response = await fetch(
    `http://127.0.0.1:${4102 + offset}/router-ab/ml-dsa/registration/prepare`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': token },
      body: JSON.stringify({
        wallet: {
          org: 'org_local_wallet',
          project: 'local-smoke-project',
          environment: 'local-smoke-project:dev',
          wallet: walletId,
        },
      }),
    },
  );
  const body = requireRecord(await response.json(), 'private preparation');
  expect(response.ok).toBe(true);
  expect(body.ready).toBe(true);
}

function gatewayCredentialLine(line: string): boolean {
  return line.startsWith('ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET=');
}
function schedulePause(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}
function pause(milliseconds: number): Promise<void> {
  return new Promise(schedulePause.bind(undefined, milliseconds));
}
async function saveEvidence(testInfo: TestInfo, evidence: Record<string, unknown>): Promise<void> {
  const sources: Record<string, string> = {};
  for (const file of [
    'tests/e2e/intended-behaviours/ml-dsa.lifecycle.contract.test.ts',
    'tests/e2e/intended-behaviours/ml-dsa-lifecycle-scenario.ts',
    'tests/intended-app/src/mlDsaLifecycle.ts',
    'tests/helpers/mlDsaHostedLifecycleWorker.ts',
    'tests/e2e/intended-behaviours/harness.ts',
    'tests/e2e/intended-behaviours/ml-dsa-testnet.ts',
    'packages/wallet/src/core/signingEngine/flows/signNear/mlDsaTransaction.ts',
    'packages/wallet/src/core/signingEngine/workerManager/workers/mlDsaSeedExport.ts',
    'packages/wallet-server/src/router/cloudflare/d1/wallet/d1MlDsaSigningSessions.ts',
    'crates/router-ab-core/src/protocol/normal_signing.rs',
    'crates/router-ab-cloudflare/src/ml_dsa/workers/executor.rs',
    'wasm/near_signer/src/passkey_custody_wasm.rs',
    'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm',
    'crates/router-ab-cloudflare/build/router/index_bg.wasm',
    'crates/router-ab-cloudflare/build/deriver-a/index_bg.wasm',
    'crates/router-ab-cloudflare/build/deriver-b/index_bg.wasm',
    'crates/router-ab-cloudflare/build/ml-dsa/router/index_bg.wasm',
    'crates/router-ab-cloudflare/build/ml-dsa/deriver-a/index_bg.wasm',
    'crates/router-ab-cloudflare/build/ml-dsa/deriver-b/index_bg.wasm',
    'wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm',
    'crates/router-ab-cloudflare/scripts/prepare-local-runtime-config.mjs',
    'crates/router-ab-cloudflare/scripts/start-local-role-workers.mjs',
    'crates/router-ab-cloudflare/scripts/start-local-wallet-system.mjs',
    'tests/scripts/start-wallet-intended-services.mjs',
  ]) {
    sources[file] = createHash('sha256')
      .update(await readFile(new URL('../../../' + file, import.meta.url)))
      .digest('hex');
  }
  const text = JSON.stringify({ ...evidence, sources }, null, 2) + '\n';
  const artifact = testInfo.outputPath('ml-dsa-browser-lifecycle.json');
  await writeFile(artifact, text);
  await testInfo.attach('ml-dsa-browser-lifecycle', {
    path: artifact,
    contentType: 'application/json',
  });
  const directory = process.env.SEAMS_INTENDED_TRACE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'ml-dsa-browser-lifecycle.json'), text);
  }
}

async function readActor(harness: IntendedBehaviourHarness) {
  const result = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('credentialIdB64u' in result) || !('walletAuthMethodId' in result))
    throw new Error('Browser did not resolve an exact owner credential');
  return {
    credentialIdB64u: requireCanonicalString(result.credentialIdB64u, 'credentialIdB64u'),
    walletAuthMethodId: requireCanonicalString(result.walletAuthMethodId, 'walletAuthMethodId'),
  };
}

async function assertCanonicalExport(
  page: Page,
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
): Promise<void> {
  const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await frame.locator('body').evaluate(captureExportClipboard);
  try {
    const outcome = await harness.runMlDsaCommand({ kind: 'export', signer });
    expect('kind' in outcome && outcome.kind).toBe('exported');
    const seedField = frame.getByRole('button', { name: 'Copy private key', exact: true });
    await expect(seedField).toBeEnabled({ timeout: 30_000 });
    await seedField.click();
    const text = await frame.locator('body').evaluate(readCapturedExport);
    if (!/^[A-Za-z0-9_-]{43}$/.test(text))
      throw new Error('The export viewer did not copy a canonical 32-byte seed');
    const seed = Buffer.from(text, 'base64url');
    try {
      const imported = createPrivateKey({
        key: Buffer.concat([
          Buffer.from('3034020100300b060960864801650304031204228020', 'hex'),
          seed,
        ]),
        format: 'der',
        type: 'pkcs8',
      });
      const publicDer = createPublicKey(imported).export({ format: 'der', type: 'spki' });
      expect(publicDer.subarray(-1952).equals(Buffer.from(signer.publicKeyB64u, 'base64url'))).toBe(
        true,
      );
      const message = Buffer.from('seams ML-DSA recovered-owner export qualification');
      const signature = ordinarySign(null, message, imported);
      expect(verify(null, message, createPublicKey(imported), signature)).toBe(true);
    } finally {
      seed.fill(0);
    }
  } finally {
    await frame.locator('body').evaluate(restoreExportClipboard);
    const close = frame.getByRole('button', { name: 'Close exported keys', exact: true });
    if (await close.isVisible()) await close.click();
  }
}

function captureExportClipboard(): void {
  const clipboard = navigator.clipboard;
  Reflect.set(clipboard, '__mlDsaSavedWriteText', clipboard.writeText);
  // Capture the authorized Copy action inside the Wallet frame. Preserve the OS clipboard.
  Reflect.set(clipboard, 'writeText', Reflect.set.bind(Reflect, clipboard, '__mlDsaCopiedSeed'));
}

function readCapturedExport(): string {
  const value: unknown = Reflect.get(navigator.clipboard, '__mlDsaCopiedSeed');
  Reflect.deleteProperty(navigator.clipboard, '__mlDsaCopiedSeed');
  if (typeof value !== 'string') throw new Error('The Wallet export did not copy its seed');
  return value;
}

function restoreExportClipboard(): void {
  const clipboard = navigator.clipboard;
  const saved = Reflect.get(clipboard, '__mlDsaSavedWriteText');
  if (typeof saved !== 'function') throw new Error('The Clipboard API override lost its method');
  Reflect.set(clipboard, 'writeText', saved);
  Reflect.deleteProperty(clipboard, '__mlDsaSavedWriteText');
  Reflect.deleteProperty(clipboard, '__mlDsaCopiedSeed');
}
async function verifyRestorationOwner(walletId: string, walletAuthMethodId: string): Promise<void> {
  if (process.env.ML_DSA_HOSTED_DEPLOYMENT) {
    const row = await mlDsaHostedFixture('/fixture/restoration-owner', { walletId });
    expect(row.owner).toBe(walletAuthMethodId);
    return;
  }
  const opened = await openReadOnlyGatewayD1();
  try {
    const row = await opened.database
      .prepare(
        `SELECT json_extract(record_json,'$.preparation.owner.walletAuthMethodId') owner
      FROM router_ab_yao_versioned_json_records WHERE record_key=?`,
      )
      .bind(`ml-dsa-registration:${JSON.stringify([walletId, 'near-ml-dsa-65:1'])}`)
      .first<{ owner: string }>();
    expect(row?.owner).toBe(walletAuthMethodId);
  } finally {
    opened.close();
  }
}

function recordOptionalAsset(urls: string[], request: import('@playwright/test').Request): void {
  const url = request.url();
  if (/ml_dsa_signer|pkg-ml-dsa/.test(url)) urls.push(url);
}
function isOptionalMlDsaCryptoAsset(url: string): boolean {
  return /(?:ml_dsa_signer|pkg-ml-dsa|mlDsa(?:RootInstallation|RootLinking|SeedExport))/u.test(
    new URL(url).pathname,
  );
}

function isOptionalWasm(url: string): boolean {
  return url.includes('ml_dsa_signer_bg.wasm');
}
export async function openSigningKeys(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Show account menu', exact: true })
    .click({ timeout: 10_000 });
  const menu = page.getByTestId('intended-account-menu');
  const trigger = menu.locator('.seams-user-account-button-trigger[aria-expanded]');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const screen = menu.getByRole('heading', { name: 'Signing keys', exact: true });
  if (!(await screen.isVisible())) await menu.getByRole('button', { name: /Signing keys/ }).click();
  await expect(screen).toBeVisible();
}
async function readDefaultSigner(harness: IntendedBehaviourHarness) {
  return harness.runMlDsaCommand({ kind: 'default_signer' });
}
async function invokeSettingsSigning(command: MlDsaBrowserCommand) {
  if (!window.__seamsIntendedMlDsa) throw new Error('ML-DSA test command is unavailable');
  return window.__seamsIntendedMlDsa(command);
}
async function signFromDefaultPicker(
  page: Page,
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
  testInfo: TestInfo,
) {
  const started = performance.now();
  const command: MlDsaBrowserCommand = {
    kind: 'normal_sign_default',
    sessionPolicy: { maxOperations: 2, durationMs: 600_001 },
  };
  const resultPromise = page.evaluate(invokeSettingsSigning, command);
  const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await expect(frame.getByRole('button', { name: 'Approve transaction', exact: true })).toBeVisible();
  await expect(frame.getByRole('group', { name: 'Signing key', exact: true })).toHaveCount(0);
  await expect(frame.getByText(/Failed operations consume one use/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('ml-dsa-transaction-approval.png') });
  await frame.getByRole('button', { name: 'Approve transaction', exact: true }).click();
  const result = await test.step(
    'One transaction approval completes signing',
    returnSigningResult.bind(null, resultPromise),
    { timeout: 120_000 },
  );
  await waitForWalletIframeConfirmationSettlement(page);
  expect(await readDefaultSigner(harness)).toEqual({
    kind: 'near_ml_dsa_65',
    signingKeyId: signer.signingKeyId,
  });
  return verifyBrowserSignature(result, signer, performance.now() - started);
}

async function hidePublishedSigner(route: Route): Promise<void> {
  await route.fulfill({ status: 200, json: { kind: 'inventory', entries: [] } });
}
function verifyOrdinarySignature(
  result: Awaited<ReturnType<IntendedBehaviourHarness['runMlDsaCommand']>>,
): void {
  if (!('kind' in result) || result.kind !== 'sdk_signed')
    throw new Error('Ordinary signing did not return a signature');
  const signed = Buffer.from(result.signedTransactionBorshB64u, 'base64url');
  const keyOffset = 4 + signed.readUInt32LE(0);
  expect(signed[keyOffset]).toBe(0);
  expect(signed[signed.length - 65]).toBe(0);
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      signed.subarray(keyOffset + 1, keyOffset + 33),
    ]),
    format: 'der',
    type: 'spki',
  });
  const hash = createHash('sha256').update(signed.subarray(0, -65)).digest();
  expect(verify(null, hash, key, signed.subarray(-64))).toBe(true);
}

function returnSigningResult(
  result: ReturnType<IntendedBehaviourHarness['runMlDsaCommand']>,
): ReturnType<IntendedBehaviourHarness['runMlDsaCommand']> {
  return result;
}

type DiscoveryRequest = {
  readonly endpoint: string;
  readonly startedMs: number;
  readonly rpcMethod: string | null;
  readonly requestType: string | null;
  responseMs: number | null;
  status: number | null;
  finishedMs: number | null;
  failed: boolean;
};
class SignerDiscoveryTrace {
  private readonly startedAt = performance.now();
  private readonly requests = new Map<import('@playwright/test').Request, DiscoveryRequest>();
  request(request: import('@playwright/test').Request): void {
    const url = new URL(request.url());
    const rpc = /^(rpc.testnet.fastnear.com|rpc.testnet.near.org)$/.test(url.hostname);
    if (
      !rpc &&
      !url.pathname.includes('/ml-dsa/metadata') &&
      !url.pathname.includes('ml_dsa_signer')
    )
      return;
    let rpcMethod: string | null = null;
    let requestType: string | null = null;
    if (rpc) {
      try {
        const body = requireRecord(request.postDataJSON(), 'RPC diagnostic body');
        if (typeof body.method === 'string') rpcMethod = body.method;
        if (body.params && typeof body.params === 'object') {
          const value: unknown = Reflect.get(body.params, 'request_type');
          if (typeof value === 'string') requestType = value;
        }
      } catch {
        /* Request diagnostics must not alter the test. */
      }
    }
    this.requests.set(request, {
      endpoint: url.origin + url.pathname.replace(/\/wallets\/[^/]+\//, '/wallets/:walletId/'),
      startedMs: this.elapsed(),
      rpcMethod,
      requestType,
      responseMs: null,
      status: null,
      finishedMs: null,
      failed: false,
    });
  }
  response(response: import('@playwright/test').Response): void {
    const record = this.requests.get(response.request());
    if (record) {
      record.responseMs = this.elapsed();
      record.status = response.status();
    }
  }
  finished(request: import('@playwright/test').Request): void {
    const record = this.requests.get(request);
    if (record) record.finishedMs = this.elapsed();
  }
  failed(request: import('@playwright/test').Request): void {
    const record = this.requests.get(request);
    if (record) {
      record.finishedMs = this.elapsed();
      record.failed = true;
    }
  }
  async save(testInfo: TestInfo): Promise<void> {
    const file = testInfo.outputPath('signer-discovery-requests.json');
    await writeFile(
      file,
      JSON.stringify(
        {
          scope: 'Endpoints, status and timing only. No headers, credentials, or RPC params.',
          elapsedMs: this.elapsed(),
          requests: [...this.requests.values()],
        },
        null,
        2,
      ),
    );
    await testInfo.attach('signer-discovery-requests', {
      path: file,
      contentType: 'application/json',
    });
  }
  private elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

export async function runMlDsaDeviceOwnerParity(
  { harness, browser, page }: { harness: IntendedBehaviourHarness; browser: Browser; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(900_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const context = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('walletId' in context) || typeof context.walletId !== 'string')
    throw new Error('Missing test wallet');
  await prepareMlDsaPool(context.walletId);
  const signer = await publishAcrossReload(page, harness);
  await assertCanonicalExport(page, harness, signer);
  const linked = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(linked);
  const linkedActor = await readActor(linked);
  await discover(linked, signer, linkedActor.credentialIdB64u);
  await assertCanonicalExport(linked.page, linked, signer);
  await linked.refreshPagePreservingWalletStorage();
  await linked.unlockPasskeyWallet();
  await assertCanonicalExport(linked.page, linked, signer);
  const third = await linked.openLinkedDevice(browser);
  await linked.linkDeviceWithPasskey(third);
  await assertCanonicalExport(third.page, third, signer);
  await harness.addEmailOtpAuthMethod();
  await harness.unlockWithAddedEmailOtp();
  await assertCanonicalExport(page, harness, signer);
  await harness.unlockPasskeyWallet();
  await harness.discardPasskeyCredentials();
  await harness.recoverPasskeyWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await assertCanonicalExport(page, harness, signer);
  await harness.revokeLinkedDeviceWithOwnerPasskey();
  const revoked = await linked.runMlDsaCommand({ kind: 'metadata' });
  expect('kind' in revoked && revoked.kind).toBe('refused');
  await assertCanonicalExport(third.page, third, signer);
  await saveEvidence(testInfo, {
    observedAt: new Date().toISOString(),
    scope: process.env.ML_DSA_HOSTED_DEPLOYMENT
      ? 'Public SDK, Chromium with separate authenticators, real Cloudflare Gateway/D1/Router/A/B Workers and separate preparers. Browser assets use local test origins. No live-chain or latency claim.'
      : 'Public SDK, Chromium with separate authenticators, local Gateway/D1/Router/A/B Workers. NEAR RPC uses the intended-behaviour fixture. No live-chain or latency claim.',
    walletId: context.walletId,
    signer,
    checks: {
      publicationAcrossReload: true,
      linkedPasskeyExport: true,
      exportAfterReload: true,
      onwardLinkExport: true,
      otherLinkedOwnerPreservedAfterRevocation: true,
      originalEmailOtpExport: true,
      recoveredOwnerExport: true,
      revokedOwnerRefused: true,
      exportsVerifiedByNodeCrypto: true,
    },
    policy: { candidateGroupSize: 2, preparationGroupSize: 4, poolCapacityCandidates: 32 },
  });
}
