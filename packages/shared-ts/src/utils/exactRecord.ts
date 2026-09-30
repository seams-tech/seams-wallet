// Exact-shape checks for parsed records. Kept apart from validation.ts, which the wallet
// iframe's boot path loads, so only the parsers that check exact shapes load this.
import { requireRecord } from './validation';

// Substrings that mean an unexpected field is carrying plaintext custody
// material rather than a public binding. Allowed fields are matched first, so
// this only classifies fields that are already being rejected — it exists to
// report a leak as a leak instead of a generic schema mismatch.
const SECRET_BEARING_FIELD_SUBSTRINGS = [
  'prf',
  'kek',
  'seed',
  'scalar',
  'secretkey',
  'privatekey',
  'plaintext',
  'recoverycode',
  'clientroot',
  'holdershare',
] as const;

/**
 * Rejects every field outside this record's exact shape.
 *
 * `knownOnOtherBranches` names fields that are legitimate public bindings
 * somewhere else in the same union. Those are reported as the branch mismatch
 * they are; only genuinely unknown fields are classified as leaks, so a public
 * key like `clientRootPublicKey33B64u` on the wrong branch is never mistaken
 * for plaintext custody material.
 */
export function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  knownOnOtherBranches: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const knownSet = new Set(knownOnOtherBranches);
  for (const field of Object.keys(record)) {
    if (allowedSet.has(field)) continue;
    if (knownSet.has(field)) {
      throw new Error(`${label}.${field} is not part of ${label}`);
    }
    const normalized = field.toLowerCase().replace(/_/g, '');
    // A field that names itself a public key is not plaintext custody
    // material, whatever else its name contains. `clientRootPublicKey33B64u`
    // matches `clientroot` but is a published point; reporting it as a leak
    // would send a reader hunting a secret that was never there.
    const namesAPublicKey = normalized.includes('publickey');
    if (
      !namesAPublicKey &&
      SECRET_BEARING_FIELD_SUBSTRINGS.some((substring) => normalized.includes(substring))
    ) {
      throw new Error(`${label}.${field} must never carry plaintext custody material`);
    }
    throw new Error(`${label}.${field} is not part of ${label}`);
  }
}

// Requires exactly `fields`, each an own property that is not undefined. Unknown fields fail
// as rejectUnknownFields reports them.
export function exactRecord(
  raw: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requireRecord(raw, label);
  rejectUnknownFields(record, fields, label);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field) || record[field] === undefined) {
      throw new Error(`${label}.${field} is required`);
    }
  }
  return record;
}
