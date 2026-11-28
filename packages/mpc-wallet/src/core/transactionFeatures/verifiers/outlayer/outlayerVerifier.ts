// The OutLayer backend of Wallet core: the verifier's own request form, each recording sealed to
// the pinned audio key of the verifier, the owner's NEP-413 enrollment statement to the OutLayer
// project, and the card text and TEE receipt of a verifier that runs in Intel TDX on OutLayer.

import { sealAudio } from '@seams/voice-verdict';
import type { PhraseReceipt } from '@/core/authMethods/hostPlugin';
import { concat, sha256, utf8, type SpeakToSignNetwork } from '@shared/speakToSign/spokenRequest';
import { SPEAK_TO_SIGN_VERIFIERS } from '@shared/speakToSign/evidence/voiceVerdictV2';
import { base64Decode, base64Encode, base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import { intentVerifyRequest } from '../../spokenIntent';
import type { VerifyOutput } from '../../voiceVerdict';
import type { SpeakToSignVerifierBackend, VerifierProof, VerifierReceiptInput } from '../backend';

const ENROLLMENT_DOMAIN = 'seams:voice-enrollment:v2';
const ENROLLMENT_MESSAGE_PREFIX = 'Speak-to-Sign voice enrollment ';
const VERIFY_OUTPUT_KIND = 'seams_voice_verify_output_v2';

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
  enrollmentKind: 'seams_voice_enrollment_v3',
  parseOutput: parseOutLayerOutput,
  proof: (output, attestationUrl) => ({ verifier: verdictVersion(output), attestationUrl }),
  receipt: receiptView,
  // The verifier parses the request itself and matches the receiver against the contacts.
  verifyInput: async ({ owner, intent }) => ({
    kind: 'ready',
    input: { op: 'verify', owner, request: await intentVerifyRequest(intent), contacts: [] },
  }),
  prepareInput: (network, verifierInput) =>
    withSealedAudio(SPEAK_TO_SIGN_VERIFIERS[network], verifierInput),
  // The verifier checks a NEP-413 message of a full-access key of the owner's account.
  authorizeEnrollment: async ({ owner, network, clipDigests, signMessage }) => {
    const verifier = SPEAK_TO_SIGN_VERIFIERS[network];
    if (!verifier) return { kind: 'not_signed', error: 'This network has no verifier.' };
    const signed = await signMessage({
      message: `${ENROLLMENT_MESSAGE_PREFIX}${await enrollmentDigest(owner, clipDigests)}`,
      recipient: verifier.project,
    });
    if (!signed.success) return { kind: 'not_signed', error: signed.error };
    return {
      kind: 'signed',
      authorization: {
        public_key: signed.publicKey,
        signature_b64: signed.signature,
        nonce_b64: signed.nonce,
      },
    };
  },
  // The templates are in OutLayer storage, which the Wallet cannot reach.
  templateDeleteInput: () => null,
};

/** The v2 verify output that the Seams verify route passes through unchanged. */
export function parseOutLayerOutput(value: unknown): VerifyOutput | null {
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
    publicKey: typeof value.public_key === 'string' ? value.public_key : null,
    policyText: typeof value.policy_text === 'string' ? value.policy_text.slice(0, 200) : null,
    ms: isPlainObject(value.ms) ? value.ms : {},
  };
}

/**
 * The verifier input with its recordings sealed to the pinned audio key (`sealAudio` of
 * `@seams/voice-verdict`): `audio_sealed_b64` in place of `audio_wav_b64`, one clip or a list of
 * clips. An input with no recording goes as it
 * is. Null if a recording cannot be sealed, so that no recording leaves the device in the clear.
 */
async function withSealedAudio(
  verifier: (typeof SPEAK_TO_SIGN_VERIFIERS)[SpeakToSignNetwork],
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
  const parsed = parseOutLayerOutput(output);
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
