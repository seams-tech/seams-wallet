import type { WalletId } from '@shared/utils/domainIds';
import type { D1WalletStoreScope } from './d1WalletStore';
import { parseWalletEcdsaSignerRecord, type WalletEcdsaSignerRecord } from './WalletStore';
import { parseD1JsonColumn } from '../storage/d1Sql';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../storage/tenantRoute';

export function prepareWalletEcdsaSignersRead(
  database: D1DatabaseLike,
  scope: D1WalletStoreScope,
  walletId: WalletId,
): D1PreparedStatementLike {
  return database.prepare(
    `SELECT record_json FROM wallet_signers
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND wallet_id = ? AND signer_family = 'ecdsa'
      ORDER BY signer_id`,
  ).bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId);
}

export function parseWalletEcdsaSignerRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  walletId: WalletId,
): readonly WalletEcdsaSignerRecord[] {
  const signers: WalletEcdsaSignerRecord[] = [];
  for (const row of rows) {
    const signer = parseWalletEcdsaSignerRecord(parseD1JsonColumn(row.record_json));
    if (!signer || signer.walletId !== walletId) {
      throw new Error('Wallet ECDSA signer record is invalid');
    }
    signers.push(signer);
  }
  return signers;
}
