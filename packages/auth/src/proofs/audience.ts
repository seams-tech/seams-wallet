import { base64UrlEncode } from '@shared/utils/base64';
import { sha256BytesUtf8 } from '@shared/utils/digests';

// A proof names one audience: the server that issued the challenge and that checks the proof.
// To auth the name is only text. The name is in the bytes that the factor signs, so the server
// of each other audience refuses the proof.

/** The audience of a sign-in. The Auth Worker issues its challenge and checks its proof. */
export const LOGIN_AUDIENCE = 'login';

const AUDIENCE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_.:~-]{16,512}$/;

export function parseAudience(value: unknown): string | null {
  return typeof value === 'string' && AUDIENCE_PATTERN.test(value) ? value : null;
}

/** A challenge is text of the audience's server. It has no line break, so it cannot name another audience. */
export function parseChallenge(value: unknown): string | null {
  return typeof value === 'string' && CHALLENGE_PATTERN.test(value) ? value : null;
}

const WEBAUTHN_CHALLENGE_DOMAIN = 'seams:auth:webauthn:v1';

/**
 * The WebAuthn challenge of a proof. The browser and the server both derive it from the
 * audience name and the challenge of the audience's server.
 */
export async function webauthnChallengeB64u(audience: string, challenge: string): Promise<string> {
  return base64UrlEncode(
    await sha256BytesUtf8(`${WEBAUTHN_CHALLENGE_DOMAIN}\n${audience}\n${challenge}`),
  );
}
