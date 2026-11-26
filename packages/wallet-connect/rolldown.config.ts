import * as fs from 'fs';
import * as path from 'path';

// Absolute roots keep the dist paths equal to the source paths (`dist/esm/client.js`,
// `dist/esm/react/index.js`), and shared helpers land under `dist/esm/shared-ts/`.
const PACKAGE_ROOT_ABS = process.cwd();
const SRC_ROOT_ABS = path.resolve(PACKAGE_ROOT_ABS, 'src');
const REACT_SRC_ROOT_ABS = path.join(SRC_ROOT_ABS, 'react');
const ESM_OUT = 'dist/esm';

const outputFileName = (chunk: { facadeModuleId?: string | null; name: string }): string => {
  if (!chunk.facadeModuleId) return `${chunk.name}.js`;
  let relative = path.relative(SRC_ROOT_ABS, chunk.facadeModuleId).split(path.sep).join('/');
  while (relative.startsWith('../')) relative = relative.slice(3);
  return `${relative.replace(/\.[^/.]+$/, '')}.js`;
};

// The picker modules import their stylesheet, so the CSS files sit next to the JavaScript.
const copyReactCssPlugin = {
  name: 'copy-react-css',
  generateBundle() {
    for (const entry of fs.readdirSync(REACT_SRC_ROOT_ABS)) {
      if (!entry.endsWith('.css')) continue;
      const destination = path.join(PACKAGE_ROOT_ABS, ESM_OUT, 'react', entry);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(REACT_SRC_ROOT_ABS, entry), destination);
    }
  },
};

// The connectors create no Seams session and hold no custody material, so they must not
// bundle auth or MPC wallet code. Each bundled module is this package's own source, a generic
// shared helper below, or a third-party package. A shared helper joins this list only when it
// holds no auth or wallet contract.
const GENERIC_SHARED_HELPERS = new Set(
  [
    'near/actions.ts',
    'near/delegate.ts',
    'near/nearTxExecutionError.ts',
    'near/walletBrandImages.ts',
    'utils/base58.ts',
    'utils/base64.ts',
    'utils/evmClient.ts',
    'utils/evmRpcResults.ts',
    'utils/jsonRpc.ts',
    'utils/near.ts',
    'utils/normalize.ts',
    'utils/validation.ts',
    'utils/variant.ts',
    'utils/walletIcon.ts',
  ].map((helper) => path.resolve(PACKAGE_ROOT_ABS, '../shared-ts/src', helper)),
);

const isAllowedModule = (moduleId: string): boolean => {
  const file = path.resolve(moduleId.replace(/\?.*$/, ''));
  if (file.startsWith(`${SRC_ROOT_ABS}${path.sep}`)) return true;
  if (GENERIC_SHARED_HELPERS.has(file)) return true;
  const nodeModules = `${path.sep}node_modules${path.sep}`;
  return file.includes(nodeModules) && !file.includes(`${nodeModules}@seams${path.sep}`);
};

const assertNoWalletCodePlugin = {
  name: 'assert-no-auth-or-mpc-wallet-code',
  generateBundle(_options: unknown, bundle: Record<string, any>) {
    const offenders = new Set<string>();
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue;
      for (const moduleId of output.moduleIds as string[]) {
        if (moduleId.startsWith('\0') || isAllowedModule(moduleId)) continue;
        offenders.add(path.relative(PACKAGE_ROOT_ABS, moduleId));
      }
    }
    if (offenders.size > 0) {
      throw new Error(
        `@seams/wallet-connect must not bundle auth or MPC wallet code:\n  ${[...offenders].join('\n  ')}`,
      );
    }
  },
};

export default [
  {
    input: ['src/client.ts', 'src/react/index.ts'],
    output: {
      dir: ESM_OUT,
      format: 'esm',
      preserveModules: true,
      preserveModulesRoot: SRC_ROOT_ABS,
      entryFileNames: outputFileName,
      chunkFileNames: outputFileName,
      sourcemap: true,
    },
    // As in the MPC wallet build, viem and borsh are bundled, so the modules also load in a
    // browser without a bundler that maps only bs58 and React.
    external: ['react', 'react/jsx-runtime', 'bs58', /\.css$/],
    resolve: {
      alias: { '@shared/*': path.resolve(PACKAGE_ROOT_ABS, '../shared-ts/src/*') },
    },
    plugins: [assertNoWalletCodePlugin, copyReactCssPlugin],
  },
] satisfies import('rolldown').RolldownOptions[];
