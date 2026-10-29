import { rolldown } from 'rolldown';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'public/sdk/voiceid');
process.chdir(root);
await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

await build(
  {
    input: ['src/index.ts', 'src/react.ts', 'src/capture/prompt.ts'],
    external: ['@seams/wallet/voiceid-host', 'voice-glow', 'preact', 'react', 'react/jsx-runtime'],
  },
  { dir: path.join(dist, 'esm'), format: 'esm', preserveModules: true, preserveModulesRoot: 'src' },
);
await cp(
  path.join(root, 'src/react/VoiceAssistantCard.css'),
  path.join(dist, 'esm/react/VoiceAssistantCard.css'),
);

await build(
  {
    input: { host: 'src/host.ts' },
    external: ['@seams/wallet/voiceid-host'],
    plugins: [{ name: 'production-environment', transform: productionEnvironment }],
    resolve: { alias: { react: 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' } },
  },
  {
    dir: assets,
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: '[name]-[hash].js',
    minify: true,
    paths: { '@seams/wallet/voiceid-host': '../voiceid-host.js' },
  },
);

for (const filename of [
  'redimnet-b1.onnx',
  'aurora-int8.onnx',
  'citrinet-int8.onnx',
  'silero-vad.onnx',
  'voice-activity-worklet.js',
  'NOTICE.txt',
  'AURORA_LICENSE.txt',
  'CITRINET_LICENSE.txt',
  'SILERO_LICENSE.txt',
]) {
  await cp(path.join(root, 'assets', filename), path.join(assets, filename));
}
const require = createRequire(import.meta.url);
const runtime = path.dirname(require.resolve('onnxruntime-web/wasm'));
for (const filename of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await cp(path.join(runtime, filename), path.join(assets, filename));
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
