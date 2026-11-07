import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import type {} from '../../fixtures/ui/SpeakToSignPluginProbe';
import type {} from '../../typecheck/speak-to-sign-api.typecheck';

const ORIGIN = 'https://wallet.example.test';
const HOST_PATH = 'sdk/speak-to-sign/host.js';
type Chunk = { fileName: string; code: string; imports: string[] };
type HostResponse = 'built' | 'missing' | 'incompatible';

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

class ProbeServer {
  readonly requested: string[] = [];
  constructor(readonly host: HostResponse) {}

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
    if (name === HOST_PATH) return await this.serveHost(route);
    const chunk = chunks.find(hasName.bind(null, name));
    if (!chunk) return await route.fulfill({ status: 404, body: 'Not found' });
    await route.fulfill({ contentType: 'text/javascript', body: chunk.code });
  }

  private async serveHost(route: Route): Promise<void> {
    if (this.host === 'missing') {
      return await route.fulfill({ status: 404, body: 'Optional package is not installed' });
    }
    if (this.host === 'incompatible') {
      return await route.fulfill({
        contentType: 'text/javascript',
        body: 'export const hostApiVersion = 2; export function createSpeakToSignHostPlugin() { return { requestTransfer() {} }; }',
      });
    }
    const file = path.resolve(
      import.meta.dirname,
      '../../../packages/speak-to-sign/dist/public',
      HOST_PATH,
    );
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
  }

  speakToSignRequests(): string[] {
    return this.requested.filter(isSpeakToSignPath);
  }
}

function hasName(name: string, chunk: Chunk): boolean {
  return chunk.fileName === name;
}
function isSpeakToSignPath(name: string): boolean {
  return name.startsWith('sdk/speak-to-sign/');
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
function requestTransfer(): ReturnType<Window['speakToSignPluginProbe']['requestTransfer']> {
  return window.speakToSignPluginProbe.requestTransfer();
}

async function open(page: Page, host: HostResponse): Promise<ProbeServer> {
  const server = new ProbeServer(host);
  await page.route('**/*', server.serve.bind(server));
  await page.goto(ORIGIN);
  await page.waitForFunction(ready);
  return server;
}

test('a Wallet without the Speak-to-Sign descriptor never requests its host plugin', async ({
  page,
}) => {
  const server = await open(page, 'built');
  expect(chunks.some(isSpeakToSignChunk)).toBe(false);
  await expect(page.evaluate(requestTransfer)).rejects.toThrow('Enable Speak-to-Sign');
  await page.evaluate(enable);
  expect(server.speakToSignRequests()).toEqual([]);
  await expect(page.evaluate(requestTransfer)).resolves.toEqual({
    kind: 'unavailable',
    reason: 'flow_not_available',
  });
  expect(server.speakToSignRequests()).toEqual([HOST_PATH]);
  await page.evaluate(requestTransfer);
  expect(server.speakToSignRequests()).toEqual([HOST_PATH]);
  await page.evaluate(disable);
  await expect(page.evaluate(requestTransfer)).rejects.toThrow('Enable Speak-to-Sign');
  expect(server.speakToSignRequests()).toEqual([HOST_PATH]);
});

test('a Wallet host refuses a missing or incompatible Speak-to-Sign plugin', async ({
  browser,
}) => {
  const missing = await browser.newPage();
  await open(missing, 'missing');
  await missing.evaluate(enable);
  await expect(missing.evaluate(requestTransfer)).rejects.toThrow(
    'Install @seams/speak-to-sign on this Wallet host',
  );
  const incompatible = await browser.newPage();
  await open(incompatible, 'incompatible');
  await incompatible.evaluate(enable);
  await expect(incompatible.evaluate(requestTransfer)).rejects.toThrow(
    'Speak-to-Sign is incompatible with this Wallet host',
  );
});

// Only the host plugin produces this result, so a Wallet chunk that holds it bundled the plugin.
function isSpeakToSignChunk(chunk: Chunk): boolean {
  return chunk.code.includes('flow_not_available');
}
