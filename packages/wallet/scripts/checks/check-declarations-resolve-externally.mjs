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
 * configured, and asserts the public types survive as real types. Isolated
 * consumers cover React integration and optional-peer absence.
 */

import { mkdtemp, rm, writeFile, mkdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
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
type PendingRegistrationRequest = Parameters<Registration['resumePendingEcdsaRegistration']>[0];
declare const registration: Registration;
declare const walletId: PendingRegistrationRequest['walletId'];
registration.resumePendingEcdsaRegistration({ walletId, exactMethod: { kind: 'passkey' } });
// @ts-expect-error The host resolves the pending ceremony from wallet identity.
registration.resumePendingEcdsaRegistration({ walletId, registrationCeremonyId: 'caller-ceremony', exactMethod: { kind: 'passkey' } });
// @ts-expect-error The executing host supplies the passkey origin.
registration.resumePendingEcdsaRegistration({ walletId, exactMethod: { kind: 'passkey', expectedOrigin: 'https://caller.invalid' } });
declare const emailMethod: Extract<PendingRegistrationRequest['exactMethod'], { kind: 'email_otp' }>;
// @ts-expect-error A spread must not turn an email proof into passkey authentication.
registration.resumePendingEcdsaRegistration({ walletId, exactMethod: { ...emailMethod, kind: 'passkey' } });
`;

const CORE_CONSUMER_SOURCE = `
import { SeamsWeb } from '@seams/wallet';
import { ExternalEvmController } from '@seams/wallet/external-evm';
declare const seams: SeamsWeb;
void seams.auth.getSession();
void seams.auth.requestEmailCode({ walletId: 'wallet.testnet' });
// @ts-expect-error Custom UI requests email codes through one public method.
void seams.auth.requestEmailOtpChallenge;
// @ts-expect-error Test funding is internal to confirmed NEAR signing.
void seams.near.fundImplicitNearAccountForTesting;
void seams.registration.registerWallet;
void seams.registration.addEmail;
// @ts-expect-error Registration owns its Email OTP enrollment challenge.
void seams.registration.requestEmailOtpEnrollmentChallenge;
// @ts-expect-error Wallet creation and email addition own enrollment.
void seams.registration.enrollEmailOtp;
// @ts-expect-error Presignature preparation belongs to wallet operations.
void seams.auth.prefillRouterAbEcdsaDerivationPresignaturePool;
// @ts-expect-error Signing owns its operation-bound Email OTP challenge.
void seams.auth.requestEmailOtpSigningSessionChallenge;
// @ts-expect-error Signing owns its Email OTP session refresh.
void seams.auth.refreshEmailOtpSigningSession;
void seams.auth.startGoogleSignIn({ idToken: 'provider-evidence', mode: 'login', loginTarget: { kind: 'discoverable' } });
// @ts-expect-error Google sign-in has one public entry name.
void seams.auth.beginGoogleEmailOtpWalletAuth;
// @ts-expect-error Hosted demo delivery is internal to the wallet UI.
void seams.onHostedAuthMenuDemoEmailOtpDelivery;
// @ts-expect-error Custom UI reads the flow delivery result directly.
void seams.auth.startGoogleSignIn({ idToken: 'provider-evidence', mode: 'login', loginTarget: { kind: 'discoverable' }, onDemoOtp() {} });
void seams.keys.exportKey({ kind: 'ecdsa', chainTarget: 'arc-testnet' });
const external = new ExternalEvmController([]);
void external.waitForReceipt;
// @ts-expect-error Receipt lookup was replaced with bounded waiting.
void external.observeReceipt;
`;

const CORE_IMPORT_SOURCE = `
import { createRequire } from 'node:module';
import { SeamsWeb } from '@seams/wallet';
import { ExternalEvmController } from '@seams/wallet/external-evm';
const require = createRequire(import.meta.url);
for (const dependency of ['react', 'react-dom', '@types/react', '@types/react-dom']) {
  try {
    require.resolve(dependency + '/package.json');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') continue;
    throw error;
  }
  throw new Error(dependency + ' must be absent from the core consumer');
}
if (typeof SeamsWeb !== 'function' || typeof ExternalEvmController !== 'function') {
  throw new Error('Core package exports did not load');
}
`;

const workspace = await mkdtemp(join(tmpdir(), 'seams-decl-check-'));
const coreWorkspace = await mkdtemp(join(tmpdir(), 'seams-core-consumer-'));
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
    await writeFile(
      join(coreWorkspace, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
      }),
    );
    execFileSync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--omit=optional',
        '--legacy-peer-deps',
        '--no-audit',
        '--no-fund',
        join(workspace, packed[0].filename),
      ],
      { cwd: coreWorkspace, encoding: 'utf8', timeout: 120_000 },
    );
    await writeFile(join(coreWorkspace, 'consumer.ts'), CORE_CONSUMER_SOURCE);
    await writeFile(join(coreWorkspace, 'import.mjs'), CORE_IMPORT_SOURCE);
    await writeFile(
      join(coreWorkspace, 'tsconfig.json'),
      await readFile(join(workspace, 'tsconfig.json'), 'utf8'),
    );
    execFileSync('npx', ['tsc', '--noEmit', '-p', join(coreWorkspace, 'tsconfig.json')], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    execFileSync(process.execPath, [join(coreWorkspace, 'import.mjs')], {
      cwd: coreWorkspace,
      encoding: 'utf8',
    });
    const coreLock = await readFile(join(coreWorkspace, 'package-lock.json'));
    const installedVersions = {};
    for (const [path, dependency] of Object.entries(JSON.parse(coreLock.toString()).packages)) {
      if (dependency.version) installedVersions[path] = dependency.version;
    }
    console.log(`[declarations] core dependency versions: ${JSON.stringify(installedVersions)}`);
    console.log(
      `[declarations] core install lock SHA-256: ${createHash('sha256').update(coreLock).digest('hex')}`,
    );
    console.log(
      '[declarations] isolated npm install compiles and imports core/external EVM without React',
    );
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
  await rm(coreWorkspace, { recursive: true, force: true });
}
