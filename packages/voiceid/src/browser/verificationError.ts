import type { VoiceCaptureQuality } from './microphone';

/** Keeps a local speaker rejection retryable without changing server authorization. */
export class VoiceSpeakerMismatchError extends Error {
  constructor(quality: VoiceCaptureQuality) {
    super(speakerMismatchMessage(quality));
    this.name = 'VoiceSpeakerMismatchError';
  }
}

function speakerMismatchMessage(quality: VoiceCaptureQuality): string {
  if (quality.microphoneSelection === 'replacement') {
    return `Your microphone changed to ${quality.microphone}. Reconnect your usual microphone or try again.`;
  }
  if (quality.noise === 'high') {
    return 'Your voice did not match. Background noise is high. Move closer and try again.';
  }
  return 'Your voice did not match. Read the next sentence naturally and try again.';
}
