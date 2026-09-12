import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
const platforms = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
};
const platform = target ? platforms[target] : process.platform + '-' + process.arch;
if (!platform) throw new Error('Unsupported local-tools target: ' + target);
const args = ['build', '--locked', '--release', '--manifest-path', 'crates/router-ab-dev/Cargo.toml', '--bin', 'router_ab_local_init'];
if (target) args.push('--target', target);
const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const output = path.join(root, 'crates/router-ab-cloudflare/build/local-tools', platform);
mkdirSync(output, { recursive: true });
const binary = path.join(output, 'router_ab_local_init');
copyFileSync(path.join(root, 'crates/router-ab-dev/target', target ?? '', 'release/router_ab_local_init'), binary);
chmodSync(binary, 0o755);
