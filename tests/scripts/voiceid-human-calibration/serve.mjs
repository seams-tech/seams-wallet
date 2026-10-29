import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');
const assets = path.join(root, 'packages/voiceid/dist/public/sdk/voiceid');
const permitted = [
  'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs',
  'redimnet-b1.onnx', 'aurora-int8.onnx', 'silero-vad.onnx', 'voice-activity-worklet.js',
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VoiceID human calibration</title>
<style>
body{margin:0;padding:32px;background:#101619;color:#eff2f3;font:15px/1.5 system-ui}
main{max-width:1100px;margin:auto}h1{font-size:28px;line-height:1.2}h2{font-size:20px}
.layout{display:grid;grid-template-columns:minmax(280px,1fr) minmax(300px,440px);gap:32px;margin:32px 0}
label{display:block;margin:14px 0}input:not([type=checkbox]),select{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:5px;background:#19242a;color:inherit;border:1px solid #3b4a52;border-radius:8px;font:inherit}
button{padding:10px 16px;font:inherit;cursor:pointer;border-radius:8px;border:1px solid #3b4a52}
button:disabled{opacity:.45;cursor:default}button[hidden]{display:none}#status{min-height:70px;color:#b9c6cc}
#results table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #34434a}th{color:#b9c6cc}
.notes{color:#b9c6cc;max-width:800px}#labels{margin:16px 0}#labels button{margin:4px}
@media(max-width:760px){body{padding:20px}.layout{grid-template-columns:1fr}#results{overflow:auto}}
</style><main>
<h1>VoiceID human calibration</h1>
<p class="notes">Local measurement only. No wallet actions. Raw audio is discarded after each capture. Voice vectors stay in memory and are cleared when this page closes. Export contains scores and pseudonymous labels only.</p>
<div class="layout"><section>
<label><input id="consent" type="checkbox"> I agree to this local recording session and will identify speakers accurately.</label>
<button id="prepare">Prepare VoiceID</button>
<label>Participant code<input id="participant" value="p01" maxlength="40" autocomplete="off"></label>
<label>Cohort<select id="cohort"><option value="calibration">Calibration speakers</option><option value="evaluation">Held-out evaluation speakers</option></select></label>
<label>Session label<input id="session" value="session-1" maxlength="40" autocomplete="off"></label>
<button id="select" disabled>Select participant / session</button>
<button id="freeze" disabled>Freeze calibration</button>
<p id="status" role="status">Prepare VoiceID, then record three enrollment clips. Keep this page open. Use a new session label after a break for probe recordings.</p>
<div id="labels"><button id="correct" hidden>I read it correctly</button><button id="stumbled" hidden>I stumbled</button><button id="different" hidden>I intentionally read different words</button></div>
<button id="export" disabled>Export scores</button>
</section><div id="capture" class="seams-wallet-ui seams-voiceid-activation-surface"></div></div>
<h2>Results</h2><p class="notes">For personal acceptance, record three enrollment clips, then select a new session label for probes. Keep the page open between sessions. Different-speaker calibration needs at least two distinct people per cohort. Phrase assignments are balanced across the current phrase bank.</p>
<p class="notes">Phrase rankings use probe recordings. Enrollment attempts stay in the export and do not count toward these rates.</p>
<p class="notes">Enrollment for measurement accepts three correctly read clips with usable audio. Model rejections are recorded, rather than filtering out difficult examples. Participant and session labels are self-reported.</p>
<div id="results"></div></main><script type="module" src="/lab/probe.js"></script></html>`;

export async function startCalibrationServer({ port, source }) {
  if (source !== 'human_microphone' && source !== 'synthetic_fixture') throw new Error('Unknown recording source');
  const chunks = JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'tests/scripts/build-preact-probe.mjs'), 'VoiceIdHumanCalibration.ts',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  const files = new Map(chunks.map(chunkEntry));
  const modelHashes = {};
  for (const name of permitted) {
    modelHashes[name] = createHash('sha256').update(await readFile(path.join(assets, name))).digest('hex');
  }
  const digest = createHash('sha256');
  digest.update(html);
  for (const chunk of chunks) digest.update(chunk.fileName).update(chunk.code);
  const configuration = JSON.stringify({ source, modelHashes, sourceHash: digest.digest('hex'), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() });
  const state = { files, configuration, requests: [], posts: 0 };
  const server = createServer(handle.bind(null, state));
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Calibration server has no port');
  return { server, url: `http://localhost:${address.port}/`, state };
}

function chunkEntry(chunk) {
  return [chunk.fileName, chunk.code];
}

function handle(state, request, response) {
  void respond(state, request, response).catch(failed.bind(null, response));
}

function failed(response, error) {
  response.statusCode = 500;
  response.end('Calibration asset could not load. Build @seams/voiceid before starting this page.');
  process.stderr.write(`${String(error)}\n`);
}

async function respond(state, request, response) {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  state.requests.push(pathname);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (request.method !== 'GET') {
    state.posts += 1;
    response.writeHead(405).end();
    return;
  }
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(html);
  } else if (pathname === '/configuration.json') {
    response.setHeader('Content-Type', 'application/json');
    response.end(state.configuration);
  } else if (pathname.startsWith('/lab/') && state.files.has(pathname.slice(5))) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(state.files.get(pathname.slice(5)));
  } else if (pathname.startsWith('/sdk/voiceid/') && permitted.includes(pathname.slice(13))) {
    const name = pathname.slice(13);
    response.setHeader('Content-Type', /\.m?js$/.test(name) ? 'text/javascript' : 'application/octet-stream');
    response.end(await readFile(path.join(assets, name)));
  } else {
    response.writeHead(404).end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? 4390);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535');
  const running = await startCalibrationServer({ port, source: 'human_microphone' });
  process.stdout.write(`VoiceID local calibration: ${running.url}\nScores stay in your browser. No recordings are uploaded.\n`);
}
