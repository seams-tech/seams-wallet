// The summary that the owner says for a note or a general request. Its rules are in
// `@seams/voice-verdict` (`summaryRefusal`), the home of the verifier's request rules. This file
// has the text step of the `spoken-intent` crate (seams-tech/speak-to-sign) for a summary.

import { isMultiplierWord, isNumberWord, type RenderedTransfer } from './spokenWords';

export { MAX_SUMMARY_BYTES, MAX_SUMMARY_WORDS, summaryRefusal, type SummaryRefusal } from '@seams/voice-verdict';

/** The whole-word aliases that the crate's text step applies to a transcript. */
const TEXT_ALIASES = new Map([
  ['approved', 'approve'],
  ['nir', 'near'],
  ['neer', 'near'],
]);

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
