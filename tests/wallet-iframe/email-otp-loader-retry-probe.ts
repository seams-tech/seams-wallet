import {
  deriveEmailOtpUnlockAuthSeedInWorker,
  ensureEvmCryptoWasm,
  ensureWalletCustodyCeremonyWasm,
} from '../../packages/wallet/src/core/signingEngine/workerManager/workers/email-otp/crypto';

type Loader = 'evm' | 'email' | 'custody';
type Outcome = { ok: true } | { ok: false; error: string };

async function initialize(loader: Loader): Promise<void> {
  switch (loader) {
    case 'evm':
      await ensureEvmCryptoWasm();
      return;
    case 'custody':
      await ensureWalletCustodyCeremonyWasm();
      return;
    case 'email': {
      const seed = await deriveEmailOtpUnlockAuthSeedInWorker({
        clientSecret32: new Uint8Array(32).fill(1),
        walletId: 'loader-retry-wallet',
      });
      try {
        if (seed.length !== 32) throw new Error('Unlock seed must have 32 bytes');
      } finally {
        seed.fill(0);
      }
      return;
    }
  }
  loader satisfies never;
}

async function runLoader(loader: Loader): Promise<Outcome> {
  try {
    await initialize(loader);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runEmailOtpLoaderRetry(loader: Loader, count: number): Promise<Outcome[]> {
  const requests: Promise<Outcome>[] = [];
  for (let index = 0; index < count; index += 1) requests.push(runLoader(loader));
  return await Promise.all(requests);
}

Reflect.set(globalThis, 'runEmailOtpLoaderRetry', runEmailOtpLoaderRetry);
