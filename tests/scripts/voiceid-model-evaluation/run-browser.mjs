import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { chromium, webkit } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(process.argv[2] || '/private/tmp/voiceid-redimnet-evaluation');
const ecapa = path.resolve(process.argv[3] || '../packages/wallet/assets/voiceid/ecapa.onnx');
const engine = process.argv[4] || 'chromium';
if (engine !== 'chromium' && engine !== 'webkit') throw new Error('Select chromium or webkit');
const ortDirectory = path.dirname(require.resolve('onnxruntime-web/wasm'));
const ortVersion = JSON.parse(await readFile(path.join(ortDirectory, '../package.json'), 'utf8')).version;
const corpus = JSON.parse(await readFile(path.join(root, 'corpus.json'), 'utf8'));
const sampleIds = new Set(corpus.samples.map(sampleId));
const browserScript = await readFile(path.join(import.meta.dirname, 'browser.js'));
const publicCorpus = JSON.stringify({ samples: corpus.samples.map(publicSample) });
const results = new Map();
const html = '<!doctype html><meta charset="utf-8"><title>VoiceID model evaluation</title>' +
  '<style>body{font:20px system-ui;margin:48px;max-width:900px}p{line-height:1.6}</style>' +
  '<h1>VoiceID browser model evaluation</h1><p>Public LibriSpeech recordings. No microphone or Wallet access.</p>' +
  '<p id="status">Loading…</p><script type="module" src="/browser.js"></script>';

function sampleId(item) {
  return item.id;
}
function publicSample(item) {
  return { id: item.id };
}

async function serve(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end(html);
      return;
    }
    if (url.pathname === '/browser.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(browserScript);
      return;
    }
    if (url.pathname === '/corpus') {
      response.setHeader('content-type', 'application/json');
      response.end(publicCorpus);
      return;
    }
    if (url.pathname === '/result' && request.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16_000_000) throw new Error('Oversized benchmark result');
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!['b0', 'b1', 'ecapa'].includes(result.model)) throw new Error('Unknown model result');
      results.set(result.model, result);
      response.end('saved');
      return;
    }
    let file = null;
    if (url.pathname.startsWith('/ort/')) {
      const name = url.pathname.slice(5);
      if (['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].includes(name)) {
        file = path.join(ortDirectory, name);
      }
    } else if (url.pathname.startsWith('/models/')) {
      const name = url.pathname.slice(8);
      if (name === 'ecapa.onnx') file = ecapa;
      else if (name === 'b0.onnx' || name === 'b1.onnx') file = path.join(root, name);
    } else if (url.pathname.startsWith('/pcm/')) {
      const name = url.pathname.slice(5);
      if (name.endsWith('.f32') && sampleIds.has(name.slice(0, -4))) file = path.join(root, 'pcm', name);
    }
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' :
      file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
    response.setHeader('content-length', (await stat(file)).size);
    createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
}

const server = http.createServer(serve);
await new Promise(listen);
function listen(resolve) {
  server.listen(0, '127.0.0.1', resolve);
}
const browserType = engine === 'chromium' ? chromium : webkit;
const browser = await browserType.launch({ headless: true });
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const model of ['b1', 'ecapa', 'b0']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/?model=${model}`);
    let priorStatus = '';
    const deadline = performance.now() + 900_000;
    while (performance.now() < deadline) {
      const state = await page.locator('body').getAttribute('data-state');
      const current = await page.locator('#status').innerText();
      if (current !== priorStatus) console.log(current);
      priorStatus = current;
      if (state === 'failed') throw new Error(current);
      if (state === 'complete') break;
      await new Promise(waitForProgress);
    }
    if (!results.has(model)) throw new Error(`${model} benchmark timed out`);
    await writeFile(path.join(root, `${engine}-${model}.json`), JSON.stringify(results.get(model)) + '\n');
    await page.screenshot({ path: path.join(root, `${engine}-${model}.png`) });
    await context.close();
  }
  await writeFile(path.join(root, `${engine}-environment.json`), JSON.stringify({
    browser: engine, browserVersion: browser.version(), nodeVersion: process.version,
    platform: process.platform, architecture: process.arch,
    osRelease: os.release(), cpuModel: os.cpus()[0].model, ortVersion,
    transport: 'localhost HTTP, uncompressed; load times are not internet download estimates',
  }, null, 2) + '\n');
} finally {
  await browser.close();
  server.close();
}
function waitForProgress(resolve) {
  setTimeout(resolve, 10_000);
}
