import { expect, type Frame } from '@playwright/test';
import { intendedTest as test } from './harness';

type RestartResult = {
  registeredPublicKeyB64u: string;
  expectedPublicKeyB64u: string;
  keyManifestDigestB64u: string;
  expectedManifestDigestB64u: string;
};

declare global {
  interface Window {
    __nearRegistrationCheckpointRestart?: () => Promise<RestartResult>;
  }
}

// Test-only interception retains the virtual authenticator's factor until the
// restart assertion. Production persists only the encrypted checkpoint.
function installCheckpointRestartProbe(): void {
  const NativeWorker = window.Worker;

  class CheckpointWorker extends NativeWorker {
    private readonly url: string | URL;
    private readonly options: WorkerOptions | undefined;
    private beginId = '';
    private finishId = '';
    private ceremonyId = '';
    private custodyJson = '';
    private factorSecret: ArrayBuffer | null = null;
    private checkpointJson = '';
    private completeRequest: Record<string, unknown> | null = null;
    private queuedCompletion: Record<string, unknown> | null = null;
    private expected: Record<string, unknown> | null = null;

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.url = url;
      this.options = options;
      if (options?.name === 'wallet-custody-ceremony-worker') {
        this.addEventListener('message', this.observe.bind(this));
      }
    }

    private record(value: unknown): Record<string, unknown> | null {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
      return Object.fromEntries(Object.entries(value));
    }

    override postMessage(
      message: unknown,
      transferOrOptions: Transferable[] | StructuredSerializeOptions = [],
    ): void {
      const request = this.record(message);
      const payload = this.record(request?.payload);
      const custody = this.record(payload?.custody);
      if (
        request?.type === 'beginWalletCustodyKeySetRun' &&
        payload?.keySet === 'near_ed25519_v1' &&
        custody?.origin === 'join' &&
        custody.factorSecret instanceof ArrayBuffer &&
        typeof custody.custodyJson === 'string' &&
        typeof request.id === 'string' &&
        typeof payload.ceremonyId === 'string'
      ) {
        this.beginId = request.id;
        this.ceremonyId = payload.ceremonyId;
        this.custodyJson = custody.custodyJson;
        this.factorSecret = custody.factorSecret.slice(0);
      }
      if (
        this.beginId && request?.type === 'completeWalletCustodyKeySetRun' &&
        payload?.keySet === 'near_ed25519_v1' && payload.ceremonyId === this.ceremonyId
      ) {
        this.completeRequest = structuredClone(request);
        if (!this.checkpointJson) {
          this.queuedCompletion = request;
          return;
        }
      }
      if (
        request?.type === 'finishWalletCustodyKeySetRun' &&
        payload?.ceremonyId === this.ceremonyId && typeof request.id === 'string'
      ) {
        this.finishId = request.id;
      }
      if (Array.isArray(transferOrOptions)) {
        super.postMessage(message, transferOrOptions);
      } else {
        super.postMessage(message, transferOrOptions);
      }
    }

    private observe(event: MessageEvent<unknown>): void {
      const message = this.record(event.data);
      if (message?.id === this.beginId && message.ok === true) {
        super.postMessage({
          id: 'checkpoint-restart-probe',
          type: 'checkpointNearRegistration',
          payload: { ceremonyId: this.ceremonyId },
        });
      }
      if (message?.id === 'checkpoint-restart-probe') {
        event.stopImmediatePropagation();
        const result = this.record(message.result);
        if (message.ok !== true || typeof result?.checkpointJson !== 'string') {
          throw new Error('Checkpoint probe could not seal the prepared exchange');
        }
        this.checkpointJson = result.checkpointJson;
        if (this.queuedCompletion) {
          super.postMessage(this.queuedCompletion);
          this.queuedCompletion = null;
        }
      }
      if (message?.id === this.finishId && message.ok === true) {
        this.expected = this.record(message.result);
        window.__nearRegistrationCheckpointRestart = this.restart.bind(this);
      }
    }

    private send(
      worker: Worker,
      type: string,
      payload: unknown,
      resolve: (value: Record<string, unknown>) => void,
      reject: (error: Error) => void,
    ): void {
      worker.addEventListener('message', this.receive.bind(this, resolve, reject), { once: true });
      worker.postMessage({ id: 'restarted-checkpoint-probe', type, payload });
    }

    private receive(
      resolve: (value: Record<string, unknown>) => void,
      reject: (error: Error) => void,
      event: MessageEvent<unknown>,
    ): void {
      const message = this.record(event.data);
      const result = this.record(message?.result);
      if (message?.ok !== true || !result) {
        reject(new Error('Restarted custody worker rejected the exchange'));
        return;
      }
      resolve(result);
    }

    private invoke(worker: Worker, type: string, payload: unknown): Promise<Record<string, unknown>> {
      return new Promise(this.send.bind(this, worker, type, payload));
    }

    private async restart(): Promise<RestartResult> {
      if (!this.factorSecret || !this.completeRequest || !this.expected) {
        throw new Error('No completed mixed-registration exchange captured');
      }
      this.terminate();
      const replacement = new NativeWorker(this.url, this.options);
      try {
        await this.invoke(replacement, 'restoreNearRegistration', {
          ceremonyId: this.ceremonyId,
          custodyJson: this.custodyJson,
          factorSecret: this.factorSecret,
          checkpointJson: this.checkpointJson,
        });
        await this.invoke(replacement, 'completeWalletCustodyKeySetRun', this.completeRequest.payload);
        const result = await this.invoke(replacement, 'finishWalletCustodyKeySetRun', {
          ceremonyId: this.ceremonyId,
          finish: { kind: 'existing' },
        });
        if (
          typeof result.registeredPublicKeyB64u !== 'string' ||
          typeof result.keyManifestDigestB64u !== 'string' ||
          typeof this.expected.registeredPublicKeyB64u !== 'string' ||
          typeof this.expected.keyManifestDigestB64u !== 'string'
        ) {
          throw new Error('Resumed exchange did not verify a NEAR manifest');
        }
        return {
          registeredPublicKeyB64u: result.registeredPublicKeyB64u,
          keyManifestDigestB64u: result.keyManifestDigestB64u,
          expectedPublicKeyB64u: this.expected.registeredPublicKeyB64u,
          expectedManifestDigestB64u: this.expected.keyManifestDigestB64u,
        };
      } finally {
        replacement.terminate();
        new Uint8Array(this.factorSecret).fill(0);
        this.factorSecret = null;
        delete window.__nearRegistrationCheckpointRestart;
      }
    }
  }

  window.Worker = CheckpointWorker;
}

function hasRestartProbe(): boolean {
  return typeof window.__nearRegistrationCheckpointRestart === 'function';
}

function restartFromCheckpoint(): Promise<RestartResult> {
  if (!window.__nearRegistrationCheckpointRestart) throw new Error('Missing checkpoint probe');
  return window.__nearRegistrationCheckpointRestart();
}

async function findCheckpointFrame(frames: readonly Frame[]): Promise<Frame> {
  for (const frame of frames) {
    if (await frame.evaluate(hasRestartProbe)) return frame;
  }
  throw new Error('Registration did not checkpoint a joining NEAR ceremony');
}

test('a fresh custody worker completes the original Yao exchange from ciphertext', async ({
  context, page, harness,
}) => {
  await context.addInitScript(installCheckpointRestartProbe);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const frame = await findCheckpointFrame(page.frames());
  const result = await frame.evaluate(restartFromCheckpoint);
  expect(result.registeredPublicKeyB64u).toBe(result.expectedPublicKeyB64u);
  expect(result.keyManifestDigestB64u).toBe(result.expectedManifestDigestB64u);
});
