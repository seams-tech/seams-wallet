// The transcript reader of the `spoken-intent` crate (seams-tech/speak-to-sign), built for
// wasm32 in `wasm/spoken_intent`. A SaySo verdict signs the transcript of a recording and does
// not decide its words, so Wallet core and the Seams co-signer read the transcript with the rules
// that the OutLayer verifier ran in its TEE. Each runtime loads the module in its own way, so it
// names its start once (`startHeardWords`) before it checks a SaySo verdict.

import initSpokenIntent, { heard_words } from '../../../../wasm/spoken_intent/pkg/spoken_intent.js';

export type SpokenIntentModule = WebAssembly.Module | URL | BufferSource;

/** Starts the module with `init`: Node reads the file, a Worker has it bundled, the Wallet fetches it. */
export type HeardWordsStart = (
  init: (module: SpokenIntentModule) => Promise<void>,
) => Promise<void>;

export type HeardReading =
  | Readonly<{ ok: true; words: string }>
  /**
   * `reader_unavailable`: no runtime started the module, or it did not load. The other codes are
   * the crate's refusals: `not_normalizable`, `recipient_not_contact`, `recipient_ambiguous`,
   * `recipient_unkeyable` and `contact_not_speakable`.
   */
  | Readonly<{ ok: false; code: string }>;

let start: HeardWordsStart | null = null;
let started: Promise<boolean> | null = null;

/** Names how this runtime loads the module. The first check of a SaySo verdict loads it. */
export function startHeardWords(next: HeardWordsStart): void {
  if (start === next) return;
  start = next;
  started = null;
}

function ready(): Promise<boolean> {
  if (!start) return Promise.resolve(false);
  started ??= start(async (module) => {
    await initSpokenIntent({ module_or_path: module });
  }).then(
    () => true,
    () => {
      // A failed load is tried again on the next check.
      started = null;
      return false;
    },
  );
  return started;
}

/**
 * The spoken words of a transcript, joined with single spaces, as `normalize_punctuated` of the
 * crate reads them. `contacts` are the accounts that a recipient may match by sound: the receiver
 * of the request, or none.
 */
export async function readHeardWords(
  transcript: string,
  contacts: readonly string[],
): Promise<HeardReading> {
  if (!(await ready())) return { ok: false, code: 'reader_unavailable' };
  try {
    return { ok: true, words: heard_words(transcript, [...contacts]) };
  } catch (error) {
    return { ok: false, code: typeof error === 'string' ? error : 'reader_failed' };
  }
}
