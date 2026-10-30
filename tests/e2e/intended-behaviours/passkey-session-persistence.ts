import {
  expect,
  type BrowserContext,
  type CDPSession,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SEAMS_WALLET_DB_NAME } from '../../../packages/wallet/src/core/indexedDB/walletDbName';
import { SEAMS_WALLET_STORES } from '../../../packages/wallet/src/core/indexedDB/schemaNames';
import type { IntendedBehaviourHarness } from './harness';

function disableSigningSessionPersistence(): void {
  if (window.location.pathname !== '/__intended-e2e') return;
  const url = new URL(window.location.href);
  url.searchParams.set('signingSessionPersistenceMode', 'none');
  window.history.replaceState(window.history.state, '', url);
}

async function countSessionSeals(session: CDPSession, page: Page): Promise<number> {
  const iframe = await page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error('Wallet iframe is unavailable');
  const metadata = await session.send('IndexedDB.getMetadata', {
    securityOrigin: new URL(frame.url()).origin,
    databaseName: SEAMS_WALLET_DB_NAME,
    objectStoreName: SEAMS_WALLET_STORES.signingSessionSeals,
  });
  return metadata.entriesCount;
}

export async function verifyMemoryOnlyPasskeyUnlock(
  {
    harness,
    context,
    page,
  }: { harness: IntendedBehaviourHarness; context: BrowserContext; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  const session = await context.newCDPSession(page);
  try {
    await harness.registerPasskeyWallet();
    await harness.awaitNearReady();
    await harness.unlockPasskeyWallet();
    const sealsBeforeUnlock = await countSessionSeals(session, page);
    expect(sealsBeforeUnlock).toBeGreaterThan(0);

    await context.addInitScript(disableSigningSessionPersistence);
    await harness.unlockPasskeyWallet();
    await harness.signNearTransaction('post_unlock');
    await harness.signTempoAndArcEvmConcurrently('post_unlock');

    const sealsAfterSigning = await countSessionSeals(session, page);
    expect(sealsAfterSigning).toBe(sealsBeforeUnlock);
    const artifactPath = path.resolve(
      testInfo.config.rootDir,
      '../.artifacts/passkey-session-persistence/receipt.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          kind: 'memory_only_passkey_unlock_v1',
          signingSessionPersistenceMode: 'none',
          unlock: 'succeeded',
          verifiedSignatures: ['near', 'tempo', 'arc_evm'],
          sealedModeUnlock: 'succeeded',
          sealsBeforeUnlock,
          sealsAfterSigning,
          reproduce:
            "SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.unlock.contract.test.ts --grep 'passkey unlock with persistence disabled'",
        },
        null,
        2,
      ) + '\n',
    );
    await testInfo.attach('memory-only-passkey-unlock', {
      path: artifactPath,
      contentType: 'application/json',
    });
  } finally {
    await session.detach();
  }
}
