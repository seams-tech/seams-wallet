import {
  buildCapabilityOperationEnvelope,
  parseAuthorizedOperationId,
  parseAuthorizationAuditEventId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseCapabilityOperationRef,
  parsePrincipalId,
  parseTenantId,
  type AuthorizationParseResult,
} from '@shared/authorization';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { buildAuthorizedOperation } from '../../../packages/wallet-server/src/authorization/domain';

function parsed<T>(result: AuthorizationParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function buildClaimedSigningOperationFixture() {
  const tenantId = parsed(parseTenantId('tenant:completion-test'));
  const digest = parseDigestB64u('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE');
  return await buildAuthorizedOperation({
    tenantId,
    authorizedOperationId: parsed(parseAuthorizedOperationId('operation:completion-test')),
    auditEventId: parsed(parseAuthorizationAuditEventId('audit:completion-test')),
    claimedAtMs: 1000,
    operation: buildCapabilityOperationEnvelope({
      tenantId,
      principalId: parsed(parsePrincipalId('principal:completion-test')),
      capabilityId: parsed(parseCapabilityId('capability:completion-test')),
      operationId: parsed(parseCapabilityOperationId('intent:completion-test')),
      operation: parsed(
        parseCapabilityOperationRef({
          capabilityKind: 'evm_ecdsa_mpc_signing',
          operationKind: 'evm.sign_transaction',
        }),
      ),
      digests: { laneDigest: digest, intentDigest: digest, displayDigest: digest },
    }),
    authorization: { kind: 'verified_step_up', evidenceSetDigest: digest },
    quota: { kind: 'quota_neutral' },
  });
}
