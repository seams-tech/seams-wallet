// The typed kinds of a spoken request, in one table. Each entry holds what Wallet core and the
// Seams co-signer must agree on for its kind:
//   - `request`: the `SpokenRequestV1` that a verdict names, from the fields;
//   - `call`: the one action that carries the request out (core signs it);
//   - `fromCall`: the fields again, from that one action (the co-signer reads signed bytes).
// Core goes from fields to bytes. The co-signer goes only from the bytes that it signs to the
// request, never from fields that a client sends. A new typed kind is one entry here, with its
// tag and Borsh in `./spokenRequest` and its vectors from the `spoken-intent` crate.
//
// The two general kinds (`transaction`, `signed_message`) are not here. They have no call form:
// the verdict binds the SHA-256 of the bytes themselves, and the owner says an app summary.

import { hasExactKeys } from '../utils/exactKeys';
import {
  BET_OUTCOMES,
  NOTE_RATINGS,
  SPEAK_TO_SIGN_USDC,
  sha256,
  utf8,
  type BetOutcome,
  type NoteRating,
  type SpeakToSignNetwork,
  type SpokenRequest,
} from './spokenRequest';

/** The fields of each typed kind, as the application gives them. They hold no owner and no digest. */
export type SpokenTypedFields =
  /** A NEAR transfer from the owner's own account. */
  | Readonly<{ kind: 'account_transfer'; receiver: string; amountYocto: bigint }>
  | Readonly<{
      kind: 'community_note';
      /** The notes contract, a named NEAR account. */
      contract: string;
      postId: bigint;
      /** The note, 1 to 280 characters. The verdict binds its SHA-256. */
      text: string;
      /** The sentence that the owner says. */
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
    }>
  /** A spoken bet. The owner says the amount, the outcome and the market id. */
  | Readonly<{
      kind: 'market_bet';
      /** The market contract, a named NEAR account. */
      contract: string;
      /** The token of the stake: the USDC contract of the network. */
      token: string;
      /** 1 or more. */
      marketId: bigint;
      outcome: BetOutcome;
      /** Base units (10^-6 USDC): a whole number of cents, from 0.01 to 1,000,000 USDC. */
      amountUnits: bigint;
    }>;

export type SpokenTypedKind = SpokenTypedFields['kind'];
type FieldsOf<Kind extends SpokenTypedKind> = Extract<SpokenTypedFields, { kind: Kind }>;

/** The checked verdict that a call can carry to its contract. */
export type SpokenCallVerdict = Readonly<{ verdictJson: string; signatureB64: string }>;

/** The one action of a typed request, as core builds it. */
export type SpokenCall =
  | Readonly<{ kind: 'transfer'; receiverId: string; depositYocto: bigint }>
  | Readonly<{
      kind: 'function_call';
      receiverId: string;
      methodName: string;
      args: Readonly<Record<string, unknown>>;
      /** The verdict does not bind the gas. */
      gas: string;
      depositYocto: bigint;
    }>;

/** The one action of a transaction that the co-signer is asked to sign. `args` is its JSON. */
export type SignedSpokenCall =
  | Readonly<{ kind: 'transfer'; receiverId: string; depositYocto: bigint }>
  | Readonly<{
      kind: 'function_call';
      receiverId: string;
      methodName: string;
      args: unknown;
      depositYocto: bigint;
    }>;

export type SpokenKindEntry<Kind extends SpokenTypedKind> = Readonly<{
  /** The request that the verdict names. `owner` is the account of the session, never a field. */
  request(
    fields: FieldsOf<Kind>,
    network: SpeakToSignNetwork,
    owner: string,
  ): Promise<SpokenRequest>;
  /** The one action that core signs. Pass only a verdict that passed the check. */
  call(fields: FieldsOf<Kind>, verdict: SpokenCallVerdict): SpokenCall;
  /**
   * The fields of a signed action, or null when the action is not exactly the call of this
   * kind: another method, another deposit or other argument keys.
   */
  fromCall(call: SignedSpokenCall, network: SpeakToSignNetwork): FieldsOf<Kind> | null;
}>;

/** The gas of one note call. The contract needs less than 10 Tgas. */
const NOTE_CALL_GAS = '30000000000000';
/** The market needs gas for `ft_on_transfer` and the token for its callback. */
const BET_CALL_GAS = '100000000000000';
/** NEP-141 asks for exactly 1 yoctoNEAR on `ft_transfer_call`. */
const BET_CALL_DEPOSIT = 1n;

export const SPOKEN_KINDS: { readonly [Kind in SpokenTypedKind]: SpokenKindEntry<Kind> } = {
  account_transfer: {
    request: async (fields, network, owner) => ({ ...fields, network, owner }),
    call: (fields) => ({
      kind: 'transfer',
      receiverId: fields.receiver,
      depositYocto: fields.amountYocto,
    }),
    fromCall: (call) =>
      call.kind === 'transfer'
        ? { kind: 'account_transfer', receiver: call.receiverId, amountYocto: call.depositYocto }
        : null,
  },
  community_note: {
    request: async (fields, network, owner) => ({
      kind: 'community_note',
      network,
      owner,
      contract: fields.contract,
      postId: fields.postId,
      noteSha256: await sha256(utf8(fields.text)),
      summary: fields.summary,
    }),
    call: (fields) =>
      noDepositCall(fields.contract, 'add_note', {
        post_id: Number(fields.postId),
        text: fields.text,
        summary: fields.summary,
      }),
    fromCall: (call) => {
      const args = noDepositArgs(call, 'add_note', ['post_id', 'text', 'summary']);
      if (!args) return null;
      const { post_id: postId, text, summary } = args;
      if (!isSafeId(postId) || typeof text !== 'string' || typeof summary !== 'string') return null;
      return {
        kind: 'community_note',
        contract: call.receiverId,
        postId: BigInt(postId),
        text,
        summary,
      };
    },
  },
  note_rating: {
    request: async (fields, network, owner) => ({ ...fields, network, owner }),
    call: (fields) =>
      noDepositCall(fields.contract, 'rate_note', {
        note_id: Number(fields.noteId),
        rating: fields.rating,
      }),
    fromCall: (call) => {
      const args = noDepositArgs(call, 'rate_note', ['note_id', 'rating']);
      if (!args) return null;
      const { note_id: noteId } = args;
      const rating = NOTE_RATINGS.find((candidate) => candidate === args.rating);
      if (!isSafeId(noteId) || !rating) return null;
      return { kind: 'note_rating', contract: call.receiverId, noteId: BigInt(noteId), rating };
    },
  },
  merge_approval: {
    request: async (fields, network, owner) => ({
      kind: 'merge_approval',
      network,
      owner,
      contract: fields.contract,
      repoSha256: await sha256(utf8(fields.repo)),
      pullRequest: fields.pullRequest,
      base: fields.base,
      headCommit: hexBytes(fields.headCommit),
    }),
    call: (fields) =>
      noDepositCall(fields.contract, 'approve_merge', {
        repo: fields.repo,
        pull_request: Number(fields.pullRequest),
        base: fields.base,
        head_commit: fields.headCommit,
      }),
    fromCall: (call) => {
      const args = noDepositArgs(call, 'approve_merge', [
        'repo',
        'pull_request',
        'base',
        'head_commit',
      ]);
      if (!args) return null;
      const { repo, pull_request: pullRequest, base, head_commit: headCommit } = args;
      if (
        typeof repo !== 'string' ||
        !isSafeId(pullRequest) ||
        pullRequest < 1 ||
        typeof base !== 'string' ||
        typeof headCommit !== 'string' ||
        !/^[0-9a-f]{40}$/.test(headCommit)
      ) {
        return null;
      }
      return {
        kind: 'merge_approval',
        contract: call.receiverId,
        repo,
        pullRequest: BigInt(pullRequest),
        base,
        headCommit,
      };
    },
  },
  market_bet: {
    request: async (fields, network, owner) => ({
      kind: 'market_bet',
      network,
      owner,
      market: fields.contract,
      token: fields.token,
      marketId: fields.marketId,
      outcome: fields.outcome,
      amountUnits: fields.amountUnits,
    }),
    // `ft_transfer_call` on the token sends the stake to the market, with the bet and its
    // checked verdict in `msg`. The market contract checks the verdict.
    call: (fields, verdict) => ({
      kind: 'function_call',
      receiverId: fields.token,
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: fields.contract,
        amount: fields.amountUnits.toString(),
        msg: JSON.stringify({
          action: 'bet',
          market_id: Number(fields.marketId),
          outcome: fields.outcome,
          verdict_json: verdict.verdictJson,
          signature_b64: verdict.signatureB64,
        }),
      },
      gas: BET_CALL_GAS,
      depositYocto: BET_CALL_DEPOSIT,
    }),
    // Only the network's USDC contract is a bet token, because the sentence says "usdc" and an
    // amount with 6 decimals. The Borsh of the request refuses an amount that is not a `u128`.
    fromCall: (call, network) => {
      const bet = readBetCall(call, network);
      return bet ? bet.fields : null;
    },
  },
};

/** A bet call and the verdict that its `msg` carries to the market contract. */
export function readBetCall(
  call: SignedSpokenCall,
  network: SpeakToSignNetwork,
): Readonly<{ fields: FieldsOf<'market_bet'>; verdict: SpokenCallVerdict }> | null {
  if (call.kind !== 'function_call' || call.methodName !== 'ft_transfer_call') return null;
  if (call.depositYocto !== BET_CALL_DEPOSIT || call.receiverId !== SPEAK_TO_SIGN_USDC[network]) {
    return null;
  }
  if (!hasExactKeys(call.args, ['receiver_id', 'amount', 'msg'])) return null;
  const { receiver_id: market, amount, msg } = call.args;
  if (typeof market !== 'string' || typeof amount !== 'string' || typeof msg !== 'string') {
    return null;
  }
  if (!/^[1-9]\d{0,38}$/.test(amount)) return null;
  let bet: unknown;
  try {
    bet = JSON.parse(msg);
  } catch {
    return null;
  }
  if (!hasExactKeys(bet, ['action', 'market_id', 'outcome', 'verdict_json', 'signature_b64'])) {
    return null;
  }
  const { market_id: marketId, verdict_json: verdictJson, signature_b64: signatureB64 } = bet;
  const outcome = BET_OUTCOMES.find((candidate) => candidate === bet.outcome);
  if (
    bet.action !== 'bet' ||
    !isSafeId(marketId) ||
    marketId < 1 ||
    !outcome ||
    typeof verdictJson !== 'string' ||
    typeof signatureB64 !== 'string'
  ) {
    return null;
  }
  return {
    fields: {
      kind: 'market_bet',
      contract: market,
      token: call.receiverId,
      marketId: BigInt(marketId),
      outcome,
      amountUnits: BigInt(amount),
    },
    verdict: { verdictJson, signatureB64 },
  };
}

/**
 * The request of a signed action and the kind that it belongs to, or null when no typed kind
 * has this call. The co-signer uses only this path for a typed request.
 */
export async function spokenRequestOfCall(
  call: SignedSpokenCall,
  network: SpeakToSignNetwork,
  owner: string,
): Promise<SpokenRequest | null> {
  for (const kind of SPOKEN_TYPED_KINDS) {
    const request = await requestOfCall(kind, call, network, owner);
    if (request) return request;
  }
  return null;
}

export const SPOKEN_TYPED_KINDS = Object.keys(SPOKEN_KINDS) as readonly SpokenTypedKind[];

async function requestOfCall<Kind extends SpokenTypedKind>(
  kind: Kind,
  call: SignedSpokenCall,
  network: SpeakToSignNetwork,
  owner: string,
): Promise<SpokenRequest | null> {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[kind];
  const fields = entry.fromCall(call, network);
  return fields ? await entry.request(fields, network, owner) : null;
}

/** The request of the fields. Core uses it for the kind that the application named. */
export async function spokenRequestOfFields<Kind extends SpokenTypedKind>(
  fields: FieldsOf<Kind>,
  network: SpeakToSignNetwork,
  owner: string,
): Promise<SpokenRequest> {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[fields.kind as Kind];
  return await entry.request(fields, network, owner);
}

/** The one action of the fields. Pass only a verdict that passed the check. */
export function spokenCallOfFields<Kind extends SpokenTypedKind>(
  fields: FieldsOf<Kind>,
  verdict: SpokenCallVerdict,
): SpokenCall {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[fields.kind as Kind];
  return entry.call(fields, verdict);
}

function noDepositCall(
  receiverId: string,
  methodName: string,
  args: Readonly<Record<string, unknown>>,
): SpokenCall {
  return { kind: 'function_call', receiverId, methodName, args, gas: NOTE_CALL_GAS, depositYocto: 0n };
}

/** The arguments of a call of `methodName` with no deposit and exactly `keys`, or null. */
function noDepositArgs<const Keys extends readonly string[]>(
  call: SignedSpokenCall,
  methodName: string,
  keys: Keys,
): { readonly [Key in Keys[number]]: unknown } | null {
  if (call.kind !== 'function_call' || call.methodName !== methodName) return null;
  if (call.depositYocto !== 0n) return null;
  return hasExactKeys(call.args, keys) ? call.args : null;
}

/** Wallet core sends note, post, pull request and market ids as JSON safe integers. */
function isSafeId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** 40 lowercase hex characters to the 20 bytes of a git commit. */
function hexBytes(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
