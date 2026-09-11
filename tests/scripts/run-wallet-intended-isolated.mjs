#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const listCasesOnly = process.argv.includes('--list-cases');
const selectionArgs = process.argv.slice(2).filter(isSelectionArgument);
const report = parseJsonReport(
  runPnpmCapture([
    'exec',
    'playwright',
    'test',
    '-c',
    'playwright.wallet-intended.config.ts',
    '--list',
    '--reporter=json',
    ...selectionArgs,
  ]),
);
const cases = collectCases(report.suites);
if (cases.length === 0) throw new Error('The Wallet intended selection did not match any cases');

if (listCasesOnly) listCases(cases);
else runCases(cases);

function isSelectionArgument(argument) {
  return argument !== '--' && argument !== '--list-cases';
}

function listCases(casesToList) {
  console.log(`[wallet-intended] selected ${casesToList.length} isolated case(s)`);
  for (const testCase of casesToList) {
    console.log(`${testCase.file}:${String(testCase.line)} ${testCase.title}`);
  }
}

function runCases(casesToRun) {
  console.log(`[wallet-intended] running ${casesToRun.length} case(s) with fresh Wallet state`);
  for (const [index, testCase] of casesToRun.entries()) runCase(testCase, index, casesToRun.length);
}

function runCase(testCase, index, total) {
  const caseNumber = index + 1;
  const caseRoot = path.join(tmpdir(), `seams-wallet-intended-${process.pid}-${caseNumber}`);
  const environment = {
    ...process.env,
    SEAMS_INTENDED_APP_URL: 'http://localhost:4201',
    SEAMS_INTENDED_ROUTER_URL: 'http://127.0.0.1:4100',
    SEAMS_INTENDED_WALLET_ORIGIN: 'http://localhost:4202',
    SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID: 'local-smoke-project:dev',
    SEAMS_INTENDED_PUBLISHABLE_KEY: 'pk_local',
    SEAMS_INTENDED_ROUTER_AB_ROOT: caseRoot,
    SEAMS_INTENDED_TEST_APP_VITE_CACHE_DIR: path.join(caseRoot, '.runtime', 'vite-app'),
    ...(index > 0 ? { SEAMS_INTENDED_SKIP_BUILD: '1' } : {}),
  };
  console.log(
    `[wallet-intended] ${caseNumber}/${total} ${testCase.file}:${String(testCase.line)} ${testCase.title}`,
  );
  try {
    runPnpmInherited(
      [
        'exec',
        'playwright',
        'test',
        '-c',
        'playwright.wallet-intended.ci.config.ts',
        testCase.file,
        '--grep',
        `${escapeRegex(testCase.title)}$`,
        '--reporter=line',
      ],
      environment,
    );
  } finally {
    rmSync(caseRoot, { recursive: true, force: true });
  }
}

function collectCases(suites, parentTitles = [], depth = 0) {
  if (!Array.isArray(suites)) return [];
  const cases = [];
  for (const suite of suites) {
    const suiteTitle = typeof suite?.title === 'string' ? suite.title.trim() : '';
    const titles = depth === 0 || !suiteTitle ? parentTitles : [...parentTitles, suiteTitle];
    if (Array.isArray(suite?.specs)) {
      for (const spec of suite.specs) {
        const title = typeof spec?.title === 'string' ? spec.title.trim() : '';
        const file = typeof spec?.file === 'string' ? spec.file.trim() : '';
        const line = Number(spec?.line);
        if (!title || !file || !Number.isSafeInteger(line) || line <= 0) continue;
        cases.push({ file, line, title: [...titles, title].join(' ') });
      }
    }
    cases.push(...collectCases(suite?.suites, titles, depth + 1));
  }
  return cases;
}

function parseJsonReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error('Playwright --list did not return a valid JSON report', { cause: error });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runPnpmCapture(args) {
  const result = spawnSync('pnpm', args, {
    cwd: testsRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 0) return result.stdout;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  throw new Error(`pnpm ${args.join(' ')} exited with ${String(result.status ?? 'unknown')}`);
}

function runPnpmInherited(args, environment) {
  const result = spawnSync('pnpm', args, {
    cwd: testsRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.status === 0) return;
  throw new Error(`pnpm ${args.join(' ')} exited with ${String(result.status ?? 'unknown')}`);
}
