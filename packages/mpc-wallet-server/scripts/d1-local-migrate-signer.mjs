#!/usr/bin/env node
// Applies the signer migrations to the local D1 database `seams-signer` of a wrangler config.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const options = parseArguments(process.argv.slice(2));
const configPath = path.resolve(
  options.config || process.env.SEAMS_D1_LOCAL_WRANGLER_CONFIG || 'wrangler.d1-local.toml',
);
const persistTo =
  options.persistTo || process.env.SEAMS_D1_LOCAL_PERSIST_TO || '.wrangler/state/seams-d1';
const result = spawnSync(
  'wrangler',
  [
    'd1',
    'migrations',
    'apply',
    'seams-signer',
    '--local',
    '--persist-to',
    persistTo,
    '--config',
    configPath,
  ],
  { cwd: path.dirname(configPath), stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function parseArguments(args) {
  const options = { config: '', persistTo: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--config' || argument === '--persist-to') {
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      if (argument === '--config') options.config = value;
      if (argument === '--persist-to') options.persistTo = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}
