// The spoken request that a voice-approved NEAR transaction carries out. The co-signer reads the
// unsigned transaction that it is asked to sign and rebuilds the `spoken-intent` request from it,
// so the verdict's request digest can only match the transaction that is signed.

import { base64UrlEncode } from '@shared/utils/base64';
import {
  readBetCall,
  spokenRequestOfCall,
  type SignedSpokenCall,
  type SpokenCallVerdict,
} from '@shared/speakToSign/spokenKinds';
import {
  isNep413Message,
  nearTransactionActionsBorsh,
  sha256,
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
export type VoiceTransaction = Readonly<{
  signerId: string;
  receiverId: string;
  /** The one `Transfer` or `FunctionCall` of a typed request, or null for other actions. */
  action: VoiceAction | null;
  /** The Borsh of all actions, which a general spoken transaction binds. */
  actionsBorsh: Uint8Array;
}>;

const ED25519_KEY_TYPE = 0;
/** 2^30 + 366 as a little-endian `u32`: the tag of a NEP-366 delegate action. */
const NEP366_TAG = [0x6e, 0x01, 0x00, 0x40];
/** A delegate action ends with its nonce, its maximum block height and an ed25519 key. */
const DELEGATE_TAIL_BYTES = 8 + 8 + 1 + 32;
const FUNCTION_CALL_TAG = 2;
const TRANSFER_TAG = 3;

/**
 * Reads the Borsh of an unsigned NEAR transaction, or returns null. The Wallet builds a V0
 * transaction with an ed25519 key. `action` is set when the transaction has exactly one
 * `Transfer` or `FunctionCall` action.
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
    const actionsBorsh = nearTransactionActionsBorsh(bytes);
    return { signerId, receiverId, action: readSingleAction(reader), actionsBorsh };
  } catch {
    return null;
  }
}

/**
 * Reads the bytes of a NEP-366 delegate action as a transaction of its sender: the same
 * receiver and the same action bytes, which a relayer sends. Null when the bytes are not a
 * delegate action or their SHA-256 is not the digest that the signers sign. A delegate action
 * is only a general spoken transaction, so it has no typed action.
 */
export async function decodeVoiceDelegate(
  delegate: Readonly<{ canonicalDelegate: Uint8Array; expectedDigestB64u: string }>,
): Promise<VoiceTransaction | null> {
  const bytes = delegate.canonicalDelegate;
  const digest = await sha256(new Uint8Array(bytes));
  if (base64UrlEncode(digest) !== delegate.expectedDigestB64u) return null;
  const reader = new BorshReader(bytes);
  try {
    const tag = reader.bytes(NEP366_TAG.length);
    if (!NEP366_TAG.every((byte, index) => tag[index] === byte)) return null;
    const signerId = reader.string();
    const receiverId = reader.string();
    const rest = reader.rest();
    const actionsLength = rest.length - DELEGATE_TAIL_BYTES;
    // The action list starts with its `u32` length.
    if (actionsLength < 4 || rest[rest.length - 33] !== ED25519_KEY_TYPE) return null;
    return { signerId, receiverId, action: null, actionsBorsh: rest.subarray(0, actionsLength) };
  } catch {
    return null;
  }
}

function readSingleAction(reader: BorshReader): VoiceAction | null {
  try {
    if (reader.u32() !== 1) return null;
    const action = readAction(reader);
    return action && reader.done() ? action : null;
  } catch {
    return null;
  }
}

/**
 * The general spoken request of the transaction: the signer as its owner, the receiver, the
 * digest of the action bytes and the summary that came beside the verdict. The verdict's
 * request digest binds the summary, so a wrong summary does not match.
 */
export async function spokenTransactionRequest(
  network: SpeakToSignNetwork,
  transaction: VoiceTransaction,
  summary: string,
): Promise<SpokenRequest> {
  return {
    kind: 'transaction',
    network,
    owner: transaction.signerId,
    receiver: transaction.receiverId,
    actionsSha256: await sha256(new Uint8Array(transaction.actionsBorsh)),
    summary,
  };
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
 * The spoken request of a NEP-413 message, or null when the bytes are not a NEP-413 message or
 * their SHA-256 is not the digest that the signers sign. The message does not name its signer,
 * so the owner is the account of the session.
 */
export async function spokenMessageRequest(
  network: SpeakToSignNetwork,
  owner: string,
  message: Readonly<{ canonicalMessage: Uint8Array; expectedDigestB64u: string }>,
  summary: string,
): Promise<SpokenRequest | null> {
  if (!isNep413Message(message.canonicalMessage)) return null;
  const payloadSha256 = await sha256(new Uint8Array(message.canonicalMessage));
  if (base64UrlEncode(payloadSha256) !== message.expectedDigestB64u) return null;
  return { kind: 'signed_message', network, owner, payloadSha256, summary };
}

/**
 * The typed spoken request that the transaction carries out, with the signer as its owner, or
 * null when its one action is the call of no typed kind. The kinds and their calls are in
 * `SPOKEN_KINDS` (`@shared/speakToSign/spokenKinds`), which Wallet core also reads: one
 * transfer, one `add_note`, `rate_note` or `approve_merge` call with no deposit, or one bet.
 */
export async function spokenRequestOfTransaction(
  network: SpeakToSignNetwork,
  transaction: VoiceTransaction,
): Promise<SpokenRequest | null> {
  const call = signedCallOfTransaction(transaction);
  return call ? await spokenRequestOfCall(call, network, transaction.signerId) : null;
}

/**
 * True when the transaction is no bet, or is a bet that carries exactly this verdict to the
 * market contract. A bet with another verdict in `msg` is not the call that core built.
 */
export function betCarriesVerdict(
  network: SpeakToSignNetwork,
  transaction: VoiceTransaction,
  verdict: SpokenCallVerdict,
): boolean {
  const call = signedCallOfTransaction(transaction);
  const bet = call ? readBetCall(call, network) : null;
  if (!bet) return true;
  return (
    bet.verdict.verdictJson === verdict.verdictJson &&
    bet.verdict.signatureB64 === verdict.signatureB64
  );
}

/** The one action with its arguments as JSON, or null. */
function signedCallOfTransaction(transaction: VoiceTransaction): SignedSpokenCall | null {
  const { action, receiverId } = transaction;
  if (!action) return null;
  if (action.kind === 'transfer') {
    return { kind: 'transfer', receiverId, depositYocto: action.depositYocto };
  }
  let args: unknown;
  try {
    args = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(action.args));
  } catch {
    return null;
  }
  return {
    kind: 'function_call',
    receiverId,
    methodName: action.methodName,
    args,
    depositYocto: action.depositYocto,
  };
}

class BorshReader {
  private at = 0;

  constructor(private readonly view: Uint8Array) {}

  done(): boolean {
    return this.at === this.view.length;
  }

  /** The bytes that are not read yet. */
  rest(): Uint8Array {
    return this.view.subarray(this.at);
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
