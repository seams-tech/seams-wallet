// The requests of the `spoken-intent` crate (seams-tech/speak-to-sign) that a Speak-to-Sign verdict
// names: their Borsh bytes and their digests. Wallet core and the Seams co-signer both build them
// from the transaction that they sign, so each one checks the verdict against that transaction.
// The crate's golden vectors, copied to tests/fixtures/spoken-intent, check these bytes
// (tests/unit/speakToSignHost.unit.test.ts).

export type SpeakToSignNetwork = 'testnet' | 'mainnet';

export const NOTE_RATINGS = ['helpful', 'somewhat_helpful', 'not_helpful'] as const;
export type NoteRating = (typeof NOTE_RATINGS)[number];

export const BET_OUTCOMES = ['yes', 'no'] as const;
export type BetOutcome = (typeof BET_OUTCOMES)[number];

/**
 * The USDC contract of each network: a NEP-141 token with 6 decimals. A spoken bet says "usdc"
 * and an amount with 6 decimals, so Wallet core and the Seams co-signer sign a bet only in this
 * token. Null: the network has no spoken bets.
 */
export const SPEAK_TO_SIGN_USDC: Readonly<Record<SpeakToSignNetwork, string | null>> = {
  testnet: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
  mainnet: null,
};
/** The base units (10^-6 USDC) of 0.01 USDC. */
export const USDC_UNITS_PER_HUNDREDTH = 10_000n;

/** The kinds of `SpokenRequestV1` that Wallet core signs. Each holds its owner, which is not spoken. */
export type SpokenRequest =
  /** `AccountTransfer`, tag 2: a NEAR transfer from the owner's own account. */
  | Readonly<{
      kind: 'account_transfer';
      network: SpeakToSignNetwork;
      owner: string;
      receiver: string;
      amountYocto: bigint;
    }>
  /** `CommunityNote`, tag 4: `add_note` on the notes contract. The verdict binds the note's SHA-256. */
  | Readonly<{
      kind: 'community_note';
      network: SpeakToSignNetwork;
      owner: string;
      contract: string;
      postId: bigint;
      noteSha256: Uint8Array;
      summary: string;
    }>
  /** `NoteRating`, tag 5: `rate_note` on the notes contract. */
  | Readonly<{
      kind: 'note_rating';
      network: SpeakToSignNetwork;
      owner: string;
      contract: string;
      noteId: bigint;
      rating: NoteRating;
    }>
  /**
   * `MergeApproval`, tag 6: `approve_merge` on a merge-approval contract. The verdict binds the
   * repository's SHA-256 and the head commit; only the pull request number and the base are said.
   */
  | Readonly<{
      kind: 'merge_approval';
      network: SpeakToSignNetwork;
      owner: string;
      contract: string;
      repoSha256: Uint8Array;
      pullRequest: bigint;
      /** 1 to 32 lowercase ASCII letters, such as `main`. */
      base: string;
      /** The 20-byte git commit. */
      headCommit: Uint8Array;
    }>
  /**
   * `MarketBet`, tag 7: the token's `ft_transfer_call` to a prediction market. The verdict binds
   * the market and token contracts; only the amount, the outcome and the market id are said.
   */
  | Readonly<{
      kind: 'market_bet';
      network: SpeakToSignNetwork;
      owner: string;
      market: string;
      token: string;
      marketId: bigint;
      outcome: BetOutcome;
      /** Base units of the token: a whole multiple of 0.01 USDC, from 0.01 to 1,000,000 USDC. */
      amountUnits: bigint;
    }>;

const REQUEST_DIGEST_DOMAIN = 'seams:spoken-intent:request:v1';
const SPOKEN_TEXT_DIGEST_DOMAIN = 'seams:spoken-intent:spoken:v1';
const TAGS: Readonly<Record<SpokenRequest['kind'], number>> = {
  account_transfer: 2,
  community_note: 4,
  note_rating: 5,
  merge_approval: 6,
  market_bet: 7,
};

/** Borsh of the request, with the explicit tag of its kind. */
export function spokenRequestBorsh(request: SpokenRequest): Uint8Array<ArrayBuffer> {
  const head = [
    Uint8Array.of(TAGS[request.kind], request.network === 'testnet' ? 0 : 1),
    borshString(request.owner),
  ];
  switch (request.kind) {
    case 'account_transfer':
      return concat([
        ...head,
        borshString(request.receiver),
        littleEndian(request.amountYocto, 16),
      ]);
    case 'community_note':
      if (request.noteSha256.length !== 32) throw new RangeError('A note digest has 32 bytes.');
      return concat([
        ...head,
        borshString(request.contract),
        littleEndian(request.postId, 8),
        request.noteSha256,
        borshString(request.summary),
      ]);
    case 'note_rating':
      return concat([
        ...head,
        borshString(request.contract),
        littleEndian(request.noteId, 8),
        Uint8Array.of(NOTE_RATINGS.indexOf(request.rating)),
      ]);
    case 'merge_approval':
      if (request.repoSha256.length !== 32) throw new RangeError('A repository digest has 32 bytes.');
      if (request.headCommit.length !== 20) throw new RangeError('A git commit has 20 bytes.');
      return concat([
        ...head,
        borshString(request.contract),
        request.repoSha256,
        littleEndian(request.pullRequest, 8),
        borshString(request.base),
        request.headCommit,
      ]);
    case 'market_bet':
      return concat([
        ...head,
        borshString(request.market),
        borshString(request.token),
        littleEndian(request.marketId, 8),
        Uint8Array.of(BET_OUTCOMES.indexOf(request.outcome)),
        littleEndian(request.amountUnits, 16),
      ]);
  }
}

/** `sha256(REQUEST_DIGEST_DOMAIN || borsh)`: the `request_digest` of a verdict. */
export async function spokenRequestDigest(borsh: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return await sha256(concat([utf8(REQUEST_DIGEST_DOMAIN), borsh]));
}

/** `sha256(SPOKEN_TEXT_DIGEST_DOMAIN || spoken_text)`: the `spoken_text_digest` of a verdict. */
export async function spokenTextDigest(spokenText: string): Promise<Uint8Array<ArrayBuffer>> {
  return await sha256(concat([utf8(SPOKEN_TEXT_DIGEST_DOMAIN), utf8(spokenText)]));
}

export function borshString(value: string): Uint8Array<ArrayBuffer> {
  const bytes = utf8(value);
  return concat([littleEndian(BigInt(bytes.length), 4), bytes]);
}

export function littleEndian(value: bigint, length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  let rest = value;
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n || value < 0n) throw new RangeError('Value does not fit the Borsh integer.');
  return out;
}

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce(addLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function addLength(total: number, part: Uint8Array): number {
  return total + part.length;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
