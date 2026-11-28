import * as path from 'node:path';

const PACKAGE_ROOT = process.cwd();
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const SHARED_ROOT = path.resolve(PACKAGE_ROOT, '../shared-ts/src');
// The stage dialog and the frame transport, which each browser package bundles.
const FRAME_KIT_ROOT = path.resolve(PACKAGE_ROOT, '../frame-kit/src');

// The published paths. The Worker and the frame document are not paths of the package: the
// services package builds them from this folder.
const ENTRIES = ['src/client/index.ts', 'src/server/index.ts'];

// The checkout has no required Seams dependency. A published path can bundle its own source and
// these pure helpers, and nothing of auth or of a wallet package.
const SHARED_HELPERS = new Set(
  [
    'utils/base64.ts',
    'utils/digests.ts',
    'utils/exactKeys.ts',
    'utils/normalize.ts',
    'utils/secureRandomId.ts',
    'utils/validation.ts',
  ].map((helper) => path.join(SHARED_ROOT, helper)),
);

function isOwnModule(moduleId: string): boolean {
  const file = path.resolve(moduleId.replace(/\?.*$/, ''));
  return (
    file.startsWith(`${SOURCE_ROOT}${path.sep}`) ||
    file.startsWith(`${FRAME_KIT_ROOT}${path.sep}`) ||
    SHARED_HELPERS.has(file)
  );
}

const ownCodeOnly = {
  name: 'checkout-own-code-only',
  generateBundle(_options: unknown, bundle: Record<string, { type: string; moduleIds?: string[] }>) {
    const foreign = new Set<string>();
    for (const output of Object.values(bundle)) {
      for (const moduleId of output.moduleIds ?? []) {
        if (!moduleId.startsWith('\0') && !isOwnModule(moduleId)) {
          foreign.add(path.relative(PACKAGE_ROOT, moduleId));
        }
      }
    }
    if (foreign.size > 0) {
      throw new Error(`@seams/checkout must not bundle:\n  ${[...foreign].join('\n  ')}`);
    }
  },
};

export default {
  input: ENTRIES,
  output: {
    dir: 'dist/esm',
    format: 'esm',
    preserveModules: true,
    preserveModulesRoot: path.resolve(PACKAGE_ROOT, '..'),
    sourcemap: true,
  },
  resolve: { alias: { '@shared/*': path.join(SHARED_ROOT, '*') } },
  plugins: [ownCodeOnly],
} satisfies import('rolldown').RolldownOptions;
