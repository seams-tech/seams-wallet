import { expect, test } from '@playwright/test';
import type { PasskeyCustodyEnvelopeRecord } from '../../packages/shared-ts/src/passkey-custody';
import type { WalletCustodyCeremonyTransportPort } from '../../packages/wallet/src/core/signingEngine/walletCustody/ceremonyStepRunner';
import {
  destroyUnlockedWalletEd25519ExportRootCapabilitiesV1,
  dropUnlockedWalletEd25519ExportRootCapabilityReferenceV1,
  establishUnlockedWalletEd25519ExportRootCapabilityV1,
  readUnlockedEd25519ExportRootLinkingCapabilityV1,
} from '../../packages/wallet/src/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';

type WorkerCall = { readonly type: string; readonly payload: Record<string, unknown> };

/** Stands in for the ceremony worker; an establish waits until released. */
class FakeCeremonyWorker {
  readonly calls: WorkerCall[] = [];
  #issued = 0;
  #hold: Promise<void> | null = null;
  #release: () => void = () => undefined;

  holdEstablish(): void {
    this.#hold = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  releaseEstablish(): void {
    this.#hold = null;
    this.#release();
  }

  destroyedHandles(): unknown[] {
    return this.calls
      .filter((call) => call.type === 'destroyUnlockedWalletEd25519ExportRootCapabilities')
      .map((call) => call.payload.scope)
      .filter((scope) => (scope as { kind: string }).kind === 'capability')
      .map((scope) => (scope as { capabilityHandleId: string }).capabilityHandleId);
  }

  transport(): WalletCustodyCeremonyTransportPort {
    return {
      requestOperation: this.#request.bind(this),
    } as unknown as WalletCustodyCeremonyTransportPort;
  }

  async #request(operation: {
    request: { type: string; payload: Record<string, unknown> };
  }): Promise<unknown> {
    const { type, payload } = operation.request;
    this.calls.push({ type, payload });
    if (type !== 'establishUnlockedWalletEd25519ExportRootCapability') return { destroyedCount: 0 };
    const capabilityHandleId = `capability-${++this.#issued}`;
    if (this.#hold) await this.#hold;
    return {
      kind: 'unlocked_wallet_ed25519_export_root_capability_v1',
      capabilityHandleId,
      walletId: payload.walletId,
      walletAuthMethodId: payload.walletAuthMethodId,
      walletSessionId: payload.walletSessionId,
      expiresAtMs: payload.expiresAtMs,
    };
  }
}

const seedEnvelope = {
  binding: { kind: 'wallet_custody_seed_v1' },
} as unknown as PasskeyCustodyEnvelopeRecord;

function establish(worker: FakeCeremonyWorker, walletId: string, walletSessionId = 'session-1') {
  return establishUnlockedWalletEd25519ExportRootCapabilityV1(worker.transport(), {
    existingEnvelope: seedEnvelope,
    existingFactorSecret: new Uint8Array(32).fill(5),
    walletId,
    walletAuthMethodId: 'auth-method-1',
    walletSessionId,
    expiresAtMs: Date.now() + 60_000,
  });
}

test.beforeEach(async () => {
  await destroyUnlockedWalletEd25519ExportRootCapabilitiesV1(new FakeCeremonyWorker().transport(), {
    kind: 'all',
  });
});

test('a destroy during an establish keeps the new handle out and destroys it', async () => {
  const worker = new FakeCeremonyWorker();
  worker.holdEstablish();
  const established = establish(worker, 'wallet-a');

  await destroyUnlockedWalletEd25519ExportRootCapabilitiesV1(worker.transport(), {
    kind: 'wallet_session',
    walletSessionId: 'session-1',
  });
  worker.releaseEstablish();

  expect(await established).toBeUndefined();
  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-a')).toBeUndefined();
  expect(worker.destroyedHandles()).toEqual(['capability-1']);
});

test('a destroy for another wallet does not cancel an establish', async () => {
  const worker = new FakeCeremonyWorker();
  worker.holdEstablish();
  const established = establish(worker, 'wallet-a');

  await destroyUnlockedWalletEd25519ExportRootCapabilitiesV1(worker.transport(), {
    kind: 'wallet',
    walletId: 'wallet-b',
  });
  worker.releaseEstablish();

  expect((await established)?.capabilityHandleId).toBe('capability-1');
  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-a')?.capabilityHandleId).toBe(
    'capability-1',
  );
  expect(worker.destroyedHandles()).toEqual([]);
});

test('a capability for another wallet destroys the handle it replaces', async () => {
  const worker = new FakeCeremonyWorker();
  await establish(worker, 'wallet-a');
  await establish(worker, 'wallet-b');

  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-a')).toBeUndefined();
  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-b')?.capabilityHandleId).toBe(
    'capability-2',
  );
  expect(worker.destroyedHandles()).toEqual(['capability-1']);
});

test('a new capability for the same wallet leaves the replacement to the worker', async () => {
  const worker = new FakeCeremonyWorker();
  await establish(worker, 'wallet-a');
  await establish(worker, 'wallet-a', 'session-2');

  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-a')?.capabilityHandleId).toBe(
    'capability-2',
  );
  expect(worker.destroyedHandles()).toEqual([]);
});

test('dropping the local reference on worker reset cancels an establish in flight', async () => {
  const worker = new FakeCeremonyWorker();
  worker.holdEstablish();
  const established = establish(worker, 'wallet-a');

  dropUnlockedWalletEd25519ExportRootCapabilityReferenceV1();
  worker.releaseEstablish();

  expect(await established).toBeUndefined();
  expect(readUnlockedEd25519ExportRootLinkingCapabilityV1('wallet-a')).toBeUndefined();
  expect(worker.destroyedHandles()).toEqual(['capability-1']);
});
