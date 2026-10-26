import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeWalletCustodyAdminChallengeDigest } from '@shared/authorization/walletCustodyOperation';
import { buildWalletServiceHtml } from '@/plugins/plugin-utils';
import { setupBasicPasskeyTest } from '../setup';
import { injectImportMap } from '../setup/bootstrap';
import { registerWalletServiceRoute } from './harness';

const WALLET_ORIGIN = 'https://wallet.example.localhost';
const RELAYER_ORIGIN = 'https://recovery-relay.example.localhost';
const WALLET_ID = 'wallet:email-recovery-backup';
const ISSUED_AT_MS = 1_700_000_000_000;
const SEED_SOURCE = `
import { configureIndexedDB, IndexedDBManager } from './packages/wallet/src/core/indexedDB';
import { pendingWalletRecoveryCodeBackupRepository } from './packages/wallet/src/core/indexedDB/seamsWalletDB/pendingWalletRecoveryCodeBackup';
import { issueWalletRecoveryCodes, zeroizeIssuedWalletRecoveryCodes } from './packages/shared-ts/src/wallet-recovery/recoveryCodes';
import { buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';

export async function seed(walletId, issuedAtMs) {
  configureIndexedDB({ mode: 'wallet' });
  const fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'email-recovery-backup',
    walletId,
    providerUserId: 'owner@example.test',
    expiresAtMs: Date.now() + 60000,
  });
  await IndexedDBManager.upsertProfile({ profileId: walletId });
  await IndexedDBManager.upsertWalletAuthMethod({
    version: 'wallet_auth_method_v1',
    kind: 'email_otp',
    status: 'active',
    walletId: fixture.authMethod.walletId,
    emailHashHex: fixture.authMethod.emailHashHex,
    registrationAuthorityId: fixture.authMethod.registrationAuthorityId,
    createdAtMs: fixture.authMethod.createdAtMs,
    updatedAtMs: fixture.authMethod.updatedAtMs,
    localStatus: 'synced',
    authority: fixture.exactFactorAuthority,
  });
  await IndexedDBManager.persistFoundingWalletAuthority({
    authority: fixture.authority,
    authMethod: fixture.authMethod,
  });
  const issued = issueWalletRecoveryCodes();
  try {
    const pendingRef = await pendingWalletRecoveryCodeBackupRepository.write({
      walletId,
      recoveryCodes: issued.codes,
    });
    await pendingWalletRecoveryCodeBackupRepository.bindIssuedAtMs(pendingRef, issuedAtMs);
  } finally {
    zeroizeIssuedWalletRecoveryCodes(issued);
  }
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  const pending = await pendingWalletRecoveryCodeBackupRepository.read(walletId);
  return { selected: selected.kind, pending: pending?.kind };
}
`;

type RelayObservation = {
  readonly operation: string;
  readonly requestId: string;
  readonly proofKind: string;
  readonly codeMatched: boolean;
  readonly challengeMatched: boolean;
  readonly issuedAtMsMatched: boolean;
  readonly walletFrame: boolean;
};

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': WALLET_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, accept',
    'content-type': 'application/json',
  };
}

async function replyToRecoveryRelay(observations: RelayObservation[], route: Route): Promise<void> {
  const request = route.request();
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders() });
    return;
  }
  const pathname = new URL(request.url()).pathname;
  const body = request.postDataJSON();
  const rpcResponse = (responseBody: unknown): Promise<void> =>
    route.fulfill({ status: 200, headers: corsHeaders(), body: JSON.stringify(responseBody) });
  if (pathname === '/wallets/custody/email-otp/challenge') {
    const operation = String(body.operation);
    const payload = body.payload as { walletId: string; requestId: string; expectedIssuedAtMs?: number };
    const challengeDigest = await computeWalletCustodyAdminChallengeDigest({
      walletId: body.walletId,
      operation: operation as 'recovery_status' | 'recovery_backup_acknowledge',
      payload,
      requestOrigin: WALLET_ORIGIN,
    });
    await rpcResponse({
      ok: true,
      challengeId: `challenge-${operation}-${payload.requestId}`,
      challenge_digest: challengeDigest,
      expiresAtMs: Date.now() + 60000,
      otpChannel: 'email',
    });
    return;
  }
  if (pathname === `/wallets/${encodeURIComponent(WALLET_ID)}/recovery/status`) {
    const proof = body.factorProof;
    observations.push({
      operation: 'recovery_status',
      requestId: body.requestId,
      proofKind: proof.kind,
      codeMatched: proof.otp_code === '111111' || proof.otp_code === '123456',
      challengeMatched: proof.challenge_id === `challenge-recovery_status-${body.requestId}`,
      issuedAtMsMatched: true,
      walletFrame: request.frame().url().startsWith(WALLET_ORIGIN),
    });
    await rpcResponse({
      ok: true,
      activeCodeCount: 10,
      totalCodeCount: 10,
      issuedAtMs: ISSUED_AT_MS,
      storeVersion: 'recovery-set-1',
      backupOutstanding: true,
    });
    return;
  }
  if (pathname === '/wallets/recovery/acknowledge-backup') {
    const proof = body.factorProof;
    observations.push({
      operation: 'recovery_backup_acknowledge',
      requestId: body.requestId,
      proofKind: proof.kind,
      codeMatched: proof.otp_code === '654321',
      challengeMatched:
        proof.challenge_id === `challenge-recovery_backup_acknowledge-${body.requestId}`,
      issuedAtMsMatched: body.expectedIssuedAtMs === ISSUED_AT_MS,
      walletFrame: request.frame().url().startsWith(WALLET_ORIGIN),
    });
    await rpcResponse({ ok: true, issuedAtMs: ISSUED_AT_MS });
    return;
  }
  await route.fulfill({ status: 404, headers: corsHeaders(), body: '{}' });
}

async function startRouter(page: Page): Promise<void> {
  await page.evaluate(
    async ({ walletOrigin, relayerOrigin }) => {
      const module = await import('/_test-sdk/esm/SeamsWeb/walletIframe/client/router.js');
      const config = structuredClone((window as any).__SEAMS_TEST_HOST_CONFIG__);
      config.network.relayer.url = relayerOrigin;
      const router = new module.WalletIframeRouter({
        hostConfig: config,
        walletOrigin,
        servicePath: '/wallet-service',
        sdkBasePath: '/_test-sdk/esm/sdk',
        testOptions: { ownerTag: 'recovery-email-host-test' },
      });
      (window as any).__recoveryEmailRouter = router;
      await router.init();
    },
    { walletOrigin: WALLET_ORIGIN, relayerOrigin: RELAYER_ORIGIN },
  );
}

async function seedWallet(page: Page): Promise<{ selected: string; pending: string | undefined }> {
  const frame = page.frames().find((candidate) =>
    candidate.url().startsWith(`${WALLET_ORIGIN}/wallet-service`),
  );
  if (!frame) throw new Error('Wallet iframe did not load');
  return await frame.evaluate(
    async ({ walletId, issuedAtMs }) => {
      const seedPath = '/__recovery-email-seed.js';
      const seed = await import(seedPath);
      return await seed.seed(walletId, issuedAtMs);
    },
    { walletId: WALLET_ID, issuedAtMs: ISSUED_AT_MS },
  );
}

test('Email OTP-only wallet confirms recovery backup with separate wallet-owned codes', async ({
  page,
}, testInfo) => {
  const bundle = await build({
    stdin: { contents: SEED_SOURCE, resolveDir: path.resolve(import.meta.dirname, '../..') },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.resolve(import.meta.dirname, '../../packages/wallet/tsconfig.json'),
  });
  const observations: RelayObservation[] = [];
  await setupBasicPasskeyTest(page, {
    skipSeamsWebInit: true,
    injectWalletServiceImportMap: true,
  });
  await page.route('**/__recovery-email-seed.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text }),
  );
  await page.route(`${RELAYER_ORIGIN}/**`, replyToRecoveryRelay.bind(null, observations));
  await injectImportMap(page);
  await registerWalletServiceRoute(
    page,
    buildWalletServiceHtml('/_test-sdk/esm/sdk', undefined, 'runtime'),
    '**://wallet.example.localhost/wallet-service*',
  );
  await startRouter(page);
  expect(await seedWallet(page)).toEqual({ selected: 'resolved', pending: 'ready' });

  const frame = page.frameLocator('iframe[data-seams-owner="recovery-email-host-test"]');
  const standaloneStatus = page.evaluate(async (walletId) => {
    const router = (window as any).__recoveryEmailRouter;
    return await router.getCodeStatus({ walletId, authorization: { kind: 'email_otp' } });
  }, WALLET_ID);
  const standaloneCode = frame.locator('input[name="email-code"]');
  await expect(standaloneCode).toBeVisible();
  await standaloneCode.fill('111111');
  await expect(standaloneStatus).resolves.toMatchObject({
    kind: 'ready',
    issuedAtMs: ISSUED_AT_MS,
  });

  const confirmation = page.evaluate(async (walletId) => {
    const router = (window as any).__recoveryEmailRouter;
    return await router.confirmBackup({ walletId, authorization: { kind: 'email_otp' } });
  }, WALLET_ID);
  const firstCode = frame.locator('input[name="email-code"]');
  await expect(firstCode).toBeVisible();
  await firstCode.fill('123456');
  await expect(frame.getByRole('button', { name: 'View recovery codes' })).toBeVisible();
  await frame.getByRole('button', { name: 'View recovery codes' }).click();
  await expect(frame.locator('.recovery-code-item')).toHaveCount(10);
  await frame.getByRole('checkbox').check();
  await frame.getByRole('button', { name: 'Finish backup' }).click();
  const secondCode = frame.locator('input[name="email-code"]');
  await expect(secondCode).toBeVisible();
  await secondCode.fill('654321');
  expect(await confirmation).toEqual({
    kind: 'acknowledged',
    walletId: WALLET_ID,
    issuedAtMs: ISSUED_AT_MS,
  });
  expect(observations).toHaveLength(3);
  expect(observations.map((observation) => observation.operation)).toEqual([
    'recovery_status',
    'recovery_status',
    'recovery_backup_acknowledge',
  ]);
  expect(new Set(observations.map((observation) => observation.requestId)).size).toBe(3);
  for (const observation of observations) {
    expect(observation.proofKind).toBe('email_otp');
    expect(observation.codeMatched).toBe(true);
    expect(observation.challengeMatched).toBe(true);
    expect(observation.issuedAtMsMatched).toBe(true);
    expect(observation.walletFrame).toBe(true);
  }
  const artifact = testInfo.outputPath('email-otp-recovery-backup.json');
  await writeFile(artifact, JSON.stringify({ observations, result: 'acknowledged' }, null, 2));
  await testInfo.attach('email-otp-recovery-backup', {
    path: artifact,
    contentType: 'application/json',
  });
});
