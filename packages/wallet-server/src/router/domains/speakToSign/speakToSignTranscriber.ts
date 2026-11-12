// The speech-to-text service of each verifier call. The verifier has one OutLayer build for each
// service (speak-to-sign repository, crates/voice-verifier, "Speech-to-text service"): the default
// build sends the clip to NEAR AI Whisper, and the `venice` build sends it to Venice AI. Only this
// server holds the WASM hashes of the builds, so a page cannot choose a build.
//
// NEAR AI serves each call. Venice serves a call only while NEAR AI or its Whisper is down, and
// only when the server has the WASM hash of the `venice` build. On 2026-11-12 NEAR AI Whisper gave
// HTTP 502 for 12 minutes, then no answer for more than an hour, while the rest of NEAR AI
// answered. Venice runs in no TEE, so it can read the words of the clips that it gets.

export type Transcriber = 'nearai' | 'venice';

type ServiceState = 'up' | 'slow' | 'down' | 'unknown';

/** The state of the NEAR AI gateway (its model list) and of its Whisper model. */
export type NearAiStatus = Readonly<{ nearAi: ServiceState; whisper: ServiceState; checkedAtMs: number }>;

const NEAR_AI_MODELS_URL = 'https://cloud-api.near.ai/v1/models';
const NEAR_AI_TRANSCRIPTIONS_URL = 'https://cloud-api.near.ai/v1/audio/transcriptions';
/** The model and the language of the verifier (crates/voice-verifier/src/config.rs). */
const WHISPER_MODEL = 'openai/whisper-large-v3';
/** A usual answer of Whisper comes in about 1 s. After this, it is slow. */
const SLOW_MS = 5_000;
/** After this, the check stops waiting: the service is down. */
const PROBE_TIMEOUT_MS = 10_000;
/** One check serves all calls for this time, so that each call does not pay for a transcription. */
const CACHE_MS = 60_000;
/** A usual check takes about 1 s. A call waits this long for it, then takes NEAR AI as down. */
const CHOICE_WAIT_MS = 3_000;

/**
 * The service for one call. Without a `venice` build, NEAR AI serves. With one, Venice serves
 * while NEAR AI or its Whisper is down, or when the check gave no answer in time (`status` null).
 * A 4xx answer is about the key or the request, not an outage: NEAR AI serves.
 */
export function chooseTranscriber(options: {
  hasVeniceBuild: boolean;
  status: NearAiStatus | null;
}): Transcriber {
  if (!options.hasVeniceBuild) return 'nearai';
  const { status } = options;
  const down = status === null || status.nearAi === 'down' || status.whisper === 'down';
  return down ? 'venice' : 'nearai';
}

/** A 5xx answer is an outage; a 4xx answer is about this request or this key, not the service. */
export function stateOf(status: number, elapsedMs: number): ServiceState {
  if (status >= 500) return 'down';
  if (status < 200 || status >= 300) return 'unknown';
  return elapsedMs > SLOW_MS ? 'slow' : 'up';
}

/** What the status check keeps between calls: the last result, and the check that runs. */
export type NearAiStatusMemory = { last: NearAiStatus | null; running: Promise<NearAiStatus> | null };

export function createNearAiStatusMemory(): NearAiStatusMemory {
  return { last: null, running: null };
}

/** The gateway builds its routes for each request, so the memory belongs to the isolate. */
const ISOLATE_MEMORY = createNearAiStatusMemory();

export type TranscriberChoiceDependencies = Readonly<{
  fetch: typeof fetch;
  now: () => number;
  /** Default: the memory of this isolate. */
  memory?: NearAiStatusMemory;
  /** Tests pass a short wait. */
  choiceWaitMs?: number;
}>;

/**
 * Chooses the service of each call. Without a `venice` build it asks nothing. Without a NEAR AI
 * key it cannot check NEAR AI, so NEAR AI serves.
 */
export class TranscriberChoice {
  private readonly memory: NearAiStatusMemory;

  constructor(
    private readonly options: Readonly<{ hasVeniceBuild: boolean; nearAiApiKey: string | null }>,
    private readonly dependencies: TranscriberChoiceDependencies,
  ) {
    this.memory = dependencies.memory ?? ISOLATE_MEMORY;
  }

  async choose(): Promise<Transcriber> {
    const { hasVeniceBuild, nearAiApiKey } = this.options;
    if (!hasVeniceBuild || !nearAiApiKey) return 'nearai';
    const waitMs = this.dependencies.choiceWaitMs ?? CHOICE_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const status = await Promise.race([
      this.status(nearAiApiKey).catch(() => null),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs))),
    ]);
    clearTimeout(timer);
    return chooseTranscriber({ hasVeniceBuild, status });
  }

  /** The cached result, or one new check that all calls share. */
  private status(apiKey: string): Promise<NearAiStatus> {
    const { memory } = this;
    const now = this.dependencies.now();
    if (memory.last && now - memory.last.checkedAtMs < CACHE_MS) return Promise.resolve(memory.last);
    memory.running ??= this.check(apiKey)
      .then((status) => (memory.last = status))
      .finally(() => (memory.running = null));
    return memory.running;
  }

  /** The model list and one short silent clip to Whisper, at the same time. */
  private async check(apiKey: string): Promise<NearAiStatus> {
    const authorization = { Authorization: `Bearer ${apiKey}` };
    const [nearAi, whisper] = await Promise.all([
      this.probe(NEAR_AI_MODELS_URL, { headers: authorization }),
      this.probe(NEAR_AI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: authorization,
        body: silentClip(),
      }),
    ]);
    return { nearAi, whisper, checkedAtMs: this.dependencies.now() };
  }

  private async probe(url: string, init: RequestInit): Promise<ServiceState> {
    const startedAtMs = this.dependencies.now();
    let response: Response;
    try {
      response = await this.dependencies.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch {
      return 'down';
    }
    await response.body?.cancel().catch(() => {});
    return stateOf(response.status, this.dependencies.now() - startedAtMs);
  }
}

/** The form of a Whisper request: 500 ms of silence, in the model and language of the verifier. */
function silentClip(): FormData {
  const form = new FormData();
  form.append('file', new Blob([silentWav(500)], { type: 'audio/wav' }), 'status.wav');
  form.append('model', WHISPER_MODEL);
  form.append('language', 'en');
  return form;
}

/** A 16 kHz mono PCM16 WAV of silence. 500 ms is 16,044 bytes. */
export function silentWav(durationMs: number): Uint8Array<ArrayBuffer> {
  const samples = Math.round((16_000 * durationMs) / 1000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}
