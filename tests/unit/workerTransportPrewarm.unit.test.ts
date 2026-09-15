import { expect, test } from '@playwright/test';
import { WorkerTransport } from '../../packages/wallet/src/core/signingEngine/workerManager/workerTransport';

test('signing worker prewarm waits for the NEAR and ECDSA WASM runtimes', async () => {
  const createdWorkerNames: string[] = [];
  const originalWorker = globalThis.Worker;

  class ReadyWorker {
    private readonly messageListeners = new Set<EventListener>();

    constructor(_url: string | URL, options?: WorkerOptions) {
      createdWorkerNames.push(options?.name ?? 'unnamed-worker');
    }

    addEventListener(type: string, listener: EventListener): void {
      if (type !== 'message') return;
      this.messageListeners.add(listener);
      queueMicrotask(() => {
        listener(
          new MessageEvent('message', {
            data: { type: 'WORKER_READY', ready: true },
          }),
        );
      });
    }

    removeEventListener(type: string, listener: EventListener): void {
      if (type === 'message') this.messageListeners.delete(listener);
    }

    postMessage(): void {}

    terminate(): void {
      this.messageListeners.clear();
    }
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: ReadyWorker,
  });

  try {
    const transport = new WorkerTransport();
    await transport.prewarmWorkers();
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }

  expect(createdWorkerNames).toEqual(
    expect.arrayContaining([
      'Web3AuthnSignerWorker',
      'Web3AuthnEcdsaDerivationClientWorker',
      'evmCrypto-worker',
      'tempoSigner-worker',
    ]),
  );
});
