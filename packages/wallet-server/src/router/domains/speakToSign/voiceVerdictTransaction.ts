// The spoken request that a voice-approved NEAR transaction carries out. The co-signer reads the
// unsigned transaction that it is asked to sign and rebuilds the `spoken-intent` request from it,
// so the verdict's request digest can only match the transaction that is signed.

import { hasExactKeys } from '@shared/utils/exactKeys';
import {
  NOTE_RATINGS,
  sha256,
  utf8,
  type SpeakToSignNetwork,
  type SpokenRequest,
} from '@shared/speakToSign/spokenRequest';

/** The one action of a voice-approved transaction. Every other action kind is refused. */
type VoiceAction =
  | Readonly<{ kind: 'transfer'; depositYocto: bigint }>
  | Readonly<{
      kind: 'function_call';
      methodName: string;
      args: Uint8Array;
      depositYocto: bigint;
    }>;

/** The fields of a NEAR `Transaction` (V0) that the check reads. */
type VoiceTransaction = Readonly<{
  signerId: string;
  receiverId: string;
  action: VoiceAction;
}>;

const ED25519_KEY_TYPE = 0;
const FUNCTION_CALL_TAG = 2;
const TRANSFER_TAG = 3;

/**
 * Reads the Borsh of an unsigned NEAR transaction with exactly one `Transfer` or `FunctionCall`
 * action, or returns null. The Wallet builds a V0 transaction with an ed25519 key.
 */
export function decodeVoiceTransaction(bytes: Uint8Array): VoiceTransaction | null {
  const reader = new BorshReader(bytes);
  try {
    const signerId = reader.string();
    if (reader.u8() !== ED25519_KEY_TYPE) return null;
    reader.bytes(32);
    reader.u64();
    const receiverId = reader.string();
    reader.bytes(32);
    if (reader.u32() !== 1) return null;
    const action = readAction(reader);
    return action && reader.done() ? { signerId, receiverId, action } : null;
  } catch {
    return null;
  }
}

function readAction(reader: BorshReader): VoiceAction | null {
  switch (reader.u8()) {
    case TRANSFER_TAG:
      return { kind: 'transfer', depositYocto: reader.u128() };
    case FUNCTION_CALL_TAG: {
      const methodName = reader.string();
      const args = reader.bytes(reader.u32());
      reader.u64();
      return { kind: 'function_call', methodName, args, depositYocto: reader.u128() };
    }
    default:
      return null;
  }
}

/**
 * The spoken request that the transaction carries out, with the signer as its owner, or null
 * when the transaction is none of the kinds that Wallet core signs for a verdict: one transfer,
 * or one `add_note`, `rate_note` or `approve_merge` call with no deposit.
 */
export async function spokenRequestOfTransaction(
  network: SpeakToSignNetwork,
  transaction: VoiceTransaction,
): Promise<SpokenRequest | null> {
  const { action, signerId: owner, receiverId } = transaction;
  if (action.kind === 'transfer') {
    return {
      kind: 'account_transfer',
      network,
      owner,
      receiver: receiverId,
      amountYocto: action.depositYocto,
    };
  }
  if (action.depositYocto !== 0n) return null;
  let args: unknown;
  try {
    args = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(action.args));
  } catch {
    return null;
  }
  if (action.methodName === 'add_note' && hasExactKeys(args, ['post_id', 'text', 'summary'])) {
    const { post_id: postId, text, summary } = args;
    if (!isNoteId(postId) || typeof text !== 'string' || typeof summary !== 'string') return null;
    return {
      kind: 'community_note',
      network,
      owner,
      contract: receiverId,
      postId: BigInt(postId),
      noteSha256: await sha256(utf8(text)),
      summary,
    };
  }
  if (action.methodName === 'rate_note' && hasExactKeys(args, ['note_id', 'rating'])) {
    const { note_id: noteId, rating } = args;
    const known = NOTE_RATINGS.find((candidate) => candidate === rating);
    if (!isNoteId(noteId) || !known) return null;
    return {
      kind: 'note_rating',
      network,
      owner,
      contract: receiverId,
      noteId: BigInt(noteId),
      rating: known,
    };
  }
  if (
    action.methodName === 'approve_merge' &&
    hasExactKeys(args, ['repo', 'pull_request', 'base', 'head_commit'])
  ) {
    const { repo, pull_request: pullRequest, base, head_commit: headCommit } = args;
    if (
      typeof repo !== 'string' ||
      !isNoteId(pullRequest) ||
      pullRequest < 1 ||
      typeof base !== 'string' ||
      typeof headCommit !== 'string' ||
      !/^[0-9a-f]{40}$/.test(headCommit)
    ) {
      return null;
    }
    return {
      kind: 'merge_approval',
      network,
      owner,
      contract: receiverId,
      repoSha256: await sha256(utf8(repo)),
      pullRequest: BigInt(pullRequest),
      base,
      headCommit: Uint8Array.from(headCommit.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)),
    };
  }
  return null;
}

/** Wallet core sends note, post and pull request ids as JSON safe integers. */
function isNoteId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

class BorshReader {
  private at = 0;

  constructor(private readonly view: Uint8Array) {}

  done(): boolean {
    return this.at === this.view.length;
  }

  u8(): number {
    return this.bytes(1)[0];
  }

  u32(): number {
    return Number(this.little(4));
  }

  u64(): bigint {
    return this.little(8);
  }

  u128(): bigint {
    return this.little(16);
  }

  string(): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(this.u32()));
  }

  bytes(length: number): Uint8Array {
    if (this.at + length > this.view.length) throw new RangeError('Borsh input ended early');
    const out = this.view.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }

  private little(length: number): bigint {
    let value = 0n;
    const bytes = this.bytes(length);
    for (let index = length - 1; index >= 0; index -= 1)
      value = (value << 8n) | BigInt(bytes[index]);
    return value;
  }
}
