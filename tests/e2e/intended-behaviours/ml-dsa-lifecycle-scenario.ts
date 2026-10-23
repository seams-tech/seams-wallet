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
import type { IntendedBehaviourHarness } from './harness';
import { mlDsaHostedFixture } from '../../helpers/mlDsaHostedFixture';
import type { AddedMlDsaSignerCapability } from '../../../packages/wallet/src/core/types/seams';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import { fundImplicitWallet, testnetRpc } from './ml-dsa-testnet';

export async function runMlDsaBrowserLifecycle(
  { harness, browser, page }: { harness: IntendedBehaviourHarness; browser: Browser; page: Page },
  testInfo: TestInfo,
) {
  testInfo.setTimeout(900_000);
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
  await prepareMlDsaPool(context.walletId);
  const signer = await publishAcrossReload(page, harness);
  await harness.useLiveNearTestnetRpc();
  const enrollment = await harness.runMlDsaCommand({ kind: 'enroll', signer });
  expect(enrollment).toMatchObject({ kind: 'enrolled' });
  const original = await signMlDsaTransaction(harness, signer, {
    maxOperations: 2,
    durationMs: 600_000,
  });
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

  const linked = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(linked);
  await linked.useLiveNearTestnetRpc();
  const linkedActor = await readActor(linked);
  expect(linkedActor.credentialIdB64u).not.toBe(context.credentialIdB64u);
  await discover(linked, signer, linkedActor.credentialIdB64u);
  await expect(linked.runMlDsaCommand({ kind: 'export', signer })).rejects.toThrow('custody owner');
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
    signatures: { original, warm, recovered, linked: device, restored },
    restoredSigner: restoration.signer,
    actors: {
      original: context.credentialIdB64u,
      linked: linkedActor.credentialIdB64u,
      recovered: recoveredActor.credentialIdB64u,
    },
    checks: {
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
      restorationOwnerMatchesRecoveredMethod: true,
    },
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
  const publishing = harness.runMlDsaCommand({ kind: 'publish' });
  const first = await Promise.race([pendingRequest, publishing]);
  expect('url' in first).toBe(true);
  void publishing.catch(ignoreInterruptedPublication);
  await harness.refreshPagePreservingWalletStorage();
  await page.unroute(pattern, abortPublication);
  await harness.unlockPasskeyWallet();
  const actor = await readActor(harness);
  const inventory = await harness.runMlDsaCommand({
    kind: 'inventory',
    credentialIdB64u: actor.credentialIdB64u,
  });
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
function ignoreInterruptedPublication(): void {}

async function discover(
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
  credentialIdB64u: string,
): Promise<void> {
  const result = await harness.runMlDsaCommand({ kind: 'inventory', credentialIdB64u });
  if (!('kind' in result) || result.kind !== 'inventory')
    throw new Error(`Inventory failed: ${JSON.stringify(result)}`);
  expect(result.entries).toHaveLength(1);
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
  await testInfo.attach('ml-dsa-browser-lifecycle', {
    body: text,
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
