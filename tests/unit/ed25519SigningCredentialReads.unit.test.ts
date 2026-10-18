import { expect, test } from '@playwright/test';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { walletIdFromString } from '@shared/utils/registrationIds';
import { Ed25519SignerRead } from '../../packages/wallet-server/src/core/d1Ed25519SignerRead';
import { D1Ed25519AdmissionPolicyRead } from '../../packages/wallet-server/src/router/cloudflare/d1/signingAdmission/d1RouterAbNormalSigningAdmissionStore';
import type { RouterAbNormalSigningAdmissionInput } from '../../packages/wallet-server/src/router/domains/signingOperations/routerAbNormalSigningAdmission';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';

const WALLET = 'wallet:credential-reads';
const AUTHORITY = 'authority:credential-reads';
const SCOPE = { orgId: 'org', projectId: 'project', envId: 'env', signingRootVersion: 'v1' };

/** A snapshot holds its rows. Asking it must never reach the database. */
function unreadDatabase(): D1DatabaseLike {
  const unexpected = (): never => {
    throw new Error('A credential snapshot must not query the database');
  };
  return { prepare: unexpected, batch: unexpected, exec: unexpected };
}

function admissionInput(
  overrides: Partial<{ walletId: string; authorityId: string; envId: string }> = {},
): Extract<
  RouterAbNormalSigningAdmissionInput,
  { readonly curve: 'ed25519'; readonly authorityKind: 'wallet_authority_v1' }
> {
  return {
    curve: 'ed25519',
    policyReadSource: { kind: 'database' },
    authorityKind: 'wallet_authority_v1',
    authorityId: overrides.authorityId ?? AUTHORITY,
    phase: 'prepare',
    walletId: overrides.walletId ?? WALLET,
    thresholdSessionId: 'threshold:credential-reads',
    walletSessionId: 'session:credential-reads',
    quotaId: 'quota:credential-reads',
    requestId: 'request:credential-reads',
    expiresAtMs: Date.now() + 60_000,
    signingWorkerId: 'worker:credential-reads',
    runtimePolicyScope: { ...SCOPE, envId: overrides.envId ?? SCOPE.envId },
  };
}

function policyRow(decisions: Record<string, unknown> = {}) {
  return {
    scope_json: JSON.stringify(SCOPE),
    project_key: null,
    project_decision: null,
    project_retry_after_ms: null,
    abuse_key: null,
    abuse_decision: null,
    abuse_retry_after_ms: null,
    ...decisions,
  };
}

test('an Ed25519 policy snapshot answers for its own store, wallet and scope only', () => {
  const database = unreadDatabase();
  const read = (rows: unknown) =>
    D1Ed25519AdmissionPolicyRead.fromRows(database, 'namespace', WALLET, AUTHORITY, rows);

  expect(read([policyRow()]).resolve(database, 'namespace', admissionInput())).toEqual({
    kind: 'allowed',
  });

  // The caller reads the database when the snapshot cannot answer.
  const snapshot = read([policyRow()]);
  expect(snapshot.resolve(unreadDatabase(), 'namespace', admissionInput())).toBeNull();
  expect(snapshot.resolve(database, 'other-namespace', admissionInput())).toBeNull();
  expect(
    snapshot.resolve(database, 'namespace', admissionInput({ envId: 'other-env' })),
  ).toBeNull();
  expect(read([]).resolve(database, 'namespace', admissionInput())).toBeNull();

  // A snapshot is never applied to another wallet or authority.
  expect(() =>
    snapshot.resolve(database, 'namespace', admissionInput({ walletId: 'wallet:other' })),
  ).toThrow('Ed25519 policy credential scope does not match');
  expect(() =>
    snapshot.resolve(database, 'namespace', admissionInput({ authorityId: 'authority:other' })),
  ).toThrow('Ed25519 policy credential scope does not match');

  // An unreadable decision fails closed.
  expect(() =>
    read([policyRow({ abuse_key: 'abuse', abuse_decision: 'unknown' })]).resolve(
      database,
      'namespace',
      admissionInput(),
    ),
  ).toThrow('Unsupported Router A/B abuse decision unknown');
  expect(() => read([policyRow(), policyRow()])).toThrow('Ed25519 policy scope is ambiguous');
});

test('an Ed25519 signer read answers only for the wallet and activation it selected', () => {
  const walletId = walletIdFromString(WALLET);
  const activation = routerAbMpcMaterialActivationRefToWire(
    buildMpcMaterialActivationRefFixture('credential-reads', WALLET),
  );
  const other = routerAbMpcMaterialActivationRefToWire(
    buildMpcMaterialActivationRefFixture('credential-reads-other', WALLET),
  );

  const empty = Ed25519SignerRead.fromRows(walletId, activation, []);
  expect(empty.resolve(walletId, activation)).toBeNull();
  // Rows that do not parse as this wallet's signer select nothing.
  expect(
    Ed25519SignerRead.fromRows(walletId, activation, [{ record_json: '{}' }]).resolve(
      walletId,
      activation,
    ),
  ).toBeNull();
  expect(() => empty.resolve(walletIdFromString('wallet:other'), activation)).toThrow(
    'Ed25519 material read does not match the requested activation',
  );
  expect(() => empty.resolve(walletId, other)).toThrow(
    'Ed25519 material read does not match the requested activation',
  );
  // A malformed projection surfaces when the read is used, after session validation.
  const malformed = Ed25519SignerRead.fromRows(walletId, activation, null);
  expect(() => malformed.resolve(walletId, activation)).toThrow(
    'Ed25519 material rows are invalid',
  );
});
