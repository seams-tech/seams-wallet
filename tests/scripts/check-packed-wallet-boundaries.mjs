#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBrowserGraph } from '../../packages/mpc-wallet/scripts/checks/browser-module-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walletPackage = packageDefinition('packages/mpc-wallet', '@seams/mpc-wallet');
const walletConnectPackage = packageDefinition('packages/wallet-connect', '@seams/wallet-connect');
const hostPackage = packageDefinition('packages/mpc-wallet-server', '@seams/host');
const packageTarget = process.argv[2] ?? 'all';
assert.ok(
  ['all', 'wallet-connect', 'mpc-wallet'].includes(packageTarget),
  `Unknown package target: ${packageTarget}`,
);
assert.ok(process.argv.length <= 3, 'Expected one package target: all, wallet-connect, or mpc-wallet');
// The MPC wallet has the connectors as a peer, so every target installs both.
const packages =
  packageTarget === 'all'
    ? [walletPackage, walletConnectPackage, hostPackage]
    : [walletPackage, walletConnectPackage];
// Dependencies that each package must not name: the VoiceID engine stays in the host's plugin
// assets, the connectors need neither the MPC wallet nor auth, and the server needs no browser
// capture.
const forbiddenDependencies = {
  '@seams/mpc-wallet': ['@seams/voice-capture', 'onnxruntime-web'],
  '@seams/wallet-connect': ['@seams/mpc-wallet', '@seams/host', '@seams/voice-capture', '@seams/voice-sign'],
  '@seams/host': ['@seams/voice-capture', 'onnxruntime-web', 'voice-glow'],
};
// Old package names. A packed file that names one points a user at a package that is gone.
const oldPackageNames = ['@seams/wallet/', "@seams/wallet'", '@seams/wallet"', '@seams/wallet-server', '@seams/voiceid', '@seams/wallet-cli'];
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
// Browser paths must not reach server code, and the server path must not reach browser code.
const browserPaths = new Set(['./client', './react', './voiceid']);
const serverOnlySpecifiers = [/^node:/u, /^(?:fs|path|crypto|module|url|util)$/u, /^@simplewebauthn\/server$/u];
const serverOnlyFiles = /(?:^|\/)(?:mpc-wallet-server\/|server\.js$)/u;
const browserOnlySpecifiers = [/^react(?:-dom)?(?:\/|$)/u, /^preact(?:\/|$)/u, /^(?:idb|qrcode|jsqr|voice-glow)$/u, /^@seams\/wallet-connect\//u];
const browserOnlyFiles = /^(?:react|SeamsWeb|core|externalEvm|externalNear)\//u;

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
  for (const packageDefinition of packages) checkEntryBoundaries(packageDefinition);
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
  // Each import names where its code runs: no package has a root path.
  for (const field of ['main', 'module', 'types']) {
    assert.equal(packageJson[field], undefined, `${packageName} must have no ${field} field`);
  }
  assert.equal(packageJson.exports['.'], undefined, `${packageName} must have no root path`);
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of forbiddenDependencies[packageName] ?? []) {
      assert.equal(
        packageJson[section]?.[dependency],
        undefined,
        `${packageName} must not depend on ${dependency}`,
      );
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
    if (packageName !== '@seams/host') {
      assert.ok(!relativePath.endsWith('.onnx'), `VoiceID models must not ship in ${packageName}`);
      assert.ok(
        !/ort-wasm|ort\.wasm/u.test(relativePath),
        `VoiceID engine must not ship in ${packageName}`,
      );
    }
    assert.ok(!relativePath.endsWith('.map'), `${packageName} contains source map ${relativePath}`);
    // Code, declarations and data only: the README may name the package it replaces.
    if (!/\.(?:js|mjs|cjs|d\.ts|d\.mts|json|toml|sql)$/u.test(file) || file.endsWith('.wasm')) {
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    for (const value of [...forbidden, ...oldPackageNames]) {
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

function checkEntryBoundaries(packageDefinition) {
  // The rule is for product packages; each path of the services package runs on a server.
  if (packageDefinition === hostPackage) return;
  const installed = path.join(nodeModulesDirectory, packageDefinition.name);
  const packageJson = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  const esmRoot = path.join(installed, 'dist/esm');
  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    const browser = browserPaths.has(subpath);
    if (!browser && subpath !== './server') continue;
    const graph = collectBrowserGraph([path.join(installed, target.import)], {
      root: installed,
      includeDynamic: true,
    });
    const label = `${packageDefinition.name}${subpath.slice(1)}`;
    for (const specifier of graph.external) {
      const rules = browser ? serverOnlySpecifiers : browserOnlySpecifiers;
      assert.ok(!rules.some((rule) => rule.test(specifier)), `${label} imports ${specifier}`);
    }
    for (const file of graph.files) {
      const relative = path.relative(esmRoot, file).split(path.sep).join('/');
      if (browser) assert.ok(!serverOnlyFiles.test(relative), `${label} reaches server code ${relative}`);
      else assert.ok(!browserOnlyFiles.test(relative), `${label} reaches browser code ${relative}`);
    }
  }
}

async function smokePackedEntries() {
  if (packages.includes(hostPackage)) {
    // The server relays verifier calls with @seams/voice-sign/server. That package has the
    // browser capture only as an optional peer, so a server install has no ONNX runtime.
    const voiceSign = JSON.parse(
      fs.readFileSync(path.join(nodeModulesDirectory, '@seams/voice-sign/package.json'), 'utf8'),
    );
    assert.equal(voiceSign.dependencies?.['@seams/voice-capture'], undefined);
    assert.equal(voiceSign.peerDependenciesMeta?.['@seams/voice-capture']?.optional, true);
  }
  const voiceId = await import(path.join(nodeModulesDirectory, '@seams/mpc-wallet/dist/esm/voiceid.js'));
  assert.deepEqual(voiceId.voiceIdAuthMethod(), { kind: 'voiceid', transcriptionModel: 'citrinet' });
  assert.deepEqual(voiceId.voiceIdAuthMethod({ transcriptionModel: 'aurora' }), { kind: 'voiceid', transcriptionModel: 'aurora' });
  assert.ok(
    fs
      .readFileSync(path.join(nodeModulesDirectory, '@seams/mpc-wallet/dist/esm/react/styles/styles.css'), 'utf8')
      .includes('.voice-assistant-card'),
    'The MPC wallet stylesheet must carry the VoiceID card styles',
  );
  const walletClient = await import(path.join(nodeModulesDirectory, '@seams/mpc-wallet/dist/esm/client.js'));
  assert.equal(typeof walletClient.createSigningRuntime, 'function');
  assert.equal(typeof walletClient.MinimalNearClient, 'function');
  assert.equal(walletClient.PRF_FIRST_SALT_V1.length, 32);
  const walletServer = await import(path.join(nodeModulesDirectory, '@seams/mpc-wallet/dist/esm/server.js'));
  assert.equal(typeof walletServer.createApplicationAuthAssertion, 'function');

  const connectors = await import(path.join(nodeModulesDirectory, '@seams/wallet-connect/dist/esm/client.js'));
  const near = new connectors.ExternalNearController({
    network: 'testnet',
    rpcUrl: 'https://rpc.testnet.near.org',
    wallets: ['meteor', 'hot', 'intear'],
  });
  assert.equal(near.getSnapshot().connection.kind, 'disconnected');
  near.disconnect();
  assert.equal(near.getSnapshot().busy, false);
  assert.equal(connectors.nearWalletName('meteor'), 'Meteor Wallet');
  assert.equal(typeof connectors.ExternalEvmController, 'function');

  if (!packages.includes(hostPackage)) return;

  const host = await import(path.join(nodeModulesDirectory, '@seams/host/dist/esm/index.js'));
  assert.equal(typeof host.SessionService, 'function');
  const walletOrigin = await import(
    path.join(nodeModulesDirectory, '@seams/host/dist/esm/wallet-origin-html.js')
  );
  assert.match(walletOrigin.getWalletServiceHtml('/sdk'), /<script type="module" src="\/sdk\//u);
  const artifactManifest = JSON.parse(
    fs.readFileSync(path.join(nodeModulesDirectory, '@seams/host/artifact-manifest.json'), 'utf8'),
  );
  assert.equal(artifactManifest.schemaVersion, 'seams_wallet_server_artifact_manifest_v1');
  assert.equal(artifactManifest.package.name, hostPackage.name);
  assert.equal(artifactManifest.package.version, hostPackage.version);

  const hosting = await import(path.join(nodeModulesDirectory, '@seams/host/voiceid/hosting.mjs'));
  const walletPublicDirectory = path.join(nodeModulesDirectory, '@seams/mpc-wallet/dist/public');
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
  // The plugin's hashed chunks load fresh after a deploy, so every import of the Wallet's
  // fixed-path bridge must carry the Wallet version, or a browser can pair them with a cached
  // older bridge.
  const voiceIdDirectory = path.join(cliOutput, 'sdk/voiceid');
  const bridgeImports = fs
    .readdirSync(voiceIdDirectory)
    .filter((name) => name.endsWith('.js'))
    .flatMap(
      (name) =>
        fs
          .readFileSync(path.join(voiceIdDirectory, name), 'utf8')
          .match(/["'`]\.\.\/voiceid-host\.js[^"'`]*["'`]/g) ?? [],
    );
  assert.ok(bridgeImports.length > 0, 'The VoiceID host plugin must import /sdk/voiceid-host.js');
  for (const specifier of bridgeImports) {
    assert.equal(specifier.slice(1, -1), `../voiceid-host.js?v=${walletPackage.version}`);
  }
  const reportPath = path.join(repoRoot, '.artifacts/packed-wallet-boundaries/voiceid-host.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        walletVersion: walletPackage.version,
        hostVersion: hostPackage.version,
        command: 'npx --no-install seams-voiceid-host ./cli-wallet',
        installedFromTarballs: true,
        walletPackageHasNoVoiceAssets: true,
        routes,
      },
      null,
      2,
    ) + '\n',
  );
  // Speak-to-Sign is a part of the Wallet: the host serves no plugin file for it.
  assert.ok(
    !routes.some((route) => route.includes('speak-to-sign')),
    'Composed Wallet host must serve no Speak-to-Sign plugin file',
  );
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
