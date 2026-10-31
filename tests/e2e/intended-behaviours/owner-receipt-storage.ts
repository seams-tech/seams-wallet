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
