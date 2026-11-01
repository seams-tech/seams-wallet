import { NearRegistrationGate } from './registration-near-gate';
import { intendedTest as test, autoConfirmWalletIframeUntil } from './harness';
import { expect, type Route } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { base58Decode } from '@shared/utils/base58';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import { parseMlDsaSignerInventoryEntry } from '@shared/near/mlDsaInventory';
import { toWalletId } from '../../../packages/wallet/src/core/signingEngine/interfaces/ecdsaChainTarget';
import { openSigningKeys } from './ml-dsa-lifecycle-scenario';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Signing keys adds NEAR to an ECDSA-only wallet and retains ECDSA signing', async ({
  harness,
  page,
}, testInfo) => {
  testInfo.setTimeout(300_000);
  await harness.registerPasskeyEcdsaOnlyWallet();
  await openSigningKeys(page);
  await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'NEAR signing keys', exact: true })).toHaveCount(0);
  await page
    .getByRole('region', { name: /^ECDSA / })
    .first()
    .getByRole('button', { name: 'Key details', exact: true })
    .click();
  const ecdsaDetails = page.getByRole('region', { name: 'ECDSA', exact: true });
  await expect(ecdsaDetails.getByRole('button', { name: 'Export key', exact: true })).toBeVisible();
  await ecdsaDetails.getByRole('button', { name: 'Back', exact: true }).click();
  const nearAddition = page
    .locator('.seams-signing-key-row')
    .filter({ hasText: 'Ed25519 · New NEAR account' });
  const added = expect(
    page.getByRole('region', { name: 'NEAR signing keys', exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  const adding = autoConfirmWalletIframeUntil(page, added, { timeoutMs: 120_000 });
  await nearAddition
    .getByRole('button', { name: 'Add signer', exact: true })
    .click({ timeout: 10_000 });
  await adding;
  const nearKeys = page.getByRole('region', { name: 'NEAR signing keys', exact: true });
  await nearKeys.getByRole('button', { name: 'Add signer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add signing key', exact: true })).toBeFocused();
  await expect(
    page.getByText(
      'Your existing wallet recovery restores this key. Your default signing key stays the same.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nearKeys
    .getByRole('group', { name: 'Ed25519 signing key', exact: true })
    .getByRole('button', { name: 'Key details', exact: true })
    .click();
  const edDetails = page.getByRole('region', { name: 'Ed25519', exact: true });
  await expect(
    edDetails.getByRole('textbox', { name: 'Ed25519 public key', exact: true }),
  ).not.toHaveValue('');
  await expect(edDetails.getByRole('button', { name: 'Export key', exact: true })).toBeVisible();
  await edDetails.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
  await page
    .getByTestId('intended-account-menu')
    .screenshot({ path: testInfo.outputPath('signing-keys.png') });
  await page.keyboard.press('Escape');
  await harness.signTempoTransaction('post_registration');
  const artifact = testInfo.outputPath('signing-keys.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        walletId: harness.walletId,
        ecdsaOnlySettings: true,
        addedNearThroughSettings: true,
        retainedEcdsaSigning: true,
        keyDetailNavigation: true,
        cancelledMlDsaCreation: true,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('signing-keys', { path: artifact, contentType: 'application/json' });
});

test('Signing keys shows pending NEAR setup without offering duplicate creation', async ({
  harness,
  page,
  context,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const gate = new NearRegistrationGate();
  const hold = gate.hold.bind(gate);
  const path = '**/wallets/register/near-provisioning';
  await context.route(path, hold);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(gate.observed.bind(gate)).toBeGreaterThan(0);
    await openSigningKeys(page);
    const pending = page.getByRole('region', { name: 'NEAR setup', exact: true });
    await expect(pending.getByText('Setup in progress', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add signer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
    await page
      .getByTestId('intended-account-menu')
      .screenshot({ path: testInfo.outputPath('pending-near.png') });
    gate.release();
    await test.step(
      'Wait for the existing NEAR registration',
      harness.awaitNearReady.bind(harness),
      { timeout: 60_000 },
    );
    await openSigningKeys(page);
    await expect(
      page.getByRole('region', { name: 'NEAR signing keys', exact: true }),
    ).toBeVisible();
    await expect(pending).toHaveCount(0);
    const artifact = testInfo.outputPath('pending-near.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          observedAt: new Date().toISOString(),
          pendingSetupVisible: true,
          duplicateCreationAbsent: true,
          ecdsaStillVisible: true,
          nearBecomesAvailable: true,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('pending-near', { path: artifact, contentType: 'application/json' });
  } finally {
    gate.release();
    if (!page.isClosed()) await context.unroute(path, hold);
  }
});

test('ML-DSA setup resumes after cancellation and checks enrollment without changing the default', async ({
  harness,
  page,
  context,
}, testInfo) => {
  testInfo.setTimeout(300_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const scene = await MlDsaSettingsScene.create(harness.walletId);
  await context.route('**/ml-dsa/metadata', scene.metadata.bind(scene));
  await context.route('https://rpc.testnet.fastnear.com/**', scene.rpc.bind(scene));
  await context.route('https://rpc.testnet.near.org/**', scene.rpc.bind(scene));
  await openSigningKeys(page);
  const key = page.getByRole('group', { name: 'ML-DSA-65 signing key', exact: true });
  await expect(key.getByText('Created — activation pending', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add signer', exact: true })).toHaveCount(0);
  await key.getByRole('button', { name: 'Review NEAR key addition', exact: true }).click();
  await page.getByRole('button', { name: 'Finish later', exact: true }).click();
  await key.getByRole('button', { name: 'Review NEAR key addition', exact: true }).click();
  await page.getByRole('button', { name: 'Approve NEAR key addition', exact: true }).click();
  const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Approve NEAR key addition', exact: true }),
  ).toBeVisible();
  expect(scene.broadcasts).toBe(0);
  scene.observation = 'unavailable';
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByText('Unable to check NEAR activation', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve NEAR key addition', exact: true }),
  ).toHaveCount(0);
  scene.observation = 'enrolled';
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Key active', exact: true })).toBeVisible();
  await expect(
    page.getByText('Your key is active on NEAR. Signing can still require preparation.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await harness.runMlDsaCommand({ kind: 'default_signer' })).toEqual({ kind: 'ed25519' });
  expect(scene.broadcasts).toBe(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await key.getByRole('button', { name: 'Key details', exact: true }).click();
  const mlDetails = page.getByRole('region', { name: 'ML-DSA-65', exact: true });
  await expect(
    mlDetails.getByRole('textbox', { name: 'ML-DSA public key (base64url)', exact: true }),
  ).toHaveValue(scene.publicKeyB64u);
  await expect(
    mlDetails.getByText('Export contains the standard FIPS ML-DSA seed.', { exact: true }),
  ).toBeVisible();
  await mlDetails.getByRole('button', { name: 'Make default', exact: true }).click();
  await expect(
    mlDetails.getByRole('button', { name: 'Default signing key', exact: true }),
  ).toBeDisabled();
  expect(await harness.runMlDsaCommand({ kind: 'default_signer' })).toEqual({
    kind: 'near_ml_dsa_65',
    signingKeyId: scene.signingKeyId,
  });
  await page
    .getByTestId('intended-account-menu')
    .screenshot({ path: testInfo.outputPath('ml-dsa-key-details.png') });
  await mlDetails.getByRole('button', { name: 'Back', exact: true }).click();
  await page
    .getByRole('group', { name: 'Ed25519 signing key', exact: true })
    .getByRole('button', { name: 'Key details', exact: true })
    .click();
  const edDetails = page.getByRole('region', { name: 'Ed25519', exact: true });
  await edDetails.getByRole('button', { name: 'Make default', exact: true }).click();
  await expect(
    edDetails.getByRole('button', { name: 'Default signing key', exact: true }),
  ).toBeDisabled();
  expect(await harness.runMlDsaCommand({ kind: 'default_signer' })).toEqual({ kind: 'ed25519' });
  await testInfo.attach('ml-dsa-setup-navigation.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        scope:
          'Real Wallet registration and settings UI with controlled ML-DSA public metadata and NEAR enrollment responses. No ML-DSA key generation, signature, or export claim.',
        finishedLater: true,
        cancelledApproval: true,
        rpcOutageRecovered: true,
        enrollmentCheckedWithoutSubmission: scene.broadcasts === 0,
        defaultChangedOnlyByExplicitAction: true,
        defaultRestoredToEd25519: true,
        keyDetailsPublicBytesMatched: true,
        metadataReads: scene.metadataReads,
      },
      null,
      2,
    ),
  });
});

class MlDsaSettingsScene {
  observation: 'absent' | 'unavailable' | 'enrolled' = 'absent';
  broadcasts = 0;
  metadataReads = 0;
  private constructor(
    readonly entry: ReturnType<typeof parseMlDsaSignerInventoryEntry>,
    readonly publicKeyB64u: string,
    readonly signingKeyId: string,
    private readonly accessKeyHandle: string,
  ) {}

  static async create(walletId: string): Promise<MlDsaSettingsScene> {
    const evidence = requireRecord(
      JSON.parse(
        await readFile(
          new URL('../../../docs/evidence/ml-dsa-65-key-enrollment-20261021.json', import.meta.url),
          'utf8',
        ),
      ),
      'public enrollment fixture',
    );
    const publicKey = requireCanonicalString(evidence.mlDsaPublicKey, 'fixture public key');
    if (!publicKey.startsWith('ml-dsa-65:')) throw new Error('Unexpected fixture key algorithm');
    const publicKeyB64u = Buffer.from(base58Decode(publicKey.slice('ml-dsa-65:'.length))).toString(
      'base64url',
    );
    const signingKeyId = `settings-test:${walletId}`;
    const entry = parseMlDsaSignerInventoryEntry(
      {
        kind: 'published',
        key: {
          walletId,
          signingKeyId,
          keySet: 'near_ml_dsa_65_v1',
          publicKeyB64u,
          keyManifestDigestB64u: Buffer.alloc(32, 1).toString('base64url'),
          operationIdB64u: Buffer.alloc(32, 2).toString('base64url'),
          materialEpoch: 1,
        },
      },
      toWalletId(walletId),
    );
    return new MlDsaSettingsScene(
      entry,
      publicKeyB64u,
      signingKeyId,
      requireCanonicalString(evidence.expectedHandle, 'fixture key handle'),
    );
  }

  async metadata(route: Route): Promise<void> {
    this.metadataReads += 1;
    await route.fulfill({ json: { kind: 'inventory', entries: [this.entry] } });
  }

  async rpc(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') return route.fallback();
    const request = requireRecord(route.request().postDataJSON(), 'NEAR RPC request');
    if (request.method === 'send_tx') this.broadcasts += 1;
    if (request.method !== 'query') return route.fallback();
    const params = requireRecord(request.params, 'NEAR query');
    if (params.request_type !== 'view_access_key_list') return route.fallback();
    if (this.observation === 'unavailable') {
      await route.fulfill({ status: 503, json: { error: 'Controlled RPC outage' } });
      return;
    }
    const keys =
      this.observation === 'enrolled'
        ? [{ public_key: this.accessKeyHandle, access_key: { nonce: 0, permission: 'FullAccess' } }]
        : [];
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: { keys, block_height: 1, block_hash: '11111111111111111111111111111111' },
      },
    });
  }
}
