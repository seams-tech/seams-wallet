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
import {
  type AuthorizedOperationInput,
  type WalletSessionAuthorizationV2,
  buildAuthorizedOperation,
} from '../../../packages/wallet-server/src/authorization/domain';

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

export function buildSessionSigningOperationInputFixture(input: {
  readonly session: WalletSessionAuthorizationV2;
  readonly label: string;
  readonly nowMs: number;
}): AuthorizedOperationInput {
  const session = input.session;
  const digest = parseDigestB64u('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE');
  return {
    tenantId: session.tenantId,
    authorizedOperationId: parsed(parseAuthorizedOperationId(`operation:${input.label}`)),
    auditEventId: parsed(parseAuthorizationAuditEventId(`audit:${input.label}`)),
    claimedAtMs: input.nowMs,
    operation: buildCapabilityOperationEnvelope({
      tenantId: session.tenantId,
      principalId: session.principalId,
      capabilityId: sessionSigningCapability(session),
      operationId: parsed(parseCapabilityOperationId(`intent:${input.label}`)),
      operation: {
        capabilityKind: 'near_ed25519_mpc_signing',
        operationKind: 'near.sign_transaction',
      },
      digests: { laneDigest: digest, intentDigest: digest, displayDigest: digest },
    }),
    authorization: {
      kind: 'authorization_grant',
      authorizationGrantRef: {
        kind: 'wallet_session_authorization',
        authorizationId: session.authorizationId,
      },
    },
    quota: { kind: 'consume_reusable_wallet_session', quotaId: session.quotaId },
  };
}

function sessionSigningCapability(session: WalletSessionAuthorizationV2) {
  for (const subject of session.capabilitySubjects) {
    if (subject.kind === 'sign' && subject.keyFamily === 'ed25519')
      return parsed(parseCapabilityId(subject.materialActivation.capability));
  }
  throw new Error('Signing fixture requires an Ed25519 session capability');
}
