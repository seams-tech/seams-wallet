// Fails when a tracked Cargo.lock no longer matches its workspace's manifests, which every
// `cargo --locked` build then rejects. The repository has one lock file per workspace, and
// workspaces depend on each other by path, so a manifest change in one crate can stale the
// lock of every workspace that uses it.
//
//   pnpm check:cargo-locks             check every tracked Cargo.lock
//   pnpm check:cargo-locks --offline   the same, without network access
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const offline = process.argv.includes('--offline');

const locks = execFileSync('git', ['ls-files', '*Cargo.lock'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const failures = [];
for (const lock of locks) {
  const manifest = path.join(path.dirname(lock), 'Cargo.toml');
  const args = ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest];
  if (offline) args.push('--offline');
  const result = spawnSync('cargo', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) {
    console.error(`Could not run cargo: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    const reason = result.stderr.split('\n').find((line) => line.trim()) ?? 'cargo metadata failed';
    failures.push({ manifest, reason: reason.trim() });
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} of ${locks.length} Cargo.lock files do not pass --locked:`);
  for (const { manifest, reason } of failures) {
    console.error(`  ${manifest}\n    ${reason}`);
  }
  console.error(
    '\nIf a lock file is out of date, bring it up to date without changing any other version:',
  );
  for (const { manifest } of failures) {
    console.error(`  cargo update --workspace --manifest-path ${manifest}`);
  }
  process.exit(1);
}
console.log(`All ${locks.length} Cargo.lock files pass --locked.`);
