#!/usr/bin/env node
// Fails when a tracked code, configuration or test file names a package that Release A renamed.
// Prose keeps the old names where it maps them to the new ones or records an earlier release, so
// Markdown and the docs folder are out of scope; the packed-package check covers the shipped files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldName = /@seams\/(?:wallet|wallet-server|voiceid|wallet-cli)(?![\w-])/u;
const checked = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|sh|css|html)$/u;
const skipped = [/^docs\//u, /^pnpm-lock\.yaml$/u, /^scripts\/check-package-names\.mjs$/u, /^tests\/scripts\/check-packed-wallet-boundaries\.mjs$/u];

const offenders = [];
const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0');
for (const file of files) {
  if (!file || !checked.test(file) || skipped.some((pattern) => pattern.test(file))) continue;
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute)) continue;
  const lines = fs.readFileSync(absolute, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (oldName.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
  });
}
if (offenders.length > 0) {
  console.error(`[check-package-names] old package names in ${offenders.length} lines:`);
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}
console.log('[check-package-names] passed');
