import { expect, test } from '@playwright/test';
import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import { resolveWorkerUrl } from '@/core/walletRuntimePaths/workers';

type AssetVersionWindow = {
  readonly location: { readonly origin: string };
  readonly __SEAMS_WALLET_SDK_BASE__: string;
  readonly __SEAMS_WALLET_ASSET_VERSION__: string;
};

function installAssetVersionWindow(): () => void {
  const originalWindow = Reflect.get(globalThis, 'window');
  const fakeWindow: AssetVersionWindow = {
    location: { origin: 'https://test.sign.seams.sh' },
    __SEAMS_WALLET_SDK_BASE__: 'https://test.sign.seams.sh/sdk/',
    __SEAMS_WALLET_ASSET_VERSION__: '0.5.4',
  };
  Reflect.set(globalThis, 'window', fakeWindow);
  return function restoreWindow(): void {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }
    Reflect.set(globalThis, 'window', originalWindow);
  };
}

test('uses one release version for worker JavaScript and WASM', () => {
  const restoreWindow = installAssetVersionWindow();
  try {
    const workerUrl = resolveWorkerUrl('/sdk/workers/near-signer.worker.js', {
      worker: 'signer',
    });
    const wasmUrl = resolveWasmUrl(
      'wasm_signer_worker_bg.wasm',
      'Signer Worker',
    ).toString();
    const explicitWorkerUrl = resolveWorkerUrl('https://workers.example/near.js', {
      worker: 'signer',
    });

    expect(workerUrl).toContain('/sdk/workers/near-signer.worker.js?v=0.5.4');
    expect(wasmUrl).toContain('/sdk/workers/wasm_signer_worker_bg.wasm?v=0.5.4');
    expect(explicitWorkerUrl).toBe('https://workers.example/near.js');
  } finally {
    restoreWindow();
  }
});
