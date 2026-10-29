#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walletPackage = packageDefinition('packages/wallet', '@seams/wallet');
const walletServerPackage = packageDefinition('packages/wallet-server', '@seams/wallet-server');
const voiceIdPackage = packageDefinition('packages/voiceid', '@seams/voiceid');
const packageTarget = process.argv[2] ?? 'all';
assert.ok(
  ['all', 'wallet', 'voiceid'].includes(packageTarget),
  `Unknown package target: ${packageTarget}`,
);
assert.ok(process.argv.length <= 3, 'Expected one package target: all, wallet, or voiceid');
const packages =
  packageTarget === 'all'
    ? [walletPackage, walletServerPackage, voiceIdPackage]
    : [walletPackage, voiceIdPackage];
const forbidden = [
  '@seams-internal/console',
  '@seams-internal/wallet-console',
  'packages/console',
  'packages/wallet-console',
  'apps/seams-console',
  'deployment/console/targets.json',
  'deployment/wallet-system/targets.json',
  'CONSOLE_SESSION_HMAC_SECRET',
  'STRIPE_API_SK',
];
const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'r105-wallet-pack-'));
const tarballDirectory = path.join(workDirectory, 'tarballs');
const nodeModulesDirectory = path.join(workDirectory, 'node_modules');

fs.mkdirSync(tarballDirectory, { recursive: true });
fs.mkdirSync(nodeModulesDirectory, { recursive: true });

try {
  const tarballs = [];
  for (const packageDefinition of packages) {
    const tarball = pack(packageDefinition.directory);
    tarballs.push(tarball);
    const unpacked = unpack(tarball, packageDefinition.name);
    inspectPackage(unpacked, packageDefinition);
  }
  installPackedPackages(tarballs);
  await smokePackedEntries();
  process.stdout.write('[check-packed-wallet-boundaries] passed\n');
} finally {
  fs.rmSync(workDirectory, { recursive: true, force: true });
}

function pack(packageDirectory) {
  const output = execFileSync('npm', ['pack', '--pack-destination', tarballDirectory, '--json'], {
    cwd: path.join(repoRoot, packageDirectory),
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: path.join(workDirectory, 'npm-cache'),
    },
  });
  const result = JSON.parse(output);
  assert.equal(result.length, 1, `${packageDirectory} must produce one tarball`);
  return path.join(tarballDirectory, result[0].filename);
}

function unpack(tarball, packageName) {
  const destination = path.join(workDirectory, 'unpacked', packageName.replace('/', '-'));
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', destination]);
  return path.join(destination, 'package');
}

function inspectPackage(packageDirectory, packageDefinition) {
  const packageName = packageDefinition.name;
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  );
  assert.equal(packageJson.name, packageName);
  assert.equal(packageJson.version, packageDefinition.version);
  assert.equal(packageJson.license, 'Apache-2.0');
  if (packageName === '@seams/wallet') {
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of ['@seams/voiceid', 'onnxruntime-web', 'voice-glow']) {
        assert.equal(
          packageJson[section]?.[dependency],
          undefined,
          `${dependency} must remain opt-in`,
        );
      }
    }
  }
  assert.match(
    fs.readFileSync(path.join(packageDirectory, 'LICENSE.md'), 'utf8'),
    /^\s*Apache License$/mu,
  );
  assert.match(
    fs.readFileSync(path.join(packageDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    /^# Third-Party Notices$/mu,
  );

  for (const file of listFiles(packageDirectory)) {
    const relativePath = path.relative(packageDirectory, file);
    if (packageName === '@seams/wallet') {
      assert.ok(!relativePath.endsWith('.onnx'), 'VoiceID models must not ship in @seams/wallet');
      assert.ok(
        !relativePath.includes('ort-wasm'),
        'VoiceID engine must not ship in @seams/wallet',
      );
    }
    assert.ok(!relativePath.endsWith('.map'), `${packageName} contains source map ${relativePath}`);
    if (!/\.(?:js|mjs|cjs|d\.ts|json|toml|sql)$/u.test(file) || file.endsWith('.wasm')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const value of forbidden) {
      assert.ok(!source.includes(value), `${packageName}/${relativePath} contains ${value}`);
    }
  }
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function installPackedPackages(tarballs) {
  fs.writeFileSync(
    path.join(workDirectory, 'package.json'),
    JSON.stringify({
      name: 'seams-release-consumer',
      private: true,
      type: 'module',
    }),
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--strict-peer-deps',
      ...tarballs,
    ],
    { cwd: workDirectory, stdio: 'pipe', env: process.env },
  );
}

async function smokePackedEntries() {
  const voiceId = await import(path.join(nodeModulesDirectory, '@seams/voiceid/dist/esm/index.js'));
  assert.deepEqual(voiceId.voiceIdAuthMethod(), { kind: 'voiceid', transcriptionModel: 'citrinet' });
  assert.deepEqual(voiceId.voiceIdAuthMethod({ transcriptionModel: 'aurora' }), { kind: 'voiceid', transcriptionModel: 'aurora' });
  const voiceUi = await import(path.join(nodeModulesDirectory, '@seams/voiceid/dist/esm/react.js'));
  assert.equal(typeof voiceUi.VoiceAssistantCard, 'function');
  assert.ok('VoiceBeam' in voiceUi);
  const voicePrompt = await import(
    path.join(nodeModulesDirectory, '@seams/voiceid/dist/esm/capture/prompt.js')
  );
  assert.equal(typeof voicePrompt.VoicePrompt, 'function');
  assert.ok(
    fs.existsSync(
      path.join(nodeModulesDirectory, '@seams/voiceid/dist/esm/react/VoiceAssistantCard.css'),
    ),
  );
  const hosting = await import(path.join(nodeModulesDirectory, '@seams/voiceid/dist/hosting.mjs'));
  const walletPublicDirectory = path.join(nodeModulesDirectory, '@seams/wallet/dist/public');
  const combined = await hosting.composeVoiceIdWalletAssets({
    walletPublicDirectory,
    outputDirectory: path.join(workDirectory, 'voiceid-wallet'),
  });
  assert.ok(fs.existsSync(path.join(combined, 'sdk/voiceid/host.js')));
  assert.ok(fs.existsSync(path.join(combined, 'sdk/voiceid/aurora-int8.onnx')));
  assert.ok(fs.existsSync(path.join(combined, 'sdk/voiceid/citrinet-int8.onnx')));
  assert.ok(!fs.existsSync(path.join(walletPublicDirectory, 'sdk/voiceid')));
  const cliOutput = path.join(workDirectory, 'cli-wallet');
  const cliResult = execFileSync('npx', ['--no-install', 'seams-voiceid-host', './cli-wallet'], {
    cwd: workDirectory,
    encoding: 'utf8',
  });
  assert.equal(fs.realpathSync(cliResult.trim()), fs.realpathSync(cliOutput));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cliOutput, 'wallet-assets.manifest.json'), 'utf8'),
  );
  const routes = manifest.assets.map(assetRoute);
  for (const route of [
    '/wallet-service',
    '/sdk/voiceid-host.js',
    '/sdk/voiceid/host.js',
    '/sdk/voiceid/redimnet-b1.onnx',
    '/sdk/voiceid/aurora-int8.onnx',
    '/sdk/voiceid/citrinet-int8.onnx',
    '/sdk/voiceid/silero-vad.onnx',
    '/sdk/voiceid/ort-wasm-simd-threaded.wasm',
  ]) {
    assert.ok(routes.includes(route), `Composed Wallet host must serve ${route}`);
  }
  for (const asset of manifest.assets) {
    assert.ok(fs.existsSync(path.join(cliOutput, asset.sourceFile)), asset.sourceFile);
  }
  assert.ok(!fs.existsSync(path.join(walletPublicDirectory, 'sdk/voiceid')));
  const reportPath = path.join(repoRoot, '.artifacts/packed-wallet-boundaries/voiceid-host.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        walletVersion: walletPackage.version,
        voiceIdVersion: voiceIdPackage.version,
        command: 'npx --no-install seams-voiceid-host ./cli-wallet',
        installedFromTarballs: true,
        walletPackageHasNoVoiceAssets: true,
        routes,
      },
      null,
      2,
    ) + '\n',
  );
  const runtime = await import(
    path.join(nodeModulesDirectory, '@seams/wallet/dist/esm/runtime.js')
  );
  assert.equal(typeof runtime.createSigningRuntime, 'function');

  const externalNear = await import(
    path.join(nodeModulesDirectory, '@seams/wallet/dist/esm/externalNear/index.js')
  );
  const near = new externalNear.ExternalNearController({
    network: 'testnet',
    rpcUrl: 'https://rpc.testnet.near.org',
    wallets: ['meteor', 'hot', 'intear'],
  });
  assert.equal(near.getSnapshot().connection.kind, 'disconnected');
  near.disconnect();
  assert.equal(near.getSnapshot().busy, false);

  const authMenu = await import(
    path.join(
      nodeModulesDirectory,
      '@seams/wallet/dist/esm/react/components/HostedSeamsAuthMenu/public.js',
    )
  );
  assert.equal(typeof authMenu.HostedSeamsAuthMenu, 'function');

  if (!packages.includes(walletServerPackage)) return;

  const walletServer = await import(
    path.join(nodeModulesDirectory, '@seams/wallet-server/dist/esm/index.js')
  );
  assert.equal(typeof walletServer.SessionService, 'function');

  const artifactManifest = JSON.parse(
    fs.readFileSync(
      path.join(nodeModulesDirectory, '@seams/wallet-server/artifact-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(artifactManifest.schemaVersion, 'seams_wallet_server_artifact_manifest_v1');
  assert.equal(artifactManifest.package.version, walletServerPackage.version);
}

function assetRoute(asset) {
  return asset.route;
}

function packageDefinition(directory, name) {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, directory, 'package.json'), 'utf8'),
  );
  return { directory, name, version: packageJson.version };
}
