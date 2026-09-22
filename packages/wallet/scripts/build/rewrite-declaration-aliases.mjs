#!/usr/bin/env node
/**
 * Rewrites the internal `@/` path alias to relative specifiers in the emitted
 * declarations.
 *
 * `tsc` resolves `@/...` through this package's `paths` mapping but emits the
 * specifier verbatim, so consumers read declarations referring to an alias
 * they do not define. That does not fail loudly: a consumer with its own `@/`
 * mapping — seams-site maps it to its own `src` — resolves the import against
 * the wrong tree and TypeScript degrades the type to `any`. Every SDK type
 * reached through such an import silently stops being checked, which makes a
 * green consumer typecheck a much weaker signal than it looks.
 *
 * Emitting relative paths keeps the declarations self-contained, so they mean
 * the same thing to a consumer as they do inside this package.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const typesRoot = join(packageRoot, 'dist/types');
const emittedWasmRoot = join(packageRoot, 'dist/esm/wasm');
/* Each alias maps to a package `src` that tsc emits under its own subtree. */
const ALIAS_ROOTS = [
  { prefix: '@/', root: join(typesRoot, 'wallet/src') },
  { prefix: '@shared/', root: join(typesRoot, 'shared-ts/src') },
];

const GENERATED_WASM_TARGETS = [
  {
    source: /^(?:\.\.\/)+wasm\/near_signer\/pkg\/(.+)$/,
    outputRoot: join(emittedWasmRoot, 'near_signer/pkg'),
  },
  {
    source: /^(?:\.\.\/)+crates\/router-ab-ed25519-yao-client\/pkg\/(.+)$/,
    outputRoot: join(emittedWasmRoot, 'router_ab_ed25519_yao_client/pkg'),
  },
  {
    source: /^(?:\.\.\/)+wasm\/router_ab_ecdsa_client\/pkg\/(.+)$/,
    outputRoot: join(emittedWasmRoot, 'router_ab_ecdsa_client/pkg'),
  },
];

/** Matches the specifier in `from '<alias>x'`, `import('<alias>x')`, etc. */
const ALIAS_SPECIFIER = /(['"])(@\/|@shared\/)([^'"]+)\1/g;

async function* declarationFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* declarationFiles(path);
    else if (entry.name.endsWith('.d.ts')) yield path;
  }
}

function toRelativeSpecifier(fromFile, prefix, aliasTarget) {
  const alias = ALIAS_ROOTS.find((entry) => entry.prefix === prefix);
  if (!alias) throw new Error(`unmapped declaration alias: ${prefix}`);
  const absolute = join(alias.root, aliasTarget);
  let specifier = relative(dirname(fromFile), absolute).split('\\').join('/');
  /* A bare sibling name is a package specifier to the resolver, not a path. */
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  return specifier;
}

function toEmittedWasmSpecifier(fromFile, specifier) {
  const target = GENERATED_WASM_TARGETS.find((entry) => entry.source.test(specifier));
  if (!target) return specifier;
  const filename = specifier.match(target.source)?.[1];
  if (!filename) return specifier;
  let relativeSpecifier = relative(dirname(fromFile), join(target.outputRoot, filename))
    .split('\\')
    .join('/');
  if (!relativeSpecifier.startsWith('.')) relativeSpecifier = `./${relativeSpecifier}`;
  return relativeSpecifier;
}

let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;
for await (const file of declarationFiles(typesRoot)) {
  const source = await readFile(file, 'utf8');
  let count = 0;
  const next = source
    .replace(ALIAS_SPECIFIER, (_match, quote, prefix, target) => {
      count += 1;
      return `${quote}${toRelativeSpecifier(file, prefix, target)}${quote}`;
    })
    .replace(/(['"])(\.\.\/[^'\"]+)\1/g, (_match, quote, specifier) => {
      const rewritten = toEmittedWasmSpecifier(file, specifier);
      if (rewritten !== specifier) count += 1;
      return `${quote}${rewritten}${quote}`;
    });
  if (count === 0) continue;
  await writeFile(file, next, 'utf8');
  rewrittenFiles += 1;
  rewrittenSpecifiers += count;
}

console.log(
  `[declarations] rewrote ${rewrittenSpecifiers} alias specifier(s) across ${rewrittenFiles} file(s)`,
);
