import type { VoiceCaptureQuality } from './microphone';

/** Keeps a local speaker rejection retryable without changing server authorization. */
export class VoiceSpeakerMismatchError extends Error {
  readonly details: string;

  constructor(
    similarity: number,
    threshold: number,
    quality: VoiceCaptureQuality,
    phraseMatched: boolean,
  ) {
    super('Your voice did not match. Move closer to the microphone and try again.');
    this.name = 'VoiceSpeakerMismatchError';
    this.details =
      `Speaker similarity ${similarity.toFixed(3)}; required ${threshold.toFixed(3)}. ` +
      `Detected speech ${(quality.voicedMs / 1000).toFixed(2)} s; recording ${(quality.recordingMs / 1000).toFixed(2)} s, stopped by ${quality.endedBy}. ` +
      `Input: ${quality.microphone}. Background estimate: ${quality.noise}; speech/background ${quality.speechToBackgroundDb === null ? 'unknown' : quality.speechToBackgroundDb.toFixed(1) + ' dB'}. ` +
      `Phrase matched: ${phraseMatched ? 'yes' : 'no'}. Browser processing: ${JSON.stringify(quality.processing)}.`;
  }
}
