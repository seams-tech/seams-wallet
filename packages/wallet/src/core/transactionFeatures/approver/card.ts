import type { SpeakToSignNetwork } from '../plugins';
import type {
  PhraseCheckView,
  PhraseReceipt,
  PhraseResultView,
  PhraseSegmentState,
} from '@/core/authMethods/hostPlugin';
import { isPlainObject } from '@shared/utils/validation';
import { parseVerifyOutput } from '../voiceVerdict';
import { heardCaption } from './heardWords';
import { isVerifierTimeout, type FailedResult } from './result';

/** OutLayer did not run the verifier in time. The cause is not the recording, so say so. */
const OUTLAYER_TIMEOUT = {
  headline: 'OutLayer timed out',
  caption: 'The OutLayer verifier did not answer in time.',
} as const;

/**
 * The line under the sentence has six segments. A spoken request has one segment for the
 * recording, one for each of the four checks of the verifier, and one for the payment.
 */
const PAYMENT_LINE = ['recording', 'speaker', 'words', 'policy', 'verdict', 'payment'] as const;
type PaymentSegment = (typeof PAYMENT_LINE)[number];

/**
 * An enrollment uses the same six segments: the recordings, the owner's signed message, and the
 * verifier, which stores the template, on the last four.
 */
const ENROLL_LINE = [
  'recordings',
  'signature',
  'verifier',
  'verifier',
  'verifier',
  'verifier',
] as const;

/** Where each check of the verifier runs. It sends one answer at the end, so its wait names them. */
const VERIFIER_STEPS = {
  speaker: 'ReDimNet · Intel TDX CVM on Phala',
  words: 'Whisper large-v3 · NEAR AI Cloud',
  policy: 'JEV policy',
  verdict: 'Signed by the OutLayer TEE verifier',
} as const;

/** The name and the block explorer of each network. */
const NETWORKS: Readonly<
  Record<SpeakToSignNetwork, Readonly<{ name: string; explorer: string }>>
> = {
  testnet: { name: 'NEAR testnet', explorer: 'https://testnet.nearblocks.io/txns/' },
  mainnet: { name: 'NEAR mainnet', explorer: 'https://nearblocks.io/txns/' },
};

/** What the card calls the request it signs. */
export type CardNoun =
  | 'payment'
  | 'note'
  | 'rating'
  | 'approval'
  | 'bet'
  | 'transaction'
  | 'signature'
  | 'message';

export type CardInput = Readonly<{
  network: SpeakToSignNetwork;
  /** The owner's NEAR account: the voice that the verifier matched. */
  owner: string;
  noun: CardNoun;
  /** The result, such as "Sent 0.01 NEAR" and "To bob.testnet". */
  doneHeadline: string;
  doneCaption: string;
  /** The spoken form of the sentence, to align with the words that the verifier heard. */
  spokenText: string;
}>;

const NOUN_COPY: Readonly<
  Record<
    CardNoun,
    Readonly<{ done: string; failedLabel: string; failedDetail: string; unknownLabel: string }>
  >
> = {
  payment: {
    done: 'paid',
    failedLabel: 'Not paid',
    failedDetail: 'Check your balance, then try again.',
    unknownLabel: 'Check before you pay again',
  },
  note: {
    done: 'posted',
    failedLabel: 'Not posted',
    failedDetail: 'Check the post and your balance, then try again.',
    unknownLabel: 'Check before you post again',
  },
  rating: {
    done: 'saved',
    failedLabel: 'Not saved',
    failedDetail: 'Check the note and your balance, then try again.',
    unknownLabel: 'Check before you rate again',
  },
  approval: {
    done: 'approved',
    failedLabel: 'Not approved',
    failedDetail: 'Check the pull request and your balance, then try again.',
    unknownLabel: 'Check before you approve again',
  },
  bet: {
    done: 'placed',
    failedLabel: 'Not placed',
    failedDetail: 'Check the market and your USDC balance, then try again.',
    unknownLabel: 'Check before you bet again',
  },
  transaction: {
    done: 'sent',
    failedLabel: 'Not sent',
    failedDetail: 'Check the transaction and your balance, then try again.',
    unknownLabel: 'Check before you send again',
  },
  signature: {
    done: 'signed',
    failedLabel: 'Not signed',
    failedDetail: 'Nothing was signed. Try again.',
    unknownLabel: 'Check before you sign again',
  },
  message: {
    done: 'signed',
    failedLabel: 'Not signed',
    failedDetail: 'Nothing was signed. Try again.',
    unknownLabel: 'Check before you sign again',
  },
};

/**
 * The state of each segment of a line: the segments before the first one named `upTo` passed,
 * that segment is `state`, and each segment after it is `after`.
 */
function line<Segment extends string>(
  segments: readonly Segment[],
  upTo: Segment,
  state: PhraseSegmentState,
  after: PhraseSegmentState,
): PhraseSegmentState[] {
  const at = segments.indexOf(upTo);
  return segments.map((_, index) => (index < at ? 'done' : index === at ? state : after));
}

export function verifyingView(): PhraseCheckView {
  return {
    kind: 'check',
    label: 'Checking',
    caption: 'Checking what you said',
    details: [
      VERIFIER_STEPS.speaker,
      VERIFIER_STEPS.words,
      VERIFIER_STEPS.policy,
      VERIFIER_STEPS.verdict,
    ],
    // The recording passed, the four checks of the verifier run together, and the payment waits.
    segments: PAYMENT_LINE.map((segment) =>
      segment === 'recording' ? 'done' : segment === 'payment' ? 'idle' : 'run',
    ),
  };
}

export function sendingView(
  input: CardInput,
  approval: 'voice' | 'passkey',
): PhraseCheckView {
  return {
    kind: 'check',
    label: 'Checking',
    caption:
      input.noun === 'message' || input.noun === 'signature'
        ? 'Signing with your account'
        : 'Sending from your account',
    details: [
      `${approval === 'voice' ? 'Signed by your Seams Wallet' : 'Approved with your passkey'} · ${NETWORKS[input.network].name}`,
    ],
    segments: line(PAYMENT_LINE, 'payment', 'run', 'run'),
  };
}

/** The step-up question asks for the passkey, then waits while the owner uses it. */
export function stepUpView(
  noun: CardNoun,
  policyText: string | null,
  step: 'asking' | 'waiting',
): PhraseResultView {
  const waiting = step === 'waiting';
  return {
    kind: 'result',
    label: 'Not sent yet',
    headline: 'Confirm with your passkey',
    caption: waiting
      ? 'Waiting for your passkey'
      : (policyText ?? `Your policy asks for a passkey for this ${noun}.`),
    detail: waiting ? 'Use the passkey prompt on your device.' : 'Your voice and words passed.',
    action: { label: 'Confirm with passkey', icon: 'passkey', busy: waiting },
    line: line(PAYMENT_LINE, 'policy', 'wait', 'skip'),
  };
}

/** What a receipt shows of one verifier call: the version in its verdict, and its attestation. */
export type CardProof = Readonly<{
  /**
   * The verifier version in the signed verdict, such as "0.13.0". A build for another
   * speech-to-text service adds its name: "0.14.0+venice".
   */
  verifier: string | null;
  /** The public OutLayer record of the call, with its TDX quote. */
  attestationUrl: string | null;
}>;

/** The proof of one verifier call, from its output and the attestation URL of the call. */
export function cardProof(output: unknown, attestationUrl: string | null): CardProof {
  return { verifier: verdictVersion(output), attestationUrl };
}

function verdictVersion(output: unknown): string | null {
  const parsed = parseVerifyOutput(output);
  if (!parsed) return null;
  try {
    const verdict: unknown = JSON.parse(parsed.verdictJson);
    if (!isPlainObject(verdict) || typeof verdict.verifier !== 'string') return null;
    return /^\d{1,4}\.\d{1,4}\.\d{1,4}(\+[a-z0-9]{1,16})?$/.test(verdict.verifier)
      ? verdict.verifier
      : null;
  } catch {
    return null;
  }
}

/**
 * The receipt of a signed request: the checks of the verifier, which the OutLayer worker signs
 * in an Intel TDX TEE, and the link to the TDX quote of the call. The voice is the owner's
 * account; a note also had its summary checked against the note. The `venice` build sends the
 * clip to Venice AI, which runs in no TEE: the receipt says so.
 */
export function receiptView(input: CardInput, proof: CardProof): PhraseReceipt {
  const rows = [
    { label: 'Voice', value: `matched ${shortAccount(input.owner)}` },
    {
      label: 'Words',
      value: input.noun === 'note' ? 'matched the summary' : 'matched the sentence',
    },
    ...(input.noun === 'note' && checksSummary(proof.verifier)
      ? [{ label: 'Summary', value: 'fits the note (JEV)' }]
      : []),
    ...(proof.verifier?.endsWith('+venice')
      ? [{ label: 'Speech to text', value: 'Venice AI, outside a TEE' }]
      : []),
    {
      label: 'Verdict',
      value: `signed by the OutLayer verifier${proof.verifier ? ` ${proof.verifier}` : ''}`,
    },
  ];
  return {
    title: 'TEE receipt',
    source: 'Intel TDX · OutLayer',
    rows,
    ...(proof.attestationUrl
      ? { link: { text: 'View TDX quote', href: proof.attestationUrl } }
      : {}),
  };
}

/** Verifier 0.13.0 and later check with JEV that a note's summary fits the note. */
function checksSummary(version: string | null): boolean {
  const [major = 0, minor = 0] = (version ?? '').split('+')[0].split('.').map(Number);
  return major > 0 || minor >= 13;
}

/** A long account in its short form: a 64-character implicit account becomes "10d3ca…25f5". */
function shortAccount(account: string): string {
  if (/^[0-9a-f]{64}$/.test(account)) return `${account.slice(0, 6)}…${account.slice(-4)}`;
  return account.length > 32 ? `${account.slice(0, 20)}…${account.slice(-8)}` : account;
}

export function paidView(
  input: CardInput,
  hash: string,
  seconds: number,
  proof?: CardProof,
): PhraseResultView {
  const { explorer } = NETWORKS[input.network];
  return {
    kind: 'result',
    label: '',
    headline: input.doneHeadline,
    caption: input.doneCaption,
    ...(proof ? { receipt: receiptView(input, proof) } : {}),
    detail: `Checked and ${NOUN_COPY[input.noun].done} in ${seconds.toFixed(1)} s ·`,
    link: { text: 'View transaction', href: `${explorer}${encodeURIComponent(hash)}` },
    action: { label: 'Done' },
    line: 'seal',
  };
}

/** A signed message has no transaction to link to. */
export function signedView(input: CardInput, seconds: number, proof?: CardProof): PhraseResultView {
  return {
    kind: 'result',
    label: '',
    headline: input.doneHeadline,
    caption: input.doneCaption,
    ...(proof ? { receipt: receiptView(input, proof) } : {}),
    detail: `Checked and ${NOUN_COPY[input.noun].done} in ${seconds.toFixed(1)} s`,
    action: { label: 'Done' },
    line: 'seal',
  };
}

/** After the third phrase, until the Wallet confirm of the enrollment message opens over it. */
export function enrollSigningView(): PhraseCheckView {
  return {
    kind: 'check',
    label: 'Enrolling',
    caption: 'Preparing your signed enrollment',
    details: ['Next, confirm one message that names these three recordings.'],
    segments: line(ENROLL_LINE, 'signature', 'wait', 'idle'),
  };
}

export function enrollSavingView(): PhraseCheckView {
  return {
    kind: 'check',
    label: 'Enrolling',
    caption: 'Storing your voice template',
    details: [VERIFIER_STEPS.speaker, VERIFIER_STEPS.verdict],
    segments: line(ENROLL_LINE, 'verifier', 'run', 'run'),
  };
}

export function enrolledView(templateEpoch: number, agreementMilli: number): PhraseResultView {
  return {
    kind: 'result',
    label: '',
    headline: 'Voice enrolled',
    caption: 'The verifier stored your voice template.',
    detail: `Template ${templateEpoch} · agreement ${(agreementMilli / 1000).toFixed(3)}`,
    action: { label: 'Done' },
    line: 'seal',
  };
}

/** Refusals that say a service of the verifier failed, not that the recordings were wrong. */
const SERVICE_REFUSALS: ReadonlySet<string> = new Set([
  'speaker_unavailable',
  'authorization_unavailable',
  'storage',
]);

/** The verifier refused the recordings, or did not answer. Nothing was stored. */
export function notEnrolledView(
  result: Readonly<{ kind: 'refused' | 'unavailable'; reason: string; detail?: string }>,
): PhraseResultView {
  if (isVerifierTimeout(result)) {
    return {
      kind: 'result',
      label: 'Not enrolled',
      ...OUTLAYER_TIMEOUT,
      detail: 'Your recordings are not the cause. Try again in a minute.',
      action: { label: 'Close' },
      line: line(ENROLL_LINE, 'verifier', 'fail', 'skip'),
    };
  }
  const refused = result.kind === 'refused' && !SERVICE_REFUSALS.has(result.reason);
  return {
    kind: 'result',
    label: 'Not enrolled',
    headline: refused ? 'The verifier refused the recordings' : 'The check is not available',
    caption: refused ? `Reason: ${result.reason}` : 'A verifier service did not answer.',
    detail: refused ? 'Record the three phrases again.' : 'Try again in a minute.',
    action: { label: 'Close' },
    line: line(ENROLL_LINE, 'verifier', 'fail', 'skip'),
  };
}

/** A failed result and whether "Try again" records the sentence again. */
export type FailureView = Readonly<{ view: PhraseResultView; retry: boolean }>;

/** `canRetry` is false for the last recording of a request. */
export function failureView(
  input: CardInput,
  result: FailedResult,
  canRetry: boolean,
): FailureView {
  const found = failureCopy(input, result);
  const copy = { ...found, retry: found.retry && canRetry };
  return {
    retry: copy.retry,
    view: {
      kind: 'result',
      label: copy.label ?? 'Nothing was sent',
      headline: copy.headline,
      caption: copy.caption,
      detail: copy.detail,
      action: { label: copy.retry ? 'Try again' : 'Close' },
      line: line(PAYMENT_LINE, copy.at, 'fail', 'skip'),
    },
  };
}

type FailureCopy = Readonly<{
  label?: string;
  headline: string;
  caption: PhraseResultView['caption'];
  detail: string;
  /** The segment of the line that failed. */
  at: PaymentSegment;
  retry: boolean;
}>;

function failureCopy(input: CardInput, result: FailedResult): FailureCopy {
  const noun = NOUN_COPY[input.noun];
  const unavailable = {
    headline: 'The check is not available',
    caption: 'A verifier service did not answer.',
    detail: 'Try again in a minute.',
    retry: true,
  };
  if (result.kind === 'unavailable') {
    if (isVerifierTimeout(result)) {
      return {
        ...OUTLAYER_TIMEOUT,
        detail: 'Your recording is not the cause. Try again in a minute.',
        at: 'speaker',
        retry: true,
      };
    }
    switch (result.reason) {
      case 'not_submitted':
        return {
          headline: `The ${input.noun} was not sent`,
          caption: 'Your Wallet did not send the transaction.',
          detail: 'Try again in a minute.',
          at: 'payment',
          retry: true,
        };
      case 'submission_unknown':
        return {
          label: noun.unknownLabel,
          headline: `The ${input.noun} may have been sent`,
          caption: 'The network did not confirm the transaction.',
          detail: 'Check your account before you try again.',
          at: 'payment',
          retry: false,
        };
      default:
        return { ...unavailable, at: 'speaker' };
    }
  }
  switch (result.reason) {
    case 'words':
      return {
        headline: 'The words did not match',
        caption: heardCaption(input.spokenText, result.detail),
        detail: 'Read the sentence again, word for word.',
        at: 'words',
        retry: true,
      };
    case 'speaker':
      return {
        headline: 'Your voice did not match',
        caption: 'The verifier did not match your enrolled voice.',
        detail: 'Speak in your usual voice, close to the microphone.',
        at: 'speaker',
        retry: true,
      };
    case 'quality':
      return {
        headline: 'The recording was not clear',
        caption: 'The verifier could not hear your voice well.',
        detail: 'Move somewhere quieter and speak close to the microphone.',
        at: 'speaker',
        retry: true,
      };
    case 'audio_reused':
    case 'audio_invalid':
      return {
        headline: 'The recording could not be used',
        caption: 'The verifier did not accept this recording.',
        detail: 'Record the sentence again.',
        at: 'speaker',
        retry: true,
      };
    case 'template_missing':
      return {
        headline: 'Your voice is not enrolled',
        caption: 'The verifier has no voice for this account.',
        detail: 'Enroll your voice for Speak-to-Sign first.',
        at: 'speaker',
        retry: false,
      };
    case 'summary_mismatch':
      return {
        headline: 'The summary did not fit the note',
        caption: 'The verifier found that the sentence does not give the main point of the note.',
        detail: 'Close the card and write the note again.',
        at: 'words',
        retry: false,
      };
    case 'transcriber_unavailable':
    case 'summary_check_unavailable':
      return { ...unavailable, at: 'words' };
    case 'transcriber_not_attested':
      return {
        headline: 'The speech-to-text service was not attested',
        caption: "The verifier could not check the TEE of NEAR AI's Whisper, so it did not use it.",
        detail: 'Your recording is not the cause. Try again in a minute.',
        at: 'words',
        retry: true,
      };
    case 'speaker_unavailable':
    case 'storage':
    case 'unsupported':
      return { ...unavailable, at: 'speaker' };
    case 'verdict_mismatch':
      return {
        headline: 'The verdict did not match',
        caption: `Your Wallet refused the signed verdict for this ${input.noun}.`,
        detail: 'Record the sentence again.',
        at: 'verdict',
        retry: true,
      };
    case 'cosigner_refused':
      return {
        headline: 'Seams refused the verdict',
        caption: `The Seams co-signer did not accept the verdict for this ${input.noun}.`,
        detail: 'Record the sentence again.',
        at: 'payment',
        retry: true,
      };
    case 'transaction_failed':
      return {
        label: noun.failedLabel,
        headline: `The ${input.noun} failed`,
        caption: 'NEAR refused the transaction.',
        detail: noun.failedDetail,
        at: 'payment',
        retry: true,
      };
    default:
      return result satisfies never;
  }
}
