import assert from 'node:assert/strict';
import {
  buildCapabilityOperationEnvelope,
  buildNearMlDsa65MpcOperationRef,
  buildNearEd25519MpcOperationRef,
  parseAuthFactorId,
  parseAuthorizationAuditEventId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
  parseAuthorizedOperationId,
  parseCapabilityOperationId,
  parsePrincipalId,
  type CapabilityOperationRef,
} from '../../packages/shared-ts/src/authorization';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import { parseDigestB64u } from '../../packages/shared-ts/src/utils/canonicalPrimitives';
import { requireRecord } from '../../packages/shared-ts/src/utils/validation';
import {
  requireBytes,
  requireBytes32,
} from '../../packages/shared-ts/src/utils/routerAbEd25519YaoDigests';
import { requireParsed } from '../../packages/shared-ts/src/passkey-custody/primitives';
import {
  buildPasskeyWalletAuthAuthority,
  walletAuthAuthorityRef,
} from '../../packages/shared-ts/src/utils/walletAuthAuthority';
import {
  buildVerifiedOwnerProof,
  buildVerifiedWalletOperationFactorEvidenceSet,
  buildVerifiedWalletOperationPasskeyFactorResult,
} from '../../packages/wallet-server/src/authorization/factorEvidence';
import {
  buildAuthorizedOperation,
  parseSessionOrigin,
  parseVerifiedOwnerProofId,
} from '../../packages/wallet-server/src/authorization/domain';
import {
  MlDsaSigningTarget,
  MlDsaTransactionIntent,
  mlDsaOwnerOperationDigests,
  prepareMlDsaOwnerOperation,
} from '../../packages/wallet-server/src/router/domains/signingOperations/mlDsaOwnerAdmission';
export { dispatchMlDsaOwnerOperation } from '../../packages/wallet-server/src/router/transport/fetch/routes/mlDsaSigning';

type Fixture = {
  readonly input: Parameters<typeof prepareMlDsaOwnerOperation>[0];
  readonly admitted: Awaited<ReturnType<typeof prepareMlDsaOwnerOperation>>;
};

/** Synthetic verified factor input. This harness does not replace the WebAuthn verifier. */
export async function mlDsaOwnerFixture(
  record: unknown,
  transactionHash: Uint8Array,
  label: string,
): Promise<Fixture> {
  const role = requireRecord(record, 'role fixture');
  const activation = requireRecord(role.activation, 'activation fixture');
  const key = requireRecord(activation.key, 'key fixture');
  const wallet = requireRecord(key.wallet, 'wallet fixture');
  const authority = buildPasskeyWalletAuthAuthority({
    walletId: wallet.wallet,
    rpId: 'wallet.test',
    credentialIdB64u: base64UrlEncode(new Uint8Array(32).fill(7)),
  });
  const target = MlDsaSigningTarget.parse({
    tenantId: 'tenant:ml-dsa',
    identity: {
      walletId: wallet.wallet,
      ownershipGeneration: 1,
      orgId: wallet.org,
      projectId: wallet.project,
      envId: wallet.environment,
    },
    capabilityId: 'capability:ml-dsa-owner',
    key: {
      kind: 'wallet_key_record_v1',
      keyFamily: 'ml_dsa_65',
      walletId: wallet.wallet,
      walletKeyId: 'wallet-key:ml-dsa',
      walletKeyVersion: 'version:1',
      mlDsaSigningKeyId: key.key_id,
      registeredPublicKeyB64u: base64UrlEncode(
        new Uint8Array(requireBytes(role.public_key, 'public key', 1952, 1952)),
      ),
      materialEpoch: key.epoch,
      keyManifestDigestB64u: base64UrlEncode(
        new Uint8Array(requireBytes32(activation.manifest_digest, 'manifest', true)),
      ),
      lifecycle: { state: 'active', activatedAtMs: 1 },
    },
    scheduleDigest: base64UrlEncode(
      new Uint8Array(requireBytes32(key.schedule_digest, 'schedule', true)),
    ),
    authority: await walletAuthAuthorityRef({ authority }),
  });
  const intent = MlDsaTransactionIntent.parse({
    transactionHash: base64UrlEncode(transactionHash),
  });
  return authorizeFixture(
    target,
    intent,
    label,
    buildNearMlDsa65MpcOperationRef('near.sign_transaction'),
  );
}

async function authorizeFixture(
  target: MlDsaSigningTarget,
  intent: MlDsaTransactionIntent,
  label: string,
  operationRef: CapabilityOperationRef,
): Promise<Fixture> {
  const nowMs = Date.now();
  const displayDigest = parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(19)));
  const envelope = buildCapabilityOperationEnvelope({
    tenantId: target.tenantId,
    principalId: requireParsed(parsePrincipalId('principal:ml-dsa-owner'), 'principal'),
    capabilityId: target.capabilityId,
    operationId: requireParsed(parseCapabilityOperationId(`operation:${label}`), 'operation id'),
    operation: operationRef,
    digests: await mlDsaOwnerOperationDigests(target, intent, displayDigest),
  });
  const authority = buildPasskeyWalletAuthAuthority({
    walletId: target.key.walletId,
    rpId: 'wallet.test',
    credentialIdB64u: base64UrlEncode(new Uint8Array(32).fill(7)),
  });
  const origin = parseSessionOrigin('https://wallet.test');
  const factor = buildVerifiedWalletOperationPasskeyFactorResult({
    tenantId: target.tenantId,
    principalId: envelope.principalId,
    walletId: target.key.walletId,
    authorityRef: target.authority,
    requestOrigin: origin,
    audience: origin,
    factorId: requireParsed(parseAuthFactorId(`factor:${label}`), 'factor'),
    operation: envelope,
    credentialIdB64u: authority.factor.credentialIdB64u,
    assertionDigest: displayDigest,
    verifiedAtMs: nowMs,
    expiresAtMs: nowMs + 300_000,
  });
  const evidence = await buildVerifiedWalletOperationFactorEvidenceSet({
    operation: envelope,
    evidenceId: requireParsed(parseAuthorizationEvidenceId(`evidence:${label}`), 'evidence'),
    evidenceSetId: requireParsed(parseAuthorizationEvidenceSetId(`set:${label}`), 'evidence set'),
    factor,
  });
  const ownerProof = await buildVerifiedOwnerProof({
    purpose: 'operation',
    proofId: parseVerifiedOwnerProofId(`proof:${label}`),
    factor,
  });
  const operation = await buildAuthorizedOperation({
    tenantId: target.tenantId,
    authorizedOperationId: requireParsed(parseAuthorizedOperationId(`claim:${label}`), 'claim'),
    auditEventId: requireParsed(parseAuthorizationAuditEventId(`audit:${label}`), 'audit'),
    claimedAtMs: nowMs,
    operation: envelope,
    authorization: { kind: 'verified_step_up', evidenceSetDigest: evidence.evidenceSetDigest },
    quota: { kind: 'quota_neutral' },
  });
  const input = {
    target,
    intent,
    operation,
    evidence,
    ownerProof,
    nowMs,
    requestOrigin: origin,
    audience: origin,
  };
  const admitted = await prepareMlDsaOwnerOperation(input);
  return { input, admitted };
}

export async function verifyMlDsaAdmissionRefusals(fixture: Fixture) {
  const input = fixture.input;
  assert.equal(fixture.admitted.kind, 'prepared');
  const checked: string[] = [];
  const raw = JSON.parse(JSON.stringify(input.target));
  for (const field of ['orgId', 'projectId', 'envId', 'ownershipGeneration']) {
    const changed = structuredClone(raw);
    changed.identity[field] = field === 'ownershipGeneration' ? 2 : 'changed';
    const result = await prepareMlDsaOwnerOperation({
      target: MlDsaSigningTarget.parse(changed),
      intent: input.intent,
      operation: input.operation,
      evidence: input.evidence,
      ownerProof: input.ownerProof,
      nowMs: input.nowMs,
      requestOrigin: input.requestOrigin,
      audience: input.audience,
    });
    assert.equal(result.kind, 'refused');
    checked.push(field);
  }
  for (const field of [
    'materialEpoch',
    'walletKeyVersion',
    'mlDsaSigningKeyId',
    'registeredPublicKeyB64u',
    'keyManifestDigestB64u',
  ]) {
    const changed = structuredClone(raw);
    if (field === 'materialEpoch') changed.key[field] = 2;
    else if (field === 'registeredPublicKeyB64u')
      changed.key[field] = base64UrlEncode(new Uint8Array(1952).fill(9));
    else if (field === 'keyManifestDigestB64u')
      changed.key[field] = base64UrlEncode(new Uint8Array(32).fill(9));
    else changed.key[field] = 'changed';
    const result = await prepareMlDsaOwnerOperation({
      target: MlDsaSigningTarget.parse(changed),
      intent: input.intent,
      operation: input.operation,
      evidence: input.evidence,
      ownerProof: input.ownerProof,
      nowMs: input.nowMs,
      requestOrigin: input.requestOrigin,
      audience: input.audience,
    });
    assert.equal(result.kind, 'refused');
    checked.push(field);
  }
  const retired = structuredClone(raw);
  retired.key.lifecycle = { state: 'retired', retiredAtMs: input.nowMs };
  assert.equal(
    (
      await prepareMlDsaOwnerOperation({
        target: MlDsaSigningTarget.parse(retired),
        intent: input.intent,
        operation: input.operation,
        evidence: input.evidence,
        ownerProof: input.ownerProof,
        nowMs: input.nowMs,
        requestOrigin: input.requestOrigin,
        audience: input.audience,
      })
    ).kind,
    'refused',
  );
  checked.push('inactiveKey');
  assert.equal(
    (
      await prepareMlDsaOwnerOperation({
        target: input.target,
        intent: input.intent,
        operation: input.operation,
        evidence: input.evidence,
        ownerProof: input.ownerProof,
        nowMs: input.nowMs,
        requestOrigin: parseSessionOrigin('https://other.test'),
        audience: input.audience,
      })
    ).kind,
    'refused',
  );
  checked.push('origin');
  const changedIntent = MlDsaTransactionIntent.parse({
    transactionHash: base64UrlEncode(new Uint8Array(32).fill(3)),
  });
  assert.equal(
    (
      await prepareMlDsaOwnerOperation({
        target: input.target,
        intent: changedIntent,
        operation: input.operation,
        evidence: input.evidence,
        ownerProof: input.ownerProof,
        nowMs: input.nowMs,
        requestOrigin: input.requestOrigin,
        audience: input.audience,
      })
    ).kind,
    'refused',
  );
  checked.push('transactionHash');
  assert.equal(
    (
      await prepareMlDsaOwnerOperation({
        target: input.target,
        intent: input.intent,
        operation: input.operation,
        evidence: input.evidence,
        ownerProof: input.ownerProof,
        nowMs: input.evidence.expiresAtMs,
        requestOrigin: input.requestOrigin,
        audience: input.audience,
      })
    ).kind,
    'refused',
  );
  checked.push('expiredEvidence');
  const wrongFamily = await authorizeFixture(
    input.target,
    input.intent,
    'wrong-family',
    buildNearEd25519MpcOperationRef('near.sign_transaction'),
  );
  assert.equal(wrongFamily.admitted.kind, 'refused');
  checked.push('wrongAlgorithm');
  const exportIntent = await authorizeFixture(
    input.target,
    input.intent,
    'export',
    buildNearMlDsa65MpcOperationRef('near.export_key'),
  );
  assert.equal(exportIntent.admitted.kind, 'refused');
  checked.push('exportIsNotSigning');
  const changedEnvelope = buildCapabilityOperationEnvelope({
    tenantId: input.operation.tenantId,
    principalId: input.operation.operation.principalId,
    capabilityId: input.operation.operation.capabilityId,
    operationId: requireParsed(parseCapabilityOperationId('changed-operation'), 'operation'),
    operation: input.operation.operation.operation,
    digests: input.operation.operation.digests,
  });
  const retargeted = await buildAuthorizedOperation({
    tenantId: input.operation.tenantId,
    authorizedOperationId: input.operation.authorizedOperationId,
    auditEventId: input.operation.auditEventId,
    claimedAtMs: input.operation.claimedAtMs,
    operation: changedEnvelope,
    authorization: {
      kind: 'verified_step_up',
      evidenceSetDigest: input.evidence.evidenceSetDigest,
    },
    quota: { kind: 'quota_neutral' },
  });
  assert.equal(
    (
      await prepareMlDsaOwnerOperation({
        target: input.target,
        intent: input.intent,
        operation: retargeted,
        evidence: input.evidence,
        ownerProof: input.ownerProof,
        nowMs: input.nowMs,
        requestOrigin: input.requestOrigin,
        audience: input.audience,
      })
    ).kind,
    'refused',
  );
  checked.push('proofOperationId');
  const alias = await buildAuthorizedOperation({
    tenantId: input.operation.tenantId,
    authorizedOperationId: requireParsed(parseAuthorizedOperationId('alternate-claim'), 'claim'),
    auditEventId: input.operation.auditEventId,
    claimedAtMs: input.operation.claimedAtMs,
    operation: input.operation.operation,
    authorization: {
      kind: 'verified_step_up',
      evidenceSetDigest: input.evidence.evidenceSetDigest,
    },
    quota: { kind: 'quota_neutral' },
  });
  const retried = await prepareMlDsaOwnerOperation({
    target: input.target,
    intent: input.intent,
    operation: alias,
    evidence: input.evidence,
    ownerProof: input.ownerProof,
    nowMs: input.nowMs,
    requestOrigin: input.requestOrigin,
    audience: input.audience,
  });
  assert.equal(retried.kind, 'prepared');
  if (retried.kind === 'prepared' && fixture.admitted.kind === 'prepared')
    assert.equal(retried.operation.encode(), fixture.admitted.operation.encode());
  return { refusedChanges: checked, claimAliasPreservesOperationId: true };
}
