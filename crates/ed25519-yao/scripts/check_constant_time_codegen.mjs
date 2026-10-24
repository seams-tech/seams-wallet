import {
  accessSync,
  closeSync,
  copyFileSync,
  constants,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '../../..');
const WORKER_MANIFEST = join(REPOSITORY_ROOT, 'crates/router-ab-cloudflare/Cargo.toml');
const PRIMITIVE_MANIFEST = join(REPOSITORY_ROOT, 'crates/two-party-primitives/Cargo.toml');
const CORE_SOURCE = join(REPOSITORY_ROOT, 'crates/two-party-primitives/src/lib.rs');
const OT_SOURCE = join(REPOSITORY_ROOT, 'crates/two-party-primitives/src/ot.rs');
const WORKER_BUILD_SCRIPT = join(
  REPOSITORY_ROOT,
  'crates/router-ab-cloudflare/scripts/build-strict-worker.sh',
);
const WASM_TARGET = 'wasm32-unknown-unknown';
const WORKER_WASM = 'router_ab_cloudflare.wasm';
const SENDER_FAMILY_SYMBOLS = Object.freeze([
  Object.freeze({ family: 'activation', pattern: /label_pad_prefix.*ActivationOtFamily/ }),
  Object.freeze({ family: 'export', pattern: /label_pad_prefix.*ExportOtFamily/ }),
  Object.freeze({ family: 'lane-materialization', pattern: /label_pad_prefix.*LaneMaterializationOtFamily/ }),
]);
const SECRET_BIT_PREFIX =
  String.raw`i32\.load8_u[\s\S]{0,500}?i32\.shr_u[\s\S]{0,200}?` +
  String.raw`i32\.const\s+1[\s\S]{0,100}?i32\.and`;
const SECRET_BIT_BRANCH = new RegExp(
  `${SECRET_BIT_PREFIX}[\\s\\S]{0,120}?i32\\.eqz[\\s\\S]{0,100}?br_if`,
  'g',
);

function fail(message) {
  throw new Error(message);
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableCandidates(name) {
  const pathEntries = (process.env.PATH ?? '').split(':').filter(Boolean);
  const candidates = [];
  for (const entry of pathEntries) {
    candidates.push(join(entry, name));
  }
  return candidates;
}

function resolveLlvmObjdump() {
  const configured = process.env.LLVM_OBJDUMP;
  const candidates = [];
  if (configured !== undefined && configured.length > 0) {
    candidates.push(configured);
  }
  candidates.push(...executableCandidates('llvm-objdump'));
  candidates.push('/opt/homebrew/opt/llvm/bin/llvm-objdump');
  const resolved = candidates.find(isExecutable);
  if (resolved === undefined) {
    fail(
      'llvm-objdump is required for the generated-WASM constant-time gate; install LLVM or set LLVM_OBJDUMP to its absolute path',
    );
  }
  return resolved;
}

function runInherited(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${String(result.status)}`);
  }
}

function runCaptured(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${String(result.status)}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function runCapturedThroughFile(command, args) {
  const temporary = mkdtempSync(join(tmpdir(), 'ed25519-yao-command-output-'));
  const stdoutPath = join(temporary, 'stdout.txt');
  const stdout = openSync(stdoutPath, 'w', 0o600);
  try {
    let result;
    try {
      result = spawnSync(command, args, {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', stdout, 'pipe'],
      });
    } finally {
      closeSync(stdout);
    }
    if (result.error !== undefined) {
      fail(`failed to run ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      fail(`${command} exited with status ${String(result.status)}: ${result.stderr.trim()}`);
    }
    return readFileSync(stdoutPath, 'utf8');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function findFiles(directory, predicate) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      matches.push(path);
    }
  }
  return matches;
}

function requireSingleFile(directory, predicate, label) {
  const matches = findFiles(directory, predicate);
  if (matches.length !== 1) {
    fail(`expected exactly one ${label} under ${directory}, found ${matches.length}`);
  }
  return matches[0];
}

function isPrimitiveAssembly(path) {
  return /two_party_primitives-[^/]+\.s$/u.test(path);
}

function requireUniqueSourceLine(path, fragment) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(fragment)) {
      matches.push(index + 1);
    }
  }
  if (matches.length !== 1) {
    fail(`expected one '${fragment}' source line in ${path}, found ${matches.length}`);
  }
  return matches[0];
}

function normalizedDerivedTraits(deriveBody) {
  const normalized = [];
  for (const traitName of deriveBody.split(',')) {
    normalized.push(traitName.trim());
  }
  return normalized;
}

function assertSecretBitWrappersCannotUseDebug() {
  const source = readFileSync(CORE_SOURCE, 'utf8');
  const secretBitWrappers = ['WireValue', 'ChoiceBit'];
  for (const wrapper of secretBitWrappers) {
    const declaration = new RegExp(
      String.raw`#\[derive\(([^)]*)\)\][\s\S]{0,120}?struct\s+${wrapper}\b`,
      'u',
    ).exec(source);
    if (declaration === null) {
      fail(`constant-time source gate cannot find the ${wrapper} declaration`);
    }
    const derivedTraits = normalizedDerivedTraits(declaration[1]);
    if (derivedTraits.includes('Debug')) {
      fail(`${wrapper} contains secret bits and must not implement Debug`);
    }
  }
}

function assemblyFileId(assemblyLines, sourceSuffix) {
  const matches = [];
  for (const line of assemblyLines) {
    const id = line.match(/^\s*\.file\s+(\d+)\s/u);
    if (id === null) {
      continue;
    }
    const segments = [...line.matchAll(/"([^"]*)"/gu)].map(assemblyPathSegment);
    if (segments.join('/').endsWith(sourceSuffix)) {
      matches.push(Number(id[1]));
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    fail(`expected one assembly file id for ${sourceSuffix}, found ${unique.length}`);
  }
  return unique[0];
}

function assemblyPathSegment(match) {
  return match[1];
}

function instructionMnemonic(line) {
  const trimmed = line.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith(';') ||
    trimmed.endsWith(':')
  ) {
    return undefined;
  }
  return trimmed.match(/^([A-Za-z][A-Za-z0-9.]*)\b/u)?.[1]?.toLowerCase();
}

function isConditionalBranch(mnemonic) {
  if (['cbz', 'cbnz', 'tbz', 'tbnz'].includes(mnemonic)) {
    return true;
  }
  if (mnemonic.startsWith('b.')) {
    return true;
  }
  if (mnemonic.startsWith('j') && mnemonic !== 'jmp') {
    return true;
  }
  return ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'].includes(mnemonic);
}

function sensitiveLineInstructions(assemblyLines, fileId, sourceLine) {
  const locationPattern = /^\s*\.loc\s+(\d+)\s+(\d+)\s+/u;
  let sensitive = false;
  const instructions = [];
  for (const line of assemblyLines) {
    const location = line.match(locationPattern);
    if (location !== null) {
      sensitive = Number(location[1]) === fileId && Number(location[2]) === sourceLine;
      continue;
    }
    if (sensitive) {
      const mnemonic = instructionMnemonic(line);
      if (mnemonic !== undefined) {
        instructions.push({ line: line.trim(), mnemonic });
      }
    }
  }
  return instructions;
}

function assertNativeSensitiveLine(assemblyLines, sourceSuffix, sourceLine, label) {
  const fileId = assemblyFileId(assemblyLines, sourceSuffix);
  const instructions = sensitiveLineInstructions(assemblyLines, fileId, sourceLine);
  if (instructions.length === 0) {
    fail(`${label} produced no line-mapped optimized host instructions`);
  }
  const branches = [];
  for (const instruction of instructions) {
    if (isConditionalBranch(instruction.mnemonic)) {
      branches.push(instruction);
    }
  }
  if (branches.length > 0) {
    const branchLines = [];
    for (const branch of branches) {
      branchLines.push(branch.line);
    }
    fail(
      `${label} contains conditional branches in optimized host code: ${branchLines.join(', ')}`,
    );
  }
  let xorFound = false;
  for (const instruction of instructions) {
    if (instruction.mnemonic.includes('xor') || instruction.mnemonic.startsWith('eor')) {
      xorFound = true;
      break;
    }
  }
  if (!xorFound) {
    fail(`${label} line mapping contains no XOR instruction; the regression gate lost coverage`);
  }
}

// LLVM can hoist a secret branch to debug line zero. Reject ambiguous branches
// in this small helper instead of treating missing line information as safe.
function assertOtHelperHasNoUnmappedBranches(assemblyLines) {
  let inHelper = false;
  let unmapped = false;
  let helpers = 0;
  for (const line of assemblyLines) {
    if (/^\S*two_party_primitives\S*2ot\S*15conditional_xor\S*:/u.test(line)) {
      inHelper = true;
      unmapped = true;
      helpers += 1;
    }
    if (!inHelper) {
      continue;
    }
    if (line.includes('.cfi_endproc')) {
      inHelper = false;
      continue;
    }
    const location = line.match(/^\s*\.loc\s+\d+\s+(\d+)\s/u);
    if (location !== null) {
      unmapped = Number(location[1]) === 0;
      continue;
    }
    const mnemonic = instructionMnemonic(line);
    if (unmapped && mnemonic !== undefined && isConditionalBranch(mnemonic)) {
      fail(`IKNP helper contains a conditional branch without a source line: ${line.trim()}`);
    }
  }
  if (helpers !== 1) {
    fail(`expected exactly one standalone IKNP conditional XOR helper, found ${helpers}`);
  }
}

function buildAndInspectHost(targetDirectory) {
  runInherited(
    'cargo',
    [
      'rustc',
      '--locked',
      '--manifest-path',
      PRIMITIVE_MANIFEST,
      '--release',
      '--lib',
      '--',
      '-Cdebuginfo=2',
      '--emit=asm',
    ],
    { CARGO_TARGET_DIR: targetDirectory },
  );
  const primitiveAssembly = requireSingleFile(
    join(targetDirectory, 'release/deps'),
    isPrimitiveAssembly,
    'shared primitive host assembly',
  );
  const primitiveLines = readFileSync(primitiveAssembly, 'utf8').split(/\r?\n/u);
  const wireLine = requireUniqueSourceLine(CORE_SOURCE, 'self.0[index] ^= u8::conditional_select');
  const otLine = requireUniqueSourceLine(OT_SOURCE, 'target[index] ^= u8::conditional_select');
  assertNativeSensitiveLine(primitiveLines, 'two-party-primitives/src/lib.rs', wireLine, 'WireLabel conditional XOR');
  assertNativeSensitiveLine(primitiveLines, 'two-party-primitives/src/ot.rs', otLine, 'IKNP row conditional XOR');
  assertOtHelperHasNoUnmappedBranches(primitiveLines);
}

// Release Workers are built with the target features that the build script
// names. The gate must inspect that code generation, not the default one.
function releaseTargetFeatures() {
  const matches = [
    ...readFileSync(WORKER_BUILD_SCRIPT, 'utf8').matchAll(
      /^worker_release_target_features="([+\-a-z0-9,]*)"$/gmu,
    ),
  ];
  if (matches.length !== 1) {
    fail(`expected one worker_release_target_features line in ${WORKER_BUILD_SCRIPT}`);
  }
  return matches[0][1];
}

function buildWorker(targetDirectory, feature) {
  const targetFeatures = releaseTargetFeatures();
  runInherited(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      WORKER_MANIFEST,
      '--target',
      WASM_TARGET,
      '--release',
      '--no-default-features',
      '--features',
      feature,
    ],
    {
      CARGO_TARGET_DIR: targetDirectory,
      ...(targetFeatures.length > 0 ? { RUSTFLAGS: `-C target-feature=${targetFeatures}` } : {}),
    },
  );
  const wasm = join(targetDirectory, WASM_TARGET, 'release', WORKER_WASM);
  accessSync(wasm, constants.R_OK);
  return wasm;
}

function symbolNames(symbolTable, pattern) {
  const matches = [];
  for (const line of symbolTable.split(/\r?\n/u)) {
    const symbol = line.trim().split(/\s+/u).at(-1);
    if (symbol !== undefined && pattern.test(symbol)) {
      matches.push(symbol);
    }
  }
  return matches;
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

// Inspect the emitted mask shape. This is a compiler regression check, not
// general control-flow verification or proof of callee behavior. Review changes
// to the helper's control flow manually; textual overwrite order assumes the
// reviewed public loops and bounds paths.
function inspectWasmOtHelper(disassembly) {
  const instructions = [];
  for (const line of disassembly.split(/\r?\n/u)) {
    const match = line.match(/^\s*[0-9a-f]+:\s+(?:[0-9a-f]{2}\s+)+([a-z][a-z0-9._]*)\s*(.*)$/u);
    if (match !== null) {
      instructions.push({ opcode: match[1], operand: match[2].trim().split(/\s/u)[0] });
    }
  }
  if (instructions[0]?.opcode !== 'local.get' || instructions[0]?.operand !== '4' ||
      instructions[1]?.opcode !== 'call' || instructions[2]?.opcode !== 'local.set') {
    fail('IKNP helper lost the initial choice-call shape');
  }
  if (localReadsBeforeWrite(instructions, '4', 1).length !== 0) {
    fail('IKNP helper reuses its choice parameter before the public overwrite');
  }
  const choice = instructions[2].operand;
  const choiceUses = localReadsBeforeWrite(instructions, choice, 3);
  if (choiceUses.length !== 1) {
    fail('IKNP helper must use the protected choice exactly once before overwrite');
  }
  const use = choiceUses[0];
  if (instructions[use - 1]?.opcode !== 'i32.const' || instructions[use - 1]?.operand !== '0' ||
      instructions[use + 1]?.opcode !== 'i32.sub' || instructions[use + 2]?.opcode !== 'local.set') {
    fail('IKNP helper must consume the choice through a subtraction mask');
  }
  const mask = instructions[use + 2].operand;
  const maskUses = immutableLocalReads(instructions, mask);
  let scalarUses = 0;
  let vectorUses = 0;
  for (const index of maskUses) {
    if (instructions[index + 1]?.opcode === 'i32.and' &&
        instructions[index + 2]?.opcode === 'i32.xor' &&
        instructions[index + 3]?.opcode === 'i32.store8') {
      scalarUses += 1;
    } else if (instructions[index + 1]?.opcode === 'i8x16.splat' &&
               instructions[index + 2]?.opcode === 'local.set') {
      const vector = instructions[index + 2].operand;
      const uses = immutableLocalReads(instructions, vector);
      if (uses.length === 0) fail('IKNP helper lost vector mask use');
      for (const vectorUse of uses) {
        if (instructions[vectorUse + 1]?.opcode !== 'v128.and' ||
            instructions[vectorUse + 2]?.opcode !== 'v128.xor' ||
            instructions[vectorUse + 3]?.opcode !== 'v128.store') {
          fail('IKNP helper uses its vector mask outside AND/XOR/store');
        }
      }
      vectorUses += 1;
    } else {
      fail('IKNP helper uses its mask outside AND/XOR/store or vector splat');
    }
  }
  if (scalarUses !== 1 || vectorUses !== 1) {
    fail('IKNP helper must retain one scalar and one vector mask path');
  }
}

function localReadsBeforeWrite(instructions, local, start) {
  const reads = [];
  for (let index = start; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.operand !== local) continue;
    if (instruction.opcode === 'local.set' || instruction.opcode === 'local.tee') break;
    if (instruction.opcode === 'local.get') reads.push(index);
  }
  return reads;
}

function immutableLocalReads(instructions, local) {
  const reads = [];
  let writes = 0;
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.operand !== local) continue;
    if (instruction.opcode === 'local.set' || instruction.opcode === 'local.tee') writes += 1;
    if (instruction.opcode === 'local.get') reads.push(index);
  }
  if (writes !== 1) fail('IKNP mask local must have exactly one assignment');
  return reads;
}

function assertNoSecretBitBranch(disassembly, label) {
  const count = countMatches(disassembly, SECRET_BIT_BRANCH);
  if (count !== 0) {
    fail(`${label} contains ${count} load/shift/secret-bit branch sequence(s)`);
  }
}

function inspectWorkerWasm(llvmObjdump, wasm, feature, requireSender) {
  const symbolTable = runCaptured(llvmObjdump, ['-t', wasm]);
  const disassembly = runCapturedThroughFile(llvmObjdump, ['-d', wasm]);
  assertNoSecretBitBranch(disassembly, `${feature} Worker WASM`);

  if (!requireSender && symbolNames(
    symbolTable,
    /SenderAwaitExtension.*(?:ActivationOtFamily|ExportOtFamily|LaneMaterializationOtFamily).*6accept/,
  ).length !== 0) {
    fail(`${feature} retains an algorithm-specific IKNP sender accept function`);
  }
  const helpers = symbolNames(symbolTable, /two_party_primitives.*2ot15conditional_xor/);
  const expectedHelpers = 1;
  if (helpers.length !== expectedHelpers) {
    fail(`${feature} must contain ${expectedHelpers} outlined IKNP XOR helper(s), found ${helpers.length}`);
  }
  if (requireSender) {
    for (const specification of SENDER_FAMILY_SYMBOLS) {
      if (symbolNames(symbolTable, specification.pattern).length !== 1) {
        fail(`${feature} must retain one ${specification.family} sender family marker`);
      }
    }
  }
  const helper = runCaptured(llvmObjdump, [`--disassemble-symbols=${helpers[0]}`, wasm]);
  inspectWasmOtHelper(helper);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inspectWorkerArtifacts(aWasm, bWasm) {
  const llvmObjdump = resolveLlvmObjdump();
  const before = Object.freeze({
    a: sha256File(aWasm),
    b: sha256File(bWasm),
  });
  inspectWorkerWasm(llvmObjdump, aWasm, 'deriver-a', true);
  inspectWorkerWasm(llvmObjdump, bWasm, 'deriver-b', false);
  const after = Object.freeze({
    a: sha256File(aWasm),
    b: sha256File(bWasm),
  });
  if (before.a !== after.a || before.b !== after.b) {
    fail('Worker WASM changed while constant-time inspection was running');
  }
}

function main() {
  if (!['arm64', 'x64'].includes(process.arch)) {
    fail(`unsupported host architecture '${process.arch}'; expected arm64 or x64`);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'ed25519-yao-ct-codegen-'));
  try {
    assertSecretBitWrappersCannotUseDebug();
    const cargoTarget = join(temporary, 'cargo-target');
    buildAndInspectHost(cargoTarget);
    const deriverA = buildWorker(cargoTarget, 'strict-worker-deriver-a-entrypoint');
    const deriverACopy = join(temporary, 'deriver-a.wasm');
    copyFileSync(deriverA, deriverACopy);
    const deriverB = buildWorker(cargoTarget, 'strict-worker-deriver-b-entrypoint');
    inspectWorkerArtifacts(deriverACopy, deriverB);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write(
    'constant-time codegen gate passed: optimized host and Deriver A/B Worker WASM retain branchless IKNP and WireLabel selection\n',
  );
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`constant-time codegen gate failed: ${message}\n`);
    process.exitCode = 1;
  }
}
