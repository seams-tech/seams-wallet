// The Speak-to-Sign verifier backends. A lane names one backend; the Gateway, Wallet core and the
// co-signer reach it only through a port, and each backend is one module on each side. SaySo is
// the backend of the Wallet. OutLayer is a module that is off: a lane setting turns it on again.

export const SPEAK_TO_SIGN_BACKEND_IDS = ['sayso', 'outlayer'] as const;

export type SpeakToSignBackendId = (typeof SPEAK_TO_SIGN_BACKEND_IDS)[number];

export function isSpeakToSignBackendId(value: unknown): value is SpeakToSignBackendId {
  return SPEAK_TO_SIGN_BACKEND_IDS.some((id) => id === value);
}
