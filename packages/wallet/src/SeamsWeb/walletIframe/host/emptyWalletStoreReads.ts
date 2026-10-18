import { SEAMS_WALLET_DB_NAME } from '@/core/indexedDB/walletDbName';
import { DEFAULT_CONFIRMATION_CONFIG } from '@/core/types/signer-worker';
import type { GetRecentUnlocksResult } from '@/core/types/seams';
import { buildAnonymousWalletSession } from '@/SeamsWeb/publicApi/session';
import type { WalletIframeExactSessionSnapshot } from '../shared/exactSessionState';
import type { PreferencesChangedPayload } from '../shared/messages';
import type { RuntimeWalletHostRoute } from './requestRouter';
import { nextSessionObservationRevision } from './sessionObservationRevision';

/**
 * The reads a parent sends when it connects. While this origin stores no wallet,
 * the boot answers them with the values the wallet runtime would return, so a
 * signed-out visitor does not download the runtime.
 */
export type EmptyWalletStoreRead = RuntimeWalletHostRoute & {
  readonly type:
    'PM_GET_EXACT_WALLET_SESSION_STATE' | 'PM_GET_RECENT_UNLOCKS' | 'PM_GET_CONFIRMATION_CONFIG';
};

export function isEmptyWalletStoreRead(
  route: RuntimeWalletHostRoute,
): route is EmptyWalletStoreRead {
  switch (route.type) {
    case 'PM_GET_RECENT_UNLOCKS':
    case 'PM_GET_CONFIRMATION_CONFIG':
      return true;
    case 'PM_GET_EXACT_WALLET_SESSION_STATE': {
      // An exact-wallet read and a malformed payload keep the runtime's answer.
      const payload: unknown = route.request.payload;
      if (!payload || typeof payload !== 'object') return false;
      const read = Reflect.get(payload, 'authenticationRead');
      const wallet: unknown = Reflect.get(payload, 'wallet');
      return (
        (read === 'restore' || read === 'current') &&
        !!wallet &&
        typeof wallet === 'object' &&
        Reflect.get(wallet, 'kind') === 'current'
      );
    }
    default:
      return false;
  }
}

export function answerEmptyWalletStoreRead(read: EmptyWalletStoreRead): unknown {
  switch (read.type) {
    case 'PM_GET_EXACT_WALLET_SESSION_STATE':
      return {
        revision: nextSessionObservationRevision(),
        walletId: null,
        state: { kind: 'wallet_locked' },
        session: buildAnonymousWalletSession(),
      } satisfies WalletIframeExactSessionSnapshot;
    case 'PM_GET_RECENT_UNLOCKS':
      return {
        walletIds: [],
        accountIds: [],
        accounts: [],
        lastUsedAccount: null,
      } satisfies GetRecentUnlocksResult;
    case 'PM_GET_CONFIRMATION_CONFIG':
      // Revision 0 is the runtime's starting revision; its first publication is newer.
      return {
        walletId: null,
        confirmationConfig: DEFAULT_CONFIRMATION_CONFIG,
        revision: 0,
      } satisfies PreferencesChangedPayload;
  }
}

let pendingProbe: Promise<boolean> | null = null;

/**
 * Resolves true only when this origin provably stores no wallet: the wallet
 * database is absent, or every store in it is empty. Any doubt resolves false,
 * and the request goes to the wallet runtime. The probe never creates the
 * database.
 */
export function walletStoreIsEmpty(): Promise<boolean> {
  pendingProbe ??= probeWalletStore().finally(clearPendingProbe);
  return pendingProbe;
}

function clearPendingProbe(): void {
  pendingProbe = null;
}

async function probeWalletStore(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
      return false;
    }
    const databases = await indexedDB.databases();
    if (!databases.some(isWalletDatabase)) return true;
    return await existingWalletDatabaseIsEmpty();
  } catch {
    return false;
  }
}

function isWalletDatabase(database: IDBDatabaseInfo): boolean {
  return database.name === SEAMS_WALLET_DB_NAME;
}

function existingWalletDatabaseIsEmpty(): Promise<boolean> {
  return new Promise((resolve) => {
    // Without a version, open never upgrades an existing database. An upgrade
    // event means the database vanished after the listing: abort it, so that
    // this read does not create it, and leave the request to the runtime.
    const request = indexedDB.open(SEAMS_WALLET_DB_NAME);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      countRecords(database).then(
        (records) => {
          database.close();
          resolve(records === 0);
        },
        () => {
          database.close();
          resolve(false);
        },
      );
    };
  });
}

function countRecords(database: IDBDatabase): Promise<number> {
  const storeNames = Array.from(database.objectStoreNames);
  if (storeNames.length === 0) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, 'readonly');
    let records = 0;
    for (const storeName of storeNames) {
      const count = transaction.objectStore(storeName).count();
      count.onsuccess = () => {
        records += count.result;
      };
    }
    transaction.oncomplete = () => resolve(records);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
