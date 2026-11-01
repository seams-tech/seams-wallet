import type { Page } from '@playwright/test';
import { walletFrame } from './session-restore-lock';

type ReceiptKind = 'approving' | 'settled';

// Runs in the wallet frame. The receipt contents come from the real signing flow.
class OwnerReceiptWriteFault {
  private static state:
    | { kind: 'disabled' }
    | {
        kind: 'active';
        receiptKind: ReceiptKind;
        originalPut: IDBObjectStore['put'];
        failedWrites: number;
      };

  static initialize(): void {
    this.state = { kind: 'disabled' };
  }

  static install(receiptKind: ReceiptKind): void {
    if (this.state.kind !== 'disabled') throw new Error('A receipt write fault is already active.');
    this.state = {
      kind: 'active',
      receiptKind,
      originalPut: IDBObjectStore.prototype.put,
      failedWrites: 0,
    };
    IDBObjectStore.prototype.put = OwnerReceiptWriteFault.put;
  }

  static put(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>): IDBRequest {
    const state = OwnerReceiptWriteFault.state;
    if (state.kind !== 'active') throw new Error('The receipt write fault is inactive.');
    const [row] = args;
    if (row && typeof row === 'object') {
      const key: unknown = Reflect.get(row, 'key');
      const value: unknown = Reflect.get(row, 'value');
      if (
        typeof key === 'string' &&
        key.startsWith('owner-near:') &&
        value &&
        typeof value === 'object' &&
        Reflect.get(value, 'kind') === state.receiptKind
      ) {
        state.failedWrites += 1;
        throw new DOMException('Injected owner receipt write failure', 'QuotaExceededError');
      }
    }
    return Reflect.apply(state.originalPut, this, args);
  }

  static restore(): number {
    const state = this.state;
    if (state.kind !== 'active') throw new Error('The receipt write fault is inactive.');
    IDBObjectStore.prototype.put = state.originalPut;
    this.state = { kind: 'disabled' };
    return state.failedWrites;
  }
}

export async function failOwnerReceiptWrites(page: Page, receiptKind: ReceiptKind): Promise<void> {
  const frame = await walletFrame(page);
  if (!(await frame.evaluate(hasReceiptWriteProbe))) {
    await frame.addScriptTag({
      content: `${OwnerReceiptWriteFault.toString()}\nOwnerReceiptWriteFault.initialize();`,
    });
  }
  await frame.evaluate(installReceiptWriteFault, receiptKind);
}

export async function restoreOwnerReceiptWrites(page: Page): Promise<number> {
  return await (await walletFrame(page)).evaluate(restoreReceiptWriteFault);
}

function hasReceiptWriteProbe(): boolean {
  return typeof OwnerReceiptWriteFault !== 'undefined';
}

function installReceiptWriteFault(receiptKind: ReceiptKind): void {
  OwnerReceiptWriteFault.install(receiptKind);
}

function restoreReceiptWriteFault(): number {
  return OwnerReceiptWriteFault.restore();
}

/** Rewrite a real receipt to the hash-only shape that earlier SDK versions stored. */
export async function stripOwnerReceiptEvidence(page: Page, operationId: string): Promise<void> {
  await (await walletFrame(page)).evaluate(stripReceiptEvidence, `owner-near:${operationId}`);
}

async function stripReceiptEvidence(key: string): Promise<void> {
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith('seams')) continue;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('app_state')) continue;
      const store = database.transaction('app_state', 'readwrite').objectStore('app_state');
      const stripped = await new Promise<boolean>((resolve, reject) => {
        const read = store.get(key);
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const row: unknown = read.result;
          if (!row || typeof row !== 'object') return resolve(false);
          const value: unknown = Reflect.get(row, 'value');
          if (!value || typeof value !== 'object') return resolve(false);
          Reflect.deleteProperty(value, 'evidence');
          const write = store.put(row);
          write.onerror = () => reject(write.error);
          write.onsuccess = () => resolve(true);
        };
      });
      if (stripped) return;
    } finally {
      database.close();
    }
  }
  throw new Error('The owner receipt does not exist.');
}

/** Rewrite real records to the RPC URL binding that SDK 0.40.0 and earlier stored. */
export async function rewriteOwnerRecordsToLegacyBinding(
  page: Page,
  operationId: string,
  legacyBinding: string,
): Promise<void> {
  await (await walletFrame(page)).evaluate(rewriteRecordsToLegacyBinding, {
    operationId,
    legacyBinding,
  });
}

async function rewriteRecordsToLegacyBinding(input: {
  operationId: string;
  legacyBinding: string;
}): Promise<void> {
  const receiptKey = `owner-near:${input.operationId}`;
  const settled = <T>(request: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith('seams')) continue;
    const database = await settled(indexedDB.open(name));
    try {
      if (!database.objectStoreNames.contains('app_state')) continue;
      const store = database.transaction('app_state', 'readwrite').objectStore('app_state');
      const receipt: unknown = await settled(store.get(receiptKey));
      if (!receipt || typeof receipt !== 'object') continue;
      await settled(
        store.put({
          key: receiptKey,
          value: { ...Reflect.get(receipt, 'value'), binding: input.legacyBinding },
        }),
      );
      const rows: unknown[] = await settled(store.getAll());
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const key: unknown = Reflect.get(row, 'key');
        const value: unknown = Reflect.get(row, 'value');
        if (
          typeof key !== 'string' ||
          !key.startsWith('owner-near-pending:') ||
          !value ||
          typeof value !== 'object' ||
          Reflect.get(Reflect.get(value, 'recovery') ?? {}, 'operationId') !== input.operationId
        )
          continue;
        await settled(store.delete(key));
        await settled(store.put({ key: `owner-near-pending:${input.legacyBinding}`, value }));
        return;
      }
      throw new Error('The pending owner record does not exist.');
    } finally {
      database.close();
    }
  }
  throw new Error('The owner receipt does not exist.');
}
