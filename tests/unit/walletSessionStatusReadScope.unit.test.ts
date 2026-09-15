import { expect, test } from '@playwright/test';
import {
  parseMpcWalletSigningQuotaId,
  type AuthorizationParseResult,
} from '@shared/authorization/capabilityKinds';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking/parsers';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';

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
