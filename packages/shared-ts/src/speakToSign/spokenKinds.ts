// The typed kinds of a spoken request, in one table. Each entry holds everything that is
// particular to its kind:
//   - `refusal`: every limit of the kind (core signs nothing for refused fields);
//   - `render`: the sentence on the card and the words that the owner says;
//   - `verifyRequest`: the request of the verifier's `verify` input;
//   - `request`: the `SpokenRequestV1` that a verdict names, from the fields;
//   - `call`: the one action that carries the request out (core signs it);
//   - `fromCall`: the fields again, from that one action (the co-signer reads signed bytes).
// Wallet core and the Seams co-signer must agree on the last three.
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
  USDC_UNITS_PER_HUNDREDTH,
} from './spokenRequest';
import { renderSummary, summaryRefusal } from './spokenSummary';
import {
  amountWords,
  displayAmount,
  integerWords,
  isSpeakableAccount,
  isSpeakableHundredths,
  renderTransfer,
  type RenderedTransfer,
} from './spokenWords';

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

/** Why the fields are not a request that the Wallet signs by voice. */
export type SpokenFieldsRefusal =
  /** The receiver is not a named NEAR account that the sentence can say (an implicit one). */
  | 'receiver_not_speakable'
  /** The amount is not a whole number of hundredths of NEAR from 0.01 to 1,000,000. */
  | 'amount_not_speakable'
  /** The summary is not 1 to 12 plain words of ASCII letters (see `summaryRefusal`). */
  | 'summary_not_speakable'
  | 'note_not_valid'
  | 'merge_not_valid'
  | 'bet_not_valid';

export type SpokenKindEntry<Kind extends SpokenTypedKind> = Readonly<{
  /**
   * Null for fields that are a request of this kind. It holds every limit of the kind, so a
   * verdict can approve no fields that it refuses.
   */
  refusal(fields: FieldsOf<Kind>, network: SpeakToSignNetwork): SpokenFieldsRefusal | null;
  /** The one sentence of the request. The verdict binds its spoken words, for every kind. */
  render(fields: FieldsOf<Kind>): RenderedTransfer;
  /** The `request` of the verifier's `verify` input. */
  verifyRequest(fields: FieldsOf<Kind>): Promise<Readonly<Record<string, unknown>>>;
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

const YOCTO_PER_HUNDREDTH = 10n ** 22n;
/** The notes contract keeps a note of at most this many characters. */
export const MAX_NOTE_CHARS = 280;
const MAX_ID = BigInt(Number.MAX_SAFE_INTEGER);
/** The merge-approval contract's rule: no owner edge dash, and a name other than "." or "..". */
const REPO_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
const BASE_PATTERN = /^[a-z]{1,32}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RATING_WORDS: Readonly<Record<NoteRating, readonly string[]>> = {
  helpful: ['this', 'note', 'is', 'helpful'],
  somewhat_helpful: ['this', 'note', 'is', 'somewhat', 'helpful'],
  not_helpful: ['this', 'note', 'is', 'not', 'helpful'],
};

/** The gas of one note call. The contract needs less than 10 Tgas. */
const NOTE_CALL_GAS = '30000000000000';
/** The market needs gas for `ft_on_transfer` and the token for its callback. */
const BET_CALL_GAS = '100000000000000';
/** NEP-141 asks for exactly 1 yoctoNEAR on `ft_transfer_call`. */
const BET_CALL_DEPOSIT = 1n;

export const SPOKEN_KINDS: { readonly [Kind in SpokenTypedKind]: SpokenKindEntry<Kind> } = {
  account_transfer: {
    refusal: (fields) => {
      if (!isSpeakableAccount(fields.receiver)) return 'receiver_not_speakable';
      // The sentence says whole hundredths of NEAR, so another amount has no sentence.
      const speakable =
        fields.amountYocto % YOCTO_PER_HUNDREDTH === 0n &&
        isSpeakableHundredths(fields.amountYocto / YOCTO_PER_HUNDREDTH);
      return speakable ? null : 'amount_not_speakable';
    },
    render: (fields) => renderTransfer(fields),
    verifyRequest: async (fields) => ({
      kind: 'transfer',
      receiver: fields.receiver,
      amount_yocto: String(fields.amountYocto),
    }),
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
    refusal: (fields) => {
      if (!isSpeakableAccount(fields.contract) || !isId(fields.postId, 0n)) return 'note_not_valid';
      const characters = [...fields.text].length;
      if (characters === 0 || characters > MAX_NOTE_CHARS) return 'note_not_valid';
      return summaryRefusal(fields.summary) === null ? null : 'summary_not_speakable';
    },
    // `displayText` keeps the summary as the author wrote it.
    render: (fields) => renderSummary(fields.summary),
    verifyRequest: async (fields) => ({
      kind: 'community_note',
      contract: fields.contract,
      post_id: Number(fields.postId),
      note_sha256_hex: hex(await sha256(utf8(fields.text))),
      summary: fields.summary,
    }),
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
    refusal: (fields) =>
      isSpeakableAccount(fields.contract) &&
      isId(fields.noteId, 0n) &&
      NOTE_RATINGS.includes(fields.rating)
        ? null
        : 'note_not_valid',
    render: (fields) => {
      const words = RATING_WORDS[fields.rating];
      return { displayText: ['This', ...words.slice(1)].join(' '), spokenText: words.join(' ') };
    },
    verifyRequest: async (fields) => ({
      kind: 'note_rating',
      contract: fields.contract,
      note_id: Number(fields.noteId),
      rating: fields.rating,
    }),
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
    refusal: (fields) =>
      isSpeakableAccount(fields.contract) &&
      isId(fields.pullRequest, 1n) &&
      REPO_PATTERN.test(fields.repo) &&
      BASE_PATTERN.test(fields.base) &&
      COMMIT_PATTERN.test(fields.headCommit)
        ? null
        : 'merge_not_valid',
    render: (fields) => ({
      displayText: `Merge pull request ${fields.pullRequest} into ${fields.base}`,
      spokenText: [
        'merge',
        'pull',
        'request',
        ...integerWords(fields.pullRequest),
        'into',
        fields.base,
      ].join(' '),
    }),
    verifyRequest: async (fields) => ({
      kind: 'merge_approval',
      contract: fields.contract,
      repo_sha256_hex: hex(await sha256(utf8(fields.repo))),
      pull_request: Number(fields.pullRequest),
      base: fields.base,
      head_commit_hex: fields.headCommit,
    }),
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
    refusal: (fields, network) =>
      isSpeakableAccount(fields.contract) &&
      // Another token can have other decimals, so "usdc" and the amount would name another value.
      fields.token === SPEAK_TO_SIGN_USDC[network] &&
      isId(fields.marketId, 1n) &&
      BET_OUTCOMES.includes(fields.outcome) &&
      fields.amountUnits % USDC_UNITS_PER_HUNDREDTH === 0n &&
      isSpeakableHundredths(fields.amountUnits / USDC_UNITS_PER_HUNDREDTH)
        ? null
        : 'bet_not_valid',
    // "bet zero point five usdc yes on market nine".
    render: (fields) => {
      const hundredths = fields.amountUnits / USDC_UNITS_PER_HUNDREDTH;
      return {
        displayText: `Bet ${displayAmount(hundredths)} USDC ${fields.outcome} on market ${fields.marketId}`,
        spokenText: [
          'bet',
          ...amountWords(hundredths),
          'usdc',
          fields.outcome,
          'on',
          'market',
          ...integerWords(fields.marketId),
        ].join(' '),
      };
    },
    verifyRequest: async (fields) => ({
      kind: 'market_bet',
      market: fields.contract,
      token: fields.token,
      market_id: Number(fields.marketId),
      outcome: fields.outcome,
      amount_units: fields.amountUnits.toString(),
    }),
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

/** Why core cannot sign the fields, or null. */
export function spokenFieldsRefusal<Kind extends SpokenTypedKind>(
  fields: FieldsOf<Kind>,
  network: SpeakToSignNetwork,
): SpokenFieldsRefusal | null {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[fields.kind as Kind];
  return entry.refusal(fields, network);
}

/** The sentence of the fields. */
export function renderSpokenFields<Kind extends SpokenTypedKind>(
  fields: FieldsOf<Kind>,
): RenderedTransfer {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[fields.kind as Kind];
  return entry.render(fields);
}

/** The `request` of the verifier's `verify` input for the fields. */
export async function spokenVerifyRequest<Kind extends SpokenTypedKind>(
  fields: FieldsOf<Kind>,
): Promise<Readonly<Record<string, unknown>>> {
  const entry: SpokenKindEntry<Kind> = SPOKEN_KINDS[fields.kind as Kind];
  return await entry.verifyRequest(fields);
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

/** A whole number from `least` to `Number.MAX_SAFE_INTEGER`: the channel carries ids as JSON. */
function isId(value: bigint, least: bigint): boolean {
  return value >= least && value <= MAX_ID;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
