import { voiceDisplayLevel } from '../../packages/wallet/src/plugins/voiceid/browser/waveform';

// The capture rules of browser/microphone.ts: a minimum level, speech starts after
// 100 ms of sound, and the capture ends after a 1.5 s pause or at 8 s. The SDK
// also asks its voice activity model. This preview has no model, so sound must
// rise well above the room level measured first, and must outlast a click.
const LEVEL_THRESHOLD = 0.006;
const BACKGROUND_RATIO = 2.5;
const CALIBRATION_MS = 200;
const MIN_SPEECH_MS = 48;
const SPEECH_START_MS = 100;
const MAX_RECORDING_MS = 8_000;
export const END_PAUSE_MS = 1_500;
export const FRAME_MS = 16;

export type VoiceFrame = Readonly<{ rms: number; level: number; voiced: boolean }>;

/** One capture as fixed-rate frames, with the speech that the rules counted. */
export class VoiceCapture {
  readonly frames: VoiceFrame[] = [];
  first = -1;
  last = -1;
  ended = false;
  private background = 0;
  private soundMs = 0;
  private speaking = false;

  push(rms: number): void {
    if (this.ended) return;
    const index = this.frames.length;
    const calibrating = index * FRAME_MS < CALIBRATION_MS;
    const audible =
      !calibrating && rms >= Math.max(LEVEL_THRESHOLD, this.background * BACKGROUND_RATIO);
    if (calibrating) this.background += (rms - this.background) / (index + 1);
    else if (!audible) this.background += (rms - this.background) * 0.02;
    this.frames.push({ rms, level: voiceDisplayLevel(rms), voiced: false });
    this.soundMs = audible ? this.soundMs + FRAME_MS : 0;
    // A run of sound becomes speech once it outlasts a click, from its first frame.
    if (this.soundMs === MIN_SPEECH_MS) {
      for (let frame = index - MIN_SPEECH_MS / FRAME_MS + 1; frame <= index; frame += 1)
        this.markSpeech(frame);
    } else if (this.soundMs > MIN_SPEECH_MS) this.markSpeech(index);
    if (this.soundMs >= SPEECH_START_MS) this.speaking = true;
    this.ended =
      (this.speaking && this.silenceMs() >= END_PAUSE_MS) ||
      this.frames.length * FRAME_MS >= MAX_RECORDING_MS;
  }

  /** Time since the last speech frame once speech has started, else zero. */
  silenceMs(): number {
    return this.speaking ? (this.frames.length - 1 - this.last) * FRAME_MS : 0;
  }

  level(): number {
    return this.frames.at(-1)?.level ?? 0;
  }

  private markSpeech(index: number): void {
    this.frames[index] = { ...this.frames[index], voiced: true };
    if (this.first < 0) this.first = index;
    this.last = index;
  }
}
