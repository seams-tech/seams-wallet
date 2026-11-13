// The public OutLayer record of one verifier call, with its TDX quote.

/**
 * The URL of the OutLayer attestation record of a call: an HTTPS URL whose path ends in
 * `/attestations/by-call/<call id>`. Null for any other value.
 */
export function readAttestationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const record = /^\/(?:.*\/)?attestations\/by-call\/[0-9a-f-]{1,64}$/;
    return url.protocol === 'https:' && record.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}
