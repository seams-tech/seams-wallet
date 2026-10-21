import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const { values } = parseArgs({
  options: {
    reference: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string', default: '.artifacts/typescript-compiler-comparison/result' },
  },
});
assert.ok(
  values.reference && values.candidate,
  'Supply --reference and --candidate executable paths.',
);
assert.ok(
  ['darwin', 'linux'].includes(process.platform),
  'Memory measurement requires macOS or Linux.',
);

const root = process.cwd();
const output = path.resolve(values.output);
const compilers = [
  { name: 'reference', executable: path.resolve(values.reference) },
  { name: 'candidate', executable: path.resolve(values.candidate) },
];
const projects = [
  'packages/shared-ts/tsconfig.json',
  'packages/wallet-server/tsconfig.json',
  'packages/wallet/tsconfig.json',
  'apps/docs/tsconfig.json',
  'examples/seams-auth-menu/tsconfig.json',
  'examples/wallet-console-lite/tsconfig.json',
  'tests/intended-app/tsconfig.json',
  'tests/tsconfig.wallet-intended.json',
  'tests/tsconfig.wallet-typecheck.json',
  'tests/tsconfig.wallet-browser.json',
];
const builds = [
  'packages/wallet-server/tsconfig.build.json',
  'packages/wallet/tsconfig.build.json',
];

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function sortedLines(contents) {
  return contents.trim().split(/\r?\n/).filter(Boolean).sort();
}

function repositorySource(filename) {
  return (
    filename.startsWith(`${root}/`) &&
    !filename.includes('/node_modules/') &&
    !filename.includes('/.artifacts/')
  );
}

function relativeSource(filename) {
  return path.relative(root, filename);
}

function compilerVersion(compiler) {
  const result = spawnSync(compiler.executable, ['--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function measurement(contents) {
  const elapsed = /^real\s+([\d.]+)$/m.exec(contents);
  const memory = /([\d]+)\s+maximum resident set size/.exec(contents);
  assert.ok(elapsed && memory, `Missing time or memory measurement:\n${contents}`);
  return {
    elapsedSeconds: Number(elapsed[1]),
    peakResidentBytes: Number(memory[1]) * (process.platform === 'linux' ? 1024 : 1),
  };
}

async function runCompiler(compiler, project, args, sample) {
  const directory = path.join(output, compiler.name, project.replaceAll('/', '_'), String(sample));
  await mkdir(directory, { recursive: true });
  const timeFile = path.join(directory, 'time.txt');
  const timeArgs =
    process.platform === 'darwin' ? ['-lp'] : ['-f', 'real %e\n%M maximum resident set size'];
  const result = spawnSync(
    '/usr/bin/time',
    [
      ...timeArgs,
      '-o',
      timeFile,
      compiler.executable,
      '-p',
      project,
      '--pretty',
      'false',
      '--listFiles',
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
  );
  assert.ifError(result.error);
  const stdout = result.stdout.replaceAll('\r\n', '\n');
  const log = `${stdout}${result.stderr}`;
  await writeFile(path.join(directory, 'compiler.log'), log);
  const lines = sortedLines(stdout);
  const sources = lines.filter(repositorySource).map(relativeSource);
  const diagnostics = lines.filter(diagnosticLine);
  return {
    project,
    exitCode: result.status,
    signal: result.signal,
    ...measurement(await readFile(timeFile, 'utf8')),
    sources,
    diagnostics,
    stderr: result.stderr.trim(),
  };
}

function diagnosticLine(line) {
  return /\berror TS\d+:/.test(line);
}

function declarationShape(node) {
  // Property order does not change a record type. Preserve overload and signature order.
  if (ts.isTypeLiteralNode(node) && node.members.every(ts.isPropertySignature)) {
    return [node.kind, node.members.map(declarationShape).sort(compareShapes)];
  }
  const children = node.getChildren();
  return [node.kind, children.length > 0 ? children.map(declarationShape) : node.getText()];
}

function compareShapes(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

async function declarationManifest(directory, current = directory) {
  const manifest = {};
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const filename = path.join(current, entry.name);
    if (entry.isDirectory()) {
      Object.assign(manifest, await declarationManifest(directory, filename));
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      const contents = await readFile(filename, 'utf8');
      let structure;
      if (entry.name.endsWith('.map')) {
        const { mappings, ...metadata } = JSON.parse(contents);
        assert.equal(typeof mappings, 'string');
        // Reordered properties change generated positions. Source paths must still match.
        structure = metadata;
      } else {
        const source = ts.createSourceFile(entry.name, contents, ts.ScriptTarget.Latest, true);
        assert.equal(source.parseDiagnostics.length, 0, filename);
        structure = declarationShape(source);
      }
      manifest[path.relative(directory, filename)] = {
        sha256: digest(contents),
        structureSha256: digest(JSON.stringify(structure)),
      };
    }
  }
  return manifest;
}

function median(numbers) {
  const sorted = numbers.toSorted(compareNumbers);
  return sorted[Math.floor(sorted.length / 2)];
}

function compareNumbers(left, right) {
  return left - right;
}

function elapsedSeconds(sample) {
  return sample.elapsedSeconds;
}

function peakResidentBytes(sample) {
  return sample.peakResidentBytes;
}

function compactSample(sample) {
  const { sources, ...measurements } = sample;
  return {
    ...measurements,
    sourceCount: sources.length,
    sourceSetSha256: digest(sources.join('\n')),
  };
}

const evidence = {
  verified: false,
  recordedAt: new Date().toISOString(),
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  platform: process.platform,
  architecture: process.arch,
  cpu: os.cpus()[0].model,
  logicalCpus: os.availableParallelism(),
  node: process.version,
  method:
    'Serial runs with default compiler workers, one warmup and three measured samples per project. OS file caches remain warm. RSS is the largest process, not summed concurrent workers.',
  compilers: [],
  checks: [],
  declarations: [],
  summary: {},
};
await mkdir(output, { recursive: true });
for (const compiler of compilers) {
  evidence.compilers.push({ name: compiler.name, version: compilerVersion(compiler) });
}

for (const project of projects) {
  const runs = { reference: [], candidate: [] };
  for (let sample = 0; sample <= 3; sample += 1) {
    const order = sample % 2 === 0 ? compilers : compilers.toReversed();
    for (const compiler of order) {
      const result = await runCompiler(compiler, project, ['--noEmit'], sample);
      if (sample > 0) runs[compiler.name].push(result);
    }
  }
  evidence.checks.push({
    project,
    sources: runs.reference[0].sources,
    runs: {
      reference: runs.reference.map(compactSample),
      candidate: runs.candidate.map(compactSample),
    },
  });
  console.log(`Checked ${project}`);
}

for (const project of builds) {
  const outputs = {};
  for (const compiler of compilers) {
    const directory = path.join(output, 'declarations', compiler.name, path.dirname(project));
    await rm(directory, { recursive: true, force: true });
    const result = await runCompiler(compiler, project, ['--outDir', directory], 'emit');
    outputs[compiler.name] = { ...result, files: await declarationManifest(directory) };
  }
  evidence.declarations.push({ project, outputs });
  console.log(`Emitted ${project}`);
}

for (const compiler of compilers) {
  let totalMedianSeconds = 0;
  let largestPeakResidentBytes = 0;
  for (const check of evidence.checks) {
    const samples = check.runs[compiler.name];
    totalMedianSeconds += median(samples.map(elapsedSeconds));
    largestPeakResidentBytes = Math.max(
      largestPeakResidentBytes,
      ...samples.map(peakResidentBytes),
    );
  }
  evidence.summary[compiler.name] = { totalMedianSeconds, largestPeakResidentBytes };
}
await writeFile(path.join(output, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);

for (const check of evidence.checks) {
  const expectedSources = check.sources;
  assert.ok(expectedSources.length > 0, `No repository sources checked: ${check.project}`);
  for (const compiler of compilers) {
    for (const sample of check.runs[compiler.name]) {
      assert.equal(
        sample.exitCode,
        0,
        `${compiler.name}: ${check.project}\n${sample.diagnostics.join('\n')}`,
      );
      assert.equal(sample.signal, null);
      assert.equal(sample.stderr, '');
      assert.deepEqual(sample.diagnostics, []);
      assert.equal(
        sample.sourceSetSha256,
        digest(expectedSources.join('\n')),
        `Source coverage differs: ${check.project}`,
      );
    }
  }
}
for (const declaration of evidence.declarations) {
  for (const compiler of compilers) {
    assert.equal(
      declaration.outputs[compiler.name].exitCode,
      0,
      `${compiler.name}: ${declaration.project}`,
    );
  }
  assert.ok(Object.keys(declaration.outputs.reference.files).length > 0);
  const referenceFiles = declaration.outputs.reference.files;
  const candidateFiles = declaration.outputs.candidate.files;
  assert.deepEqual(Object.keys(candidateFiles).sort(), Object.keys(referenceFiles).sort());
  for (const [filename, reference] of Object.entries(referenceFiles)) {
    assert.equal(
      candidateFiles[filename].structureSha256,
      reference.structureSha256,
      `Declaration structure differs: ${declaration.project}: ${filename}`,
    );
  }
}
evidence.verified = true;
await writeFile(path.join(output, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence.summary, null, 2));
console.log(
  `Verified diagnostics, source coverage, type fixtures, declarations, and declaration maps: ${output}/result.json`,
);
