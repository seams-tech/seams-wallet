import { FRAME_MS, VoiceCapture } from './voiceCapture';

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'requesting'; context: AudioContext; abort: AbortController }
  | {
      kind: 'recording';
      context: AudioContext;
      stream: MediaStream;
      analyser: AnalyserNode;
      samples: Float32Array<ArrayBuffer>;
      capture: VoiceCapture;
      startedAt: number;
      timer: number;
    };

export class MicrophonePreview {
  private state: CaptureState = { kind: 'idle' };
  // The last capture stays readable after it ends: levels only, never audio.
  private latest: VoiceCapture | null = null;

  readonly level = (): number => (this.state.kind === 'recording' ? this.state.capture.level() : 0);

  readonly capture = (): VoiceCapture | null => this.latest;

  async start(
    listening: () => void,
    complete: () => void,
    failed: (message: string) => void,
  ): Promise<void> {
    this.stop();
    const abort = new AbortController();
    let context: AudioContext;
    try {
      context = new AudioContext();
      this.state = { kind: 'requesting', context, abort };
      await context.resume();
      if (abort.signal.aborted) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      if (abort.signal.aborted) {
        stopTracks(stream);
        return;
      }
      const analyser = connectStream(context, stream);
      const capture = new VoiceCapture();
      this.latest = capture;
      this.state = {
        kind: 'recording',
        context,
        stream,
        analyser,
        samples: new Float32Array(analyser.fftSize),
        capture,
        startedAt: performance.now(),
        timer: window.setInterval(this.sample.bind(this, complete), FRAME_MS),
      };
      listening();
    } catch (error) {
      if (abort.signal.aborted) return;
      this.stop();
      failed(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Allow microphone access, then try again.'
          : 'The microphone is unavailable. Try again.',
      );
    }
  }

  readonly stop = (): void => {
    const state = this.state;
    this.state = { kind: 'idle' };
    switch (state.kind) {
      case 'idle':
        return;
      case 'requesting':
        state.abort.abort();
        void state.context.close().catch(ignoreClosedContext);
        return;
      case 'recording':
        window.clearInterval(state.timer);
        stopTracks(state.stream);
        state.samples.fill(0);
        void state.context.close().catch(ignoreClosedContext);
        return;
      default:
        return assertNever(state);
    }
  };

  // Frames follow the clock, so a throttled timer still reaches the 8 s limit on time.
  private sample(done: () => void): void {
    if (this.state.kind !== 'recording') return;
    const { analyser, samples, capture, context, startedAt } = this.state;
    analyser.getFloatTimeDomainData(samples);
    const count = Math.min(samples.length, Math.round((context.sampleRate * FRAME_MS) / 1_000));
    let energy = 0;
    for (let index = samples.length - count; index < samples.length; index += 1)
      energy += samples[index] * samples[index];
    const rms = Math.sqrt(energy / count);
    const due = Math.floor((performance.now() - startedAt) / FRAME_MS);
    while (capture.frames.length < due && !capture.ended) capture.push(rms);
    if (capture.ended) this.complete(done);
  }

  private complete(done: () => void): void {
    this.stop();
    done();
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function ignoreClosedContext(): void {}

function assertNever(state: never): never {
  throw new Error(`Unexpected microphone state: ${String(state)}`);
}

function connectStream(context: AudioContext, stream: MediaStream): AnalyserNode {
  try {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  } catch (error) {
    stopTracks(stream);
    throw error;
  }
}
