import { expect, test } from '@playwright/test';
import { WorkerTransport } from '../../packages/wallet/src/core/signingEngine/workerManager/workerTransport';

const PREWARM_ECDSA_REGISTRATION_CRYPTO = 70_018;
const PREWARM_EMAIL_OTP = 'prewarmEmailOtpRegistrationCrypto';
const BREAK_PROTOCOL = 'test_break_protocol';

type Posted = { readonly worker: string; readonly type: unknown };

/** Answers every request with success, except one type that breaks the protocol. */
class FakeWorker {
  static posted: Posted[] = [];
  readonly #name: string;
  readonly #listeners = new Set<(event: { data: unknown }) => void>();

  constructor(_url: string, options?: { name?: string }) {
    this.#name = options?.name ?? 'unnamed';
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.#listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.#listeners.delete(listener);
  }

  terminate(): void {
    this.#listeners.clear();
  }

  postMessage(message: { id: string; type: unknown }): void {
    FakeWorker.posted.push({ worker: this.#name, type: message.type });
    const reply =
      message.type === BREAK_PROTOCOL
        ? { unexpected: true }
        : { id: message.id, ok: true, result: { kind: 'succeeded', elapsedMs: 1 } };
    queueMicrotask(() => {
      for (const listener of this.#listeners) listener({ data: reply });
    });
  }
}

function prewarmCount(type: unknown): number {
  return FakeWorker.posted.filter((posted) => posted.type === type).length;
}

/** A frame the transport cannot parse makes it reset that worker. */
async function breakWorker(
  transport: WorkerTransport,
  kind: 'emailOtp' | 'ecdsaDerivationClient',
): Promise<void> {
  const request = { kind, request: { type: BREAK_PROTOCOL, payload: {} } };
  await expect(
    (transport.requestOperation as (args: unknown) => Promise<unknown>)(request),
  ).rejects.toThrow();
}

let previousWorker: unknown;

test.beforeEach(() => {
  previousWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  FakeWorker.posted = [];
});

test.afterEach(() => {
  (globalThis as { Worker?: unknown }).Worker = previousWorker;
});

function createTransport(): WorkerTransport {
  const transport = new WorkerTransport();
  transport.setWorkerBaseOrigin('https://wallet.example.test');
  return transport;
}

test('a prewarm runs once per worker instance', async () => {
  const transport = createTransport();

  expect((await transport.prewarmEmailOtpYao()).kind).toBe('succeeded');
  expect((await transport.prewarmEmailOtpYao()).kind).toBe('succeeded');
  expect((await transport.prewarmEcdsaRegistrationCrypto()).kind).toBe('succeeded');
  expect((await transport.prewarmEcdsaRegistrationCrypto()).kind).toBe('succeeded');

  expect(prewarmCount(PREWARM_EMAIL_OTP)).toBe(1);
  expect(prewarmCount(PREWARM_ECDSA_REGISTRATION_CRYPTO)).toBe(1);
});

test('an Email OTP worker reset makes the next prewarm run again', async () => {
  const transport = createTransport();
  await transport.prewarmEmailOtpYao();

  await breakWorker(transport, 'emailOtp');
  await transport.prewarmEmailOtpYao();

  expect(prewarmCount(PREWARM_EMAIL_OTP)).toBe(2);
});

test('an ECDSA derivation worker reset makes the next prewarm run again', async () => {
  const transport = createTransport();
  await transport.prewarmEcdsaRegistrationCrypto();

  await breakWorker(transport, 'ecdsaDerivationClient');
  await transport.prewarmEcdsaRegistrationCrypto();

  expect(prewarmCount(PREWARM_ECDSA_REGISTRATION_CRYPTO)).toBe(2);
});

test('a worker base origin change makes both prewarms run again', async () => {
  const transport = createTransport();
  await transport.prewarmEmailOtpYao();
  await transport.prewarmEcdsaRegistrationCrypto();

  transport.setWorkerBaseOrigin('https://other-wallet.example.test');
  await transport.prewarmEmailOtpYao();
  await transport.prewarmEcdsaRegistrationCrypto();

  expect(prewarmCount(PREWARM_EMAIL_OTP)).toBe(2);
  expect(prewarmCount(PREWARM_ECDSA_REGISTRATION_CRYPTO)).toBe(2);
});
