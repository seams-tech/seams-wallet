import { createVoiceActivity } from './voiceActivity';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';

/** One 32 ms frame as the recorder judged it. No capture event carries the stream. */
export type VoiceActivityEvent = Readonly<{
  kind: 'activity';
  rms: number;
  /** The voice activity model and the level check both found speech. */
  speech: boolean;
  /** The share of the end pause that has passed: 0 before speech, 1 when capture stops. */
  pause: number;
  stream?: never;
}>;
export type VoiceCaptureEvent =
  | { readonly kind: 'listening'; readonly stream?: never }
  | VoiceActivityEvent
  | { readonly kind: 'processing'; readonly stream?: never }
  | { readonly kind: 'measured'; readonly quality: VoiceCaptureQuality; readonly stream?: never };
export type VoiceCaptureObserver = (event: VoiceCaptureEvent) => void;

export type VoiceCaptureQuality = Readonly<{
  attemptId: string;
  capturedAtMs: number;
  durationMs: number;
  recordingMs: number;
  endedBy: 'pause' | 'limit' | 'stream_ended';
  voicedMs: number;
  peakFrameRms: number;
  levelThreshold: number;
  requiredVoicedMs: number;
  microphone: string;
  processing: Readonly<{
    noiseSuppression: boolean | null;
    echoCancellation: boolean | string | null;
    autoGainControl: boolean | null;
    sampleRate: number | null;
  }>;
  backgroundRms: number;
  speechToBackgroundDb: number | null;
  noise: 'high' | 'normal' | 'unknown';
}>;

type VoiceRecordingResult =
  | { kind: 'captured'; samples: Float32Array; quality: VoiceCaptureQuality }
  | { kind: 'insufficient_audio'; quality: VoiceCaptureQuality; samples?: never };

export function voiceQualityMessage(quality: VoiceCaptureQuality): string {
  if (quality.noise === 'high')
    return 'Background noise is high. Move closer to the microphone and try again.';
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
const REQUIRED_VOICED_MS = 600;
const MAX_RECORDING_MS = 8_000;
const END_PAUSE_MS = 1_500;
const SPEECH_START_MS = 100;
const VOICE_FRAME_MS = 32;

type SpeechActivity =
  { kind: 'waiting'; activeMs: number } | { kind: 'speaking'; lastSoundAtMs: number };

type RecordedAudio = Readonly<{
  bytes: ArrayBuffer;
  recordingMs: number;
  endedBy: 'pause' | 'limit' | 'stream_ended';
}>;

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
    const recording = new VoiceRecording(stream, signal, onCapture);
    const clip = await recording.result.finally(onCapture.bind(null, { kind: 'processing' }));
    if (signal.aborted) throw new Error('VoiceID recording was cancelled.');
    const decoder = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(clip.bytes);
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
        const measurement = await measureAudio(samples, signal);
        const settings = stream.getAudioTracks()[0]?.getSettings();
        const quality: VoiceCaptureQuality = {
          attemptId,
          capturedAtMs: Date.now(),
          durationMs: rendered.duration * 1_000,
          recordingMs: clip.recordingMs,
          endedBy: clip.endedBy,
          voicedMs: measurement.voicedMs,
          peakFrameRms: measurement.peakFrameRms,
          levelThreshold: LEVEL_THRESHOLD,
          requiredVoicedMs: REQUIRED_VOICED_MS,
          microphone: stream.getAudioTracks()[0]?.label || 'Default microphone',
          processing: {
            noiseSuppression: settings?.noiseSuppression ?? null,
            echoCancellation: settings?.echoCancellation ?? null,
            autoGainControl: settings?.autoGainControl ?? null,
            sampleRate: settings?.sampleRate ?? null,
          },
          backgroundRms: measurement.backgroundRms,
          speechToBackgroundDb: measurement.speechToBackgroundDb,
          noise: measurement.noise,
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
  private readonly completion = new WorkerDeferred<RecordedAudio>();
  private startedAtMs = performance.now();
  private ended: Pick<RecordedAudio, 'recordingMs' | 'endedBy'> | null = null;
  private activity: SpeechActivity = { kind: 'waiting', activeMs: 0 };
  private audioContext: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private detector: Awaited<ReturnType<typeof createVoiceActivity>> | null = null;
  private pending: Promise<void> = Promise.resolve();
  private queuedFrames = 0;
  private closed = false;
  readonly result = this.completion.promise;

  constructor(
    private readonly stream: MediaStream,
    private readonly signal: AbortSignal,
    private readonly onCapture: VoiceCaptureObserver,
  ) {
    this.recorder = new MediaRecorder(stream);
    this.recorder.addEventListener('dataavailable', this.data);
    this.recorder.addEventListener('stop', this.stopped);
    this.recorder.addEventListener('error', this.failed);
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.timer = setTimeout(this.startupFailed, MAX_RECORDING_MS);
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      await this.startPauseDetection();
      this.signal.throwIfAborted();
      this.startedAtMs = performance.now();
      if (this.closed) return;
      this.recorder.start();
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(this.stop.bind(this, 'limit'), MAX_RECORDING_MS);
      this.onCapture({ kind: 'listening' });
    } catch (error) {
      this.cleanup();
      this.completion.reject(
        error instanceof Error ? error : new Error('Speech detection could not start.'),
      );
    }
  }

  private readonly data = (event: BlobEvent): void => {
    this.chunks.push(event.data);
  };
  private readonly stop = (endedBy: RecordedAudio['endedBy']): void => {
    if (this.recorder.state === 'inactive') return;
    this.ended = { endedBy, recordingMs: performance.now() - this.startedAtMs };
    this.recorder.stop();
    this.stopTracks();
  };
  private readonly cancelled = (): void => {
    if (this.recorder.state === 'inactive') {
      this.cleanup();
      this.completion.reject(new Error('VoiceID recording was cancelled.'));
      return;
    }
    this.stop('stream_ended');
  };
  private readonly startupFailed = (): void => {
    this.cleanup();
    this.completion.reject(new Error('Speech detection startup timed out. Please try again.'));
  };
  private readonly detectorFailed = (error: unknown): void => {
    this.cleanup();
    this.completion.reject(error instanceof Error ? error : new Error('Speech detection failed.'));
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
      .then(this.complete, this.completion.reject.bind(this.completion));
  };
  private readonly complete = (bytes: ArrayBuffer): void => {
    if (this.signal.aborted) {
      this.completion.reject(new Error('VoiceID recording was cancelled.'));
      return;
    }
    const end = this.ended ?? {
      endedBy: 'stream_ended' as const,
      recordingMs: performance.now() - this.startedAtMs,
    };
    this.completion.resolve({ bytes, recordingMs: end.recordingMs, endedBy: end.endedBy });
  };

  private async startPauseDetection(): Promise<void> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.audioContext = context;
    const resumed = context.resume();
    this.detector = await createVoiceActivity();
    this.signal.throwIfAborted();
    if (context.sampleRate !== SAMPLE_RATE)
      throw new Error('Speech detection requires 16 kHz audio.');
    await context.audioWorklet.addModule('/sdk/voiceid/voice-activity-worklet.js');
    this.signal.throwIfAborted();
    const worklet = new AudioWorkletNode(context, 'voice-activity-frames');
    this.worklet = worklet;
    worklet.port.onmessage = this.receiveFrame;
    context.createMediaStreamSource(this.stream).connect(worklet);
    worklet.connect(context.destination);
    await resumed;
  }

  private readonly receiveFrame = (event: MessageEvent<unknown>): void => {
    if (!(event.data instanceof Float32Array) || event.data.length !== 512) {
      this.failed();
      return;
    }
    if (this.closed || this.recorder.state !== 'recording') {
      event.data.fill(0);
      return;
    }
    if (++this.queuedFrames > 32) {
      event.data.fill(0);
      this.failed();
      return;
    }
    this.pending = this.pending
      .then(this.processFrame.bind(this, event.data))
      .catch(this.detectorFailed);
  };

  private async processFrame(frame: Float32Array): Promise<void> {
    const detector = this.detector;
    try {
      if (this.closed || !detector) return;
      const probability = await detector.probability(frame);
      if (this.closed) {
        detector.clear();
        return;
      }
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      const rms = Math.sqrt(energy / frame.length);
      const speech = probability >= 0.5 && rms >= LEVEL_THRESHOLD;
      this.updateActivity(speech);
      this.onCapture({ kind: 'activity', rms, speech, pause: this.pauseProgress() });
    } finally {
      frame.fill(0);
      this.queuedFrames -= 1;
    }
  }

  private updateActivity(audible: boolean): void {
    const now = performance.now();
    switch (this.activity.kind) {
      case 'waiting': {
        const activeMs = audible ? this.activity.activeMs + VOICE_FRAME_MS : 0;
        this.activity =
          activeMs >= SPEECH_START_MS
            ? { kind: 'speaking', lastSoundAtMs: now }
            : { kind: 'waiting', activeMs };
        return;
      }
      case 'speaking':
        if (audible) this.activity = { kind: 'speaking', lastSoundAtMs: now };
        else if (now - this.activity.lastSoundAtMs >= END_PAUSE_MS) this.stop('pause');
        return;
      default:
        return assertNeverActivity(this.activity);
    }
  }

  private pauseProgress(): number {
    if (this.activity.kind === 'waiting') return 0;
    return Math.min(1, (performance.now() - this.activity.lastSoundAtMs) / END_PAUSE_MS);
  }

  private readonly stopPauseDetection = (): void => {
    this.closed = true;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
      this.worklet.disconnect();
    }
    this.worklet = null;
    this.detector?.clear();
    this.detector = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context) void context.close().catch(ignoreClosedContext);
  };

  private stopTracks(): void {
    for (const track of this.stream.getTracks()) track.stop();
  }
  private cleanup(): void {
    this.stopPauseDetection();
    this.stopTracks();
    if (this.timer !== null) clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.cancelled);
    this.recorder.removeEventListener('dataavailable', this.data);
    this.recorder.removeEventListener('stop', this.stopped);
    this.recorder.removeEventListener('error', this.failed);
  }
}

type NoiseMeasurement = Readonly<{
  backgroundRms: number;
  speechToBackgroundDb: number | null;
  noise: 'high' | 'normal' | 'unknown';
}>;
type AudioMeasurement = NoiseMeasurement &
  (
    | { kind: 'captured'; first: number; last: number; voicedMs: number; peakFrameRms: number }
    | {
        kind: 'insufficient_audio';
        voicedMs: number;
        peakFrameRms: number;
        first?: never;
        last?: never;
      }
  );

async function measureAudio(samples: Float32Array, signal: AbortSignal): Promise<AudioMeasurement> {
  const detector = await createVoiceActivity();
  let first = -1;
  let last = 0;
  let voicedSamples = 0;
  let peakFrameRms = 0;
  let backgroundEnergy = 0;
  let backgroundSamples = 0;
  let speechEnergy = 0;
  const frame = new Float32Array(512);
  try {
    for (let offset = 0; offset < samples.length; offset += frame.length) {
      signal.throwIfAborted();
      frame.fill(0);
      const count = Math.min(frame.length, samples.length - offset);
      frame.set(samples.subarray(offset, offset + count));
      let energy = 0;
      for (const sample of frame) energy += sample * sample;
      const rms = Math.sqrt(energy / count);
      peakFrameRms = Math.max(peakFrameRms, rms);
      const speech = (await detector.probability(frame)) >= 0.5 && rms >= LEVEL_THRESHOLD;
      if (!speech) {
        backgroundEnergy += energy;
        backgroundSamples += count;
        continue;
      }
      if (first < 0) first = offset;
      last = offset + count;
      voicedSamples += count;
      speechEnergy += energy;
    }
  } finally {
    frame.fill(0);
    detector.clear();
  }
  const backgroundRms = Math.sqrt(backgroundEnergy / Math.max(1, backgroundSamples));
  const speechRms = Math.sqrt(speechEnergy / Math.max(1, voicedSamples));
  const speechToBackgroundDb =
    voicedSamples && backgroundSamples
      ? 20 * Math.log10(Math.max(speechRms, 1e-8) / Math.max(backgroundRms, 1e-8))
      : null;
  const noise: NoiseMeasurement = {
    backgroundRms,
    speechToBackgroundDb,
    noise:
      backgroundRms >= LEVEL_THRESHOLD &&
      (speechToBackgroundDb === null || speechToBackgroundDb < 10)
        ? 'high'
        : backgroundSamples
          ? 'normal'
          : 'unknown',
  };
  const voicedMs = (voicedSamples / SAMPLE_RATE) * 1_000;
  if (first < 0 || voicedMs < REQUIRED_VOICED_MS)
    return { kind: 'insufficient_audio', voicedMs, peakFrameRms, ...noise };
  return { kind: 'captured', first, last, voicedMs, peakFrameRms, ...noise };
}

function wipeAudioBuffer(buffer: AudioBuffer): void {
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    buffer.getChannelData(channel).fill(0);
  }
}

function ignoreClosedContext(): void {}

function assertNeverActivity(activity: never): never {
  throw new Error(`Unexpected speech activity: ${String(activity)}`);
}
