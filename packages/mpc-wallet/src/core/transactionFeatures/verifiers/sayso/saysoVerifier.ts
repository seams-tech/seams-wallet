// The SaySo backend of Wallet core: a transcript-only intent, the recording as a plain WAV, a
// fresh passkey or Email OTP approval for an enrollment, and the card text and receipt of the
// Seams verifier on Cloudflare. SaySo checks the speaker and the audio and signs the transcript;
// core and the co-signer decide the words (`saysoVerdictV1`). SaySo has no TEE, so the receipt
// names the operator's Cloudflare infrastructure and links no attestation.

import { MAX_SENTENCE_WORDS } from '@seams/sayso-verdict';
import type { PhraseReceipt } from '@/core/authMethods/hostPlugin';
import { saysoIntent, saysoIntentFields } from '@shared/speakToSign/evidence/saysoVerdictV1';
import { hex } from '@shared/speakToSign/spokenKinds';
import { isPlainObject } from '@shared/utils/validation';
import type { VerifyOutput } from '../../voiceVerdict';
import type { SpeakToSignVerifierBackend, VerifierProof, VerifierReceiptInput } from '../backend';

const VERIFY_OUTPUT_KIND = 'sayso_verify_output_v1';
/** SaySo refuses a sentence of more characters. */
const MAX_SENTENCE_CHARS = 160;
const SPEAKER_MODEL = 'ReDimNet B1 · Cloudflare Container';
const TRANSCRIBER = 'Whisper large-v3-turbo · Workers AI';

export const SAYSO_VERIFIER: SpeakToSignVerifierBackend = {
  id: 'sayso',
  steps: {
    speaker: SPEAKER_MODEL,
    words: TRANSCRIBER,
    policy: 'The Wallet reads the words',
    verdict: 'Signed by the Seams verifier on Cloudflare',
  },
  timeout: {
    headline: 'The verifier timed out',
    caption: 'The Seams verifier did not answer in time.',
  },
  enrollmentKind: 'sayso_enrollment_v1',
  parseOutput: parseSaySoOutput,
  proof: (output) => ({ verifier: verdictVersion(output), attestationUrl: null }),
  receipt: receiptView,
  verifyInput: async ({ request, requestDigest }) => {
    const fields = saysoIntentFields(request, requestDigest);
    try {
      await saysoIntent(fields);
    } catch {
      return { kind: 'above_limits', detail: limitDetail(fields.sentence) };
    }
    return {
      kind: 'ready',
      input: {
        op: 'verify',
        network: fields.network,
        owner: fields.owner,
        intent: {
          action: fields.action,
          payload_sha256_hex: hex(requestDigest),
          sentence: fields.sentence,
        },
      },
    };
  },
  // The recording goes as it is: the Seams Gateway and SaySo run in one operator's account.
  prepareInput: async (network, verifierInput) =>
    verifierInput.op === 'enroll' ? { ...verifierInput, network } : verifierInput,
  // The Gateway enrolls only with a Wallet Session that the fresh approval issued.
  authorizeEnrollment: async ({ freshApproval }) => {
    const approval = await freshApproval();
    return approval.kind === 'approved'
      ? { kind: 'signed', authorization: null }
      : { kind: 'not_signed', error: approval.error };
  },
  templateDeleteInput: (network, owner) => ({ op: 'delete', network, owner }),
};

/** The SaySo verify output that the Seams verify route passes through unchanged. */
function parseSaySoOutput(value: unknown): VerifyOutput | null {
  if (
    !isPlainObject(value) ||
    value.kind !== VERIFY_OUTPUT_KIND ||
    typeof value.verdict_json !== 'string'
  ) {
    return null;
  }
  return {
    verdictJson: value.verdict_json,
    signatureB64: typeof value.signature_b64 === 'string' ? value.signature_b64 : null,
    publicKey: typeof value.public_key_hex === 'string' ? value.public_key_hex : null,
    // SaySo has no policy rule.
    policyText: null,
    ms: isPlainObject(value.ms) ? value.ms : {},
  };
}

/** Why a sentence has no spoken approval. The application then uses the confirm. */
function limitDetail(sentence: string): string {
  const words = sentence.split(' ').length;
  if (words > MAX_SENTENCE_WORDS) {
    return `The sentence has ${words} words; the verifier takes at most ${MAX_SENTENCE_WORDS}.`;
  }
  if (sentence.length > MAX_SENTENCE_CHARS) {
    return `The sentence has ${sentence.length} characters; the verifier takes at most ${MAX_SENTENCE_CHARS}.`;
  }
  return 'The verifier cannot take this sentence.';
}

function verdictVersion(output: unknown): string | null {
  const parsed = parseSaySoOutput(output);
  if (!parsed) return null;
  try {
    const verdict: unknown = JSON.parse(parsed.verdictJson);
    if (!isPlainObject(verdict) || typeof verdict.verifier !== 'string') return null;
    return /^sayso\/\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(verdict.verifier) ? verdict.verifier : null;
  } catch {
    return null;
  }
}

/**
 * The receipt of a signed request: SaySo matched the voice of the owner's account and wrote the
 * words, and the Wallet read them as the request. The Seams verifier on Cloudflare signed it.
 */
function receiptView(input: VerifierReceiptInput, proof: VerifierProof): PhraseReceipt {
  return {
    title: 'Verifier receipt',
    source: 'Seams verifier · Cloudflare',
    rows: [
      { label: 'Voice', value: `matched ${input.owner} (ReDimNet B1)` },
      {
        label: 'Words',
        value: input.note ? 'matched the summary' : 'matched the sentence',
      },
      { label: 'Speech to text', value: 'Whisper large-v3-turbo on Workers AI' },
      {
        label: 'Verdict',
        value: `signed by the Seams verifier${proof.verifier ? ` ${proof.verifier}` : ''}`,
      },
    ],
  };
}
