import { expect, type Page, type Request, type TestInfo } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { writeFile } from 'node:fs/promises';
import type { IntendedBehaviourHarness } from './harness';
import { walletFrame } from './session-restore-lock';

// Return presignature identifiers only. Signing material stays in the wallet origin.
class DurablePresignatureProbe {
  static read(walletId: string, format: 'current' | 'initial' = 'current'): Promise<string[]> {
    return new Promise(DurablePresignatureProbe.open.bind(null, walletId, format));
  }

  static open(
    walletId: string,
    format: 'current' | 'initial',
    resolve: (keys: string[]) => void,
    reject: (error: unknown) => void,
  ): void {
    const request = indexedDB.open('seams_wallet');
    request.onsuccess = DurablePresignatureProbe.opened.bind(
      null,
      walletId,
      format,
      request,
      resolve,
      reject,
    );
    request.onerror = DurablePresignatureProbe.failed.bind(null, request, reject);
  }

  static failed(request: IDBRequest, reject: (error: unknown) => void): void {
    reject(request.error);
  }

  static opened(
    walletId: string,
    format: 'current' | 'initial',
    request: IDBOpenDBRequest,
    resolve: (keys: string[]) => void,
    reject: (error: unknown) => void,
  ): void {
    const database = request.result;
    const transaction = database.transaction(
      'ecdsa_client_presignatures',
      format === 'initial' ? 'readwrite' : 'readonly',
    );
    const keys = transaction
      .objectStore('ecdsa_client_presignatures')
      .index('wallet_id')
      .getAll(walletId);
    keys.onsuccess = DurablePresignatureProbe.keysRead.bind(
      null,
      database,
      transaction,
      format,
      keys,
      resolve,
      reject,
    );
    keys.onerror = DurablePresignatureProbe.readFailed.bind(null, database, keys, reject);
  }

  static readFailed(
    database: IDBDatabase,
    request: IDBRequest,
    reject: (error: unknown) => void,
  ): void {
    database.close();
    reject(request.error);
  }

  static keysRead(
    database: IDBDatabase,
    transaction: IDBTransaction,
    format: 'current' | 'initial',
    request: IDBRequest<unknown[]>,
    resolve: (keys: string[]) => void,
    reject: (error: unknown) => void,
  ): void {
    database.close();
    const keys: string[] = [];
    for (const row of request.result) {
      if (
        typeof row !== 'object' ||
        row === null ||
        !('presignature_id' in row) ||
        typeof row.presignature_id !== 'string'
      ) {
        reject(new Error('Durable presignature identifier is not a string'));
        return;
      }
      if (format === 'initial') {
        DurablePresignatureProbe.useInitialFormat(row);
        transaction.objectStore('ecdsa_client_presignatures').put(row);
      }
      keys.push(row.presignature_id);
    }
    transaction.oncomplete = resolve.bind(null, keys.sort());
    transaction.onabort = reject.bind(null, new Error('Presignature storage probe aborted'));
  }

  static useInitialFormat(row: object): void {
    if (
      !('pool_identity' in row) ||
      typeof row.pool_identity !== 'object' ||
      row.pool_identity === null ||
      !('ownershipGeneration' in row.pool_identity) ||
      row.pool_identity.ownershipGeneration !== 1 ||
      !('pool_identity_key' in row) ||
      typeof row.pool_identity_key !== 'string' ||
      !row.pool_identity_key.endsWith('|1')
    )
      throw new Error('Expected a current generation-1 presignature');
    Reflect.deleteProperty(row.pool_identity, 'ownershipGeneration');
    row.pool_identity_key = row.pool_identity_key.slice(0, -2);
  }
}

async function readPresignatureIds(
  page: Page,
  walletId: string,
  format: 'current' | 'initial' = 'current',
): Promise<string[]> {
  const frame = await walletFrame(page);
  return await frame.evaluate(
    ({ source, walletId, format }) => {
      const probe = eval(`(${source})`) as typeof DurablePresignatureProbe;
      return probe.read(walletId, format);
    },
    { source: DurablePresignatureProbe.toString(), walletId, format },
  );
}

export async function verifyLockPreservesPresignatures(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(180_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await expect
    .poll(readPresignatureCount.bind(null, page, harness.walletId), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const before = await readPresignatureIds(page, harness.walletId, 'initial');
  await harness.lockWallet();
  await harness.assertWalletLocked();
  const locked = await readPresignatureIds(page, harness.walletId);
  expect(locked).toEqual(expect.arrayContaining(before));
  await harness.unlockPasskeyWallet();
  const unlocked = await readPresignatureIds(page, harness.walletId);
  expect(unlocked).toEqual(expect.arrayContaining(before));
  const preparation = page.waitForRequest(isEcdsaPreparation);
  await harness.signTempoTransaction('post_unlock');
  const request: unknown = (await preparation).postDataJSON();
  if (!isPlainObject(request) || typeof request.client_presignature_id !== 'string') {
    throw new Error('ECDSA preparation omitted its presignature identifier');
  }
  expect(before).toContain(request.client_presignature_id);
  const afterSigning = await readPresignatureIds(page, harness.walletId);
  expect(afterSigning).not.toContain(request.client_presignature_id);
  await writeFile(
    testInfo.outputPath('lock-presignature-retention.json'),
    JSON.stringify(
      {
        beforeLock: before.length,
        whileLocked: locked.length,
        afterUnlock: unlocked.length,
        allOriginalRecordsRetained: true,
        signingConsumedRetainedPresignature: true,
        initialGenerationStorageUpgrade: true,
        postUnlockTempoSigning: 'passed',
        scope: 'Immediate lock and fresh unlock; the separate 30-day return gate remains open.',
      },
      null,
      2,
    ),
  );
}

function isEcdsaPreparation(request: Request): boolean {
  return (
    request.method() === 'POST' &&
    new URL(request.url()).pathname === '/router-ab/ecdsa-derivation/sign/prepare'
  );
}

async function readPresignatureCount(page: Page, walletId: string): Promise<number> {
  return (await readPresignatureIds(page, walletId)).length;
}
