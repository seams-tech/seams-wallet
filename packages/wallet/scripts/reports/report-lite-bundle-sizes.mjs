#!/usr/bin/env node
/**
 * Report bundle sizes (raw/gzip/brotli) for the root SDK entry and wallet-origin assets.
 *
 * Usage:
 *   pnpm -C packages/wallet build:prod
 *   pnpm -C packages/wallet size:lite
 *   pnpm -C packages/wallet size:lite:check
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectBrowserGraph } from '../checks/browser-module-graph.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sdkRoot = path.resolve(path.join(__dirname, '../..'));

const argv = process.argv.slice(2);

const HELP = argv.includes('--help') || argv.includes('-h');
const CHECK = argv.includes('--check');
const JSON_OUTPUT = argv.includes('--json');
const CONSUMERS = argv.includes('--consumers');

if (HELP) {
  console.log(
    `
[report-lite-bundle-sizes] Report individual assets and optional consumer bundles.

Reads from:
  - dist/esm/index.js
  - dist/workers/*

Options:
  --check   Enforce budgets (exit non-zero on regressions)
  --json    Print machine-readable JSON
  --consumers  Bundle root client, React provider, hosted auth menu, and their
               React composition with Bun
               in a retained temporary directory; never rebuild shared dist
  -h,--help Show help
`.trim(),
  );
  process.exit(0);
}

function fail(msg) {
  console.error(`\n[report-lite-bundle-sizes] ${msg}`);
  process.exit(1);
}

function formatBytes(bytes) {
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

function compressGzip(buf) {
  return zlib.gzipSync(buf, { level: 9 });
}

function compressBrotli(buf) {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
}

function sumSizes(rows) {
  const total = { raw: 0, gzip: 0, brotli: 0 };
  for (const row of rows) {
    total.raw += row.raw;
    total.gzip += row.gzip;
    total.brotli += row.brotli;
  }
  return total;
}

function hashBuildOutputs() {
  const hash = createHash('sha256');
  const pending = [path.join(sdkRoot, 'dist/esm')];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      if (fs.statSync(filename).isDirectory()) {
        pending.push(filename);
      } else {
        hash.update(path.relative(sdkRoot, filename));
        hash.update('\0');
        hash.update(fs.readFileSync(filename));
      }
    }
  }
  return hash.digest('hex');
}

function gitOutput(args) {
  return execFileSync('git', args, { cwd: sdkRoot, encoding: 'utf8' }).trim();
}

function reportConsumers() {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-wallet-consumers-'));
  const outputHash = hashBuildOutputs();
  const manifest = path.join(sdkRoot, 'dist/.build-inputs.sha256');
  const freshness = spawnSync('bash', ['./scripts/build/check-build-freshness.sh'], {
    cwd: sdkRoot,
    encoding: 'utf8',
  });
  const packageDefinition = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  const bun = process.env.BUN_BIN || 'bun';
  const version = execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim();
  const lockfile = path.resolve(sdkRoot, '../../pnpm-lock.yaml');
  const report = {
    accounting:
      'Production minified ESM with splitting; named exports retained. Static and all-reachable closures overlap. React peers excluded; dependencies otherwise bundled. CSS/assets separate. Per-file gzip level 9 and Brotli quality 11. No observed network or WASM traffic.',
    outputDirectory,
    revision: gitOutput(['rev-parse', 'HEAD']),
    workingTree: gitOutput([
      'status',
      '--short',
      '--',
      'src',
      'package.json',
      'rolldown.config.ts',
      '../shared-ts',
      '../../wasm',
      '../../crates',
    ]),
    packageVersion: packageDefinition.version,
    nodeVersion: process.version,
    bunVersion: version,
    lockfileSha256: createHash('sha256').update(fs.readFileSync(lockfile)).digest('hex'),
    inputBuildMode:
      'Not recorded by the existing build manifest; consumer bundles are minified in production mode.',
    buildInputsHash: fs.existsSync(manifest) ? fs.readFileSync(manifest, 'utf8').trim() : null,
    emittedEsmSha256: outputHash,
    freshness: {
      status: freshness.status === 0 ? 'fresh' : 'unverified',
      detail:
        freshness.error?.message ||
        `${freshness.stdout || ''}${freshness.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim(),
    },
    consumers: [],
  };
  const fixtures = [
    { name: 'root-client', entry: '.', exports: ['SeamsWeb', 'defineSeamsConfig'] },
    { name: 'react-provider', entry: './react/provider', exports: ['SeamsWebProvider'] },
    {
      name: 'hosted-auth-menu',
      entry: './react/hosted-seams-auth-menu',
      exports: ['HostedSeamsAuthMenu'],
    },
    {
      name: 'react-hosted-auth',
      entry: './react',
      exports: ['SeamsWebProvider', 'HostedSeamsAuthMenu'],
    },
  ];
  const excludedPeers = [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom/client',
  ];
  for (const fixture of fixtures) {
    const entry = path.resolve(sdkRoot, packageDefinition.exports[fixture.entry].import);
    const fixturePath = path.join(outputDirectory, `${fixture.name}.js`);
    fs.writeFileSync(
      fixturePath,
      `export { ${fixture.exports.join(', ')} } from ${JSON.stringify(entry)};\n`,
    );
    const bundleRoot = path.join(outputDirectory, fixture.name);
    const build = spawnSync(
      bun,
      [
        'build',
        fixturePath,
        '--outdir',
        bundleRoot,
        '--target',
        'browser',
        '--format',
        'esm',
        '--splitting',
        '--minify',
        '--define',
        'process.env.NODE_ENV="production"',
        '--external',
        'react',
        '--external',
        'react-dom',
        '--external',
        'react/*',
        '--external',
        'react-dom/*',
      ],
      { encoding: 'utf8' },
    );
    if (build.status !== 0) throw new Error(build.error?.message || build.stderr || build.stdout);
    fs.writeFileSync(
      path.join(outputDirectory, `${fixture.name}.build.log`),
      `${build.stdout}${build.stderr}`,
    );
    const files = [];
    for (const name of fs.readdirSync(bundleRoot).sort()) {
      const bytes = fs.readFileSync(path.join(bundleRoot, name));
      files.push({
        path: name,
        raw: bytes.length,
        gzip: compressGzip(bytes).length,
        brotli: compressBrotli(bytes).length,
      });
    }
    const consumer = { ...fixture, files, closures: {} };
    for (const includeDynamic of [false, true]) {
      const graph = collectBrowserGraph([path.join(bundleRoot, `${fixture.name}.js`)], {
        root: bundleRoot,
        includeDynamic,
      });
      for (const external of graph.external) {
        if (!excludedPeers.includes(external))
          throw new Error(`Unexpected external import: ${external}`);
      }
      if (graph.unresolved.length)
        throw new Error(`Incomplete consumer graph: ${graph.unresolved.join(', ')}`);
      const selected = [];
      for (const file of files) {
        if (file.path.endsWith('.js') && graph.files.includes(path.join(bundleRoot, file.path)))
          selected.push(file);
      }
      consumer.closures[includeDynamic ? 'allReachableJavaScript' : 'staticJavaScript'] = {
        ...sumSizes(selected),
        files: selected.map(fileName),
        external: graph.external,
      };
    }
    const assets = [];
    for (const file of files) if (!file.path.endsWith('.js')) assets.push(file);
    consumer.assets = { ...sumSizes(assets), files: assets.map(fileName) };
    report.consumers.push(consumer);
  }
  if (hashBuildOutputs() !== outputHash)
    throw new Error('Shared dist changed during measurement; rerun against stable outputs.');
  fs.writeFileSync(
    path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

function fileName(file) {
  return file.path;
}

const TARGETS = [
  {
    id: 'sdk-index',
    label: 'root entry file only (excludes imported dependencies)',
    relPath: 'dist/esm/index.js',
    budget: { raw: 8_000, gzip: 3_000, brotli: 3_000 },
  },
  {
    id: 'secure-confirm-worker',
    label: 'secure-confirm worker',
    relPath: 'dist/workers/passkey-confirm.worker.js',
    budget: { raw: 220_000, gzip: 38_000, brotli: 32_000 },
  },
  {
    id: 'passkey-mpc-export-worker',
    label: 'Passkey MPC export worker',
    relPath: 'dist/workers/passkey-mpc-export.worker.js',
    budget: { raw: 120_000, gzip: 30_000, brotli: 25_000 },
  },
  {
    id: 'passkey-mpc-session-worker',
    label: 'Passkey MPC session worker',
    relPath: 'dist/workers/passkey-mpc-session.worker.js',
    budget: { raw: 220_000, gzip: 38_000, brotli: 32_000 },
  },
  {
    id: 'signer-worker',
    label: 'signer worker',
    relPath: 'dist/workers/near-signer.worker.js',
    budget: { raw: 90_000, gzip: 20_000, brotli: 20_000 },
  },
  {
    id: 'ecdsa-derivation-client-worker',
    label: 'ECDSA derivation client worker',
    relPath: 'dist/workers/ecdsa-derivation-client.worker.js',
    budget: { raw: 55_000, gzip: 14_000, brotli: 14_000 },
  },
  {
    id: 'ecdsa-presign-client-worker',
    label: 'ECDSA presign client worker',
    relPath: 'dist/workers/ecdsa-presign-client.worker.js',
    budget: { raw: 55_000, gzip: 14_000, brotli: 14_000 },
  },
  {
    id: 'ecdsa-online-client-worker',
    label: 'ECDSA online client worker',
    relPath: 'dist/workers/ecdsa-online-client.worker.js',
    budget: { raw: 45_000, gzip: 12_000, brotli: 12_000 },
  },
  {
    id: 'ecdsa-derivation-client-wasm',
    label: 'ECDSA derivation client WASM',
    relPath: 'dist/workers/router_ab_ecdsa_client_bg.wasm',
    budget: { raw: 630_000, gzip: 250_000, brotli: 200_000 },
  },
  {
    id: 'ed25519-yao-client-wasm',
    label: 'Ed25519 Yao client WASM',
    relPath: 'dist/workers/router_ab_ed25519_yao_client_bg.wasm',
    budget: { raw: 556_435, gzip: 223_677, brotli: 223_677 },
  },
  {
    id: 'wasm-signer',
    label: 'wasm signer',
    relPath: 'dist/workers/wasm_signer_worker_bg.wasm',
    budget: { raw: 900_000, gzip: 360_000, brotli: 340_000 },
  },
];

const rows = [];
const missing = [];

for (const t of TARGETS) {
  const abs = path.join(sdkRoot, t.relPath);
  if (!fs.existsSync(abs)) {
    missing.push(t.relPath);
    continue;
  }

  const buf = fs.readFileSync(abs);
  const gzip = compressGzip(buf);
  const brotli = compressBrotli(buf);

  rows.push({
    id: t.id,
    label: t.label,
    path: t.relPath,
    raw: buf.length,
    gzip: gzip.length,
    brotli: brotli.length,
    budget: t.budget,
  });
}

if (missing.length) {
  const hint = `Missing build outputs:\n${missing.map((p) => `  - ${p}`).join('\n')}\n\nDid you run 'pnpm -C packages/wallet build:prod' (or 'build:sdk')?`;
  if (CHECK) fail(hint);
  console.warn(`\n[report-lite-bundle-sizes] ${hint}`);
}

const totals = rows.reduce(
  (acc, r) => {
    acc.raw += r.raw;
    acc.gzip += r.gzip;
    acc.brotli += r.brotli;
    return acc;
  },
  { raw: 0, gzip: 0, brotli: 0 },
);

const consumers = CONSUMERS ? reportConsumers() : null;

if (JSON_OUTPUT) {
  console.log(
    JSON.stringify(
      {
        sdkRoot,
        accounting:
          'Selected individual asset inventory only; totals are not an application bundle or a page-load download. Compression is per file.',
        targets: rows,
        totals,
        missing,
        consumers,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    '\n[report-lite-bundle-sizes] Selected individual assets (raw / gzip / brotli); excludes import closures:',
  );
  for (const r of rows) {
    console.log(
      `- ${r.label} (${r.path}): ${formatBytes(r.raw)} / ${formatBytes(r.gzip)} / ${formatBytes(r.brotli)}`,
    );
  }
  console.log(
    `\n[report-lite-bundle-sizes] Selected inventory sum, not page-load size: ${formatBytes(totals.raw)} / ${formatBytes(totals.gzip)} / ${formatBytes(
      totals.brotli,
    )}`,
  );
  if (consumers) {
    for (const consumer of consumers.consumers) {
      const initial = consumer.closures.staticJavaScript;
      const all = consumer.closures.allReachableJavaScript;
      console.log(
        `${consumer.name}: static gzip ${formatBytes(initial.gzip)}; all reachable JS gzip ${formatBytes(all.gzip)}; separate assets gzip ${formatBytes(consumer.assets.gzip)}`,
      );
    }
    console.log(
      `Build freshness: ${consumers.freshness.status}; evidence: ${consumers.outputDirectory}/report.json`,
    );
  }
}

if (CHECK) {
  const failures = [];
  for (const r of rows) {
    const b = r.budget;
    if (!b) continue;
    if (typeof b.raw === 'number' && r.raw > b.raw)
      failures.push(`${r.path}: raw ${r.raw} > ${b.raw}`);
    if (typeof b.gzip === 'number' && r.gzip > b.gzip)
      failures.push(`${r.path}: gzip ${r.gzip} > ${b.gzip}`);
    if (typeof b.brotli === 'number' && r.brotli > b.brotli)
      failures.push(`${r.path}: brotli ${r.brotli} > ${b.brotli}`);
  }

  if (failures.length) {
    fail(`Bundle size budgets exceeded:\n${failures.map((l) => `  - ${l}`).join('\n')}`);
  }

  console.log('[report-lite-bundle-sizes] OK: budgets satisfied');
}
