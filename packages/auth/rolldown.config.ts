import * as path from 'node:path';

const PACKAGE_ROOT = process.cwd();
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const SHARED_ROOT = path.resolve(PACKAGE_ROOT, '../shared-ts/src');
// The stage dialog and the frame transport, which each browser package bundles.
const FRAME_KIT_ROOT = path.resolve(PACKAGE_ROOT, '../frame-kit/src');

// The published paths. The Auth Worker and the account frame are not paths of the package: the
// services package builds them from this folder.
const ENTRIES = ['src/client/index.ts', 'src/react/index.ts', 'src/server/index.ts'];

// Auth depends on nothing from Seams. A published path can bundle its own source, the frame kit
// (browser paths only) and these pure helpers.
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

const inSource = (file: string, folder: string): boolean =>
  file.startsWith(path.join(SOURCE_ROOT, folder) + path.sep);

/** The reason why a module must not be in the chunk of an entry, or null. */
function refusal(entry: string, moduleId: string): string | null {
  const file = path.resolve(moduleId.replace(/\?.*$/, ''));
  const browserPath = entry !== 'server';
  if (file.startsWith(`${FRAME_KIT_ROOT}${path.sep}`)) {
    return browserPath ? null : 'browser code in /server';
  }
  if (SHARED_HELPERS.has(file)) return null;
  if (!file.startsWith(`${SOURCE_ROOT}${path.sep}`)) return 'code from outside the auth module';
  if (inSource(file, 'origin')) return 'the account frame is not a path of the package';
  if (browserPath && (inSource(file, 'worker') || inSource(file, 'server'))) {
    return 'server code in a browser path';
  }
  if (!browserPath && (inSource(file, 'client') || inSource(file, 'react'))) {
    return 'browser code in /server';
  }
  return null;
}

type ModuleGraph = {
  getModuleInfo(
    id: string,
  ): { importedIds: readonly string[]; dynamicallyImportedIds: readonly string[] } | null;
};

/** Walks the modules that each entry reaches, and refuses a module that its path must not hold. */
const pathRules = {
  name: 'auth-path-rules',
  buildEnd(this: ModuleGraph) {
    const refused = new Set<string>();
    for (const entryFile of ENTRIES) {
      const entry = path.basename(path.dirname(entryFile));
      const seen = new Set<string>();
      const queue = [path.join(PACKAGE_ROOT, entryFile)];
      for (let id = queue.pop(); id; id = queue.pop()) {
        if (seen.has(id) || id.startsWith('\0') || id === 'react') continue;
        seen.add(id);
        const reason = refusal(entry, id);
        if (reason) refused.add(`/${entry}: ${path.relative(PACKAGE_ROOT, id)}: ${reason}`);
        const info = this.getModuleInfo(id);
        queue.push(...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? []));
      }
    }
    if (refused.size > 0) {
      throw new Error(`@seams/auth must not bundle:\n  ${[...refused].join('\n  ')}`);
    }
  },
};

export default {
  input: ENTRIES,
  external: ['react'],
  output: {
    dir: 'dist/esm',
    format: 'esm',
    preserveModules: true,
    preserveModulesRoot: path.resolve(PACKAGE_ROOT, '..'),
    sourcemap: true,
  },
  resolve: { alias: { '@shared/*': path.join(SHARED_ROOT, '*') } },
  plugins: [pathRules],
} satisfies import('rolldown').RolldownOptions;
