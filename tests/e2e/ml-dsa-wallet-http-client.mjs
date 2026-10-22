//! One persistent Node HTTP client per simulated wallet. No protocol work runs here.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

export async function createWalletHttpClient(clientId, endpoint, credential, timeoutMs) {
  const worker = new Worker(new URL('./ml-dsa-wallet-http-worker.mjs', import.meta.url), {
    workerData: { clientId, endpoint, credential, timeoutMs },
  });
  try {
    const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(10000) });
    assert.equal(ready.status, 'ready');
    return new WalletHttpClient(worker, clientId, ready.runtime, timeoutMs);
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

class WalletHttpClient {
  constructor(worker, clientId, runtime, timeoutMs) {
    this.worker = worker;
    this.clientId = clientId;
    this.runtime = runtime;
    this.timeoutMs = timeoutMs;
    this.state = { kind: 'ready' };
    worker.on('message', this.completed.bind(this));
    worker.on('error', this.failed.bind(this));
    worker.on('exit', this.exited.bind(this));
  }

  post(body, requestId, timing) {
    const started = performance.now();
    Object.assign(timing, { requestId, clientId: this.clientId, workerTimingReceived: false });
    if (this.state.kind !== 'ready') {
      timing.parentElapsedMs = performance.now() - started;
      return Promise.reject(new Error('HTTP client is not ready; request was not dispatched'));
    }
    const completion = Promise.withResolvers();
    const timer = setTimeout(this.timedOut.bind(this), this.timeoutMs + 5000);
    this.state = {
      kind: 'pending', requestId, timing, completion, timer, started,
    };
    try {
      this.worker.postMessage({ requestId, body });
    } catch (error) {
      this.failed(error);
    }
    return completion.promise;
  }

  completed(message) {
    if (this.state.kind === 'closed') return;
    if (this.state.kind !== 'pending' || message.requestId !== this.state.requestId) {
      this.failed(new Error('HTTP client returned an unexpected request identity'));
      return;
    }
    const pending = this.state;
    clearTimeout(pending.timer);
    this.state = { kind: 'ready' };
    Object.assign(pending.timing, message.timing, {
      parentElapsedMs: performance.now() - pending.started,
      workerTimingReceived: true,
    });
    switch (message.status) {
      case 'completed':
        pending.completion.resolve(message.response);
        break;
      case 'failed':
        pending.completion.reject(new Error(message.error));
        break;
      default:
        pending.completion.reject(new Error('HTTP client returned an invalid result'));
        this.failed(new Error('Invalid HTTP client result'));
    }
  }

  timedOut() {
    this.failed(new Error('HTTP client response timed out; server outcome is unknown'));
  }

  exited(code) {
    this.failed(new Error(`HTTP client exited (${code}); server outcome is unknown`));
  }

  failed(error) {
    if (this.state.kind === 'closed') return;
    if (this.state.kind === 'pending') {
      clearTimeout(this.state.timer);
      this.state.timing.parentElapsedMs = performance.now() - this.state.started;
      this.state.completion.reject(error);
    }
    this.state = { kind: 'closed', completion: this.worker.terminate() };
  }

  close() {
    this.failed(new Error('HTTP client closed; server outcome is unknown'));
    return this.state.completion;
  }
}
