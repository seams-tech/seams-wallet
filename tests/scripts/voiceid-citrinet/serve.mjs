import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');

export async function startComparisonServer({ port, source }) {
  if (source !== 'human_microphone' && source !== 'synthetic_fixture')
    throw new Error('Invalid comparison source');
  const chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(root, 'tests/scripts/build-preact-probe.mjs'), 'VoiceIdCitrinetSession.ts'],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    ),
  );
  const files = new Map();
  files.set('/', {
    bytes: await readFile(path.join(import.meta.dirname, 'session.html')),
    type: 'text/html',
  });
  for (const chunk of chunks)
    files.set(`/lab/${chunk.fileName}`, {
      bytes: Buffer.from(chunk.code),
      type: 'text/javascript',
    });
  for (const name of [
    'aurora-int8.onnx',
    'citrinet-int8.onnx',
    'silero-vad.onnx',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'voice-activity-worklet.js',
  ]) {
    files.set(`/sdk/voiceid/${name}`, {
      bytes: await readFile(path.join(root, 'packages/voiceid/dist/public/sdk/voiceid', name)),
      type: /\.m?js$/.test(name) ? 'text/javascript' : 'application/octet-stream',
    });
  }
  const sourceDigest = createHash('sha256');
  const hashes = {};
  for (const [url, file] of files) {
    sourceDigest.update(url).update(file.bytes);
    hashes[url] = createHash('sha256').update(file.bytes).digest('hex');
  }
  const configuration = {
    source,
    sourceHash: sourceDigest.digest('hex'),
    hashes,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    quantization: 'Citrinet per-channel INT8 weights, FP32 activations and arithmetic',
  };
  files.set('/configuration.json', {
    bytes: Buffer.from(JSON.stringify(configuration)),
    type: 'application/json',
  });
  const server = createServer(respond.bind(null, files));
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Comparison server has no port');
  return { server, url: `http://localhost:${address.port}/` };
}

function respond(files, request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', file.type);
  response.end(file.bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? 4392);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Choose a port from 1024 to 65535');
  const running = await startComparisonServer({ port, source: 'human_microphone' });
  process.stdout.write(
    `Local speech comparison: ${running.url}\nNo uploads. Export scores before closing.\n`,
  );
}
