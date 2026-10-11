import { expect, test, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupBasicPasskeyTest } from '../setup';

const probeSource = `
import { configureIndexedDB } from './packages/wallet/src/core/indexedDB';
import { seamsWalletDB } from './packages/wallet/src/core/indexedDB/singletons';
import { SEAMS_WALLET_STORES } from './packages/wallet/src/core/indexedDB/schemaNames';
import { walletSessionAuthorizations } from './packages/wallet/src/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';

function scope(fixture) {
  return {
    walletId: fixture.activeWalletSession.walletId,
    authorityId: fixture.activeWalletSession.authorityId,
    authMethodId: fixture.activeWalletSession.authMethodId,
  };
}

async function write(fixture) {
  await walletSessionAuthorizations.writeExactWithOperationCredential({
    record: fixture.activeWalletSession,
    operationCredential: fixture.operationCredential,
  });
}

async function refresh(fixture) {
  return walletSessionAuthorizations.refreshExactWithOperationCredential({
    expected: fixture.activeWalletSession,
    record: fixture.activeWalletSession,
    operationCredential: fixture.operationCredential,
  });
}

async function retire(fixture) {
  return walletSessionAuthorizations.retireExactActiveForWallet({
    walletId: fixture.activeWalletSession.walletId,
    reason: 'wallet_locked',
    retiredAtMs: 2000,
  });
}

export async function run() {
  configureIndexedDB({ mode: 'wallet' });
  const alpha = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'transaction-alpha', walletId: 'wallet:transaction-alpha', expiresAtMs: 10000,
  });
  const beta = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'transaction-beta', walletId: 'wallet:transaction-beta', expiresAtMs: 10000,
  });
  await write(alpha);
  await write(beta);
  const db = await seamsWalletDB.getDB();
  const store = SEAMS_WALLET_STORES.walletSessionAuthorizations;
  const alphaKey = alpha.operationCredential.walletSessionId;
  const original = await db.get(store, alphaKey);
  const beforeRead = seamsWalletDB.getWalletAuthorityRevision();
  const initial = await walletSessionAuthorizations.readExactWithOperationCredential(scope(alpha));
  const afterRead = seamsWalletDB.getWalletAuthorityRevision();
  await write(alpha);
  const afterIdenticalWrite = seamsWalletDB.getWalletAuthorityRevision();
  const updated = await refresh(alpha);
  const afterRefresh = seamsWalletDB.getWalletAuthorityRevision();

  // Put malformed raw boundary data after a valid row in index order.
  const corruptKey = 'zzzz-corrupt-session';
  const corrupt = structuredClone(original);
  corrupt.wallet_session_id = corruptKey;
  corrupt.operation_credential.token = '';
  await db.put(store, corrupt);
  const legacyKey = '0000-legacy-session';
  await db.put(store, {
    record_version: 'wallet_session_authorization_v3',
    wallet_session_id: legacyKey,
    wallet_id: alpha.activeWalletSession.walletId,
  });
  const corruptRead = await walletSessionAuthorizations.readExactActiveForWallet(scope(alpha));
  const legacySurvivedRead = await db.get(store, legacyKey) !== undefined;
  let retirementRejected = false;
  try {
    await retire(alpha);
  } catch {
    retirementRejected = true;
  }
  const validSurvivedRetirement = await db.get(store, alphaKey) !== undefined;
  const legacySurvivedRetirement = await db.get(store, legacyKey) !== undefined;
  let replacementRejected = false;
  try {
    await write(alpha);
  } catch {
    replacementRejected = true;
  }
  const validSurvivedReplacement = await db.get(store, alphaKey) !== undefined;
  const legacySurvivedReplacement = await db.get(store, legacyKey) !== undefined;

  const afterAborts = seamsWalletDB.getWalletAuthorityRevision();
  await db.delete(store, corruptKey);
  const recovered = await walletSessionAuthorizations.readExactActiveForWallet(scope(alpha));
  const afterPrune = seamsWalletDB.getWalletAuthorityRevision();
  const legacyPruned = await db.get(store, legacyKey) === undefined;
  await walletSessionAuthorizations.clearWallet(alpha.activeWalletSession.walletId);
  const cleared = await walletSessionAuthorizations.readExact(alphaKey);
  const beforeStaleRefresh = seamsWalletDB.getWalletAuthorityRevision();
  const staleRefresh = await refresh(alpha);
  const afterStaleRefresh = seamsWalletDB.getWalletAuthorityRevision();
  const otherWallet = await walletSessionAuthorizations.readExactWithOperationCredential(scope(beta));
  const retired = await retire(beta);
  const retiredRead = await walletSessionAuthorizations.readExact(beta.operationCredential.walletSessionId);
  await write(alpha);
  await write(beta);
  await walletSessionAuthorizations.clearAll();
  const remainingRows = await db.count(store);
  seamsWalletDB.setDisabled(true);
  const unavailable = await walletSessionAuthorizations.readExactActiveForWallet(scope(alpha));
  seamsWalletDB.setDisabled(false);

  return {
    revisions: {
      unchangedRead: afterRead === beforeRead,
      identicalWrite: afterIdenticalWrite === afterRead,
      committedRefresh: afterRefresh === afterRead + 1,
      abortedWrites: afterAborts === afterRefresh,
      legacyPrune: afterPrune === afterAborts + 1,
      staleRefresh: afterStaleRefresh === beforeStaleRefresh,
    },
    initial: initial.kind,
    updated,
    corruptRead: corruptRead.kind,
    legacySurvivedRead,
    retirementRejected,
    validSurvivedRetirement,
    legacySurvivedRetirement,
    replacementRejected,
    validSurvivedReplacement,
    legacySurvivedReplacement,
    recovered: recovered.kind,
    legacyPruned,
    cleared,
    staleRefresh,
    otherWallet: otherWallet.kind,
    retiredCount: retired.length,
    retiredRead,
    remainingRows,
    unavailable: unavailable.kind,
  };
}
`;

async function serveProbe(bundle: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'text/javascript', body: bundle });
}

async function runPersistenceScenario(): Promise<unknown> {
  const probePath = '/__session-persistence.js';
  const probe = await import(probePath);
  return probe.run();
}

test('session transactions roll back corruption and retire exact credentials durably', async ({
  page,
}, info) => {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: { contents: probeSource, resolveDir: root },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await page.route(
    '**/__session-persistence.js',
    serveProbe.bind(null, bundle.outputFiles[0]!.text),
  );
  const receipt = await page.evaluate(runPersistenceScenario);
  expect(receipt).toEqual({
    revisions: {
      unchangedRead: true,
      identicalWrite: true,
      committedRefresh: true,
      abortedWrites: true,
      legacyPrune: true,
      staleRefresh: true,
    },
    initial: 'found',
    updated: 'updated',
    corruptRead: 'corrupt',
    legacySurvivedRead: true,
    retirementRejected: true,
    validSurvivedRetirement: true,
    legacySurvivedRetirement: true,
    replacementRejected: true,
    validSurvivedReplacement: true,
    legacySurvivedReplacement: true,
    recovered: 'found',
    legacyPruned: true,
    cleared: null,
    staleRefresh: 'superseded',
    otherWallet: 'found',
    retiredCount: 1,
    retiredRead: null,
    remainingRows: 0,
    unavailable: 'persistence_unavailable',
  });
  await writeFile(info.outputPath('session-persistence.json'), JSON.stringify(receipt, null, 2));
});
