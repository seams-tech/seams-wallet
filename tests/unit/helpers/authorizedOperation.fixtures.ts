import {
  buildCapabilityOperationEnvelope,
  parseAuthorizedOperationId,
  parseAuthFactorId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
  parseAuthorizationAuditEventId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parseCapabilityOperationRef,
  parsePrincipalId,
  parseTenantId,
  type AuthorizationParseResult,
} from '@shared/authorization';
import {
  buildPasskeyWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { parseWebAuthnCredentialIdB64u } from '@shared/utils/domainIds';
import {
  buildVerifiedWalletOperationPasskeyFactorResult,
  buildVerifiedWalletOperationFactorEvidenceSet,
  type VerifiedAuthorizationEvidenceSet,
} from '../../../packages/wallet-server/src/authorization/factorEvidence';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  type AuthorizedOperationInput,
  type WalletSessionAuthorizationV2,
  buildAuthorizedOperation,
  parseSessionOrigin,
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

export function buildAdditionalStepUpOperationInputFixture(input: {
  readonly admitted: AuthorizedOperationInput;
  readonly label: string;
  readonly nowMs: number;
}): AuthorizedOperationInput {
  const admitted = input.admitted;
  if (admitted.authorization.kind !== 'verified_step_up')
    throw new Error('Additional step-up fixture requires verified evidence');
  return {
    tenantId: admitted.tenantId,
    authorizedOperationId: parsed(parseAuthorizedOperationId(`operation:${input.label}`)),
    auditEventId: parsed(parseAuthorizationAuditEventId(`audit:${input.label}`)),
    claimedAtMs: input.nowMs,
    operation: buildCapabilityOperationEnvelope({
      tenantId: admitted.tenantId,
      principalId: admitted.operation.principalId,
      capabilityId: admitted.operation.capabilityId,
      operationId: parsed(parseCapabilityOperationId(`intent:${input.label}`)),
      operation: admitted.operation.operation,
      digests: admitted.operation.digests,
    }),
    authorization: admitted.authorization,
    quota: { kind: 'quota_neutral' },
  };
}

export async function buildStepUpSigningOperationFixture(input: {
  readonly session: WalletSessionAuthorizationV2;
  readonly label: string;
  readonly nowMs: number;
  readonly rpId: string;
  readonly credentialIdB64u: string;
}): Promise<{
  readonly operation: AuthorizedOperationInput;
  readonly evidence: VerifiedAuthorizationEvidenceSet;
}> {
  const ordinary = buildSessionSigningOperationInputFixture(input);
  const origin = parseSessionOrigin(`https://${input.rpId}`);
  const credentialId = parsed(parseWebAuthnCredentialIdB64u(input.credentialIdB64u));
  const factor = buildVerifiedWalletOperationPasskeyFactorResult({
    tenantId: input.session.tenantId,
    principalId: input.session.principalId,
    walletId: input.session.walletId,
    authorityRef: await walletAuthAuthorityRef({
      authority: buildPasskeyWalletAuthAuthority({
        walletId: input.session.walletId,
        rpId: input.rpId,
        credentialIdB64u: credentialId,
      }),
    }),
    requestOrigin: origin,
    audience: origin,
    factorId: parsed(parseAuthFactorId(`factor:${input.label}`)),
    operation: ordinary.operation,
    credentialIdB64u: credentialId,
    assertionDigest: parseDigestB64u('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'),
    verifiedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + 3_600_000,
  });
  const evidence = await buildVerifiedWalletOperationFactorEvidenceSet({
    operation: ordinary.operation,
    evidenceId: parsed(parseAuthorizationEvidenceId(`evidence:${input.label}`)),
    evidenceSetId: parsed(parseAuthorizationEvidenceSetId(`evidence-set:${input.label}`)),
    factor,
  });
  const operation: AuthorizedOperationInput = {
    tenantId: ordinary.tenantId,
    authorizedOperationId: ordinary.authorizedOperationId,
    auditEventId: ordinary.auditEventId,
    claimedAtMs: ordinary.claimedAtMs,
    operation: ordinary.operation,
    authorization: { kind: 'verified_step_up', evidenceSetDigest: evidence.evidenceSetDigest },
    quota: { kind: 'quota_neutral' },
  };
  return { operation, evidence };
}
