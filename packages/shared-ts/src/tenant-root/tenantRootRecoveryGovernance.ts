import { base64UrlDecode, base64UrlEncode } from '../utils/base64';
import { alphabetizeStringify, sha256Bytes } from '../utils/digests';
import type { TenantRootRecipientPairV1, TenantRootRecoveryGovernanceV1 } from './tenantRootSecurityState';

/**
 * Digests over the recovery governance policy and the recipient pair.
 *
 * Both feed the operation record, so both are fixed encodings:
 *
 * - The governance digest is SHA-256 over the canonical RFC 8785 JSON of the
 *   governance object, matching `TenantRootRecoveryGovernanceV1::digest()` in
 *   `crates/router-ab-core`. A tenant that has not chosen a policy yet is
 *   represented by the fixed `not_configured` object below, so the first
 *   governance selection is itself an exact, digestable operation.
 * - The recipient-pair digest is SHA-256 over a domain string and the canonical
 *   JSON of the two fingerprints. It exists only in the console; the control
 *   plane treats it as opaque bytes.
 */

const TENANT_ROOT_RECIPIENT_PAIR_DOMAIN_V1 = 'seams/tenant-root-recipient-pair/v1';

/** The canonical bytes digested when no governance policy has been chosen. */
export const TENANT_ROOT_GOVERNANCE_NOT_CONFIGURED_CANONICAL_V1 = '{"kind":"not_configured"}';

/** Returns the canonical JSON the governance digest covers. */
export function canonicalTenantRootRecoveryGovernanceJsonV1(
  governance: TenantRootRecoveryGovernanceV1 | null,
): string {
  if (governance === null) return TENANT_ROOT_GOVERNANCE_NOT_CONFIGURED_CANONICAL_V1;
  return alphabetizeStringify(governance);
}

/** Returns the base64url SHA-256 digest of one governance policy, or of its absence. */
export async function tenantRootRecoveryGovernanceDigestB64uV1(
  governance: TenantRootRecoveryGovernanceV1 | null,
): Promise<string> {
  const canonical = new TextEncoder().encode(
    canonicalTenantRootRecoveryGovernanceJsonV1(governance),
  );
  return base64UrlEncode(await sha256Bytes(canonical));
}

/** Returns the base64url SHA-256 digest binding one exact Deriver A and B recipient pair. */
export async function tenantRootRecipientPairDigestB64uV1(
  pair: TenantRootRecipientPairV1,
): Promise<string> {
  // The fingerprints are already digests; decoding them refuses a pair whose
  // fingerprints are not canonical 32-byte values.
  const deriverA = base64UrlDecode(pair.deriverAFingerprintB64u);
  const deriverB = base64UrlDecode(pair.deriverBFingerprintB64u);
  if (deriverA.length !== 32 || deriverB.length !== 32) {
    throw new Error('recipient fingerprints must be 32-byte digests');
  }
  const canonical = new TextEncoder().encode(
    alphabetizeStringify({
      deriverAFingerprint: pair.deriverAFingerprintB64u,
      deriverBFingerprint: pair.deriverBFingerprintB64u,
    }),
  );
  const domain = new TextEncoder().encode(TENANT_ROOT_RECIPIENT_PAIR_DOMAIN_V1);
  const input = new Uint8Array(domain.length + canonical.length);
  input.set(domain, 0);
  input.set(canonical, domain.length);
  return base64UrlEncode(await sha256Bytes(input));
}

/**
 * Returns whether a governance transition needs a second owner.
 *
 * A transition uses the stronger quorum of the current and target branches:
 * selecting two-person governance takes two owners, and leaving it takes two
 * owners, so one owner can never downgrade a two-person tenant alone.
 */
export function tenantRootGovernanceTransitionRequiresSecondOwnerV1(
  current: TenantRootRecoveryGovernanceV1 | null,
  target: TenantRootRecoveryGovernanceV1,
): boolean {
  return current?.kind === 'two_person_v1' || target.kind === 'two_person_v1';
}
