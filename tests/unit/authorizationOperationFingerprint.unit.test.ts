import { expect, test } from '@playwright/test';
import {
  VAULT_OPERATION_KINDS,
  buildCapabilityOperationEnvelope,
  buildVaultOperationRef,
  canonicalCapabilityOperationFingerprintPreimageV1,
  computeCapabilityOperationFingerprintDigest,
  parseCapabilityId,
  parseCapabilityOperationId,
  parsePrincipalId,
  parseSigningOperationFingerprintDigest,
  parseTenantId,
  type AuthorizationParseResult,
} from '@shared/authorization';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';

const LANE_DIGEST = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const INTENT_DIGEST = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const DISPLAY_DIGEST = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM';

function requireParsed<T>(result: AuthorizationParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function buildVaultEnvelope() {
  return buildCapabilityOperationEnvelope({
    tenantId: requireParsed(parseTenantId('tenant-1')),
    principalId: requireParsed(parsePrincipalId('principal-1')),
    capabilityId: requireParsed(parseCapabilityId('capability-1')),
    operationId: requireParsed(parseCapabilityOperationId('operation-1')),
    operation: buildVaultOperationRef(VAULT_OPERATION_KINDS.proxyUse),
    digests: {
      laneDigest: parseDigestB64u(LANE_DIGEST),
      intentDigest: parseDigestB64u(INTENT_DIGEST),
      displayDigest: parseDigestB64u(DISPLAY_DIGEST),
    },
  });
}

test('authorization operation fingerprint pins its versioned canonical preimage and digest', async () => {
  const envelope = buildVaultEnvelope();
  expect(canonicalCapabilityOperationFingerprintPreimageV1(envelope)).toBe(
    'seams:authorization:capability-operation-fingerprint:v1|{"capabilityId":"capability-1","digests":{"displayDigest":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM","intentDigest":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI","laneDigest":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"},"operation":{"capabilityKind":"vault_access","operationKind":"vault.proxy_use"},"operationId":"operation-1","principalId":"principal-1","tenantId":"tenant-1"}',
  );
  await expect(computeCapabilityOperationFingerprintDigest(envelope)).resolves.toBe(
    'ZqxwnrLiD1RH6R5AHq40vEVA3VnsjGH2A0oRHh4NL2Y',
  );
});

test('signing operation fingerprint exposes one canonical lane digest', () => {
  expect(parseSigningOperationFingerprintDigest(`sha256:${LANE_DIGEST}`)).toBe(LANE_DIGEST);
  expect(() => parseSigningOperationFingerprintDigest(LANE_DIGEST)).toThrow(
    'signing operation fingerprint must use the sha256: prefix',
  );
  expect(() => parseSigningOperationFingerprintDigest('sha256:not-a-digest')).toThrow(
    'digest must be canonical base64url for 32 bytes',
  );
});
