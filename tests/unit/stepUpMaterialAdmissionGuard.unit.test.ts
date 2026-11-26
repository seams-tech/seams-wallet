import { expect, test } from '@playwright/test';
import { EcdsaMaterialReadSnapshot } from '../../packages/mpc-wallet-server/src/core/ecdsaMaterialReadSnapshot';
import { prepareAuthorizedOperationInsert } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/authorization/authorizedOperationStatements';

const SCOPE = { namespace: 'test', orgId: 'org-1', projectId: 'project-1', envId: 'env-1' };
const WALLET_ID = 'wallet-1';
const SIGNER_RECORD = '{"walletKey":{"keyHandle":"key-1"}}';

/** Captures the SQL and the bindings of the one statement that the builder prepares. */
function capturingDatabase() {
  const captured: { sql: string; bindings: readonly unknown[] }[] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          captured.push({ sql, bindings });
          return {};
        },
      };
    },
  };
  return { database, captured };
}

function stepUpOperation() {
  return {
    tenantId: 'org-1',
    authorizedOperationId: 'ecdsa-step-up-authorized-operation:op-1',
    auditEventId: 'ecdsa-operation-audit:op-1',
    operationFingerprintDigest: 'fingerprint',
    claimedAtMs: 1_900_000_000_000,
    authorization: { kind: 'verified_step_up', evidenceSetDigest: 'evidence-digest' },
    quota: { kind: 'quota_neutral' },
    operation: {
      principalId: 'principal-1',
      capabilityId: 'capability-1',
      operationId: 'op-1',
      operation: { capabilityKind: 'evm_ecdsa_mpc_signing', operationKind: 'evm.sign_transaction' },
      digests: { laneDigest: 'lane', intentDigest: 'intent', displayDigest: 'display' },
    },
  } as never;
}

function material(readSnapshot?: EcdsaMaterialReadSnapshot) {
  return {
    walletId: WALLET_ID,
    keyHandle: 'key-1',
    runtimePolicyScope: { orgId: 'org-1' },
    materialActivation: {
      kind: 'mpc_material_activation_ref_v1',
      activation_id: 'activation-1',
      capability: 'capability-1',
      material_owner: WALLET_ID,
      key_binding: 'key-binding',
      lifecycle_binding: 'lifecycle-binding',
      signing_worker: 'worker-1',
    },
    ...(readSnapshot ? { readSnapshot } : {}),
  } as never;
}

test('a step-up admission with a material read is conditional on the signer rows it read', () => {
  const { database, captured } = capturingDatabase();
  const snapshot = EcdsaMaterialReadSnapshot.canonical(SCOPE as never, WALLET_ID as never, 'activation-1', [
    { record_json: SIGNER_RECORD },
  ]);
  prepareAuthorizedOperationInsert({
    database: database as never,
    namespace: 'test',
    walletSignerScope: SCOPE as never,
    operation: stepUpOperation(),
    material: material(snapshot),
    existingOperation: 'preserve',
  });
  expect(captured).toHaveLength(1);
  expect(captured[0]?.sql).toContain('FROM wallet_signers');
  expect(captured[0]?.bindings).toContain(JSON.stringify([[SIGNER_RECORD]]));
});

test('a material with no read adds no signer-row condition', () => {
  const { database, captured } = capturingDatabase();
  prepareAuthorizedOperationInsert({
    database: database as never,
    namespace: 'test',
    walletSignerScope: SCOPE as never,
    operation: stepUpOperation(),
    material: material(),
    existingOperation: 'preserve',
  });
  expect(captured[0]?.sql).not.toContain('FROM wallet_signers');
});
