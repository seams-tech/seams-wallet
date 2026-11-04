import { expect, test } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking/activeWalletSession';
import { prepareRouterAbNormalSigningV2 } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import { buildLinkedDeviceManagementAuthorityFixture } from './helpers/linkedDeviceManagement.fixtures';

class StatusServer {
  async fetch(
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    if (typeof init?.body !== 'string') throw new Error('Expected JSON status request');
    const identity = JSON.parse(init.body);
    return Response.json({ ok: true, status: 'missing', ...identity });
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

test('a signing request that the server refuses for step-up drops what the wallet observed', async () => {
  const server = new StatusServer();
  const { session, options, identity } = await registrationIssuedSession('refused-prepare', server);
  // Signing requests and the observations they contradict use the default fetch.
  const observed = {
    relayerUrl: options.relayerUrl,
    operationCredential: options.operationCredential,
  };
  const other = { ...observed, operationCredential: operationCredential('d') };
  const admitted = {
    status: 'active' as const,
    ...identity,
    remainingUses: 3,
    expiresAtMs: session.expiresAtMs,
    quotaLifecycle: 'active' as const,
    authorization: session.walletSession,
  };
  await WalletSessionStatusReadScope.fromPrepare(observed, admitted).read(observed, identity);
  await WalletSessionStatusReadScope.fromPrepare(other, admitted).read(other, identity);
  WalletSessionStatusReadScope.acceptRegistrationSession(options.relayerUrl, session);

  const refusal = {
    ok: false,
    code: 'wallet_session_quota_exhausted',
    message: 'Ed25519 authorized operation rejected',
    authorization_decision: {
      kind: 'step_up_required',
      reason: 'wallet_session_exhausted',
      step_up: {
        wallet_id: session.walletSession.walletId,
        operation_kind: 'near.sign_transaction',
        operation_id: 'operation-refused',
        request_id: 'request-refused',
        account_id: session.walletSession.walletId,
        material_activation: {
          kind: 'mpc_material_activation_ref',
          activation_id: `mact_${'A'.repeat(32)}`,
          capability: `cap_${'A'.repeat(32)}`,
          material_owner: session.walletSession.walletId,
          key_binding: `key_${'A'.repeat(32)}`,
          lifecycle_binding: `life_${'A'.repeat(32)}`,
          signing_worker: 'local-signing-worker',
        },
        signing_worker_id: 'local-signing-worker',
        near_account_id: 'refused.testnet',
        signer_slot: 1,
        participant_ids: [1, 2],
        expires_at_ms: session.expiresAtMs,
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(refusal, { status: 409 });
  try {
    await expect(
      prepareRouterAbNormalSigningV2({
        relayServerUrl: options.relayerUrl,
        credential: {
          kind: 'wallet_session_opaque',
          home: options.operationCredential.home,
          walletSessionToken: options.operationCredential.token,
        },
        request: {} as Parameters<typeof prepareRouterAbNormalSigningV2>[0]['request'],
      }),
    ).rejects.toMatchObject({ name: 'WalletSessionQuotaAdmissionError' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(WalletSessionStatusReadScope.observationForConfirmation(observed, identity)).toBeNull();
  expect(WalletSessionStatusReadScope.observationForConfirmation(other, identity)).not.toBeNull();
  // The issued session is gone too: the next wallet-host observation asks the server.
  expect(
    (await WalletSessionStatusReadScope.forHostObservation().read(options, identity)).status,
  ).toBe('missing');
});
