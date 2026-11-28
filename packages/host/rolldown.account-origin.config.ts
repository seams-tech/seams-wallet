import * as path from 'node:path';

const PACKAGE_ROOT = process.cwd();

// The script of the account frame: the auth core of the account origin, in one file. A plugin
// or a gate is not in it. The frame loads each one from `/sdk/` on the account origin.
export default {
  input: path.resolve(PACKAGE_ROOT, '../auth/src/origin/main.ts'),
  external: [/^\/sdk\//],
  output: {
    file: 'dist/account-origin/account-frame.js',
    format: 'esm',
    minify: true,
    sourcemap: true,
  },
  resolve: { alias: { '@shared/*': path.resolve(PACKAGE_ROOT, '../shared-ts/src/*') } },
} satisfies import('rolldown').RolldownOptions;
