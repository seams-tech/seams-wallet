type CaptureState =
  | { kind: 'idle' }
  | { kind: 'requesting'; context: AudioContext; abort: AbortController }
  | {
      kind: 'recording';
      context: AudioContext;
      stream: MediaStream;
      analyser: AnalyserNode;
      samples: Float32Array<ArrayBuffer>;
      timer: number;
    };

export class MicrophonePreview {
  private state: CaptureState = { kind: 'idle' };

  readonly level = (): number => {
    if (this.state.kind !== 'recording') return 0;
    this.state.analyser.getFloatTimeDomainData(this.state.samples);
    let energy = 0;
    for (const sample of this.state.samples) energy += sample * sample;
    const rms = Math.sqrt(energy / this.state.samples.length);
    return Math.min(1, Math.max(0, rms - 0.003) * 9);
  };

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
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (abort.signal.aborted) {
        stopTracks(stream);
        return;
      }
      const analyser = connectStream(context, stream);
      this.state = {
        kind: 'recording',
        context,
        stream,
        analyser,
        samples: new Float32Array(analyser.fftSize),
        timer: window.setTimeout(this.complete.bind(this, complete), 8_000),
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
        window.clearTimeout(state.timer);
        stopTracks(state.stream);
        state.samples.fill(0);
        void state.context.close().catch(ignoreClosedContext);
        return;
      default:
        return assertNever(state);
    }
  };

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
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  } catch (error) {
    stopTracks(stream);
    throw error;
  }
}
