// The port between the Speak-to-Sign verify route and a verifier backend. The route checks the
// Wallet Session and the owner, and streams the result. A backend runs the
// verifier. Each backend is one module in `backends/`.

import {
  isSpeakToSignBackendId,
  SPEAK_TO_SIGN_BACKEND_IDS,
  type SpeakToSignBackendId,
} from '@shared/speakToSign/backend';
import type { NormalizedRouterLogger } from '../../framework/logger';

export type { SpeakToSignBackendId };

/**
 * The data of the last event of the verify stream: the verifier output, or a fixed code without
 * upstream text. `attestationUrl` is a public record of the call, or null. `transcriber` names the
 * speech-to-text service that ran. `timing` holds the backend's stage times in milliseconds.
 */
export type SpeakToSignBackendResult =
  | Readonly<{
      ok: true;
      output: unknown;
      attestationUrl: string | null;
      transcriber: string;
      timing: Readonly<Record<string, number>>;
    }>
  | Readonly<{ ok: false; code: string }>;

export type SpeakToSignBackendCall = Readonly<{
  /**
   * The verifier input of Wallet core, unchanged: a spoken request (`op: 'verify'`), an
   * enrollment (`op: 'enroll'`) or, on SaySo, the delete of the owner's voice template
   * (`op: 'delete'`). The route already checked that `owner` is the session account.
   */
  input: Readonly<Record<string, unknown>>;
  /** How the owner opened the Wallet Session: its auth method kind and when it was issued. */
  session: Readonly<{ authMethodKind: string; issuedAtMs: number }>;
  logger: NormalizedRouterLogger;
  /** When the route got the request, for the backend's `serverMs`. */
  startedAtMs: number;
}>;

export interface SpeakToSignBackend {
  readonly id: SpeakToSignBackendId;
  /** The `op` values of the verifier input that the backend serves. */
  readonly operations: ReadonlySet<string>;
  run(call: SpeakToSignBackendCall): Promise<SpeakToSignBackendResult>;
}

export const SPEAK_TO_SIGN_BACKEND_ENV = 'SPEAK_TO_SIGN_BACKEND';

/**
 * The backend that the lane names in `SPEAK_TO_SIGN_BACKEND`, or null when it names none. Another
 * value stops the server at start.
 */
export function readSpeakToSignBackendId(
  read: (name: typeof SPEAK_TO_SIGN_BACKEND_ENV) => string | undefined,
): SpeakToSignBackendId | null {
  const value = read(SPEAK_TO_SIGN_BACKEND_ENV)?.trim() || '';
  if (value === '') return null;
  if (!isSpeakToSignBackendId(value)) {
    throw new Error(
      `${SPEAK_TO_SIGN_BACKEND_ENV} must be one of ${SPEAK_TO_SIGN_BACKEND_IDS.join(', ')}`,
    );
  }
  return value;
}
