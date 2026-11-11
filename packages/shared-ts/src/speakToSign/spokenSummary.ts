// The summary that the owner says for a note or a general request: the rules and the text step
// of the `spoken-intent` crate (seams-tech/speak-to-sign). The crate's vectors check this port.

import { utf8 } from './spokenRequest';
import { isMultiplierWord, isNumberWord, type RenderedTransfer } from './spokenWords';

/** Twelve plain words fit in one 8 s clip. */
export const MAX_SUMMARY_WORDS = 12;
export const MAX_SUMMARY_BYTES = 120;
/** The first words of the transfer grammar. A summary cannot start with one. */
const TRANSFER_VERBS = ['send', 'sent', 'sends'];
/** The whole-word aliases that the crate's text step applies to a transcript. */
const TEXT_ALIASES = new Map([
  ['approved', 'approve'],
  ['nir', 'near'],
  ['neer', 'near'],
]);

/** Why a text is not a speakable summary, as `spoken_intent::InvalidSummary`. */
export type SummaryRefusal = 'empty' | 'too_long' | 'too_many_words' | 'character' | 'transfer_verb';

/**
 * Null for a speakable summary: 1 to 12 words of ASCII letters with one space between two
 * words, a comma allowed at the end of a word and one `.`, `!` or `?` at the end.
 */
export function summaryRefusal(text: string): SummaryRefusal | null {
  if (text === '') return 'empty';
  if (utf8(text).length > MAX_SUMMARY_BYTES) return 'too_long';
  const body = /[.!?]$/.test(text) ? text.slice(0, -1) : text;
  const words = body.split(' ');
  for (const [index, word] of words.entries()) {
    const letters = word.endsWith(',') ? word.slice(0, -1) : word;
    if (!/^[A-Za-z]+$/.test(letters)) return 'character';
    if (index === 0 && TRANSFER_VERBS.includes(letters.toLowerCase())) return 'transfer_verb';
  }
  return words.length > MAX_SUMMARY_WORDS ? 'too_many_words' : null;
}

/** The sentence of a summary: shown as the author wrote it, said in the crate's words. */
export function renderSummary(summary: string): RenderedTransfer {
  return { displayText: summary, spokenText: summaryWords(summary).join(' ') };
}

/** The crate's text step on a summary: lowercase words, aliases, "a hundred", "one and two". */
function summaryWords(summary: string): string[] {
  const words = summary
    .toLowerCase()
    .replace(/[.!?]$/, '')
    .split(' ')
    .map((word) => (word.endsWith(',') ? word.slice(0, -1) : word))
    .map((word) => TEXT_ALIASES.get(word) ?? word);
  const tokens: string[] = [];
  for (const [index, word] of words.entries()) {
    const next = words[index + 1];
    if (word === 'a' && next !== undefined && isMultiplierWord(next)) {
      tokens.push('one');
      continue;
    }
    const previous = tokens.at(-1);
    if (
      word === 'and' &&
      previous !== undefined &&
      isNumberWord(previous) &&
      next !== undefined &&
      isNumberWord(next)
    ) {
      continue;
    }
    tokens.push(word);
  }
  return tokens;
}
