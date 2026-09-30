#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const boundaryDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const llbcPath = process.argv[2];
if (!llbcPath) {
  console.error('usage: normalize-visible-boundary-llbc.mjs <llbc-file>');
  process.exit(1);
}

const llbc = JSON.parse(readFileSync(llbcPath, 'utf8'));
const shortNames = llbc?.translated?.short_names;
if (!Array.isArray(shortNames)) {
  console.error('expected translated.short_names array in LLBC artifact');
  process.exit(1);
}

shortNames.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));

// Charon records the absolute --dest-file; keep it relative so every checkout extracts the
// same bytes.
const options = llbc.translated.options;
if (typeof options?.dest_file === 'string' && path.isAbsolute(options.dest_file)) {
  options.dest_file = path.relative(boundaryDir, options.dest_file);
}
writeFileSync(llbcPath, JSON.stringify(llbc));
