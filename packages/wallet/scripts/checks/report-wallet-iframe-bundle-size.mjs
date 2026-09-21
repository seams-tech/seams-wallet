#!/usr/bin/env node
/**
 * Report wallet iframe boot, lazy feature closures, direct entries, CSS, workers, and WASM.
 *
 * Usage:
 *   pnpm -C packages/wallet build:prod
 *   pnpm -C packages/wallet check:bundle-size
 *   pnpm -C packages/wallet check:bundle-size -- --budget walletHostGzip=100000 --budget ecdsaWasmGzip=1500000
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { collectBrowserGraph } from './browser-module-graph.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sdkRoot = path.resolve(path.join(__dirname, '../..'));
const distRoot = path.join(sdkRoot, 'dist');
const sizeCache = new Map();

const argv = process.argv.slice(2);
const help = argv.includes('--help') || argv.includes('-h');
const jsonOutput = argv.includes('--json');

if (help) {
  console.log(
    `
[report-wallet-iframe-bundle-size] Report wallet iframe bundle sizes.

Reads from:
  - dist/esm/sdk/wallet-iframe-host-runtime.js
  - static and lazy imports reachable from the host and direct browser entries
  - dist/esm/sdk/*.css
  - dist/workers/*

Options:
  --budget key=value  Enforce an explicit byte budget, repeatable
  --json              Print machine-readable JSON
  -h,--help           Show help

Budget keys:
  walletHostGzip, walletHostBootPathGzip, walletHostStaticImportsGzip
  workerAndWasmGzip, ecdsaWasmGzip, nearWasmGzip, tempoWasmGzip
  derivationWasmGzip, walletReachableGzip
  ed25519YaoClientWasmGzip
`.trim(),
  );
  process.exit(0);
}

function formatBytes(bytes) {
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function brotliSize(buf) {
  return zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

function relFromSdk(absPath) {
  return path.relative(sdkRoot, absPath).split(path.sep).join('/');
}

function readSize(absPath) {
  const cached = sizeCache.get(absPath);
  if (cached) return cached;
  const buf = fs.readFileSync(absPath);
  const size = {
    raw: buf.length,
    gzip: gzipSize(buf),
    brotli: brotliSize(buf),
  };
  sizeCache.set(absPath, size);
  return size;
}

function parseBudgetArgs(args) {
  const budgets = new Map();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg !== '--budget') continue;
    const spec = args[i + 1];
    i += 1;
    if (!spec || !spec.includes('=')) {
      throw new Error('--budget requires key=value');
    }
    const [key, valueText] = spec.split('=', 2);
    const value = Number(valueText);
    if (!key || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid budget: ${spec}`);
    }
    budgets.set(key, Math.floor(value));
  }
  return budgets;
}

function makeRow(label, absPath, group) {
  const size = readSize(absPath);
  return {
    label,
    path: relFromSdk(absPath),
    group,
    raw: size.raw,
    gzip: size.gzip,
    brotli: size.brotli,
  };
}

function sumRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.raw += row.raw;
      acc.gzip += row.gzip;
      acc.brotli += row.brotli;
      return acc;
    },
    { raw: 0, gzip: 0, brotli: 0 },
  );
}

function printRows(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  - none');
    return;
  }
  for (const row of rows) {
    console.log(
      `  - ${row.label} (${row.path}): ${formatBytes(row.raw)} raw / ${formatBytes(row.gzip)} gzip / ${formatBytes(row.brotli)} brotli`,
    );
  }
}

let budgets;
try {
  budgets = parseBudgetArgs(argv);
} catch (err) {
  console.error(`\n[report-wallet-iframe-bundle-size] ${err.message}`);
  process.exit(1);
}

const hostAbs = path.join(distRoot, 'esm/sdk/wallet-iframe-host-runtime.js');
const workerTargets = [
  ['passkeyConfirmWorker', 'passkey confirm worker', 'dist/workers/passkey-confirm.worker.js'],
  [
    'passkeyMpcSessionWorker',
    'passkey MPC session worker',
    'dist/workers/passkey-mpc-session.worker.js',
  ],
  [
    'passkeyMpcExportWorker',
    'Passkey MPC export worker',
    'dist/workers/passkey-mpc-export.worker.js',
  ],
  ['emailOtpWorker', 'Email OTP worker', 'dist/workers/email-otp.worker.js'],
  ['nearSignerWorker', 'NEAR signer worker', 'dist/workers/near-signer.worker.js'],
  ['nearWasm', 'NEAR signer WASM', 'dist/workers/wasm_signer_worker_bg.wasm'],
  ['nearWorkerWasm', 'NEAR worker WASM alias', 'dist/workers/near_signer.wasm'],
  ['evmCryptoWorker', 'ECDSA signer worker', 'dist/workers/evm-crypto.worker.js'],
  ['ecdsaWasm', 'ECDSA signer WASM', 'dist/workers/evm_crypto.wasm'],
  ['tempoSignerWorker', 'Tempo signer worker', 'dist/workers/tempo-signer.worker.js'],
  ['tempoWasm', 'Tempo signer WASM', 'dist/workers/tempo_signer.wasm'],
  [
    'ecdsaDerivationClientWorker',
    'ECDSA bootstrap/export client worker',
    'dist/workers/ecdsa-derivation-client.worker.js',
  ],
  [
    'derivationWasm',
    'ECDSA deferred export client WASM',
    'dist/workers/router_ab_ecdsa_client_bg.wasm',
  ],
  [
    'ecdsaPresignClientWorker',
    'ECDSA presign client worker',
    'dist/workers/ecdsa-presign-client.worker.js',
  ],
  [
    'ecdsaOnlineClientWorker',
    'ECDSA online client worker',
    'dist/workers/ecdsa-online-client.worker.js',
  ],
  [
    'ed25519YaoClientWasm',
    'Ed25519 Yao client WASM',
    'dist/workers/router_ab_ed25519_yao_client_bg.wasm',
  ],
  ['shamir3PassWorker', 'Shamir3Pass worker', 'dist/workers/shamir3pass.worker.js'],
  ['shamir3PassWasm', 'Shamir3Pass WASM', 'dist/workers/shamir3pass_runtime_bg.wasm'],
  ['emailOtpRuntimeWasm', 'Email OTP runtime WASM', 'dist/workers/email_otp_runtime_bg.wasm'],
];

const missing = [];
const hostRows = [];
const staticImportRows = [];
const workerRows = [];

if (fs.existsSync(hostAbs)) {
  hostRows.push(makeRow('wallet host runtime', hostAbs, 'walletHost'));
  for (const staticImportAbs of collectBrowserGraph([hostAbs], {
    root: distRoot,
    includeDynamic: false,
  }).files.filter((filename) => filename !== hostAbs)) {
    staticImportRows.push(
      makeRow(path.basename(staticImportAbs), staticImportAbs, 'walletHostStaticImport'),
    );
  }
} else {
  missing.push(relFromSdk(hostAbs));
}

for (const [id, label, relPath] of workerTargets) {
  const absPath = path.join(sdkRoot, relPath);
  if (!fs.existsSync(absPath)) {
    missing.push(relPath);
    continue;
  }
  workerRows.push({ id, ...makeRow(label, absPath, 'workerAndWasm') });
}

const hostTotal = sumRows(hostRows);
const staticImportTotal = sumRows(staticImportRows);
const bootPathTotal = sumRows([...hostRows, ...staticImportRows]);
const workerTotal = sumRows(workerRows);

const metrics = {
  walletHostGzip: hostTotal.gzip,
  walletHostBootPathGzip: bootPathTotal.gzip,
  walletHostStaticImportsGzip: staticImportTotal.gzip,
  workerAndWasmGzip: workerTotal.gzip,
};
for (const row of workerRows) {
  if (row.id === 'ecdsaWasm') metrics.ecdsaWasmGzip = row.gzip;
  if (row.id === 'nearWasm') metrics.nearWasmGzip = row.gzip;
  if (row.id === 'tempoWasm') metrics.tempoWasmGzip = row.gzip;
  if (row.id === 'derivationWasm') metrics.derivationWasmGzip = row.gzip;
  if (row.id === 'ed25519YaoClientWasm') metrics.ed25519YaoClientWasmGzip = row.gzip;
}

const browserRoot = path.join(distRoot, 'esm/sdk');
const browserFiles = fs.readdirSync(browserRoot);
const importCache = new Map();
const bootFiles = new Set([...hostRows, ...staticImportRows].map((row) => row.path));
const reachableFiles = new Set();

function reportGraph(label, entryPaths) {
  const graph = collectBrowserGraph(entryPaths, {
    root: distRoot,
    includeDynamic: true,
    importCache,
  });
  const rows = graph.files.map((filename) => makeRow(path.basename(filename), filename, label));
  for (const filename of graph.files) reachableFiles.add(filename);
  return {
    entries: entryPaths.map(relFromSdk),
    files: rows,
    cold: sumRows(rows),
    incrementalOverRuntimeBoot: sumRows(rows.filter((row) => !bootFiles.has(row.path))),
    external: graph.external,
    unresolved: graph.unresolved,
  };
}

function findFeatureEntry(prefix) {
  const matches = browserFiles.filter(
    (filename) => filename.startsWith(`${prefix}-`) && filename.endsWith('.js'),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one ${prefix} browser entry; found ${matches.join(', ')}`);
  return path.join(browserRoot, matches[0]);
}

const flows = {
  auth: reportGraph('auth', [findFeatureEntry('runtime-auth')]),
  confirmation: reportGraph('confirmation', [findFeatureEntry('confirm-ui')]),
  export: reportGraph('export', [findFeatureEntry('export-viewer-host')]),
  recovery: reportGraph('recovery', [findFeatureEntry('runtime-recovery-codes')]),
};
const directEntries = {};
for (const filename of [
  'wallet-iframe-host-runtime.js',
  'wallet-iframe-host-near.js',
  'wallet-iframe-host-ecdsa.js',
  'wallet-iframe-host-full.js',
  'tx-confirm-ui.js',
  'wallet-shims.js',
]) {
  directEntries[filename] = reportGraph(filename, [path.join(browserRoot, filename)]);
}
const cssRows = browserFiles
  .filter((filename) => filename.endsWith('.css'))
  .sort()
  .map((filename) => makeRow(filename, path.join(browserRoot, filename), 'css'));
const reachableRows = [...reachableFiles]
  .sort()
  .map((filename) => makeRow(path.basename(filename), filename, 'reachableBrowserJavaScript'));
const reachableTotal = sumRows(reachableRows);
metrics.walletReachableGzip = reachableTotal.gzip;
const browserGraphs = {
  accounting:
    'Per-file compression, deduplicated by emitted URL within each closure. Lazy closures are conservative reachable assets, not an observed network trace. Incremental bytes exclude runtime static boot only. Independently bundled copies count separately. Workers/WASM and CSS are separate totals.',
  flows,
  directEntries,
  reachable: { files: reachableRows, total: reachableTotal },
  css: { files: cssRows, total: sumRows(cssRows) },
};

if (jsonOutput) {
  console.log(
    JSON.stringify(
      {
        sdkRoot,
        buildInputsHash: fs.existsSync(path.join(distRoot, '.build-inputs.sha256'))
          ? fs.readFileSync(path.join(distRoot, '.build-inputs.sha256'), 'utf8').trim()
          : null,
        host: hostRows,
        staticImports: staticImportRows,
        workersAndWasm: workerRows,
        totals: {
          walletHost: hostTotal,
          walletHostStaticImports: staticImportTotal,
          walletHostBootPath: bootPathTotal,
          workerAndWasm: workerTotal,
        },
        metrics,
        browserGraphs,
        missing,
      },
      null,
      2,
    ),
  );
} else {
  console.log('\n[report-wallet-iframe-bundle-size] Wallet iframe bundle sizes');
  printRows('Wallet host boot entry', hostRows);
  printRows('Wallet host static imports', staticImportRows);
  console.log(
    `\nWallet host boot-path total: ${formatBytes(bootPathTotal.raw)} raw / ${formatBytes(bootPathTotal.gzip)} gzip / ${formatBytes(bootPathTotal.brotli)} brotli`,
  );
  printRows('Wallet workers and WASM', workerRows);
  for (const [label, graph] of Object.entries(flows)) {
    console.log(
      `\n${label}: ${formatBytes(graph.cold.raw)} raw / ${formatBytes(graph.cold.gzip)} gzip / ${formatBytes(graph.cold.brotli)} brotli; incremental gzip ${formatBytes(graph.incrementalOverRuntimeBoot.gzip)}`,
    );
  }
  console.log(
    `\nReachable browser JS union: ${formatBytes(reachableTotal.raw)} raw / ${formatBytes(reachableTotal.gzip)} gzip / ${formatBytes(reachableTotal.brotli)} brotli`,
  );
  printRows('Wallet document CSS assets', cssRows);
  console.log(
    `\nWorker/WASM total: ${formatBytes(workerTotal.raw)} raw / ${formatBytes(workerTotal.gzip)} gzip / ${formatBytes(workerTotal.brotli)} brotli`,
  );
  if (missing.length) {
    console.warn(
      `\n[report-wallet-iframe-bundle-size] Missing build outputs:\n${missing
        .map((p) => `  - ${p}`)
        .join('\n')}\n\nRun 'pnpm -C packages/wallet build:prod' before using this report in CI.`,
    );
  }
}

const failures = [];
for (const [label, graph] of Object.entries({ ...flows, ...directEntries })) {
  if (graph.external.length || graph.unresolved.length) {
    failures.push(
      `${label}: incomplete graph: ${[...graph.external, ...graph.unresolved].join(', ')}`,
    );
  }
}
if (missing.length) failures.push(`Missing assets: ${missing.join(', ')}`);
for (const [key, budget] of budgets) {
  const measured = metrics[key];
  if (typeof measured !== 'number') {
    failures.push(`${key}: no measured value`);
    continue;
  }
  if (measured > budget) failures.push(`${key}: ${measured} > ${budget}`);
}

if (failures.length) {
  console.error(
    `\n[report-wallet-iframe-bundle-size] Bundle verification failed:\n${failures
      .map((failure) => `  - ${failure}`)
      .join('\n')}`,
  );
  process.exit(1);
}

if (budgets.size > 0 && !jsonOutput) {
  console.log('[report-wallet-iframe-bundle-size] OK: explicit budgets satisfied');
}
