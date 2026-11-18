import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_DIRECTORY = path.join(import.meta.dirname, 'fixtures');

/**
 * The record fixtures are written by today's code, never by hand. Run the record checks with
 * SEAMS_CONFORMANCE_WRITE_FIXTURES=1 to write them again from the current writers.
 */
const rewriteRecordFixtures = process.env.SEAMS_CONFORMANCE_WRITE_FIXTURES === '1';

export async function readRecordFixture<T>(name: string): Promise<T> {
  const committed: T = JSON.parse(
    await readFile(path.join(FIXTURE_DIRECTORY, `${name}.json`), 'utf8'),
  );
  return committed;
}

/**
 * Returns the committed fixture `name`. In the rewrite mode it first stores `written`, the
 * records that today's code just wrote, as the new fixture. Each check then asserts that the
 * writer still makes the committed records and that the readers still read them.
 */
export async function committedRecordFixture<T>(name: string, written: T): Promise<T> {
  if (rewriteRecordFixtures) {
    await writeFile(
      path.join(FIXTURE_DIRECTORY, `${name}.json`),
      `${JSON.stringify(written, null, 2)}\n`,
    );
  }
  return await readRecordFixture<T>(name);
}
