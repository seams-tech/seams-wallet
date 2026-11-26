#!/usr/bin/env node
// Rewrites the shared-helper aliases in a package's emitted declarations (`dist/types`) to
// relative paths, so a consumer resolves them without this repository's `paths` mapping. It also
// drops stylesheet side-effect imports, which a consumer that type-checks them cannot resolve.
// Run it from the package directory after the declaration build.
import fs from 'node:fs';
import path from 'node:path';

const typesRoot = path.join(process.cwd(), 'dist/types');
const sharedTypesRoot = path.join(typesRoot, 'shared-ts/src');
const STYLESHEET_IMPORT = /^import\s+(['"])[^'"\r\n]+\.css\1;\r?\n/gm;

function listDeclarationFiles(directory) {
  const declarations = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      declarations.push(...listDeclarationFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      declarations.push(entryPath);
    }
  }
  return declarations;
}

function toModuleSpecifier(value) {
  const posixValue = value.split(path.sep).join('/');
  return posixValue.startsWith('.') ? posixValue : `./${posixValue}`;
}

function replaceSharedSpecifier(declarationPath, source) {
  const relativeSharedRoot = toModuleSpecifier(
    path.relative(path.dirname(declarationPath), sharedTypesRoot),
  );
  return source
    .replace(STYLESHEET_IMPORT, '')
    .replaceAll('@seams-internal/shared-ts/', `${relativeSharedRoot}/`)
    .replaceAll('@shared/', `${relativeSharedRoot}/`);
}

for (const declarationPath of listDeclarationFiles(typesRoot)) {
  const source = fs.readFileSync(declarationPath, 'utf8');
  const rewritten = replaceSharedSpecifier(declarationPath, source);
  if (rewritten !== source) {
    fs.writeFileSync(declarationPath, rewritten);
  }
}
