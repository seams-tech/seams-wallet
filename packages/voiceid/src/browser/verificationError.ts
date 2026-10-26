import type { VoiceCaptureQuality } from './microphone';

/** Keeps a local speaker rejection retryable without changing server authorization. */
export class VoiceSpeakerMismatchError extends Error {
  constructor(quality: VoiceCaptureQuality) {
    super(
      quality.noise === 'high'
        ? 'Your voice did not match. Background noise is high. Move closer and try again.'
        : 'Your voice did not match. Read the next sentence naturally and try again.',
    );
    this.name = 'VoiceSpeakerMismatchError';
  }
}
