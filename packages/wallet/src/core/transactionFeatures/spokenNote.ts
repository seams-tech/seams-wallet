// The kinds of the `spoken-intent` crate (seams-tech/speak-to-sign) that call one contract method
// and move no value: `SpokenRequestV1::CommunityNote`, `NoteRating` and `MergeApproval`, with the
// same rules, rendered words, Borsh bytes and digests. The crate's golden vectors check this port.
// Wallet core uses it to check a verdict and to build the one call that it signs.

import { functionCall } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import {
  NOTE_RATINGS,
  sha256,
  spokenRequestBorsh,
  utf8,
  type NoteRating,
} from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignNetwork } from './plugins';
import {
  integerWords,
  isMultiplierWord,
  isNumberWord,
  isSpeakableAccount,
  spokenDigests,
  type RenderedTransfer,
  type SpokenDigests,
} from './spokenTransfer';

export { NOTE_RATINGS, type NoteRating };

/** Twelve plain words fit in one 8 s clip. */
export const MAX_SUMMARY_WORDS = 12;
export const MAX_SUMMARY_BYTES = 120;
/** The notes contract keeps a note of at most this many characters. */
export const MAX_NOTE_CHARS = 280;

/** The gas of one note call. The contract needs less than 10 Tgas. */
const NOTE_CALL_GAS = '30000000000000';
/** The first words of the transfer grammar. A summary cannot start with one. */
const TRANSFER_VERBS = ['send', 'sent', 'sends'];
/** The whole-word aliases that the crate's text step applies to a transcript. */
const TEXT_ALIASES = new Map([
  ['approved', 'approve'],
  ['nir', 'near'],
  ['neer', 'near'],
]);

const RATING_WORDS: Readonly<Record<NoteRating, readonly string[]>> = {
  helpful: ['this', 'note', 'is', 'helpful'],
  somewhat_helpful: ['this', 'note', 'is', 'somewhat', 'helpful'],
  not_helpful: ['this', 'note', 'is', 'not', 'helpful'],
};

/** A spoken community note or note rating. The owner says the summary or the rating only. */
export type SpokenNoteAction =
  | Readonly<{
      kind: 'community_note';
      /** The notes contract, a named NEAR account. */
      contract: string;
      postId: bigint;
      /** The note, 1 to 280 characters. The verdict binds its SHA-256. */
      text: string;
      /** The sentence that the owner says. See `summaryRefusal`. */
      summary: string;
    }>
  | Readonly<{ kind: 'note_rating'; contract: string; noteId: bigint; rating: NoteRating }>
  /** A spoken approval to merge a pull request. The owner says its number and base only. */
  | Readonly<{
      kind: 'merge_approval';
      /** The merge-approval contract, a named NEAR account. */
      contract: string;
      /** `owner/name`. The verdict binds its SHA-256. */
      repo: string;
      pullRequest: bigint;
      /** The base branch, 1 to 32 lowercase letters, such as `main`. */
      base: string;
      /** The head commit, 40 lowercase hex characters. The verdict binds it. */
      headCommit: string;
    }>;

/** The merge-approval contract's rule: no owner edge dash, and a name other than "." or "..". */
const REPO_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
const BASE_PATTERN = /^[a-z]{1,32}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

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

/** Why core cannot build this action, or null. */
export function noteActionRefusal(
  action: SpokenNoteAction,
): 'summary_not_speakable' | 'note_not_valid' | 'merge_not_valid' | null {
  if (action.kind === 'merge_approval') {
    const valid =
      isSpeakableAccount(action.contract) &&
      action.pullRequest >= 1n &&
      action.pullRequest <= BigInt(Number.MAX_SAFE_INTEGER) &&
      REPO_PATTERN.test(action.repo) &&
      BASE_PATTERN.test(action.base) &&
      COMMIT_PATTERN.test(action.headCommit);
    return valid ? null : 'merge_not_valid';
  }
  if (!isSpeakableAccount(action.contract)) return 'note_not_valid';
  const id = action.kind === 'community_note' ? action.postId : action.noteId;
  if (id < 0n || id > BigInt(Number.MAX_SAFE_INTEGER)) return 'note_not_valid';
  if (action.kind === 'note_rating') {
    return NOTE_RATINGS.includes(action.rating) ? null : 'note_not_valid';
  }
  const characters = [...action.text].length;
  if (characters === 0 || characters > MAX_NOTE_CHARS) return 'note_not_valid';
  return summaryRefusal(action.summary) === null ? null : 'summary_not_speakable';
}

/** The sentence of the action. `displayText` keeps the summary as the author wrote it. */
export function renderNoteAction(action: SpokenNoteAction): RenderedTransfer {
  if (action.kind === 'merge_approval') {
    const words = ['merge', 'pull', 'request', ...integerWords(action.pullRequest), 'into', action.base];
    return {
      displayText: `Merge pull request ${action.pullRequest} into ${action.base}`,
      spokenText: words.join(' '),
    };
  }
  if (action.kind === 'note_rating') {
    const words = RATING_WORDS[action.rating];
    return { displayText: ['This', ...words.slice(1)].join(' '), spokenText: words.join(' ') };
  }
  return { displayText: action.summary, spokenText: summaryWords(action.summary).join(' ') };
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

export async function noteSha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return await sha256(utf8(text));
}

/** Borsh of the request kind of the action, whose explicit tags are 4, 5 and 6. */
export async function noteActionBorsh(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenNoteAction,
): Promise<Uint8Array> {
  if (action.kind === 'merge_approval') {
    return spokenRequestBorsh({
      kind: 'merge_approval',
      network,
      owner,
      contract: action.contract,
      repoSha256: await sha256(utf8(action.repo)),
      pullRequest: action.pullRequest,
      base: action.base,
      headCommit: hexBytes(action.headCommit),
    });
  }
  return spokenRequestBorsh(
    action.kind === 'note_rating'
      ? { ...action, network, owner }
      : {
          kind: 'community_note',
          network,
          owner,
          contract: action.contract,
          postId: action.postId,
          noteSha256: await noteSha256(action.text),
          summary: action.summary,
        },
  );
}

export async function noteActionDigests(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenNoteAction,
): Promise<SpokenDigests> {
  return await spokenDigests(
    await noteActionBorsh(network, owner, action),
    renderNoteAction(action).spokenText,
  );
}

/** The `request` of the verifier's `verify` input. */
export async function noteVerifyRequest(
  action: SpokenNoteAction,
): Promise<Readonly<Record<string, unknown>>> {
  if (action.kind === 'merge_approval') {
    return {
      kind: 'merge_approval',
      contract: action.contract,
      repo_sha256_hex: hex(await sha256(utf8(action.repo))),
      pull_request: Number(action.pullRequest),
      base: action.base,
      head_commit_hex: action.headCommit,
    };
  }
  if (action.kind === 'note_rating') {
    return {
      kind: 'note_rating',
      contract: action.contract,
      note_id: Number(action.noteId),
      rating: action.rating,
    };
  }
  const digest = await noteSha256(action.text);
  return {
    kind: 'community_note',
    contract: action.contract,
    post_id: Number(action.postId),
    note_sha256_hex: hex(digest),
    summary: action.summary,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `headCommit` is 40 lowercase hex characters; `noteActionRefusal` checks it first. */
function hexBytes(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** The one call that core signs: `add_note`, `rate_note` or `approve_merge`, with no deposit. */
export function noteTransaction(action: SpokenNoteAction): TransactionInput {
  if (action.kind === 'merge_approval') {
    const call = functionCall({
      method: 'approve_merge',
      args: {
        repo: action.repo,
        pull_request: Number(action.pullRequest),
        base: action.base,
        head_commit: action.headCommit,
      },
      gas: NOTE_CALL_GAS,
      deposit: '0',
    });
    return { receiverId: action.contract, actions: [call] };
  }
  const call =
    action.kind === 'community_note'
      ? functionCall({
          method: 'add_note',
          args: { post_id: Number(action.postId), text: action.text, summary: action.summary },
          gas: NOTE_CALL_GAS,
          deposit: '0',
        })
      : functionCall({
          method: 'rate_note',
          args: { note_id: Number(action.noteId), rating: action.rating },
          gas: NOTE_CALL_GAS,
          deposit: '0',
        });
  return { receiverId: action.contract, actions: [call] };
}
