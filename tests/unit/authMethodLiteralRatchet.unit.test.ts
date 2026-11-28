import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The method names of the client must not spread. This test counts, for each method name, the
 * files of the browser code that name it and the `case` arms on it. A count above the recorded
 * one fails. When a change lowers a count, lower the recorded count in the same change, so the
 * count cannot grow back.
 *
 * The inventory at the end of `docs/refactor-233-auth-methods-by-factor.md` sorts each arm into
 * identity, step-up, custody and other.
 */
const CLIENT_SOURCES = ['packages/mpc-wallet/src', 'packages/voiceid/src'];

/** Counted on 2026-11-28. */
const RECORDED = {
  passkey: { files: 191, caseArms: 107 },
  email_otp: { files: 188, caseArms: 109 },
  voiceid: { files: 70, caseArms: 56 },
} as const;

type Method = keyof typeof RECORDED;
type Count = Readonly<{ files: number; caseArms: number }>;

const ROOT = path.resolve(import.meta.dirname, '../..');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(entryPath));
    else if (/\.tsx?$/u.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function countMethod(method: Method, sources: readonly string[]): Count {
  const literal = new RegExp(`['"]${method}['"]`, 'u');
  const caseArm = new RegExp(`case ['"]${method}['"]`, 'gu');
  let files = 0;
  let caseArms = 0;
  for (const source of sources) {
    if (!literal.test(source)) continue;
    files += 1;
    caseArms += source.match(caseArm)?.length ?? 0;
  }
  return { files, caseArms };
}

test('the method names of the client do not spread', () => {
  const sources = CLIENT_SOURCES.flatMap((directory) =>
    sourceFiles(path.join(ROOT, directory)),
  ).map((file) => readFileSync(file, 'utf8'));
  for (const method of Object.keys(RECORDED) as Method[]) {
    const counted = countMethod(method, sources);
    const recorded = RECORDED[method];
    expect(
      counted.files,
      `'${method}' is in ${counted.files} files; the recorded count is ${recorded.files}`,
    ).toBeLessThanOrEqual(recorded.files);
    expect(
      counted.caseArms,
      `'${method}' has ${counted.caseArms} case arms; the recorded count is ${recorded.caseArms}`,
    ).toBeLessThanOrEqual(recorded.caseArms);
  }
});

test('the count sees a method name and its case arms', () => {
  const sources = [
    'switch (kind) { case \'voiceid\': return 1; case "voiceid": return 2; }',
    "const method = 'voiceid';",
    "const other = 'voiceid_unavailable';",
  ];
  expect(countMethod('voiceid', sources)).toEqual({ files: 2, caseArms: 2 });
});
