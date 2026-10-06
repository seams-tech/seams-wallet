import { requireRecord } from '@shared/utils/validation';
import { SEAMS_WALLET_STORES, SEAMS_WALLET_INDEXES } from '../schemaNames';
import type { SeamsWalletTransactionContext } from './manager';
import { parseSealedAvailableClientPresignatureRow } from './ecdsaClientPresignatures';

async function readOwnershipGeneration(
  context: SeamsWalletTransactionContext,
  walletId: string,
): Promise<number> {
  const raw = await context
    .store(SEAMS_WALLET_STORES.appState)
    .get(`wallet_ownership_generation:${walletId}`);
  if (raw === undefined) return 1;
  const record = requireRecord(raw, 'Wallet ownership generation');
  const generation = record.value;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('Stored wallet ownership generation is invalid');
  }
  return generation;
}

export async function assertWalletOwnershipGeneration(
  context: SeamsWalletTransactionContext,
  walletId: string,
  generation: number,
): Promise<void> {
  if ((await readOwnershipGeneration(context, walletId)) !== generation) {
    throw new Error('Wallet ownership generation requires fresh authentication');
  }
}

export async function acceptWalletOwnershipGeneration(
  context: SeamsWalletTransactionContext,
  walletId: string,
  generation: number,
): Promise<void> {
  const current = await readOwnershipGeneration(context, walletId);
  if (generation < current) {
    throw new Error('Wallet session belongs to an obsolete ownership generation');
  }
  if (generation === current) return;
  await context.store(SEAMS_WALLET_STORES.appState).put({
    key: `wallet_ownership_generation:${walletId}`,
    value: generation,
  });
  const store = context.store(SEAMS_WALLET_STORES.ecdsaClientPresignatures);
  let cursor = await store.index(SEAMS_WALLET_INDEXES.walletId).openCursor(walletId);
  while (cursor) {
    let obsolete = true;
    try {
      const row = parseSealedAvailableClientPresignatureRow(cursor.value);
      obsolete = row.pool_identity.ownershipGeneration < generation;
    } catch {
      // Malformed material cannot be used after ownership changes.
    }
    if (obsolete) await cursor.delete();
    cursor = await cursor.continue();
  }
}
