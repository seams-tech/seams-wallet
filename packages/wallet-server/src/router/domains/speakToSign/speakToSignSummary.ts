// The summary of a community note, which the owner says aloud to sign the note. The Seams server
// writes it from the note with `writeSummary` of `@seams/voice-sign/server` (a chat model on NEAR
// AI). The app gives no summary, so it cannot put words in the owner's mouth; the voice verifier
// then checks that the summary fits the note. This file has the route's settings and its body.

import { MAX_NOTE_CHARS } from '@shared/speakToSign/spokenKinds';
import { DEFAULT_SUMMARY_MODEL, writeSummary, type WrittenSummary } from '@seams/voice-sign/server';
import { hasExactKeys } from '@shared/utils/exactKeys';

export const SPEAK_TO_SIGN_SUMMARY_PATH = '/speak-to-sign/v1/summary';
/** A note is at most 280 characters; 4 bytes each, with room for the JSON around it. */
export const SPEAK_TO_SIGN_SUMMARY_MAX_BODY_BYTES = 2 * 1024;


/** The route writes summaries only when the server has a NEAR AI key. */
export type SpeakToSignSummaryConfig = Readonly<{
  /** The NEAR AI key. It goes only into the Authorization header of the chat call. */
  apiKey: string;
  /** A chat model that NEAR AI lists at `/v1/models`. */
  model: string;
}>;

const ENV_NAMES = ['SPEAK_TO_SIGN_NEAR_AI_API_KEY', 'SPEAK_TO_SIGN_SUMMARY_MODEL'] as const;

/** Null when the server has no NEAR AI key. The model is optional. */
export function readSpeakToSignSummaryConfig(
  read: (name: (typeof ENV_NAMES)[number]) => string | undefined,
): SpeakToSignSummaryConfig | null {
  const apiKey = read('SPEAK_TO_SIGN_NEAR_AI_API_KEY')?.trim() || '';
  if (apiKey === '') return null;
  return { apiKey, model: read('SPEAK_TO_SIGN_SUMMARY_MODEL')?.trim() || DEFAULT_SUMMARY_MODEL };
}

/** Body: `{ text }`, the note of 1 to 280 characters, not only white space. */
export function parseSummaryBody(body: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!hasExactKeys(raw, ['text']) || typeof raw.text !== 'string') return null;
  const characters = [...raw.text].length;
  if (raw.text.trim() === '' || characters > MAX_NOTE_CHARS) return null;
  return raw.text;
}

export type NoteSummary = WrittenSummary;

/**
 * The summary of one note, in the words of the model's request: a "Community Note". `signal`
 * ends the request to the model: the Wallet ends its request when the note's text changed.
 */
export async function writeNoteSummary(
  config: SpeakToSignSummaryConfig,
  note: string,
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<NoteSummary> {
  return await writeSummary(
    { apiKey: config.apiKey, model: config.model, subject: { name: 'Community Note', short: 'note' }, fetch },
    note,
    signal ? { signal } : {},
  );
}
