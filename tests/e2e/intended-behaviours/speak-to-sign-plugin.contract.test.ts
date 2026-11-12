import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import type {} from '../../fixtures/ui/SpeakToSignPluginProbe';
import type {} from '../../typecheck/speak-to-sign-api.typecheck';

const ORIGIN = 'https://wallet.example.test';
type Chunk = { fileName: string; code: string; imports: string[] };

// Speak-to-Sign is a part of the Wallet. Its flow is a chunk that loads on first use, and the
// Wallet host serves no separate plugin file for it.

const chunks: Chunk[] = JSON.parse(
  execFileSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
      'SpeakToSignPluginProbe.ts',
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  ),
);

/** A text of the card of the flow. Only the chunk of the flow holds it. */
const FLOW_TEXT = 'Checking what you said';

class ProbeServer {
  readonly requested: string[] = [];

  async serve(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return await route.abort();
    const name = url.pathname.slice(1);
    this.requested.push(name);
    if (name === '') {
      return await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Speak-to-Sign loading</title><script type="module" src="/probe.js"></script>',
      });
    }
    const chunk = chunks.find(hasName.bind(null, name));
    if (!chunk) return await route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ contentType: 'text/javascript', body: chunk.code });
  }

  /** The requested chunks that hold the flow. */
  flowRequests(): string[] {
    return this.requested.filter(isFlowChunkName);
  }
}

function hasName(name: string, chunk: Chunk): boolean {
  return chunk.fileName === name;
}
function isFlowChunkName(name: string): boolean {
  return chunks.some((chunk) => chunk.fileName === name && chunk.code.includes(FLOW_TEXT));
}
function ready(): boolean {
  return Boolean(window.speakToSignPluginProbe);
}
function enable(): void {
  window.speakToSignPluginProbe.configure(true);
}
function disable(): void {
  window.speakToSignPluginProbe.configure(false);
}
function loadApprover(): ReturnType<Window['speakToSignPluginProbe']['loadHost']> {
  return window.speakToSignPluginProbe.loadHost();
}
function startFlow(): ReturnType<Window['speakToSignPluginProbe']['startFlow']> {
  return window.speakToSignPluginProbe.startFlow();
}

test('the Speak-to-Sign flow is a chunk of the Wallet that loads on the first request', async ({
  page,
}) => {
  const server = new ProbeServer();
  await page.route('**/*', server.serve.bind(server));
  await page.goto(ORIGIN);
  await page.waitForFunction(ready);

  // The flow is in its own chunk, not in the entry.
  const entry = chunks.find(hasName.bind(null, 'probe.js'));
  expect(entry?.code.includes(FLOW_TEXT)).toBe(false);
  expect(chunks.some((chunk) => chunk.code.includes(FLOW_TEXT))).toBe(true);

  await expect(page.evaluate(loadApprover)).rejects.toThrow('Enable Speak-to-Sign');
  await page.evaluate(enable);
  await expect(page.evaluate(loadApprover)).resolves.toEqual({
    kind: 'loaded',
    methods: ['approve', 'enroll'],
  });
  // Nothing loads until a request starts, and the Wallet host serves no plugin file.
  expect(server.flowRequests()).toEqual([]);
  await page.evaluate(startFlow);
  expect(server.flowRequests().length).toBeGreaterThan(0);
  expect(server.requested.filter((name) => name.startsWith('sdk/'))).toEqual([]);

  await page.evaluate(disable);
  await expect(page.evaluate(loadApprover)).rejects.toThrow('Enable Speak-to-Sign');
});
