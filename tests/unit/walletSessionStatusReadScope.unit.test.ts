import { expect, test } from '@playwright/test';
import {
  parseMpcWalletSigningQuotaId,
  type AuthorizationParseResult,
} from '@shared/authorization/capabilityKinds';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking/activeWalletSession';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import { buildLinkedDeviceManagementAuthorityFixture } from './helpers/linkedDeviceManagement.fixtures';

function requireParsed<T>(result: AuthorizationParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

class StatusServer {
  calls = 0;
  status: 'missing' | 'invalid' = 'missing';
  fail = false;

  async fetch(
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    this.calls += 1;
    if (this.fail) throw new Error('offline');
    if (typeof init?.body !== 'string') throw new Error('Expected JSON status request');
    const identity = JSON.parse(init.body);
    return Response.json({ ok: true, status: this.status, ...identity });
  }
}

function operationCredential(tokenCharacter: string) {
  return parseWalletSessionOperationCredentialV1({
    kind: 'opaque_wallet_session_operation_credential_v1',
    ownershipGeneration: 1,
    home: { kind: 'direct' },
    token: `wst_${tokenCharacter.repeat(43)}`,
    walletSessionId: 'session-scope-test',
  });
}

test('one operation shares settled and pending status reads; later operations and other identities read afresh', async () => {
  const server = new StatusServer();
  const options = {
    relayerUrl: 'https://relay.example',
    operationCredential: operationCredential('a'),
    fetchImpl: server.fetch.bind(server),
  };
  const identity = {
    walletSessionId: options.operationCredential.walletSessionId,
    quotaId: requireParsed(parseMpcWalletSigningQuotaId('quota-scope-test')),
  };
  const scope = new WalletSessionStatusReadScope();
  const first = scope.read(options, identity);
  expect(scope.read(options, identity)).toBe(first);
  expect((await first).status).toBe('missing');
  server.status = 'invalid';
  expect(scope.read(options, identity)).toBe(first);
  expect(server.calls).toBe(1);

  expect((await new WalletSessionStatusReadScope().read(options, identity)).status).toBe('invalid');
  expect(server.calls).toBe(2);
  await scope.read({ ...options, operationCredential: operationCredential('b') }, identity);
  await scope.read({ ...options, relayerUrl: 'https://other-relay.example' }, identity);
  await scope.read({ ...options, fetchImpl: server.fetch.bind(server) }, identity);
  await scope.read(options, {
    walletSessionId: identity.walletSessionId,
    quotaId: requireParsed(parseMpcWalletSigningQuotaId('quota-other')),
  });
  expect(server.calls).toBe(6);
});

test('a failed status read is shared without retrying within the operation', async () => {
  const server = new StatusServer();
  server.fail = true;
  const options = {
    relayerUrl: 'https://relay.example',
    operationCredential: operationCredential('a'),
    fetchImpl: server.fetch.bind(server),
  };
  const identity = {
    walletSessionId: options.operationCredential.walletSessionId,
    quotaId: requireParsed(parseMpcWalletSigningQuotaId('quota-scope-test')),
  };
  const scope = new WalletSessionStatusReadScope();
  await expect(scope.read(options, identity)).rejects.toThrow('offline');
  server.fail = false;
  await expect(scope.read(options, identity)).rejects.toThrow('offline');
  expect(server.calls).toBe(1);
  expect((await new WalletSessionStatusReadScope().read(options, identity)).status).toBe('missing');
  expect(server.calls).toBe(2);
});

/** The session a registration response issued, from the shared session factory. */
async function registrationIssuedSession(label: string, server: StatusServer) {
  const fixture = await buildLinkedDeviceManagementAuthorityFixture({
    label,
    permissions: buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
  });
  const quota = fixture.issuedSession.quota;
  const session = {
    walletSessionId: fixture.operationCredential.walletSessionId,
    quotaId: quota.quotaId,
    remainingUses: quota.remainingUses,
    expiresAtMs: quota.expiresAtMs,
    walletSession: fixture.activeWalletSession,
    operationCredential: fixture.operationCredential,
  };
  return {
    session,
    options: {
      relayerUrl: 'https://relay.example',
      operationCredential: fixture.operationCredential,
      fetchImpl: server.fetch.bind(server),
    },
    identity: { walletSessionId: session.walletSessionId, quotaId: session.quotaId },
  };
}

test('a wallet-host observation reads a registration-issued session once without asking the server', async () => {
  const server = new StatusServer();
  const { session, options, identity } = await registrationIssuedSession('seed-once', server);
  WalletSessionStatusReadScope.acceptRegistrationSession(options.relayerUrl, session);

  const observed = await WalletSessionStatusReadScope.forHostObservation().read(options, identity);
  expect(observed).toEqual({
    status: 'active',
    walletSessionId: session.walletSessionId,
    quotaId: session.quotaId,
    remainingUses: session.remainingUses,
    expiresAtMs: session.expiresAtMs,
    quotaLifecycle: 'active',
    authorization: session.walletSession,
  });
  expect(server.calls).toBe(0);

  // The response is read once. The next observation asks the server.
  expect(
    (await WalletSessionStatusReadScope.forHostObservation().read(options, identity)).status,
  ).toBe('missing');
  expect(server.calls).toBe(1);
});

test('reads outside a wallet-host observation ask the server, and its answer replaces the issued session', async () => {
  const server = new StatusServer();
  const { session, options, identity } = await registrationIssuedSession('seed-replaced', server);
  WalletSessionStatusReadScope.acceptRegistrationSession(options.relayerUrl, session);

  expect((await new WalletSessionStatusReadScope().read(options, identity)).status).toBe('missing');
  expect(server.calls).toBe(1);
  expect(
    (await WalletSessionStatusReadScope.forHostObservation().read(options, identity)).status,
  ).toBe('missing');
  expect(server.calls).toBe(2);
});

test('a wallet-host observation of another session asks the server', async () => {
  const server = new StatusServer();
  const { session, options, identity } = await registrationIssuedSession('seed-other', server);
  WalletSessionStatusReadScope.acceptRegistrationSession(options.relayerUrl, session);

  await WalletSessionStatusReadScope.forHostObservation().read(
    { ...options, operationCredential: operationCredential('c') },
    identity,
  );
  await WalletSessionStatusReadScope.forHostObservation().read(
    { ...options, relayerUrl: 'https://other-relay.example' },
    identity,
  );
  expect(server.calls).toBe(2);
  expect(
    (await WalletSessionStatusReadScope.forHostObservation().read(options, identity)).status,
  ).toBe('active');
  expect(server.calls).toBe(2);
});

test('a prepare answers with the status it admitted and leaves the balance after its claim for planning', async () => {
  const server = new StatusServer();
  const { session, options, identity } = await registrationIssuedSession('prepare-claim', server);
  const admitted = {
    status: 'active' as const,
    ...identity,
    remainingUses: 2,
    expiresAtMs: session.expiresAtMs,
    quotaLifecycle: 'active' as const,
    authorization: session.walletSession,
  };
  const scope = WalletSessionStatusReadScope.fromPrepare(options, admitted);
  expect(await scope.read(options, identity)).toBe(admitted);
  expect(
    WalletSessionStatusReadScope.observationForConfirmation(options, identity)?.status,
  ).toEqual({ ...admitted, remainingUses: 1 });

  const lastUse = { ...admitted, remainingUses: 1 };
  await WalletSessionStatusReadScope.fromPrepare(options, lastUse).read(options, identity);
  expect(
    WalletSessionStatusReadScope.observationForConfirmation(options, identity)?.status,
  ).toEqual({ ...lastUse, status: 'exhausted', remainingUses: 0, quotaLifecycle: 'exhausted' });
  expect(server.calls).toBe(0);
});
