// The account transfer subset of the `spoken-intent` crate (seams-tech/speak-to-sign): the same
// account and amount rules and the same rendered words. The Borsh bytes and digests are in
// `@shared/speakToSign/spokenRequest`. The crate's golden vectors check this port. Wallet core
// uses it to check a verdict against the transaction that core signs.

import {
  spokenRequestBorsh,
  spokenRequestDigest,
  spokenTextDigest,
} from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignNetwork } from './plugins';

const YOCTO_PER_HUNDREDTH = 10n ** 22n;
const MAX_HUNDREDTHS = 100_000_000n;

/** `SpokenRequestV1::AccountTransfer`: a NEAR transfer from the owner's own account. */
export type SpokenTransferRequest = Readonly<{
  network: SpeakToSignNetwork;
  /** Any NEAR account, named or implicit. The sentence does not say it. */
  owner: string;
  receiver: string;
  /** A whole multiple of 0.01 NEAR, from 0.01 to 1,000,000 NEAR. */
  amountYocto: bigint;
}>;

export type RenderedTransfer = Readonly<{
  /** The sentence that the capture surface shows. */
  displayText: string;
  /** The words that the owner says, joined with single spaces. */
  spokenText: string;
}>;

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: ReadonlyArray<readonly [string, bigint]> = [
  ['quintillion', 10n ** 18n],
  ['quadrillion', 10n ** 15n],
  ['trillion', 10n ** 12n],
  ['billion', 10n ** 9n],
  ['million', 10n ** 6n],
  ['thousand', 1_000n],
];

/** A named NEAR account that the grammar can speak; implicit and `0x` accounts are refused. */
export function isSpeakableAccount(accountId: string): boolean {
  if (accountId.length < 2 || accountId.length > 64) return false;
  if (accountId.length === 64 && /^[0-9a-fA-F]+$/.test(accountId)) return false;
  if (accountId.startsWith('0x')) return false;
  return accountId.split('.').every(isValidPart);
}

function isValidPart(part: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(part);
}

/** `"2.5"` NEAR to yoctoNEAR, or null when the grammar cannot speak the amount. It never rounds. */
export function parseSpeakableNear(text: string): bigint | null {
  const hundredths = parseSpeakableHundredths(text);
  return hundredths === null ? null : hundredths * YOCTO_PER_HUNDREDTH;
}

/** `"2.5"` to 250 hundredths, or null outside 0.01 to 1,000,000 or with a third decimal. */
export function parseSpeakableHundredths(text: string): bigint | null {
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return isSpeakableHundredths(hundredths) ? hundredths : null;
}

/** True from 0.01 to 1,000,000 of the unit. */
export function isSpeakableHundredths(hundredths: bigint): boolean {
  return hundredths > 0n && hundredths <= MAX_HUNDREDTHS;
}

/** The one canonical sentence of a transfer. */
export function renderTransfer(
  request: Pick<SpokenTransferRequest, 'receiver' | 'amountYocto'>,
): RenderedTransfer {
  const hundredths = request.amountYocto / YOCTO_PER_HUNDREDTH;
  const words = [
    'send',
    ...amountWords(hundredths),
    'near',
    'to',
    ...accountWords(request.receiver),
  ];
  return {
    displayText: `Send ${displayAmount(hundredths)} NEAR to ${request.receiver}`,
    spokenText: words.join(' '),
  };
}

/** "two point five": the integer words, then "point" and one word for each decimal digit. */
export function amountWords(hundredths: bigint): string[] {
  const words = integerWords(hundredths / 100n);
  const fraction = Number(hundredths % 100n);
  if (fraction !== 0) {
    words.push('point', ONES[Math.floor(fraction / 10)]);
    if (fraction % 10 !== 0) words.push(ONES[fraction % 10]);
  }
  return words;
}

/** "1,250", "2.5" or "0.05". */
export function displayAmount(hundredths: bigint): string {
  const digits = (hundredths / 100n).toString();
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  const fraction = Number(hundredths % 100n);
  if (fraction !== 0) {
    out += `.${Math.floor(fraction / 10)}`;
    if (fraction % 10 !== 0) out += String(fraction % 10);
  }
  return out;
}

export function integerWords(value: bigint): string[] {
  if (value === 0n) return [ONES[0]];
  const words: string[] = [];
  let rest = value;
  for (const [word, scale] of SCALES) {
    const group = rest / scale;
    if (group > 0n) {
      words.push(...belowThousand(Number(group)), word);
      rest %= scale;
    }
  }
  if (rest > 0n) words.push(...belowThousand(Number(rest)));
  return words;
}

function belowThousand(value: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds > 0) words.push(ONES[hundreds], 'hundred');
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10 !== 0) words.push(ONES[rest % 10]);
  } else if (rest > 0) {
    words.push(ONES[rest]);
  }
  return words;
}

/** "bob-1.testnet" is "bob dash one dot testnet": letter runs, one word per digit and separator. */
function accountWords(accountId: string): string[] {
  return accountId.match(/[a-z]+|[^a-z]/g)!.map(separatorWord);
}

function separatorWord(piece: string): string {
  if (piece === '.') return 'dot';
  if (piece === '-') return 'dash';
  if (piece === '_') return 'underscore';
  return /^\d$/.test(piece) ? ONES[Number(piece)] : piece;
}

/** Borsh of `SpokenRequestV1::AccountTransfer`, whose explicit tag is 2. */
export function transferBorsh(request: SpokenTransferRequest): Uint8Array {
  return spokenRequestBorsh({ kind: 'account_transfer', ...request });
}

/** The two digests that a verdict names for one request. */
export type SpokenDigests = Readonly<{
  /** `sha256(REQUEST_DIGEST_DOMAIN || borsh(request))`. */
  request: Uint8Array<ArrayBuffer>;
  /** `sha256(SPOKEN_TEXT_DIGEST_DOMAIN || spoken_text)`. */
  spokenText: Uint8Array<ArrayBuffer>;
}>;

/** The digests of a request from its Borsh bytes and its spoken words. */
export async function spokenDigests(borsh: Uint8Array, spokenText: string): Promise<SpokenDigests> {
  return {
    request: await spokenRequestDigest(borsh),
    spokenText: await spokenTextDigest(spokenText),
  };
}

export async function transferDigests(request: SpokenTransferRequest): Promise<SpokenDigests> {
  return await spokenDigests(transferBorsh(request), renderTransfer(request).spokenText);
}

/** True for every word that can appear in an integer. */
export function isNumberWord(word: string): boolean {
  return (
    (ONES as readonly string[]).includes(word) ||
    TENS.slice(2).includes(word) ||
    isMultiplierWord(word)
  );
}

/** True for "hundred" and the scale words. */
export function isMultiplierWord(word: string): boolean {
  return word === 'hundred' || SCALES.some(([scale]) => scale === word);
}
