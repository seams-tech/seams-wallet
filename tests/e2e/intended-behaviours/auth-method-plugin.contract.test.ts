import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import type {} from '../../fixtures/ui/AuthMethodPluginProbe';

const ORIGIN = 'https://wallet.example.test';
type Chunk = { fileName: string; code: string; imports: string[]; dynamicImports: string[] };

class ProbeServer {
  readonly fetched = new Set<string>();
  nativeRequests = 0;
  constructor(readonly chunks: readonly Chunk[]) {}

  async serve(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      this.nativeRequests += 1;
      return await route.abort();
    }
    if (url.pathname === '/') {
      return await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Auth plugin loading</title><script type="module" src="/probe.js"></script>',
      });
    }
    const name = url.pathname.slice(1);
    const chunk = this.chunks.find(hasName.bind(null, name));
    if (!chunk) return await route.abort();
    this.fetched.add(name);
    await route.fulfill({ contentType: 'text/javascript', body: chunk.code });
  }
}

function hasName(name: string, chunk: Chunk): boolean { return chunk.fileName === name; }
function ready(): boolean { return Boolean(window.authMethodPluginProbe); }
function enable(): void { window.authMethodPluginProbe.configure(true); }
function disable(): void { window.authMethodPluginProbe.configure(false); }
function load(): Promise<void> { return window.authMethodPluginProbe.load(); }

function staticGraph(chunks: readonly Chunk[]): Set<string> {
  const names = new Set<string>();
  const queue = ['probe.js'];
  for (const name of queue) {
    if (names.has(name)) continue;
    names.add(name);
    const chunk = chunks.find(hasName.bind(null, name));
    if (!chunk) throw new Error(`Missing probe chunk: ${name}`);
    queue.push(...chunk.imports);
  }
  return names;
}

test('auth plugin loads only on enabled use and remains disabled after a cached load', runJourney);

async function runJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  const chunks: Chunk[] = JSON.parse(execFileSync(process.execPath, [
    path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
    'AuthMethodPluginProbe.ts',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  const initialGraph = staticGraph(chunks);
  const server = new ProbeServer(chunks);
  await page.route('**/*', server.serve.bind(server));
  await page.goto(ORIGIN);
  await page.waitForFunction(ready);
  await expect(page.evaluate(load)).rejects.toThrow('Enable the authentication method plugin');
  expect([...server.fetched].sort()).toEqual([...initialGraph].sort());
  await page.evaluate(enable);
  expect([...server.fetched].sort()).toEqual([...initialGraph].sort());
  await page.evaluate(load);
  const loaded = [...server.fetched].sort();
  expect(loaded.length).toBeGreaterThan(initialGraph.size);
  await page.evaluate(load);
  expect([...server.fetched].sort()).toEqual(loaded);
  await page.evaluate(disable);
  await expect(page.evaluate(load)).rejects.toThrow('Enable the authentication method plugin');
  expect(server.nativeRequests).toBe(0);
  const report = testInfo.outputPath('auth-method-plugin.json');
  await writeFile(report, JSON.stringify({
    status: 'passed',
    initialChunks: [...initialGraph].sort(),
    enabledUseChunks: loaded,
    nativeRequests: server.nativeRequests,
    cases: ['disabled_load_rejected', 'enable_does_not_load', 'first_use_loads', 'repeat_use_cached', 'disabled_cached_plugin_rejected'],
  }, null, 2));
  await testInfo.attach('auth-method-plugin.json', { path: report, contentType: 'application/json' });
}
