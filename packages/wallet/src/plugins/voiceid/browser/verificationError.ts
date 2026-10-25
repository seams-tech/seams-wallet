import type { VoiceCaptureQuality } from './microphone';

/** Keeps a local speaker rejection retryable without changing server authorization. */
export class VoiceSpeakerMismatchError extends Error {
  readonly details: string;

  constructor(
    similarity: number,
    threshold: number,
    quality: VoiceCaptureQuality,
    phraseMatched: boolean,
    modelInputMs: number,
  ) {
    super(
      quality.noise === 'high'
        ? 'Your voice did not match. Background noise is high. Move closer and try again.'
        : 'Your voice did not match. Read the next sentence naturally and try again.',
    );
    this.name = 'VoiceSpeakerMismatchError';
    this.details =
      `Speaker similarity ${similarity.toFixed(3)}; required ${threshold.toFixed(3)}. ` +
      `Speaker input ${(modelInputMs / 1000).toFixed(2)} s. ` +
      `Detected speech ${(quality.voicedMs / 1000).toFixed(2)} s; recording ${(quality.recordingMs / 1000).toFixed(2)} s, stopped by ${quality.endedBy}. ` +
      `Input: ${quality.microphone}. Background estimate: ${quality.noise}; speech/background ${quality.speechToBackgroundDb === null ? 'unknown' : quality.speechToBackgroundDb.toFixed(1) + ' dB'}. ` +
      `Phrase matched: ${phraseMatched ? 'yes' : 'no'}. Browser processing: ${JSON.stringify(quality.processing)}.`;
  }
}
