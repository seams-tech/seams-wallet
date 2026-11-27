// The voice verdict v2 (`seams_voice_signed_verdict_v2`) of the OutLayer verifier: the library
// that reads and checks it, the verdict key and audio key of each network, and its life. Wallet
// core and the Seams co-signer read the v2 format only through this module, so that another
// evidence kind is another module beside it (Refactor 254).

import { VERDICT_LIFE_MS } from '@seams/voice-verdict';
import type { SpeakToSignNetwork } from '../spokenRequest';

export {
  checkVerdict,
  parseVerdict,
  verdictMessage,
  type VerdictRefusal,
} from '@seams/voice-verdict';

/**
 * The verifier of each network: its OutLayer project, its project-bound verdict key and its
 * audio key. Both keys stay the same across verifier versions. They are pinned in code and never
 * come from the app, which supplies the Seams server URL: a verdict key from the app would let
 * the app supply its own verdicts, and an audio key from the app would let the app read the
 * recordings.
 *
 * `audioKey` is the X25519 public key (standard base64) that Wallet core seals each recording
 * to. The verifier's `audio_key` operation returns it with a signature of the verdict key.
 */
export type SpeakToSignVerifier = Readonly<{
  project: string;
  publicKey: string;
  audioKey: string;
}>;

export const SPEAK_TO_SIGN_VERIFIERS: Readonly<
  Record<SpeakToSignNetwork, SpeakToSignVerifier | null>
> = {
  testnet: {
    project: 'seams-v1.testnet/voice-verifier',
    publicKey: 'ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U',
    audioKey: 'swH9imlBy9lASO9868ouz/FUumuZIK9g/3R7QiFl7ig=',
  },
  mainnet: null,
};

/** The verifier signs a verdict with `expires_at_ms` 120 s after its own clock. */
export const VOICE_VERDICT_LIFE_MS = VERDICT_LIFE_MS;
