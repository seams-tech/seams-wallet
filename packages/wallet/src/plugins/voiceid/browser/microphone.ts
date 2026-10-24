import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';

export type VoiceCaptureEvent =
  | { readonly kind: 'listening'; readonly stream: MediaStream }
  | { readonly kind: 'processing'; readonly stream?: never }
  | { readonly kind: 'measured'; readonly quality: VoiceCaptureQuality; readonly stream?: never };
export type VoiceCaptureObserver = (event: VoiceCaptureEvent) => void;

export type VoiceCaptureQuality = Readonly<{
  attemptId: string;
  capturedAtMs: number;
  durationMs: number;
  voicedMs: number;
  peakFrameRms: number;
  levelThreshold: number;
  requiredVoicedMs: number;
  microphone: string;
}>;

type VoiceRecordingResult =
  | { kind: 'captured'; samples: Float32Array; quality: VoiceCaptureQuality }
  | { kind: 'insufficient_audio'; quality: VoiceCaptureQuality; samples?: never };

export function voiceQualityMessage(quality: VoiceCaptureQuality): string {
  return `Audio too brief or quiet: ${(quality.voicedMs / 1_000).toFixed(2)} of ${(quality.requiredVoicedMs / 1_000).toFixed(2)} seconds detected.`;
}

/** Carries a typed capture rejection across the SDK's exception-based UI action boundary. */
export class InsufficientVoiceAudioError extends Error {
  constructor(readonly quality: VoiceCaptureQuality) {
    super(voiceQualityMessage(quality));
    this.name = 'InsufficientVoiceAudioError';
  }
}

const SAMPLE_RATE = 16_000;
const LEVEL_THRESHOLD = 0.006;
const REQUIRED_VOICED_MS = 2_000;

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
  onCapture: VoiceCaptureObserver,
): Promise<VoiceRecordingResult> {
  if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
  const attemptId = crypto.randomUUID();
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
    const recording = new VoiceRecording(stream, signal, onCapture, 8_000);
    const bytes = await recording.result.finally(onCapture.bind(null, { kind: 'processing' }));
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
    try {
      const rendered = await renderer.startRendering();
      try {
        if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
        const samples = rendered.getChannelData(0);
        const measurement = measureAudio(samples);
        const quality: VoiceCaptureQuality = {
          attemptId,
          capturedAtMs: Date.now(),
          durationMs: rendered.duration * 1_000,
          voicedMs: measurement.voicedMs,
          peakFrameRms: measurement.peakFrameRms,
          levelThreshold: LEVEL_THRESHOLD,
          requiredVoicedMs: REQUIRED_VOICED_MS,
          microphone: stream.getAudioTracks()[0]?.label || 'Default microphone',
        };
        onCapture({ kind: 'measured', quality });
        if (measurement.kind === 'insufficient_audio') {
          return { kind: 'insufficient_audio', quality };
        }
        const speech = samples.slice(
          Math.max(0, measurement.first - 3_200),
          Math.min(samples.length, measurement.last + 3_200),
        );
        return { kind: 'captured', samples: speech, quality };
      } finally {
        wipeAudioBuffer(rendered);
      }
    } finally {
      wipeAudioBuffer(decoded);
    }
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
    onCapture: VoiceCaptureObserver,
    durationMs: number,
  ) {
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener('dataavailable', this.data);
    this.recorder.addEventListener('stop', this.stopped);
    this.recorder.addEventListener('error', this.failed);
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.recorder.start();
    this.timer = setTimeout(this.stop, durationMs);
    onCapture({ kind: 'listening', stream });
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

type AudioMeasurement =
  | { kind: 'captured'; first: number; last: number; voicedMs: number; peakFrameRms: number }
  | {
      kind: 'insufficient_audio';
      voicedMs: number;
      peakFrameRms: number;
      first?: never;
      last?: never;
    };

function measureAudio(samples: Float32Array): AudioMeasurement {
  let first = -1;
  let last = 0;
  let voicedSamples = 0;
  let peakFrameRms = 0;
  const frameSize = 160;
  for (let offset = 0; offset + frameSize <= samples.length; offset += frameSize) {
    let energy = 0;
    for (let i = offset; i < offset + frameSize; i += 1) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / frameSize);
    peakFrameRms = Math.max(peakFrameRms, rms);
    if (rms < LEVEL_THRESHOLD) continue;
    if (first < 0) first = offset;
    last = offset + frameSize;
    voicedSamples += frameSize;
  }
  const voicedMs = (voicedSamples / SAMPLE_RATE) * 1_000;
  if (first < 0 || voicedMs < REQUIRED_VOICED_MS) {
    return { kind: 'insufficient_audio', voicedMs, peakFrameRms };
  }
  return { kind: 'captured', first, last, voicedMs, peakFrameRms };
}

function wipeAudioBuffer(buffer: AudioBuffer): void {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    buffer.getChannelData(channel).fill(0);
  }
}
