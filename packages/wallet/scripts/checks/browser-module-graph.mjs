import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function readModuleImports(filename) {
  if (!/\.[cm]?js$/.test(filename)) return [];
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const pending = [source];
  const imports = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      imports.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      imports.push({
        specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
        expression: argument?.getText(source) ?? '',
        dynamic: true,
      });
    }
    pending.push(...node.getChildren(source));
  }
  return imports;
}

export function collectBrowserGraph(entries, { root, includeDynamic, importCache = new Map() }) {
  const files = new Set();
  const external = new Set();
  const unresolved = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const filename = pending.pop();
    if (files.has(filename)) continue;
    if (!fs.existsSync(filename)) throw new Error(`Missing browser asset: ${filename}`);
    files.add(filename);
    let imports = importCache.get(filename);
    if (!imports) {
      imports = readModuleImports(filename);
      importCache.set(filename, imports);
    }
    for (const dependency of imports) {
      if (dependency.dynamic && !includeDynamic) continue;
      if (dependency.specifier === null) {
        unresolved.add(`${path.relative(root, filename)}: import(${dependency.expression})`);
        continue;
      }
      if (!dependency.specifier.startsWith('.')) {
        external.add(dependency.specifier);
        continue;
      }
      const resolved = path.resolve(path.dirname(filename), dependency.specifier);
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(
          `Browser import escapes build directory: ${filename} -> ${dependency.specifier}`,
        );
      }
      pending.push(resolved);
    }
  }
  return {
    files: [...files].sort(),
    external: [...external].sort(),
    unresolved: [...unresolved].sort(),
  };
}
