//! The parent owns signing decisions and retries. This thread performs one HTTP request.
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { observeEventLoop, timedJson } from './ml-dsa-http-timing.mjs';

parentPort.on('message', post);
parentPort.postMessage({
  status: 'ready',
  runtime: { node: process.version, undici: process.versions.undici },
});

async function post({ requestId, body }) {
  const timing = { clientId: workerData.clientId, fetchEventLoopGaps: [] };
  const monitor = observeEventLoop(timing.fetchEventLoopGaps, performance.now());
  try {
    const response = await timedJson(workerData.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-router-ab-internal-service-auth': workerData.credential,
        'x-ml-dsa-request-id': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(workerData.timeoutMs),
    }, requestId, timing);
    parentPort.postMessage({ status: 'completed', requestId, response, timing });
  } catch (error) {
    parentPort.postMessage({ status: 'failed', requestId, error: String(error), timing });
  } finally {
    clearInterval(monitor);
  }
}
