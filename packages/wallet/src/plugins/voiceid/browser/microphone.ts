import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';

const SAMPLE_RATE = 16_000;
export const VOICE_SAMPLE_PHRASE = 'My voice unlocks my wallet.';

export function requireVoiceUserAction(): void {
  if (
    !navigator.userActivation.isActive ||
    document.visibilityState !== 'visible' ||
    !document.hasFocus()
  ) {
    throw new Error('Open the Wallet and select Record to use VoiceID.');
  }
}

export async function recordVoice(
  signal: AbortSignal,
  onListening: (microphone: string) => void,
): Promise<{ samples: Float32Array; voicedMs: number; durationMs: number; microphone: string }> {
  if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  try {
    if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
    const recording = new VoiceRecording(
      stream,
      signal,
      onListening,
      8_000,
    );
    const bytes = await recording.result;
    if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
    const decoder = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(bytes);
    const renderer = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    const rendered = await renderer.startRendering();
    if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
    const speech = speechSamples(
      rendered.getChannelData(0),
      SAMPLE_RATE * 2,
    );
    return {
      samples: speech.samples,
      voicedMs: speech.voicedMs,
      durationMs: rendered.duration * 1_000,
      microphone: stream.getAudioTracks()[0]?.label || 'Default microphone',
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

class VoiceRecording {
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly completion = new WorkerDeferred<ArrayBuffer>();
  readonly result = this.completion.promise;

  constructor(
    private readonly stream: MediaStream,
    private readonly signal: AbortSignal,
    onListening: (microphone: string) => void,
    durationMs: number,
  ) {
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener('dataavailable', this.data);
    this.recorder.addEventListener('stop', this.stopped);
    this.recorder.addEventListener('error', this.failed);
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.recorder.start();
    this.timer = setTimeout(this.stop, durationMs);
    onListening(stream.getAudioTracks()[0]?.label || 'Default microphone');
  }

  private readonly data = (event: BlobEvent): void => {
    this.chunks.push(event.data);
  };
  private readonly stop = (): void => {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.stopTracks();
  };
  private readonly cancelled = (): void => {
    this.stop();
  };
  private readonly failed = (): void => {
    this.cleanup();
    this.completion.reject(new Error('VoiceID could not record this microphone.'));
  };
  private readonly stopped = (): void => {
    this.cleanup();
    if (this.signal.aborted) {
      this.completion.reject(new Error('VoiceID recording was cancelled.'));
      return;
    }
    void new Blob(this.chunks, { type: this.recorder.mimeType })
      .arrayBuffer()
      .then(
        this.completion.resolve.bind(this.completion),
        this.completion.reject.bind(this.completion),
      );
  };
  private stopTracks(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }
  private cleanup(): void {
    this.stopTracks();
    if (this.timer !== null) clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.cancelled);
    this.recorder.removeEventListener('dataavailable', this.data);
    this.recorder.removeEventListener('stop', this.stopped);
    this.recorder.removeEventListener('error', this.failed);
  }
}

function speechSamples(
  samples: Float32Array,
  minimumVoicedSamples: number,
): { samples: Float32Array; voicedMs: number } {
  let first = -1;
  let last = 0;
  let voicedSamples = 0;
  const frameSize = 160;
  for (let offset = 0; offset + frameSize <= samples.length; offset += frameSize) {
    let energy = 0;
    for (let i = offset; i < offset + frameSize; i += 1) energy += samples[i] * samples[i];
    if (Math.sqrt(energy / frameSize) < 0.006) continue;
    if (first < 0) first = offset;
    last = offset + frameSize;
    voicedSamples += frameSize;
  }
  if (first < 0 || voicedSamples < minimumVoicedSamples)
    throw new Error(
      'VoiceID needs more clear speech. Read the full sentence after Listening appears.',
    );
  return {
    samples: samples.slice(Math.max(0, first - 3_200), Math.min(samples.length, last + 3_200)),
    voicedMs: (voicedSamples / SAMPLE_RATE) * 1_000,
  };
}
