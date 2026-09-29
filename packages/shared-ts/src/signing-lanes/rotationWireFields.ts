// The field parsers that the rotation protocol's messages and its stored records share.
import { parseAuthorizedOperationId } from '../authorization/capabilityKinds';
import {
  hasWhitespaceOrControlCharacters,
  parseMpcMaterialActivationId,
  parseMpcMaterialActivationRef,
  parseWalletId,
  type MpcMaterialActivationRef,
} from '../utils/domainIds';
import { parseDigestB64u } from '../utils/canonicalPrimitives';
import {
  wireLabeled,
  wireLiteral,
  wireObject,
  wireResult,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
  type WireParser,
} from '../utils/wireSchema';
import {
  parseLaneEnrollmentId,
  parseLaneOperationId,
  parseLaneShareEpoch,
  parseLinkedDeviceEnrollmentId,
  parseSigningLaneId,
  parseWalletKeyId,
} from './ids';
import { parseLaneParticipantBindingDigestB64u } from './participants';
import type { SigningLaneKind } from './records';
import type { LaneOperationAuthorizationBindingV1 } from './rotation';

export function requiredString(raw: unknown, label: string): string {
  if (typeof raw !== 'string') throw new Error(`${label} must be a string`);
  const value = raw.trim();
  if (!value) throw new Error(`${label} is required`);
  if (hasWhitespaceOrControlCharacters(value)) {
    throw new Error(`${label} must not contain whitespace or control characters`);
  }
  return value;
}

export function requiredInteger(raw: unknown, label: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(raw);
}

export function parseLaneKind(raw: unknown, label: string): SigningLaneKind {
  switch (raw) {
    case 'owner_passkey':
    case 'owner_email_otp':
    case 'linked_device':
    case 'delegated_execution':
    case 'recovery':
    case 'break_glass':
      return raw;
    default:
      throw new Error(`${label} must be a known signing lane kind`);
  }
}

export const laneOperationId = /* @__PURE__ */ wireResult(parseLaneOperationId);
export const laneEnrollmentId = /* @__PURE__ */ wireResult(parseLaneEnrollmentId);
export const walletId = /* @__PURE__ */ wireResult(parseWalletId);
export const walletKeyId = /* @__PURE__ */ wireResult(parseWalletKeyId);
export const signingLaneId = /* @__PURE__ */ wireResult(parseSigningLaneId);
export const laneShareEpoch = /* @__PURE__ */ wireResult(parseLaneShareEpoch);
export const materialActivationId = /* @__PURE__ */ wireResult(parseMpcMaterialActivationId);
// Annotated so declarations name the activation type rather than spell out its class.
export const materialActivation: WireParser<MpcMaterialActivationRef> = /* @__PURE__ */ wireResult(
  parseMpcMaterialActivationRef,
);
export const laneParticipantBindingDigest = /* @__PURE__ */ wireResult(
  parseLaneParticipantBindingDigestB64u,
);
export const digest = /* @__PURE__ */ wireLabeled(parseDigestB64u);
// Most declared wire types carry their digests as plain strings.
export const digestString: WireParser<string> = digest;

const authorizedOperationId = /* @__PURE__ */ wireResult(parseAuthorizedOperationId);

function laneOperationAuthorizationBindingV1() {
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('linked_device_enrollment'),
      authorizedOperationId,
      linkedDeviceEnrollmentId: wireResult(parseLinkedDeviceEnrollmentId),
      linkedDevicePermissionDigestB64u: digestString,
    }),
    wireObject({
      kind: wireLiteral('owner_lane_refresh'),
      authorizedOperationId,
      ownerLaneRefreshDigestB64u: digestString,
    }),
  ]);
}

export function parseAuthorization(
  raw: unknown,
  label: string,
): LaneOperationAuthorizationBindingV1 {
  return laneOperationAuthorizationBindingV1()(raw, label);
}

// The schema parses exactly the declared wire type. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [ParsesExactly<typeof laneOperationAuthorizationBindingV1, LaneOperationAuthorizationBindingV1>]
>;
