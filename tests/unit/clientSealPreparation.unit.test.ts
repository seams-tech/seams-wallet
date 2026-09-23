import { expect, test } from '@playwright/test';
import { ClientSealPreparations } from '../../packages/wallet/src/core/signingEngine/workerManager/workers/shamir3pass/clientSealPreparation';
import type { Shamir3PassRuntime } from '../../packages/wallet/src/core/signingEngine/workerManager/workers/shamir3pass/runtime';

const secret = Buffer.alloc(32, 7).toString('base64url');
const otherSecret = Buffer.alloc(32, 8).toString('base64url');

class SealRuntime implements Shamir3PassRuntime {
  created = 0;
  destroyed: string[] = [];
  failSeal = false;
  private releaseSeal: () => void = ignoreRelease;
  private held: Promise<void> = Promise.resolve();

  hold(): void {
    this.held = new Promise<void>(this.saveRelease.bind(this));
  }
  private saveRelease(resolve: () => void): void {
    this.releaseSeal = resolve;
  }
  release(): void {
    this.releaseSeal();
  }
  async get(): Promise<Shamir3PassRuntime> {
    return this;
  }
  async createClientKeyHandle(): Promise<{ keyHandle: string }> {
    return { keyHandle: `key-${++this.created}` };
  }
  async destroyClientKeyHandle(args: { keyHandle: string }): Promise<void> {
    this.destroyed.push(args.keyHandle);
  }
  async addClientSealWithKeyHandle(): Promise<string> {
    await this.held;
    if (this.failSeal) throw new Error('injected seal failure');
    return 'ciphertext';
  }
  async addClientSealBytesWithKeyHandle(): Promise<string> {
    throw new Error('unused');
  }
  async removeClientSealWithKeyHandle(): Promise<string> {
    throw new Error('unused');
  }
  async removeClientSealWithKeyHandleToBytes(): Promise<Uint8Array> {
    throw new Error('unused');
  }
}
function ignoreRelease(): void {}

test('prepared seal transfers one owned key to the exact session and factor', async () => {
  const runtime = new SealRuntime();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  await preparations.prepare('near', 'first', secret);
  const seal = await preparations.take('near', secret);
  await preparations.discard('near', 'first');
  expect(runtime.created).toBe(1);
  expect(runtime.destroyed).toEqual([]);
  await seal.runtime.destroyClientKeyHandle({ keyHandle: seal.keyHandle });
  expect(runtime.destroyed).toEqual(['key-1']);
});

test('prepared ciphertext can be read without consuming its exact preparation', async () => {
  const runtime = new SealRuntime();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  await preparations.prepare('near', 'first', secret);
  expect(await preparations.readCiphertext('near', 'first')).toBe('ciphertext');
  await expect(preparations.takeExact('near', 'other', secret)).rejects.toThrow('unavailable');
  expect(runtime.destroyed).toEqual([]);
  const seal = await preparations.takeExact('near', 'first', secret);
  await seal.runtime.destroyClientKeyHandle({ keyHandle: seal.keyHandle });
  expect(runtime.destroyed).toEqual(['key-1']);
});

test('factor mismatch destroys the prepared key', async () => {
  const runtime = new SealRuntime();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  await preparations.prepare('near', 'first', secret);
  await expect(preparations.take('near', otherSecret)).rejects.toThrow('factor mismatch');
  expect(runtime.destroyed).toEqual(['key-1']);
});

test('discard during computation destroys a late key and cannot discard a newer preparation', async () => {
  const runtime = new SealRuntime();
  runtime.hold();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  const preparing = preparations.prepare('near', 'first', secret);
  const rejected = expect(preparing).rejects.toThrow('discarded');
  const discarded = preparations.discard('near', 'first');
  runtime.release();
  await rejected;
  await discarded;
  await preparations.prepare('near', 'second', secret);
  await preparations.discard('near', 'first');
  expect(runtime.destroyed).toEqual(['key-1']);
  await preparations.discard('near', 'second');
  expect(runtime.destroyed).toEqual(['key-1', 'key-2']);
});

test('lock clears pending preparation and seal failure destroys its key', async () => {
  const runtime = new SealRuntime();
  runtime.hold();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  const preparing = preparations.prepare('near', 'first', secret);
  const rejected = expect(preparing).rejects.toThrow('discarded');
  preparations.clear();
  runtime.release();
  await rejected;
  await expect.poll(() => runtime.destroyed.length).toBe(1);
  runtime.failSeal = true;
  await expect(preparations.prepare('near', 'second', secret)).rejects.toThrow(
    'injected seal failure',
  );
  expect(runtime.destroyed).toEqual(['key-1', 'key-2']);
});

test('abandoned preparation expires and destroys its temporary key', async () => {
  const runtime = new SealRuntime();
  const preparations = new ClientSealPreparations(runtime.get.bind(runtime));
  await preparations.prepare('near', 'abandoned', secret);
  await expect
    .poll(() => runtime.destroyed, { timeout: 35_000, intervals: [1000] })
    .toEqual(['key-1']);
});
