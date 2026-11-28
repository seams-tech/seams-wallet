#!/usr/bin/env node
// A Speak-to-Sign verifier backend is one module on each side, so that it can be swapped in and
// out. This check reads the import graph (with the TypeScript preprocessor, not
// the source text) and fails when:
// - a file outside a backend module imports a backend's library;
// - a file other than the backend selector of its side imports a backend module;
// - a file other than the evidence checker or a backend module imports an evidence kind's module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  'packages/mpc-wallet/src',
  'packages/mpc-wallet-server/src',
  'packages/shared-ts/src',
];
const aliases = [
  ['@/', 'packages/mpc-wallet/src/'],
  ['@shared/', 'packages/shared-ts/src/'],
];

const serverBackends = 'packages/mpc-wallet-server/src/router/domains/speakToSign/backends/';
const sdkBackends = 'packages/mpc-wallet/src/core/transactionFeatures/verifiers/';
const evidenceKinds = 'packages/shared-ts/src/speakToSign/evidence/';
const evidenceChecker = 'packages/shared-ts/src/speakToSign/evidence.ts';

/** The libraries of each backend, and the paths that may import them. */
const libraries = [
  {
    backend: 'OutLayer',
    name: /^@seams\/voice-sign(?:\/|$)/u,
    owners: [`${serverBackends}outlayer/`],
  },
  {
    backend: 'OutLayer',
    name: /^@seams\/voice-verdict(?:\/|$)/u,
    owners: [
      `${serverBackends}outlayer/`,
      `${sdkBackends}outlayer/`,
      `${evidenceKinds}voiceVerdictV2.ts`,
    ],
  },
  {
    backend: 'SaySo',
    name: /^@seams\/sayso-verdict(?:\/|$)/u,
    owners: [
      `${serverBackends}sayso/`,
      `${sdkBackends}sayso/`,
      `${evidenceKinds}saysoVerdictV1.ts`,
    ],
  },
];

/**
 * The summary of a spoken note is not a part of the verifier. These
 * files use the summary helpers of the same libraries, and only these exact imports.
 */
const summaryImports = new Map([
  [
    'packages/mpc-wallet-server/src/router/domains/speakToSign/speakToSignSummary.ts',
    '@seams/voice-sign/server',
  ],
  [
    'packages/mpc-wallet/src/core/transactionFeatures/hostOperations.ts',
    '@seams/voice-sign/summary',
  ],
  ['packages/shared-ts/src/speakToSign/spokenSummary.ts', '@seams/voice-verdict'],
]);

/** Each backend module, and the one selector of its side that may import it from outside. */
const modules = ['outlayer', 'sayso'].flatMap((backend) => [
  { folder: `${serverBackends}${backend}/`, selector: `${serverBackends}select.ts` },
  { folder: `${sdkBackends}${backend}/`, selector: `${sdkBackends}backend.ts` },
]);

function* sourceFiles(folder) {
  for (const entry of fs.readdirSync(path.join(repoRoot, folder), { withFileTypes: true })) {
    const relative = `${folder}/${entry.name}`;
    if (entry.isDirectory()) yield* sourceFiles(relative);
    else if (/\.(?:[cm]?ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts'))
      yield relative;
  }
}

/** The repository path that a specifier names, or null for a package. */
function resolveSpecifier(file, specifier) {
  if (specifier.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  }
  for (const [alias, target] of aliases) {
    if (specifier.startsWith(alias)) return `${target}${specifier.slice(alias.length)}`;
  }
  return null;
}

const offenders = [];
for (const folder of sources) {
  for (const file of sourceFiles(folder)) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    const { importedFiles } = ts.preProcessFile(text, true, true);
    for (const { fileName: specifier } of importedFiles) {
      for (const library of libraries) {
        if (!library.name.test(specifier)) continue;
        const owned = library.owners.some((owner) => file === owner || file.startsWith(owner));
        if (!owned && summaryImports.get(file) !== specifier) {
          offenders.push(
            `${file}: imports ${specifier}, a library of the ${library.backend} backend`,
          );
        }
      }
      const target = resolveSpecifier(file, specifier);
      if (target === null) continue;
      if (
        target.startsWith(evidenceKinds) &&
        file !== evidenceChecker &&
        !file.startsWith(evidenceKinds) &&
        !modules.some((backend) => file.startsWith(backend.folder))
      ) {
        offenders.push(
          `${file}: imports ${specifier}; only ${evidenceChecker} and a backend module may import it`,
        );
      }
      for (const backend of modules) {
        if (
          target.startsWith(backend.folder) &&
          !file.startsWith(backend.folder) &&
          file !== backend.selector
        ) {
          offenders.push(
            `${file}: imports ${specifier}; only ${backend.selector} may import that module`,
          );
        }
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `[check-speak-to-sign-backends] ${offenders.length} imports cross a backend module:`,
  );
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}
console.log('[check-speak-to-sign-backends] each verifier backend is behind its port');
