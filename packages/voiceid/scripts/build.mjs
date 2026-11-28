import { rolldown } from 'rolldown';
import { copyVoiceCaptureAssets } from '@seams/voice-capture/hosting';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'public/sdk/voiceid');
// The Wallet host serves /sdk/voiceid-host.js at a fixed path with a long cache life, while this
// plugin's hashed chunks load fresh after a deploy. Each import of it carries the version of the
// MPC wallet in this repository, which is also the Wallet's asset version, so a new chunk never
// runs against a cached older bridge.
const walletVersion = JSON.parse(
  await readFile(path.join(root, '../mpc-wallet/package.json'), 'utf8'),
).version;
if (!/^\d+\.\d+\.\d+$/.test(walletVersion)) {
  throw new Error(`The VoiceID plugin needs one exact @seams/mpc-wallet version, not ${walletVersion}`);
}
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

await build(
  {
    // The second entry is ONNX Runtime Web at a fixed name, `ort.wasm.bundle.min.js`: the
    // plugin's chunks import it, and so does the Wallet's own phrase card, which bundles no engine.
    input: { host: 'src/host.ts', 'ort.wasm.bundle.min': 'onnxruntime-web/wasm' },
    external: ['@seams/mpc-wallet/voiceid'],
    plugins: [{ name: 'production-environment', transform: productionEnvironment }],
    resolve: { alias: { react: 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' } },
  },
  {
    dir: assets,
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
    minify: true,
    paths: { '@seams/mpc-wallet/voiceid': `../voiceid-host.js?v=${walletVersion}` },
  },
);

// The capture package brings speech detection, the audio worklet and the model engine. VoiceID's
// own NOTICE.txt replaces the package's: it also covers the speaker and text models.
await copyVoiceCaptureAssets(assets);
for (const filename of [
  'redimnet-b1.onnx',
  'aurora-int8.onnx',
  'citrinet-int8.onnx',
  'NOTICE.txt',
  'AURORA_LICENSE.txt',
  'CITRINET_LICENSE.txt',
]) {
  await cp(path.join(root, 'assets', filename), path.join(assets, filename));
}
await cp(path.join(root, 'hosting.mjs'), path.join(dist, 'hosting.mjs'));
await cp(path.join(root, 'hosting.d.mts'), path.join(dist, 'hosting.d.mts'));
await cp(path.join(root, 'scripts/compose-host.mjs'), path.join(dist, 'compose-host.mjs'));

async function build(input, output) {
  const bundle = await rolldown(input);
  try {
    await bundle.write(output);
  } finally {
    await bundle.close();
  }
}

function productionEnvironment(code) {
  return { code: code.replaceAll('process.env.NODE_ENV', '"production"'), map: null };
}
