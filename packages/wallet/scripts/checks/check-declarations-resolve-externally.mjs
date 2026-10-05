#!/usr/bin/env node
/**
 * Proves the emitted declarations resolve the way an outside consumer sees
 * them from the npm tarball, without this repository's source path aliases.
 *
 * Inside the repo everything resolves, because tsconfig maps `@/*` and
 * `@shared/*` to source. A published consumer has neither. When a declaration
 * leaks such a specifier the failure is silent rather than loud: a consumer
 * that happens to define its own `@/` resolves it against their own tree and
 * TypeScript degrades the type to `any`, so a green consumer typecheck can
 * mean nothing was checked at all.
 *
 * So this typechecks a small program against the built package with no `paths`
 * configured, and asserts the public types survive as real types. It is a
 * check, not a framework: one temp directory, one `tsc` invocation.
 */

import { mkdtemp, rm, writeFile, mkdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(packageRoot, '../..');

const CONSUMER_SOURCE = `
import type { SeamsWeb, NearProvisioningState } from '@seams/wallet';
import { SeamsWebProvider, useSeams } from '@seams/wallet/react';
import { createSigningRuntime } from '@seams/wallet/runtime';
type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type Registration = SeamsWeb['registration'];
type AccountState = Awaited<ReturnType<Registration['getNearAccountState']>>;
type AccountWait = Awaited<ReturnType<Registration['waitForNearAccount']>>;
export type StateIsTyped = Assert<
  IsAny<NearProvisioningState['status']> extends false ? true : false
>;
export type RegistrationIsTyped = Assert<IsAny<Registration> extends false ? true : false>;
export type AccountStateIsTyped = Assert<IsAny<AccountState> extends false ? true : false>;
export type AccountWaitIsTyped = Assert<IsAny<AccountWait> extends false ? true : false>;
export type ProviderIsTyped = Assert<
  IsAny<Parameters<typeof SeamsWebProvider>[0]> extends false ? true : false
>;
export type ReactContextIsTyped = Assert<
  IsAny<ReturnType<typeof useSeams>> extends false ? true : false
>;
export type RuntimeIsTyped = Assert<
  IsAny<ReturnType<typeof createSigningRuntime>> extends false ? true : false
>;
// @ts-expect-error The obsolete public name must not remain available.
export type RemovedAccountRead = Registration['getNearProvisioningState'];
`;

const workspace = await mkdtemp(join(tmpdir(), 'seams-decl-check-'));
try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', workspace], {
      cwd: packageRoot,
      encoding: 'utf8',
    }),
  );
  const installedPackage = join(workspace, 'node_modules/@seams/wallet');
  await mkdir(installedPackage, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    join(workspace, packed[0].filename),
    '--strip-components=1',
    '-C',
    installedPackage,
  ]);
  const definition = JSON.parse(await readFile(join(installedPackage, 'package.json'), 'utf8'));
  for (const dependency of Object.keys({
    ...definition.dependencies,
    ...definition.peerDependencies,
  })) {
    const destination = join(workspace, 'node_modules', dependency);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(join(repoRoot, 'node_modules', dependency), destination, 'dir');
  }
  /* React types are a peer dependency of the declarations. */
  await symlink(
    join(repoRoot, 'node_modules/@types'),
    join(workspace, 'node_modules/@types'),
    'dir',
  );

  await writeFile(join(workspace, 'consumer.ts'), CONSUMER_SOURCE, 'utf8');
  await writeFile(
    join(workspace, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          /* Deliberately no `paths`: that is the whole point. */
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2022',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['consumer.ts'],
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = spawnSync('npx', ['tsc', '--noEmit', '-p', join(workspace, 'tsconfig.json')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.error || result.status !== 0) {
    console.error('[declarations] external consumer compilation failed:');
    console.error(result.error?.message ?? output.trim());
    process.exitCode = 1;
  } else {
    console.log(
      '[declarations] packed root, React, and runtime consumers compile with strict ES2022 declarations',
    );
    console.log(`[declarations] tarball integrity: ${packed[0].integrity}`);
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
