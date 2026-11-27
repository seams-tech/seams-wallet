// The Speak-to-Sign verifier backends (Refactor 254). A lane names one backend; the Gateway, Wallet
// core and the co-signer reach it only through a port, and each backend is one module on each
// side. OutLayer is the only backend that is built. SaySo comes in Slice 4.

export const SPEAK_TO_SIGN_BACKEND_IDS = ['outlayer'] as const;

export type SpeakToSignBackendId = (typeof SPEAK_TO_SIGN_BACKEND_IDS)[number];

export function isSpeakToSignBackendId(value: unknown): value is SpeakToSignBackendId {
  return SPEAK_TO_SIGN_BACKEND_IDS.some((id) => id === value);
}
