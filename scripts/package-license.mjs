#!/usr/bin/env node

import { copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoLicense = fileURLToPath(new URL('../LICENSE.md', import.meta.url));
const packageLicense = path.join(process.cwd(), 'LICENSE.md');
const command = process.argv[2];

if (command === 'stage') {
  copyFileSync(repoLicense, packageLicense);
} else if (command === 'clean') {
  rmSync(packageLicense, { force: true });
} else {
  throw new Error('Usage: package-license.mjs <stage|clean>');
}
