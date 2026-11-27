// The OutLayer backend of Wallet core: each recording sealed to the pinned audio key of the
// verifier, the owner's NEP-413 enrollment statement to the OutLayer project, and the card text
// and TEE receipt of a verifier that runs in Intel TDX on OutLayer.

import { sealAudio } from '@seams/voice-verdict';
import type { PhraseReceipt } from '@/core/authMethods/hostPlugin';
import { concat, sha256, utf8 } from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignVerifier } from '@shared/speakToSign/evidence/voiceVerdictV2';
import { base64Decode, base64Encode, base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import { parseVerifyOutput } from '../../voiceVerdict';
import type {
  EnrollmentStatement,
  SpeakToSignVerifierBackend,
  VerifierProof,
  VerifierReceiptInput,
} from '../backend';

const ENROLLMENT_DOMAIN = 'seams:voice-enrollment:v2';
const ENROLLMENT_MESSAGE_PREFIX = 'Speak-to-Sign voice enrollment ';

export const OUTLAYER_VERIFIER: SpeakToSignVerifierBackend = {
  id: 'outlayer',
  steps: {
    speaker: 'ReDimNet · Intel TDX CVM on Phala',
    words: 'Whisper large-v3 · NEAR AI Cloud',
    policy: 'JEV policy',
    verdict: 'Signed by the OutLayer TEE verifier',
  },
  /** OutLayer did not run the verifier in time. The cause is not the recording, so say so. */
  timeout: {
    headline: 'OutLayer timed out',
    caption: 'The OutLayer verifier did not answer in time.',
  },
  proof: (output, attestationUrl) => ({ verifier: verdictVersion(output), attestationUrl }),
  receipt: receiptView,
  prepareInput: withSealedAudio,
  enrollmentStatement: async (owner, clipDigests, verifier): Promise<EnrollmentStatement> => ({
    message: `${ENROLLMENT_MESSAGE_PREFIX}${await enrollmentDigest(owner, clipDigests)}`,
    recipient: verifier.project,
  }),
};

/**
 * The verifier input with its recordings sealed to the pinned audio key (`sealAudio` of
 * `@seams/voice-verdict`): `audio_sealed_b64` in place of `audio_wav_b64`, one clip or a list of
 * clips. An input with no recording goes as it
 * is. Null if a recording cannot be sealed, so that no recording leaves the device in the clear.
 */
async function withSealedAudio(
  verifier: SpeakToSignVerifier | null,
  verifierInput: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>> | null> {
  const { audio_wav_b64: plain, ...rest } = verifierInput;
  if (plain === undefined) return verifierInput;
  const { op, owner } = rest;
  const clips = Array.isArray(plain) ? plain : [plain];
  // The verify route serves only these two operations.
  if (!verifier || (op !== 'verify' && op !== 'enroll') || typeof owner !== 'string') return null;
  if (!clips.every((clip) => typeof clip === 'string')) return null;
  let sealed: string[];
  try {
    const audioKey = base64Decode(verifier.audioKey);
    sealed = await Promise.all(
      clips.map(async (clip) =>
        base64Encode(await sealAudio(audioKey, op, owner, base64Decode(clip))),
      ),
    );
  } catch {
    return null;
  }
  return { ...rest, audio_sealed_b64: Array.isArray(plain) ? sealed : sealed[0] };
}

/** base64url SHA-256(domain || owner || 0 || SHA-256 of each WAV, in order). */
export async function enrollmentDigest(
  owner: string,
  clipDigests: readonly Uint8Array<ArrayBuffer>[],
): Promise<string> {
  const preimage = concat([
    utf8(ENROLLMENT_DOMAIN),
    utf8(owner),
    new Uint8Array(1),
    ...clipDigests,
  ]);
  return base64UrlEncode(await sha256(preimage));
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
function receiptView(input: VerifierReceiptInput, proof: VerifierProof): PhraseReceipt {
  const rows = [
    { label: 'Voice', value: `matched ${input.owner}` },
    {
      label: 'Words',
      value: input.note ? 'matched the summary' : 'matched the sentence',
    },
    ...(input.note && checksSummary(proof.verifier)
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
