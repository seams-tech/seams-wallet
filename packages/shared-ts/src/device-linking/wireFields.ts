// The field parsers of the device-linking record modules. Not part of the package barrel.
import {
  parseDelegatedWalletAuthorityV1 as parseDelegatedWalletAuthorityResult,
  type DelegatedWalletAuthorityV1,
} from '../authorization/delegatedAuthority';
import {
  parseDeviceId as parseAuthorizationDeviceId,
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
} from '../authorization/capabilityKinds';
import {
  parseLinkedDeviceEnrollmentId,
  parseLinkedDeviceId,
  parseLinkDeviceSessionId,
  parseWalletKeyId,
} from '../signing-lanes/ids';
import {
  parseMpcMaterialActivationRef,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseVerifiedEmailAddress,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type MpcMaterialActivationRef,
  type VerifiedEmailAddress,
} from '../utils/domainIds';
import { parseDigestB64u } from '../utils/canonicalPrimitives';
import { parseUnixMs } from '../passkey-custody/primitives';
import { wireLabeled, wireNullable, wireResult, type WireParser } from '../utils/wireSchema';

export const sessionId = /* @__PURE__ */ wireResult(parseLinkDeviceSessionId);
export const walletId = /* @__PURE__ */ wireResult(parseWalletId);
export const enrollmentId = /* @__PURE__ */ wireResult(parseLinkedDeviceEnrollmentId);
export const linkedDeviceId = /* @__PURE__ */ wireResult(parseLinkedDeviceId);
export const authorizationDeviceId = /* @__PURE__ */ wireResult(parseAuthorizationDeviceId);
export const walletKeyId = /* @__PURE__ */ wireResult(parseWalletKeyId);
export const walletSessionId = /* @__PURE__ */ wireResult(parseWalletSessionId);
export const walletSessionAuthorizationId = /* @__PURE__ */ wireResult(
  parseWalletSessionAuthorizationId,
);
export const walletAuthMethodId = /* @__PURE__ */ wireResult(parseWalletAuthMethodId);
export const walletAuthorityId = /* @__PURE__ */ wireResult(parseWalletAuthorityId);
export const credentialId = /* @__PURE__ */ wireResult(parseWebAuthnCredentialIdB64u);
export const rpId = /* @__PURE__ */ wireResult(parseWebAuthnRpId);
export const quotaId = /* @__PURE__ */ wireResult(parseMpcWalletSigningQuotaId);
// Annotated so declarations name the activation type rather than spell out its class.
export const materialActivation: WireParser<MpcMaterialActivationRef> = /* @__PURE__ */ wireResult(
  parseMpcMaterialActivationRef,
);
export const digest = /* @__PURE__ */ wireLabeled(parseDigestB64u);
export const nullableToken = /* @__PURE__ */ wireNullable(parseNonEmptyToken);

// Some records name a bad field by its key alone rather than by its path.
export function keyLabeled<T>(parse: WireParser<T>): WireParser<T> {
  return (raw, label) => parse(raw, label.slice(label.lastIndexOf('.') + 1));
}

export function parseUnixTime(raw: unknown, label: string): number {
  try {
    return parseUnixMs(raw, label);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid`);
  }
}

export function parseNonEmptyToken(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.trim() !== raw) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  for (const character of raw) {
    const code = character.charCodeAt(0);
    if (/\s/.test(character) || code <= 31 || code === 127) {
      throw new Error(`${label} must not contain whitespace or control characters`);
    }
  }
  return raw;
}

export function parseNonNegativeSafeInteger(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(raw);
}

export function parseDelegatedWalletAuthority(
  raw: unknown,
  label: string,
): DelegatedWalletAuthorityV1 {
  const result = parseDelegatedWalletAuthorityResult(raw);
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.value;
}

export function parseTargetEmail(raw: unknown, label: string): VerifiedEmailAddress {
  const parsed = parseVerifiedEmailAddress(raw);
  if (!parsed.ok) throw new Error(`${label} ${parsed.error.message}`);
  return parsed.value;
}
