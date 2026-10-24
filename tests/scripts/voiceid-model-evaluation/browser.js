import * as ort from '/ort/ort.wasm.min.mjs';

const status = document.getElementById('status');
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

function normalize(values) {
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (values.length !== 192 || !Number.isFinite(norm) || norm <= 1e-12) {
    throw new Error('Invalid speaker embedding');
  }
  return Array.from(values, divide.bind(null, norm));
}

function divide(norm, value) {
  return value / norm;
}

async function infer(session, samples) {
  const input = new ort.Tensor('float32', samples, [1, samples.length]);
  const started = performance.now();
  let outputs;
  try {
    outputs = await session.run({ samples: input });
    return { embedding: normalize(outputs.embedding.data), inferenceMs: performance.now() - started };
  } finally {
    input.dispose();
    if (outputs) {
      for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }
}

async function run() {
  const model = new URL(location.href).searchParams.get('model');
  const corpus = await (await fetch('/corpus')).json();
  const started = performance.now();
  const session = await ort.InferenceSession.create(`/models/${model}.onnx`, {
    executionProviders: ['wasm'],
  });
  const loadMs = performance.now() - started;
  const results = [];
  try {
    for (const item of corpus.samples) {
      const bytes = await (await fetch(`/pcm/${item.id}.f32`)).arrayBuffer();
      const pcm = new Float32Array(bytes);
      const result = await infer(session, pcm);
      results.push({ id: item.id, ...result });
      pcm.fill(0);
      status.textContent = `${model}: ${results.length}/${corpus.samples.length} recordings processed`;
    }
    // A quiet input must produce finite outputs; caller speech-quality checks reject it.
    const quiet = await infer(session, new Float32Array(32000));
    const report = {
      model, loadMs, results, quietFinite: quiet.embedding.every(Number.isFinite),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      runtime: 'onnxruntime-web WASM, one thread',
      memoryMeasurement: 'not measured; JS heap does not represent total WASM memory',
    };
    await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
    status.textContent = `${model}: complete (${results.length} recordings)`;
    document.body.dataset.state = 'complete';
  } finally {
    await session.release();
  }
}

function failed(error) {
  status.textContent = String(error);
  document.body.dataset.state = 'failed';
}

run().catch(failed);
