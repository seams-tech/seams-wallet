// The phrase card of a spoken request: what Wallet core asks of it and what the card gives back.
// `./approver/phraseCard` opens the card of `@seams/voice-capture/card` in the Wallet's frame. The
// types are written here, so the Wallet's declarations name no type of that package.

import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';

/** One clip of a shown sentence: 16 kHz mono samples that passed the quality gate. */
export type PhraseRecording =
  | Readonly<{
      kind: 'recorded';
      samples: Float32Array;
      /**
       * `performance.now()` of the last voiced frame: the owner stopped speaking then, before the
       * pause that ends the recording.
       */
      endOfSpeechAt: number;
    }>
  | Readonly<{ kind: 'cancelled' }>;

export type PhraseRequest = Readonly<{
  sentence: string;
  signal: AbortSignal;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  /**
   * The first recording starts with no press on Record. Use it when the person just asked for
   * the card. If the browser does not start audio without a press, the card keeps its button.
   */
  autoStart?: boolean;
  /**
   * The text that the sentence speaks for, such as the note that a spoken summary signs. The
   * card shows it above the sentence, with its label.
   */
  context?: Readonly<{ label: string; text: string }>;
}>;

/** One segment of the line that shows a check: waiting, working, passed, failed or held. */
export type PhraseSegmentState = 'idle' | 'run' | 'done' | 'fail' | 'wait' | 'skip';

/** Text in which some words are marked, such as words that a verifier heard differently. */
type PhraseText = string | readonly (string | Readonly<{ mark: string }>)[];

/**
 * A check after the recording: the sentence stays and dims, the action row goes, and the line
 * becomes segments. Segments that change from `run` to `done` fill one after another.
 */
export type PhraseCheckView = Readonly<{
  kind: 'check';
  label: string;
  caption: string;
  /** The second line. Several lines change every 1.3 s and stay on the last one. */
  details: readonly string[];
  segments: readonly PhraseSegmentState[];
}>;

/**
 * The proof of a result, in a box between the caption and the detail: who checked what, and a
 * link to check it again, such as a TEE attestation.
 */
export type PhraseReceipt = Readonly<{
  title: string;
  /** Where the checks ran, at the right of the title. */
  source?: string;
  rows: readonly Readonly<{ label: string; value: string }>[];
  link?: Readonly<{ text: string; href: string }>;
}>;

/** A result or a question: a headline takes the sentence's place, with one action. */
export type PhraseResultView = Readonly<{
  kind: 'result';
  label: string;
  headline: string;
  caption: PhraseText;
  /** The proof of the result, under the caption. */
  receipt?: PhraseReceipt;
  detail: string;
  /** A link after the detail, such as the transaction in a block explorer. */
  link?: Readonly<{ text: string; href: string }>;
  /**
   * `busy` shows the action dimmed while something outside the surface finishes. `retry`: the
   * action records the sentence again, and an app's `retry` press can run it.
   */
  action: Readonly<{ label: string; icon?: 'passkey'; busy?: boolean; retry?: boolean }>;
  /** `seal`: the line closes into the success seal. */
  line: 'seal' | readonly PhraseSegmentState[];
}>;

export type PhraseView = PhraseCheckView | PhraseResultView;

/** `replaced`: another view or a recording took the surface first. */
export type PhraseChoice = 'action' | 'closed' | 'replaced';

/**
 * The phrase surface stays open after a recording, so the caller can show its check and the
 * result in the same card. The caller closes it.
 */
export interface PhraseSurface {
  /** Shows the sentence with Record and records one clip. A later call records again. */
  record(): Promise<PhraseRecording>;
  /** A check view settles only when it is replaced; a result settles on its action or close. */
  show(view: PhraseView): Promise<PhraseChoice>;
  close(): void;
}
