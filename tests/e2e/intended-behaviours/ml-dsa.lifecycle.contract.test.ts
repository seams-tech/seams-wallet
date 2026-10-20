import { expect, type TestInfo } from '@playwright/test';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openReadOnlyGatewayD1 } from './local-gateway-database';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import type { AddedMlDsaSignerCapability } from '../../../packages/wallet/src/core/types/seams';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('ML-DSA survives full browser recovery and QR linking under separate owners', async ({
  harness,
  browser,
}, testInfo) => {
  test.setTimeout(900_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const context = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('walletId' in context) || !('nearAccountId' in context) || !('credentialIdB64u' in context))
    throw new Error('Missing browser wallet identity');
  await preparePool(context.walletId);
  const signer = await publish(harness);
  const unsignedTransactionBorshB64u = transaction(context.nearAccountId, signer);
  const original = await sign(
    harness,
    signer,
    unsignedTransactionBorshB64u,
    context.credentialIdB64u,
  );

  const linked = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(linked);
  const linkedActor = await readActor(linked);
  expect(linkedActor.credentialIdB64u).not.toBe(context.credentialIdB64u);
  await discover(linked, signer, linkedActor.credentialIdB64u);
  await pause(60_000);
  const device = await sign(
    linked,
    signer,
    unsignedTransactionBorshB64u,
    linkedActor.credentialIdB64u,
  );

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
  await pause(60_000);
  const recovered = await sign(
    harness,
    signer,
    unsignedTransactionBorshB64u,
    recoveredActor.credentialIdB64u,
  );
  await harness.revokeLinkedDeviceWithOwnerPasskey();
  const revoked = await linked.runMlDsaCommand({
    kind: 'inventory',
    credentialIdB64u: linkedActor.credentialIdB64u,
  });
  expect('kind' in revoked && revoked.kind).toBe('refused');
  await discover(harness, signer, recoveredActor.credentialIdB64u);
  await preparePool(context.walletId);
  const restoration = await harness.runMlDsaCommand({ kind: 'restore', recordedSigner: signer });
  if (!('kind' in restoration) || restoration.kind !== 'restored')
    throw new Error(`Browser restoration failed: ${JSON.stringify(restoration)}`);
  expect(restoration.signer.publicKeyB64u).toBe(signer.publicKeyB64u);
  expect(restoration.signer.keyManifestDigestB64u).toBe(signer.keyManifestDigestB64u);
  expect(restoration.signer.materialEpoch).toBeGreaterThan(signer.materialEpoch);
  await discover(harness, restoration.signer, recoveredActor.credentialIdB64u);
  await verifyRestorationOwner(context.walletId, recoveredActor.walletAuthMethodId);
  await pause(60_000);
  const restored = await sign(
    harness,
    restoration.signer,
    unsignedTransactionBorshB64u,
    recoveredActor.credentialIdB64u,
  );
  await harness.assertConsumedRecoveryCodeReportedAsUsed();
  await saveEvidence(testInfo, {
    observedAt: new Date().toISOString(),
    scope:
      'Chromium, real recovery-code ceremony, separate QR target browser and authenticators, public SDK and Gateway, local Cloudflare workerd. Transactions are independently verified without broadcasting.',
    walletId: context.walletId,
    signer,
    signatures: { original, recovered, linked: device, restored },
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
});

async function publish(harness: IntendedBehaviourHarness): Promise<AddedMlDsaSignerCapability> {
  const result = await harness.runMlDsaCommand({ kind: 'publish' });
  if (!('kind' in result) || result.kind !== 'near_ml_dsa_65')
    throw new Error(`Unexpected publication: ${JSON.stringify(result)}`);
  return result;
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
  const entry = result.entries[0];
  if (entry.kind !== 'published') throw new Error('Recovered signer is unpublished');
  expect(entry.key.publicKeyB64u).toBe(signer.publicKeyB64u);
  expect(entry.key.keyManifestDigestB64u).toBe(signer.keyManifestDigestB64u);
  expect(entry.key.materialEpoch).toBe(signer.materialEpoch);
}

async function sign(
  harness: IntendedBehaviourHarness,
  signer: AddedMlDsaSignerCapability,
  unsignedTransactionBorshB64u: string,
  credentialIdB64u: string,
) {
  const result = await harness.runMlDsaCommand({
    kind: 'sign',
    credentialIdB64u,
    signer,
    unsignedTransactionBorshB64u,
  });
  if (!('kind' in result) || result.kind !== 'signed')
    throw new Error(`Browser signature failed: ${JSON.stringify(result)}`);
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(signer.publicKeyB64u, 'base64url'),
    ]),
    format: 'der',
    type: 'spki',
  });
  const hash = createHash('sha256')
    .update(Buffer.from(unsignedTransactionBorshB64u, 'base64url'))
    .digest();
  expect(verify(null, hash, key, Buffer.from(result.transaction.signatureB64u, 'base64url'))).toBe(
    true,
  );
  return result.transaction;
}

function transaction(accountId: string, signer: AddedMlDsaSignerCapability): string {
  const result = spawnSync(
    path.resolve('..', 'tools/ml-dsa-investigation/target/release/ml-dsa-investigation'),
    ['near-enrollment-fixture'],
    {
      input:
        JSON.stringify({
          kind: 'ml_dsa_transfer',
          accountId,
          publicKeyB64u: signer.publicKeyB64u,
        }) + '\n',
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error(`Transaction codec failed: ${result.stderr}`);
  return requireCanonicalString(
    requireRecord(JSON.parse(result.stdout), 'transaction codec').unsignedTransactionBorshB64u,
    'unsigned transaction',
  );
}

async function preparePool(walletId: string): Promise<void> {
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
async function saveEvidence(testInfo: TestInfo, evidence: unknown): Promise<void> {
  const text = JSON.stringify(evidence, null, 2) + '\n';
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
    credentialIdB64u: result.credentialIdB64u,
    walletAuthMethodId: result.walletAuthMethodId,
  };
}
async function verifyRestorationOwner(walletId: string, walletAuthMethodId: string): Promise<void> {
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
