import { openDB } from 'idb';
import { SEAMS_WALLET_DB_NAME } from '../../../packages/wallet/src/core/indexedDB/walletDbName';
import { SEAMS_WALLET_STORES } from '../../../packages/wallet/src/core/indexedDB/schemaNames';
import { WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND } from '../../../packages/wallet/src/core/indexedDB/walletCustodyEd25519MaterialRecord';
import { parseWalletAuthorityV1 } from '../../../packages/shared-ts/src/authorization/walletAuthority';
import {
  requireRecord,
  requireNonEmptyString,
} from '../../../packages/shared-ts/src/utils/validation';

export type AuthoritySnapshot = {
  authorityId: string;
  digest: string;
  epoch: number;
  state: string;
  activationId: string;
};

export async function readAuthority(walletId: string): Promise<AuthoritySnapshot> {
  const database = await openDB(SEAMS_WALLET_DB_NAME);
  try {
    const rows: unknown[] = await database.getAllFromIndex(
      SEAMS_WALLET_STORES.walletAuthorities,
      'wallet_id',
      walletId,
    );
    if (rows.length !== 1) throw new Error('Expected one test wallet authority');
    const row = requireRecord(rows[0], 'authority row');
    const parsed = parseWalletAuthorityV1(row.record);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const authority = parsed.value;
    const activation = authority.signerActivations.ed25519;
    if (!activation) throw new Error('Expected an Ed25519 authority');
    return {
      authorityId: authority.authorityId,
      digest: authority.authorityDigestB64u,
      epoch: authority.revocationEpoch,
      state: authority.state,
      activationId: activation.materialActivation.activationId,
    };
  } finally {
    database.close();
  }
}

export async function removeCustodyCache(walletId: string): Promise<number> {
  const database = await openDB(SEAMS_WALLET_DB_NAME);
  try {
    const authorities: unknown[] = await database.getAllFromIndex(
      SEAMS_WALLET_STORES.walletAuthorities,
      'wallet_id',
      walletId,
    );
    if (authorities.length !== 1) throw new Error('Expected one authority checkpoint');
    sessionStorage.setItem('cold-custody-authority-checkpoint', JSON.stringify(authorities[0]));
    const transaction = database.transaction(SEAMS_WALLET_STORES.keyMaterial, 'readwrite');
    const rows: unknown[] = await transaction.store.getAll();
    let removed = 0;
    for (const raw of rows) {
      const row = requireRecord(raw, 'key material row');
      const record = requireRecord(row.record, 'key material record');
      if (record.keyKind !== WALLET_CUSTODY_ED25519_MATERIAL_KEY_KIND) continue;
      const payload = requireRecord(record.payload, 'custody cache payload');
      const binding = requireRecord(payload.binding, 'custody cache binding');
      if (binding.walletId !== walletId) continue;
      await transaction.store.delete(requireNonEmptyString(row.key_material_id, 'key material id'));
      removed += 1;
    }
    await transaction.done;
    return removed;
  } finally {
    database.close();
  }
}

/** Simulate recovery committing remotely before the browser saved its authority update. */
export async function restoreAuthorityCheckpoint(walletId: string): Promise<void> {
  const serialized = sessionStorage.getItem('cold-custody-authority-checkpoint');
  if (!serialized) throw new Error('Authority checkpoint is unavailable');
  const row = requireRecord(JSON.parse(serialized), 'authority checkpoint');
  const parsed = parseWalletAuthorityV1(row.record);
  if (!parsed.ok || parsed.value.walletId !== walletId)
    throw new Error('Authority checkpoint belongs to another wallet');
  const database = await openDB(SEAMS_WALLET_DB_NAME);
  try {
    await database.put(SEAMS_WALLET_STORES.walletAuthorities, row);
    sessionStorage.removeItem('cold-custody-authority-checkpoint');
  } finally {
    database.close();
  }
}
