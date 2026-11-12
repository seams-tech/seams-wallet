// A release reuses the Rust outputs of the newest published @seams/wallet-server when none of
// their inputs changed since the commit that package was built from (its gitHead):
//
//   workers      crates/router-ab-cloudflare/build/<role>, from `pnpm build:workers`
//                (about 17 minutes of the release build, and 2 more to install worker-build)
//   local-tools  crates/router-ab-cloudflare/build/local-tools/<platform>, from
//                scripts/build-local-tools.mjs (a macOS runner per Mac platform)
//
//   node scripts/reuse-published-rust-outputs.mjs <workers|local-tools> [--check]
//
// It prints why it reuses or builds, and writes reuse=true or reuse=false to $GITHUB_OUTPUT.
// With reuse=true the published files are in place. --check decides and copies nothing.
//
// The outputs are reused only when all of these are true:
//   - the gitHead commit is in this checkout (a release checks out with fetch-depth 0);
//   - scripts/rust-build-inputs.mjs gives the same hash for the output at gitHead and HEAD;
//   - for the Workers, the release workflow pins the same worker-build version at both;
//   - each published binary names the commit of the rustc on PATH, and no other.
//
// A fresh build of the same inputs gives the same bytes. The release builds of 0.68.1 and
// 0.69.0 (a680d22f6 and 7a925ca86, no Rust change between them) built every Worker and the
// Linux local tool from source, and every file is the same, except the build time
// (started_at_ms) in each Worker's build-stamp.json. Only the repository's own Worker tests
// read that time. (Both releases reused the Mac local tools of an earlier package.)
//
// The WASM packages (wasm/*/pkg) are not reusable: the Wallet tarball carries the .wasm files
// but not all of the wasm-bindgen output that the SDK build reads (for example
// tempo_signer.js, the pkg/package.json files and several .d.ts files).
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

const packageName = '@seams/wallet-server';
const buildDir = 'crates/router-ab-cloudflare/build';
const releaseWorkflow = '.github/workflows/release-wallet-packages.yml';
// The same roles as `build:workers` in package.json and copy-cloudflare-router-runtime.mjs.
const workerRoles = ['router', 'deriver-a', 'deriver-b', 'signing-worker', 'tenant-root-control-plane'];
const localToolPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64'];

const outputs = {
  workers: {
    // The tarball directory, the checkout directory, and the binary rustc built in it.
    dirs: workerRoles.map((role) => ({
      packed: `cloudflare-router-ab/build/${role}`,
      target: `${buildDir}/${role}`,
      binary: 'index_bg.wasm',
    })),
    // worker-build writes this file; copy-cloudflare-router-runtime.mjs leaves it out of the
    // package. Writing it back makes each directory the same as a fresh build.
    gitignore: '*',
  },
  'local-tools': {
    dirs: localToolPlatforms.map((platform) => ({
      packed: `cloudflare-router-ab/build/local-tools/${platform}`,
      target: `${buildDir}/local-tools/${platform}`,
      binary: 'router_ab_local_init',
      executable: true,
    })),
  },
};

const name = process.argv[2];
const output = outputs[name];
if (!output) {
  console.error(`usage: reuse-published-rust-outputs.mjs <${Object.keys(outputs).join('|')}> [--check]`);
  process.exit(2);
}
const checkOnly = process.argv.includes('--check');

const version = run('npm', ['view', packageName, 'version']);
const source = `${packageName}@${version}`;
const sourceCommit = run('npm', ['view', source, 'gitHead']);
const workDir = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'published-rust-outputs-'));
let decision;
try {
  decision = decide();
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
console.log(decision.reason);
const { reuse } = decision;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${reuse}\n`);

// Says whether to reuse the outputs, and why. Before it says to reuse them, it copies them into place.
function decide() {
  const build = (why) => ({ reuse: false, reason: `Building ${name}: ${why}` });
  try {
    run('git', ['cat-file', '-e', `${sourceCommit}^{commit}`]);
  } catch {
    return build(`${source} was built from ${sourceCommit}, which this checkout does not have.`);
  }

  const inputsHash = (commit) =>
    run('node', ['scripts/rust-build-inputs.mjs', '--outputs', name, '--commit', commit]);
  if (inputsHash(sourceCommit) !== inputsHash('HEAD')) {
    return build(`its inputs changed since ${source} (${sourceCommit}).`);
  }

  if (name === 'workers') {
    const pin = (text) => text.match(/cargo install worker-build --version (\S+)/)?.[1];
    const sourcePin = pin(run('git', ['show', `${sourceCommit}:${releaseWorkflow}`]));
    const headPin = pin(readFileSync(path.join(root, releaseWorkflow), 'utf8'));
    if (!sourcePin || sourcePin !== headPin) {
      return build(`worker-build ${headPin ?? '(no pin)'} differs from ${sourcePin ?? '(no pin)'} at ${sourceCommit}.`);
    }
  }

  const rustcCommit = run('rustc', ['-vV']).match(/^commit-hash: ([0-9a-f]{40})$/m)?.[1];
  if (!rustcCommit) return build('rustc -vV names no commit-hash.');

  // npm pack checks the tarball against the integrity hash in the registry.
  const tarball = JSON.parse(run('npm', ['pack', source, '--pack-destination', workDir, '--json']))[0].filename;
  run('tar', ['-xzf', path.join(workDir, tarball), '-C', workDir]);
  const packed = (dir) => path.join(workDir, 'package', dir);

  for (const dir of output.dirs) {
    const binary = path.join(packed(dir.packed), dir.binary);
    if (!existsSync(binary)) return build(`${source} has no ${dir.packed}/${dir.binary}.`);
    // A Rust binary keeps the standard library source paths of its panic messages, and
    // each path names the rustc commit: /rustc/<commit>/library/...
    const named = new Set(
      [...readFileSync(binary).toString('latin1').matchAll(/\/rustc\/([0-9a-f]{40})\//g)].map((m) => m[1]),
    );
    if (named.size !== 1 || !named.has(rustcCommit)) {
      return build(`${dir.packed}/${dir.binary} names rustc ${[...named].join(', ') || '(none)'}, not ${rustcCommit}.`);
    }
  }

  if (!checkOnly) {
    for (const dir of output.dirs) {
      const target = path.join(root, dir.target);
      rmSync(target, { recursive: true, force: true });
      cpSync(packed(dir.packed), target, { recursive: true });
      if (output.gitignore) writeFileSync(path.join(target, '.gitignore'), output.gitignore);
      if (dir.executable) chmodSync(path.join(target, dir.binary), 0o755);
    }
  }
  return {
    reuse: true,
    reason: `Reusing ${name} of ${source} (${sourceCommit}): no input changed since then, and rustc ${rustcCommit} built it.`,
  };
}
