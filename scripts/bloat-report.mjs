// Reports how much of the codebase is dead, duplicated or boilerplate, and how each
// number moved since scripts/bloat-baseline.json.
//
//   pnpm report:bloat                    the report, with changes since the baseline
//   pnpm report:bloat --check            also fail when a RATCHETED measure grew
//   pnpm report:bloat --write-baseline   record the current numbers as the baseline
//   pnpm report:bloat --rev <commit>     measure a commit instead of the working tree
//
// Usage is textual: an export counts as used when any other tracked file names it, so a
// name shared by unrelated code hides dead code rather than inventing it. Duplication
// counts exact repeats of 10 meaningful lines (blank, comment, import and brace-only lines
// dropped), so renamed copies are not counted.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const self = 'scripts/bloat-report.mjs';
const baselinePath = path.join(root, 'scripts/bloat-baseline.json');
const ts = createRequire(path.join(root, 'packages/wallet/package.json'))('typescript');
const revAt = process.argv.indexOf('--rev');
const rev = revAt > 0 ? process.argv[revAt + 1] : null;
const sourceRoot = rev ? mkdtempSync(path.join(tmpdir(), 'bloat-report-')) : root;
if (rev) {
  execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', rev, sourceRoot], {
    cwd: root,
  });
}

// Measures that are waste whatever the feature work, so any growth is new waste. The
// others grow with the codebase and are only reported.
const RATCHETED = [
  'deadExports',
  'filesOver2000',
  'helperCopies',
  'refactorCitations',
  'rustAllowDeadCode',
  'rustDuplicatedLines',
  'tsDuplicatedLines',
];
const WINDOW = 10;
const VALIDATION = /^(parse|assert|require|is|normalize|expect|validate|decode|coerce)[A-Z]/;
const HELPERS = new Set([
  'asRecord',
  'assertExactKeys',
  'exactRecord',
  'expectExactKeys',
  'hasOwn',
  'isNonEmptyString',
  'isObject',
  'isPlainObject',
  'isRecord',
  'requireArray',
  'requireBoolean',
  'requireExactRecord',
  'requireInteger',
  'requireNonEmptyString',
  'requireNumber',
  'requireRecord',
  'requireString',
  'requiredInteger',
  'requiredString',
]);
const LANGUAGE = { ts: 'ts', tsx: 'ts', rs: 'rust', js: 'js', mjs: 'js', cjs: 'js' };
const TEST_FILE = /^tests\/|\.(typecheck|test|spec)\.tsx?$|\/__tests__\//;

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const tracked = (rev ? git('ls-tree', '-r', '--name-only', rev) : git('ls-files')).split('\n');
const texts = new Map();
function read(file) {
  if (!texts.has(file)) {
    try {
      texts.set(file, readFileSync(path.join(sourceRoot, file), 'utf8'));
    } catch {
      texts.set(file, null); // deleted in the working tree
    }
  }
  return texts.get(file);
}

function measureSize() {
  const code = { ts: 0, rust: 0, js: 0 };
  const files = [];
  for (const file of tracked) {
    const language = LANGUAGE[path.extname(file).slice(1)];
    const text = language ? read(file) : null;
    if (!text) continue;
    let inComment = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (inComment || line.startsWith('/*')) inComment = !line.includes('*/');
      else if (line && !line.startsWith('//')) code[language]++;
    }
    files.push({ file, lines: text.split('\n').length });
  }
  files.sort((a, b) => b.lines - a.lines);
  const large = files.filter((f) => f.lines > 2000);
  return {
    code,
    large,
    largest: files.slice(0, 8),
    lines: new Map(files.map((f) => [f.file, f.lines])),
  };
}

function measureDuplication(language) {
  const pattern = language === 'rust' ? /\.rs$/ : /\.tsx?$/;
  const skip =
    language === 'rust'
      ? /^(\/\/|\/\*|\*|use |pub use |mod |pub mod |#\[(derive|cfg|test|allow))/
      : /^(\/\/|\/\*|\*|import |export \* from|\} from ')/;
  const punctuation = /^[\s\])};,:>|&(<{=]*$/;
  const files = tracked.filter((f) => pattern.test(f) && !f.endsWith('.d.ts') && read(f));
  const lineIds = new Map();
  const perFile = files.map((file) =>
    read(file)
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter((line) => line && !skip.test(line) && !punctuation.test(line))
      .map((line) => {
        if (!lineIds.has(line)) lineIds.set(line, lineIds.size);
        return lineIds.get(line);
      }),
  );
  const windows = new Map();
  perFile.forEach((ids, fileIndex) => {
    for (let start = 0; start + WINDOW <= ids.length; start++) {
      const key = ids.slice(start, start + WINDOW).join(',');
      const seen = windows.get(key);
      if (seen) seen.push(fileIndex, start);
      else windows.set(key, [fileIndex, start]);
    }
  });
  const duplicated = perFile.map((ids) => new Uint8Array(ids.length));
  const pairs = new Map();
  for (const flat of windows.values()) {
    if (flat.length < 4) continue;
    const hits = [];
    for (let i = 0; i < flat.length; i += 2) {
      const [fileIndex, start] = [flat[i], flat[i + 1]];
      if (hits.every(([f, s]) => f !== fileIndex || Math.abs(s - start) >= WINDOW)) {
        hits.push([fileIndex, start]);
      }
    }
    if (hits.length < 2) continue;
    for (const [fileIndex, start] of hits) duplicated[fileIndex].fill(1, start, start + WINDOW);
    const owners = [...new Set(hits.map(([f]) => files[f]))].sort();
    const keys =
      owners.length === 1
        ? [`${owners[0]} (repeats itself)`]
        : owners.flatMap((a, i) => owners.slice(i + 1).map((b) => `${a}\n      ${b}`));
    for (const key of keys) pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const meaningful = perFile.reduce((sum, ids) => sum + ids.length, 0);
  const repeated = duplicated.reduce((sum, d) => sum + d.reduce((s, x) => s + x, 0), 0);
  const topPairs = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { meaningful, repeated, topPairs };
}

function resolveModule(fromFile, specifier) {
  let base;
  if (specifier.startsWith('.')) base = path.join(path.dirname(fromFile), specifier);
  else if (specifier.startsWith('@/')) base = `packages/wallet/src/${specifier.slice(2)}`;
  else if (specifier.startsWith('@shared/')) base = `packages/shared-ts/src/${specifier.slice(8)}`;
  else return null;
  base = base.replace(/\.(js|mjs|ts|tsx)$/, '');
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((c) => existsSync(path.join(sourceRoot, c))) ?? null;
}

// A package's build decides which sources its published files come from: a Rolldown
// config object with a single-file input names its output with entryFileNames, and the
// output path need not match the source path (src/router/express-adaptor.ts is published
// as router/express.js). Every such standalone bundle, and every object-form input, counts
// as an entry point whether or not package.json exports it.
function rolldownEntries(dir) {
  const text = read(`${dir}/rolldown.config.ts`) ?? '';
  const byOutput = new Map();
  const standalone = [];
  const source = (p) => path.normalize(path.join(dir, p));
  for (const [, input, output] of text.matchAll(
    /input:\s*'([^']+)'[\s\S]*?entryFileNames:\s*'([^']+)'/g,
  )) {
    if (!/\.tsx?$/.test(input)) continue;
    standalone.push(source(input));
    if (!output.includes('[')) byOutput.set(output, source(input));
  }
  for (const [, body] of text.matchAll(/input:\s*\{([^}]*)\}/g)) {
    for (const [, input] of body.matchAll(/:\s*'([^']+\.tsx?)'/g)) standalone.push(source(input));
  }
  return { byOutput, standalone };
}

function packageEntries() {
  const entries = new Set();
  for (const manifest of tracked.filter((f) => /^packages\/[^/]+\/package\.json$/.test(f))) {
    const pkg = JSON.parse(read(manifest));
    if (pkg.private) continue;
    const dir = path.dirname(manifest);
    const { byOutput, standalone } = rolldownEntries(dir);
    standalone.forEach((entry) => entries.add(entry));
    const targets = [];
    const collect = (value) => {
      if (typeof value === 'string') targets.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(pkg.exports ?? {});
    for (const target of targets) {
      const match = /^\.\/dist\/esm\/(.+\.js)$/.exec(target);
      if (!match) continue;
      const entry =
        byOutput.get(match[1]) ??
        resolveModule(`${dir}/src/index.ts`, `./${match[1].replace(/\.js$/, '')}`);
      if (entry) entries.add(entry);
    }
  }
  return entries;
}

function analyzeSources() {
  const sources = tracked.filter(
    (f) =>
      /^packages\/[^/]+\/src\/.+\.tsx?$/.test(f) &&
      !/\.(d|typecheck|test|spec)\.tsx?$/.test(f) &&
      !f.includes('/generated/'), // regenerated from Rust; checked for currency there
  );
  const declarations = new Map(); // `${file}\t${name}` -> lines
  const reexportAll = new Map(); // file -> files it re-exports with `export *`
  const validation = { count: 0, lines: 0, functionLines: 0 };
  const helpers = { count: 0, files: new Set() };
  let neverLines = 0;
  for (const file of sources) {
    const text = read(file);
    if (!text) continue;
    neverLines += (text.match(/\?: never;?[ \t]*$/gm) ?? []).length;
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line;
    const declared = new Map();
    const listed = [];
    for (const statement of source.statements) {
      const names = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
            .filter((d) => ts.isIdentifier(d.name))
            .map((d) => d.name.text)
        : statement.name && ts.isIdentifier(statement.name)
          ? [statement.name.text]
          : [];
      const lines =
        (lineOf(statement.getEnd()) - lineOf(statement.getStart(source, true)) + 1) /
        Math.max(names.length, 1);
      for (const name of names) declared.set(name, (declared.get(name) ?? 0) + lines);
      const isFunction = ts.isFunctionDeclaration(statement)
        ? Boolean(statement.body)
        : ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (d) =>
              d.initializer &&
              (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)),
          );
      if (isFunction && names.length === 1) {
        validation.functionLines += lines;
        if (VALIDATION.test(names[0])) {
          validation.count++;
          validation.lines += lines;
        }
        if (HELPERS.has(names[0])) {
          helpers.count++;
          helpers.files.add(file);
        }
      }
      const modifiers = (ts.canHaveModifiers(statement) && ts.getModifiers(statement)) || [];
      const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (exported && !isDefault) listed.push(...names);
      if (ts.isExportDeclaration(statement)) {
        const specifier =
          statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : null;
        if (specifier && !statement.exportClause) {
          const target = resolveModule(file, specifier);
          if (target) reexportAll.set(file, [...(reexportAll.get(file) ?? []), target]);
        } else if (
          !specifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          listed.push(
            ...statement.exportClause.elements.map((e) => (e.propertyName ?? e.name).text),
          );
        }
      }
    }
    for (const name of new Set(listed))
      if (declared.has(name)) declarations.set(`${file}\t${name}`, declared.get(name));
  }
  return { declarations, reexportAll, validation, helpers, neverLines };
}

function classifyExports({ declarations, reexportAll }) {
  const publicFiles = new Set();
  const visit = (file) => {
    if (publicFiles.has(file)) return;
    publicFiles.add(file);
    for (const next of reexportAll.get(file) ?? []) visit(next);
  };
  packageEntries().forEach(visit);

  const names = new Set([...declarations.keys()].map((k) => k.split('\t')[1]));
  const usedIn = new Map(); // name -> Map(file -> occurrences)
  for (const file of tracked) {
    if (
      file === self ||
      !/\.(tsx?|[mc]?js|html|json)$/.test(file) ||
      /lock\.(json|yaml)$/.test(file)
    )
      continue;
    const text = read(file);
    for (const token of (text && text.match(/[A-Za-z_$][\w$]*/g)) ?? []) {
      if (!names.has(token)) continue;
      if (!usedIn.has(token)) usedIn.set(token, new Map());
      const files = usedIn.get(token);
      files.set(file, (files.get(file) ?? 0) + 1);
    }
  }

  const groups = { dead: [], testsOnly: [], localOnly: [], public: [], used: [] };
  const definedIn = new Map(); // name -> files exporting it
  for (const [key, lines] of declarations) {
    const [file, name] = key.split('\t');
    definedIn.set(name, [...(definedIn.get(name) ?? []), file]);
    const files = usedIn.get(name) ?? new Map();
    const others = [...files.keys()].filter((f) => f !== file);
    const entry = { file, name, lines };
    if (others.some((f) => !TEST_FILE.test(f))) groups.used.push(entry);
    else if (publicFiles.has(file)) groups.public.push(entry);
    else if (others.length) groups.testsOnly.push(entry);
    else if ((files.get(file) ?? 0) > 1) groups.localOnly.push(entry);
    else groups.dead.push(entry);
  }
  const pairs = new Map();
  for (const files of definedIn.values()) {
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = [files[i], files[j]].sort().join('\n      ');
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const mirrored = [...definedIn.values()].filter((files) => files.length > 1).length;
  return { groups, mirrored, mirroredPairs: [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 4) };
}

function countResidue() {
  // Archived plans are history, so they do not count as live plan docs.
  const planDocs = tracked.filter(
    (f) => /(^|\/)refactor-\d+[^/]*\.md$/.test(f) && !f.includes('/archive/') && read(f),
  );
  const planDocLines = planDocs.reduce((sum, f) => sum + read(f).split('\n').length, 0);
  let citations = 0;
  let allowDeadCode = 0;
  for (const file of tracked.filter((f) => /\.(tsx?|rs)$/.test(f))) {
    const text = read(file);
    if (!text) continue;
    // "Phase N" alone is often a protocol term (the Yao circuits have phases), so only
    // refactor numbers count.
    citations += (text.match(/^.*(\/\/|\/\*|^\s*\*).*(Refactor \d+|\bR\d{3}[A-Z]?\b).*$/gm) ?? [])
      .length;
    if (file.endsWith('.rs'))
      allowDeadCode += (text.match(/#!?\[allow\([^\]]*\bdead_code\b/g) ?? []).length;
  }
  return { planDocs: planDocs.length, planDocLines, citations, allowDeadCode };
}

function hotspots(lines) {
  const touched = git(
    'log',
    rev ?? 'HEAD',
    '--since=30 days ago',
    '--format=',
    '--name-only',
    '--',
    '*.ts',
    '*.tsx',
    '*.rs',
  );
  const commits = new Map();
  for (const file of touched.split('\n').filter(Boolean))
    commits.set(file, (commits.get(file) ?? 0) + 1);
  return [...commits]
    .filter(([file]) => lines.has(file))
    .map(([file, n]) => ({ file, commits: n, lines: lines.get(file) }))
    .sort((a, b) => b.commits * b.lines - a.commits * a.lines)
    .slice(0, 6);
}

// ---- report ------------------------------------------------------------------------------------

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const metrics = {};
const number = (n) => Math.round(n).toLocaleString('en-US');
function metric(name, value, format = number) {
  metrics[name] = value;
  const before = baseline?.metrics?.[name];
  if (before === undefined) return format(value);
  const delta = value - before;
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '±';
  return `${format(value)} (${sign}${format(Math.abs(delta))})`;
}
const percent = (n) => `${n.toFixed(1)}%`;
const lines = [];
const out = (text = '') => lines.push(text);

const size = measureSize();
const commit = git('rev-parse', '--short', rev ?? 'HEAD');
out(
  `Bloat report at ${commit}${baseline ? `, changes since the baseline at ${baseline.commit} (${baseline.date})` : ''}`,
);
out();
out('Size');
out(
  `  code lines        ts ${metric('tsCodeLines', size.code.ts)}   rust ${metric('rustCodeLines', size.code.rust)}   js ${metric('jsCodeLines', size.code.js)}`,
);
out(
  `  files over 2,000 lines: ${metric('filesOver2000', size.large.length)}, holding ${metric(
    'linesInFilesOver2000',
    size.large.reduce((s, f) => s + f.lines, 0),
  )} lines`,
);
for (const f of size.largest) out(`    ${number(f.lines).padStart(7)}  ${f.file}`);

out();
out(`Duplication (exact repeats of ${WINDOW} meaningful lines)`);
for (const language of ['ts', 'rust']) {
  const d = measureDuplication(language);
  const share = Math.round((1000 * d.repeated) / d.meaningful) / 10;
  out(
    `  ${language.padEnd(5)} ${metric(`${language}DuplicatedPercent`, share, percent)} of ${number(d.meaningful)} lines, ${metric(`${language}DuplicatedLines`, d.repeated)} lines`,
  );
  for (const [pair, n] of d.topPairs) out(`    ${String(n).padStart(4)}  ${pair}`);
}

const sources = analyzeSources();
const exported = classifyExports(sources);
const total = (group) => group.reduce((s, e) => s + e.lines, 0);
out();
out('Exports in packages/*/src');
out(
  `  named nowhere else          ${metric('deadExports', exported.groups.dead.length)}, ${metric('deadExportLines', total(exported.groups.dead))} lines`,
);
out(
  `  used only by tests          ${metric('testOnlyExports', exported.groups.testsOnly.length)}, ${metric('testOnlyExportLines', total(exported.groups.testsOnly))} lines`,
);
out(
  `  used only in their own file ${metric('localOnlyExports', exported.groups.localOnly.length)}`,
);
out(`  public API, unused inside   ${number(exported.groups.public.length)}`);
out(`  exported from 2+ files      ${metric('mirroredExportNames', exported.mirrored)} names`);
for (const [pair, n] of exported.mirroredPairs) out(`    ${String(n).padStart(4)}  ${pair}`);
out('  largest named nowhere else:');
for (const e of [...exported.groups.dead].sort((a, b) => b.lines - a.lines).slice(0, 8)) {
  out(`    ${number(e.lines).padStart(5)}  ${e.name}  ${e.file}`);
}

const residue = countResidue();
const { validation, helpers } = sources;
out();
out('Boilerplate');
out(
  `  validation functions (parse*, require*, assert*, is*, ...) ${metric('validationFunctions', validation.count)}, ${metric('validationLines', validation.lines)} lines = ${percent((100 * validation.lines) / validation.functionLines)} of top-level function lines`,
);
out(
  `  local copies of basic validation helpers ${metric('helperCopies', helpers.count)} in ${number(helpers.files.size)} files`,
);
out(`  '?: never' padding lines ${metric('neverPaddingLines', sources.neverLines)}`);
out(`  Rust allow(dead_code) ${metric('rustAllowDeadCode', residue.allowDeadCode)}`);
out(
  `  refactor plan docs ${metric('refactorPlanDocs', residue.planDocs)}, ${metric('refactorPlanDocLines', residue.planDocLines)} lines; comments citing refactor numbers ${metric('refactorCitations', residue.citations)}`,
);

out();
out('Hotspots (commits in the last 30 days x current lines)');
for (const h of hotspots(size.lines))
  out(`  ${String(h.commits).padStart(4)} commits ${number(h.lines).padStart(7)} lines  ${h.file}`);

console.log(lines.join('\n'));
if (rev) rmSync(sourceRoot, { recursive: true, force: true });
if (process.argv.includes('--write-baseline')) {
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(baselinePath, `${JSON.stringify({ commit, date, metrics }, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(root, baselinePath)}`);
} else if (process.argv.includes('--check')) {
  if (!baseline) throw new Error(`--check needs ${path.relative(root, baselinePath)}`);
  const change = (name) => `${name} ${baseline.metrics[name]} -> ${metrics[name]}`;
  const grown = RATCHETED.filter((name) => metrics[name] > baseline.metrics[name]);
  const shrunk = RATCHETED.filter((name) => metrics[name] < baseline.metrics[name]);
  if (shrunk.length) {
    console.log(`\nBelow the baseline: ${shrunk.map(change).join(', ')}.`);
    console.log('Record the reduction with pnpm report:bloat --write-baseline.');
  }
  if (grown.length) {
    console.error(`\nGrew past the baseline: ${grown.map(change).join(', ')}.`);
    process.exitCode = 1;
  } else {
    console.log(`\nNo ratcheted measure grew (${RATCHETED.join(', ')}).`);
  }
}
