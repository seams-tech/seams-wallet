// The refusals that both verdict libraries name in the same way: the key, the signature, the
// fields, the kind and the time. Each evidence kind maps its other refusals itself.

import type { EvidenceRefusal } from '../evidence';

const SHARED_REFUSALS: Readonly<Record<string, EvidenceRefusal>> = {
  bad_public_key: { code: 'signature_invalid', detail: 'verdict signature is invalid' },
  bad_signature_encoding: { code: 'signature_invalid', detail: 'verdict signature is invalid' },
  bad_signature: { code: 'signature_invalid', detail: 'verdict signature is invalid' },
  malformed: { code: 'invalid', detail: 'verdict fields are invalid' },
  wrong_kind: { code: 'invalid', detail: 'unknown verdict kind' },
  expired: { code: 'expired', detail: 'verdict expired or not yet valid' },
  not_yet_valid: { code: 'expired', detail: 'verdict expired or not yet valid' },
};

/**
 * The refusal of a code that both libraries share, or null. A code of neither list is no
 * approval, so the caller answers it with `invalid`.
 */
export function sharedRefusal(code: string): EvidenceRefusal | null {
  return Object.hasOwn(SHARED_REFUSALS, code) ? SHARED_REFUSALS[code] : null;
}
