import { reconcileWalletPlacement } from '../../../packages/wallet/src/SeamsWeb/walletIframe/host/reconcileWalletPlacement';
import { parseWalletPlacement } from '../../../packages/wallet/src/SeamsWeb/publicApi/placement';
import { parseWalletId } from '../../../packages/shared-ts/src/utils/domainIds';
import { configureIndexedDB } from '../../../packages/wallet/src/core/indexedDB';
import type { SeamsWalletTransactionContext } from '../../../packages/wallet/src/core/indexedDB/seamsWalletDB/manager';
import { seamsWalletDB } from '../../../packages/wallet/src/core/indexedDB/singletons';
import { SEAMS_WALLET_STORES as stores } from '../../../packages/wallet/src/core/indexedDB/schemaNames';
import { acceptWalletOwnershipGeneration } from '../../../packages/wallet/src/core/indexedDB/seamsWalletDB/walletOwnershipGeneration';
import { IndexedDbEcdsaCapabilityManifestStore } from '../../../packages/wallet/src/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import {
  decryptPresignatureBytes,
  metadataFromPresignatureRow,
  parseSealedAvailableClientPresignatureRow,
} from '../../../packages/wallet/src/core/indexedDB/seamsWalletDB/ecdsaClientPresignatures';
import { parseSealingKeyRow } from '../../../packages/wallet/src/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestRecords';
import { parseEcdsaClientPresignPoolIdentity } from '../../../packages/wallet/src/core/signingEngine/workerManager/ecdsaPresignPoolIdentity';
import { base64UrlDecode } from '../../../packages/shared-ts/src/utils/base64';

async function accept(walletId: string, generation: number): Promise<void> {
  await seamsWalletDB.runTransaction(
    [stores.appState, stores.ecdsaClientPresignatures],
    'readwrite',
    acceptInTransaction.bind(null, walletId, generation),
  );
}

function acceptInTransaction(
  walletId: string,
  generation: number,
  context: SeamsWalletTransactionContext,
): Promise<void> {
  return acceptWalletOwnershipGeneration(context, walletId, generation);
}

export async function count(walletId: string): Promise<number> {
  configureIndexedDB({ mode: 'wallet' });
  const db = await seamsWalletDB.getDB();
  return db.countFromIndex(stores.ecdsaClientPresignatures, 'wallet_id', walletId);
}

export async function run(walletId: string) {
  configureIndexedDB({ mode: 'wallet' });
  const db = await seamsWalletDB.getDB();
  const raw = await db.getFromIndex(stores.ecdsaClientPresignatures, 'wallet_id', walletId);
  const row = parseSealedAvailableClientPresignatureRow(raw);
  const metadata = metadataFromPresignatureRow(row);
  const key = parseSealingKeyRow(
    await db.get(stores.ecdsaMaterialSealingKeys, metadata.sealingKeyId),
  );
  const plaintext97 = await decryptPresignatureBytes({
    key: key.key,
    metadata,
    sealed: row.sealed,
  });
  const storage = new IndexedDbEcdsaCapabilityManifestStore();
  const input = {
    poolIdentity: metadata.poolIdentity,
    durableMaterialRef: metadata.durableMaterialRef,
    presignatureId: metadata.presignatureId,
    groupPublicKey33: base64UrlDecode(metadata.groupPublicKey33B64u),
    bigR33: base64UrlDecode(metadata.bigR33B64u),
    plaintext97,
    createdAtMs: metadata.createdAtMs,
    expiresAtMs: metadata.expiresAtMs,
  };
  try {
    await observeMove(walletId);
    const afterAdvance = await count(walletId);
    const delayedOldAdmission = await storage.admitClientPresignature(input);
    const oldAvailable = await storage.listAvailableClientPresignatures(metadata.poolIdentity);
    await observeMove(walletId);
    let rollbackRejected = false;
    try {
      await accept(walletId, 1);
    } catch {
      rollbackRejected = true;
    }
    input.poolIdentity = parseEcdsaClientPresignPoolIdentity({
      ...metadata.poolIdentity,
      ownershipGeneration: 2,
    });
    const currentAdmission = await storage.admitClientPresignature(input);
    if (currentAdmission.kind !== 'stored') throw new Error('Current generation admission failed');
    const consumed = await storage.takeClientPresignature({
      recordId: currentAdmission.metadata.recordId,
      poolIdentity: input.poolIdentity,
    });
    if (consumed.kind === 'opened') consumed.plaintext97.fill(0);
    return {
      afterAdvance,
      delayedOldAdmission: delayedOldAdmission.kind,
      oldAvailable: oldAvailable.length,
      rollbackRejected,
      currentAdmission: currentAdmission.kind,
      currentConsumption: consumed.kind,
    };
  } finally {
    plaintext97.fill(0);
    input.groupPublicKey33.fill(0);
    input.bigR33.fill(0);
  }
}

export async function advance(walletId: string): Promise<void> {
  configureIndexedDB({ mode: 'wallet' });
  await observeMove(walletId);
}

async function observeMove(rawWalletId: string): Promise<void> {
  const wallet = parseWalletId(rawWalletId);
  if (!wallet.ok) throw new Error('Browser probe wallet is invalid');
  const placement = parseWalletPlacement({
    state: 'moving',
    move: {
      moveId: `wmove_${'P'.repeat(43)}`,
      sourceRegion: 'US',
      destinationRegion: 'APAC',
      sourceGeneration: 1,
      destinationGeneration: 2,
      admittedAtMs: 1000,
      nextMoveAtMs: 2000,
      progress: { state: 'freezing', availability: 'paused', execution: { state: 'running' } },
    },
  });
  await reconcileWalletPlacement(wallet.value, placement);
}
