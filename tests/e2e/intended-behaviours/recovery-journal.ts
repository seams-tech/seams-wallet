import type { CDPSession, Frame } from '@playwright/test';
import { isObject, requireNonEmptyString } from '@shared/utils/validation';
import { SEAMS_WALLET_STORES } from '../../../packages/wallet/src/core/indexedDB/schemaNames';
import { SEAMS_WALLET_DB_NAME } from '../../../packages/wallet/src/core/indexedDB/walletDbName';

type PendingWalletRecoveryCommitIdentity = {
  readonly walletId: string;
  readonly recoveryOperationId: string;
  readonly stage: string;
};

function journalIdentity(this: {
  value: { wallet_id: unknown; recovery_operation_id: unknown; stage: unknown };
}): unknown {
  return {
    walletId: this.value.wallet_id,
    recoveryOperationId: this.value.recovery_operation_id,
    stage: this.value.stage,
  };
}

export async function readPendingWalletRecoveryCommitIdentity(
  session: CDPSession,
  frame: Frame,
  recoveryOperationId: string,
): Promise<PendingWalletRecoveryCommitIdentity | null> {
  // The harness owns this session. Detaching another session can remove its virtual authenticator.
  const securityOrigin = new URL(frame.url()).origin;
  const { databaseNames } = await session.send('IndexedDB.requestDatabaseNames', {
    securityOrigin,
  });
  let databaseName: string | null = null;
  for (const name of databaseNames) {
    if (name !== SEAMS_WALLET_DB_NAME && !name.startsWith('seams_test_wallet_')) continue;
    if (databaseName) throw new Error('Recovery evidence found more than one wallet database');
    databaseName = name;
  }
  if (!databaseName) throw new Error('Recovery evidence requires the wallet database');
  const key = {
    type: 'string' as const,
    string: `pending_wallet_recovery_commit_v1:${recoveryOperationId}`,
  };
  const records = await session.send('IndexedDB.requestData', {
    securityOrigin,
    databaseName,
    objectStoreName: SEAMS_WALLET_STORES.appState,
    indexName: '',
    skipCount: 0,
    pageSize: 1,
    keyRange: { lower: key, upper: key, lowerOpen: false, upperOpen: false },
  });
  if (records.objectStoreDataEntries.length === 0) return null;
  const objectId = records.objectStoreDataEntries[0].value.objectId;
  if (!objectId) throw new Error('Recovery journal row is not an object');
  try {
    // Read only identity metadata from the live row. Custody data stays in the browser.
    const result = await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: journalIdentity.toString(),
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error('Recovery journal identity could not be read');
    const identity: unknown = result.result.value;
    if (!isObject(identity)) throw new Error('Recovery journal identity is malformed');
    return {
      walletId: requireNonEmptyString(identity.walletId, 'recovery journal wallet'),
      recoveryOperationId: requireNonEmptyString(
        identity.recoveryOperationId,
        'recovery operation',
      ),
      stage: requireNonEmptyString(identity.stage, 'recovery journal stage'),
    };
  } finally {
    await session.send('Runtime.releaseObject', { objectId });
  }
}
