import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

/** The source files that one published path of `@seams/checkout` bundles. */
async function bundledFiles(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    tsconfig: path.join(root, 'packages/checkout/tsconfig.json'),
  });
  return Object.keys(result.metafile.inputs).sort();
}

// The pure helpers that the checkout may bundle. Each holds no auth or wallet contract.
const SHARED_HELPERS = [
  'packages/shared-ts/src/utils/base64.ts',
  'packages/shared-ts/src/utils/digests.ts',
  'packages/shared-ts/src/utils/exactKeys.ts',
  'packages/shared-ts/src/utils/normalize.ts',
  'packages/shared-ts/src/utils/secureRandomId.ts',
  'packages/shared-ts/src/utils/validation.ts',
];

function outside(files: readonly string[], allowed: readonly string[]): string[] {
  return files.filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
}

test.describe('the published paths of @seams/checkout', () => {
  test('/client bundles only the checkout, the frame kit and pure helpers: no auth, no wallet, no Worker', async () => {
    const files = await bundledFiles('packages/checkout/src/client/index.ts');
    expect(outside(files, ['packages/checkout/src/client/', 'packages/checkout/src/shared/', 'packages/frame-kit/src/', ...SHARED_HELPERS])).toEqual([]);
    // A guest-only checkout loads no auth code and no provider key code.
    expect(files.filter((file) => /packages\/(auth|mpc-wallet|wallet-connect|host)\//.test(file))).toEqual([]);
    expect(files.filter((file) => file.includes('/worker/'))).toEqual([]);
  });

  test('/server bundles no browser code and no Worker code', async () => {
    const files = await bundledFiles('packages/checkout/src/server/index.ts');
    expect(outside(files, ['packages/checkout/src/server/', 'packages/checkout/src/shared/', ...SHARED_HELPERS])).toEqual([]);
  });

  test('the frame and the Worker import no auth or wallet package', async () => {
    for (const entry of ['packages/checkout/src/frame/main.ts', 'packages/checkout/src/worker/index.ts']) {
      const files = await bundledFiles(entry);
      expect(files.filter((file) => /packages\/(auth|mpc-wallet|mpc-wallet-server|wallet-connect|voiceid)\//.test(file)), entry).toEqual([]);
    }
  });
});
