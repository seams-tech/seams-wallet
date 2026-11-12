// The inputs of the Rust outputs that validate-wallet.yml caches: the WASM packages, the
// Ed25519 Yao client package, the release Workers and the local tools.
//
//   node scripts/rust-build-inputs.mjs                   print the cache-key hash
//   node scripts/rust-build-inputs.mjs --list            print each hashed input
//   node scripts/rust-build-inputs.mjs --check-dep-info  after a build, fail when rustc read
//                                                        a repository file the hash omits
//
// The hash covers every tracked file in the directory of each path package that
// `cargo metadata` resolves for a built manifest. Each built manifest's Cargo.lock sits in
// that directory and pins every registry and git package. A new path dependency enters the
// hash on its own: the resolve lists it as soon as a manifest names it. A crate that no
// built manifest resolves is not an input.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter(Boolean);
const tracked = new Set(git(['ls-tree', '-r', '--name-only', 'HEAD']));

// One manifest per cached output: build-wasm.sh builds every crate in wasm/ and the Yao
// client, build-strict-worker.sh the Workers, build-local-tools.mjs the local tools.
const builtManifests = [
  ...[...tracked].filter((file) => /^wasm\/[^/]+\/Cargo\.toml$/.test(file)),
  'crates/router-ab-ed25519-yao-client/Cargo.toml',
  'crates/router-ab-cloudflare/Cargo.toml',
  'crates/router-ab-dev/Cargo.toml',
];

// The scripts that run the build, besides those inside the package directories.
const buildScripts = [
  '.github/workflows/validate-wallet.yml',
  'packages/wallet/build-paths.sh',
  'packages/wallet/scripts/build',
  'scripts/build-local-tools.mjs',
  'scripts/rust-build-inputs.mjs',
];

// Only the package.json entries that run the build: a release changes each package's
// version, and no Rust output depends on it. pnpm also runs a pre or post entry if one exists.
const packageScripts = {
  'package.json': ['build:wasm', 'build:workers', 'build:local-tools'],
  'packages/wallet/package.json': ['build:wasm'],
};

function pathPackageDirs(manifest) {
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest],
      { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 },
    ),
  );
  return metadata.packages
    .filter((pkg) => pkg.source === null)
    .map((pkg) => {
      const relative = path.relative(root, pkg.manifest_path);
      if (!tracked.has(relative)) {
        throw new Error(`${manifest} resolves ${pkg.manifest_path}, which git does not track`);
      }
      return path.dirname(relative);
    });
}

const packageDirs = [...new Set(builtManifests.flatMap(pathPackageDirs))].sort();

// Cargo reads .cargo/config.toml, and rustup reads rust-toolchain files, in the directory a
// build starts in and in each directory above it. A path that does not exist hashes nothing.
const cargoSettings = new Set();
for (const dir of packageDirs) {
  for (let at = dir; ; at = path.dirname(at)) {
    for (const name of ['.cargo', 'rust-toolchain', 'rust-toolchain.toml']) {
      cargoSettings.add(path.join(at, name));
    }
    if (at === '.') break;
  }
}

const hashedPaths = [...packageDirs, ...cargoSettings, ...buildScripts];

if (process.argv.includes('--check-dep-info')) {
  checkDepInfo();
} else {
  const inputs = [
    ...git(['ls-tree', '-r', 'HEAD', '--', ...hashedPaths]),
    ...Object.entries(packageScripts).flatMap(([file, names]) => {
      const { scripts } = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      return names
        .flatMap((name) => [`pre${name}`, name, `post${name}`])
        .map((name) => `${file} ${name} ${JSON.stringify(scripts[name] ?? null)}`);
    }),
  ];
  if (process.argv.includes('--list')) {
    console.log(inputs.join('\n'));
  } else {
    console.log(createHash('sha256').update(inputs.join('\n')).digest('hex').slice(0, 40));
  }
}

// Rustc writes a dep-info (.d) file that names every source file it read, including files
// that include_bytes! or #[path] reach outside a package directory. After a build in a fresh
// checkout, each target directory holds only that build's dep-info.
function checkDepInfo() {
  const covered = new Set(git(['ls-tree', '-r', '--name-only', 'HEAD', '--', ...hashedPaths]));
  const missing = new Map();
  const read = new Set();
  for (const manifest of [...tracked].filter((file) => path.basename(file) === 'Cargo.toml')) {
    const workspace = path.join(root, path.dirname(manifest));
    const target = path.join(workspace, 'target');
    const depInfos = existsSync(target) ? depInfoFiles(target) : [];
    if (depInfos.length === 0 && builtManifests.includes(manifest)) {
      throw new Error(`${path.relative(root, target)} holds no dep-info; build ${manifest} first`);
    }
    for (const depInfo of depInfos) {
      for (const dependency of dependencies(readFileSync(depInfo, 'utf8'))) {
        // Rustc names sources relative to the workspace root it runs in.
        const absolute = path.resolve(workspace, dependency);
        const file = path.relative(root, absolute);
        if (file.startsWith('..') || absolute.startsWith(target + path.sep)) continue;
        read.add(file);
        if (!covered.has(file)) missing.set(file, path.relative(root, depInfo));
      }
    }
  }
  if (missing.size > 0) {
    console.error(`Rustc read ${missing.size} repository files that the cache key omits:`);
    for (const [file, depInfo] of missing) console.error(`  ${file}\n    named in ${depInfo}`);
    process.exit(1);
  }
  console.log(`The cache key covers all ${read.size} repository files that rustc read.`);
}

function depInfoFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return depInfoFiles(file);
    return entry.name.endsWith('.d') ? [file] : [];
  });
}

// A dep-info file is a makefile: `output: source source ...`, then one `source:` rule per
// source. Spaces in a path are escaped with a backslash; `#` lines record env and checksums.
function dependencies(text) {
  return text
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .flatMap((line) => line.replace(/(?<!\\):(\s|$)/, ' ').split(/(?<!\\)\s+/))
    .filter(Boolean)
    .map((file) => file.replace(/\\ /g, ' '));
}
