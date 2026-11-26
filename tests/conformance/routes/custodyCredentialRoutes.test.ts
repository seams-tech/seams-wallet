import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  buildFullOwnerPermissionsV1,
  buildSigningOnlyDelegatedWalletAuthorityV1,
} from '../../../packages/shared-ts/src/authorization/delegatedAuthority';
import { computeWalletOwnerAdminChallengeDigest } from '../../../packages/shared-ts/src/authorization/walletOwnerOperation';
import { buildPasskeyWalletAuthAuthority } from '../../../packages/shared-ts/src/utils/walletAuthAuthority';
import { buildVerifiedOwnerProof } from '../../../packages/mpc-wallet-server/src/authorization/factorEvidence';
import { APP_ORIGIN, recordedCalls, routerWith, webAuthnAssertion } from './routeHarness';

// The custody credential list. The browser signs a challenge that names the wallet, the
// operation, its payload and the Origin; the route checks that passkey assertion before it lists
// the wallet's passkey credentials. The challenge bytes are fixed here because the browser
// computes the same digest.

const WALLET_ID = 'custody-wallet-1';
const RP_ID = 'wallet.example.test';
const CREDENTIAL_ID = 'Y3JlZGVudGlhbC0x';
const PATH = `/wallets/${WALLET_ID}/custody/credentials`;
const CREDENTIALS = [
  { envelopeId: 'envelope-1', label: 'MacBook', lastUsedAtMs: 1_700_000_000_000 },
];

/** The challenge preimage with its keys in sorted order, as the server and the browser hash it. */
function expectedChallengeDigest(walletId: string, origin: string): string {
  const preimage =
    'seams:wallet-custody:challenge:v1|' +
    `{"operation":"credentials_list","payload":{"walletId":"${walletId}"},` +
    `"requestOrigin":"${origin}","walletId":"${walletId}"}`;
  return createHash('sha256').update(preimage).digest('base64url');
}

function factorProof(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'passkey',
    walletId: WALLET_ID,
    rpId: RP_ID,
    credentialIdB64u: CREDENTIAL_ID,
    challenge_digest: expectedChallengeDigest(WALLET_ID, APP_ORIGIN),
    webauthn_authentication: webAuthnAssertion(CREDENTIAL_ID),
    ...overrides,
  };
}

function custodyRouter(options: { permissions?: readonly string[]; assertion?: object } = {}) {
  const prepareAssertion = recordedCalls(
    options.assertion ?? { success: true, consumeInBatch: [] },
  );
  const completed: unknown[] = [];
  const listCredentials = recordedCalls(CREDENTIALS);
  const router = routerWith({
    authorizedOperations: {
      tenantId: 'conformance-tenant',
      buildVerifiedOwnerProof,
      readWalletOperationEvidence: async () => null,
      readAuthorizedOperation: async () => null,
      commitWalletOperationEvidence: async () => undefined,
      admitAuthorizedOperation: async (input: { operation: object }) => ({
        kind: 'claimed',
        operation: { ...input.operation, lifecycle: 'claimed' },
      }),
      completeAuthorizedOperation: async (input: unknown) => {
        completed.push(input);
      },
    },
    walletAuthMethods: {
      resolveActivePasskeyAuthorityForVerifiedCredential: async () => ({
        ok: true,
        authority: buildPasskeyWalletAuthAuthority({
          walletId: WALLET_ID,
          rpId: RP_ID,
          credentialIdB64u: CREDENTIAL_ID,
        }),
        walletAuthority: {
          permissions: options.permissions ?? buildFullOwnerPermissionsV1(),
          updatedAtMs: 0,
        },
      }),
    },
    webAuthn: { prepareWebAuthnAuthenticationLite: prepareAssertion.answer },
    passkeyCustody: { listWalletCredentials: listCredentials.answer },
  });
  return { router, prepareAssertion, listCredentials, completed };
}

test('the credentials_list challenge digest keeps its preimage', async () => {
  const digest = await computeWalletOwnerAdminChallengeDigest({
    walletId: WALLET_ID,
    operation: 'credentials_list',
    payload: { walletId: WALLET_ID },
    requestOrigin: APP_ORIGIN,
  });
  expect(digest).toBe(expectedChallengeDigest(WALLET_ID, APP_ORIGIN));
});

test('POST /wallets/:walletId/custody/credentials lists the credentials after a fresh owner proof', async () => {
  const fake = custodyRouter();
  const response = await fake.router.call('POST', PATH, {
    headers: { origin: APP_ORIGIN },
    body: { factorProof: factorProof() },
  });
  expect(response).toEqual({ status: 200, body: { ok: true, credentials: CREDENTIALS } });
  expect(fake.prepareAssertion.calls).toEqual([
    expect.objectContaining({
      userId: WALLET_ID,
      rpId: RP_ID,
      expectedChallenge: expectedChallengeDigest(WALLET_ID, APP_ORIGIN),
      expected_origin: APP_ORIGIN,
    }),
  ]);
  expect(fake.listCredentials.calls).toEqual([{ walletId: WALLET_ID }]);
  // The answer is stored with the operation, so a replay returns the same body.
  expect(fake.completed).toEqual([
    expect.objectContaining({
      result: 'succeeded',
      response: {
        status: 200,
        contentType: 'application/json',
        bodyText: JSON.stringify({ ok: true, credentials: CREDENTIALS }),
      },
    }),
  ]);
});

test('the credential list refuses a proof that does not bind this request', async () => {
  const fake = custodyRouter();
  const cases = [
    [{}, { factorProof: factorProof() }, 400, 'invalid_origin', 'request Origin is required'],
    [{ origin: APP_ORIGIN }, {}, 400, 'invalid_owner_proof', 'factorProof is required'],
    [
      { origin: APP_ORIGIN },
      { factorProof: factorProof({ walletId: 'another-wallet' }) },
      403,
      'scope_mismatch',
      'owner proof wallet differs',
    ],
    [
      { origin: 'https://other.example.test' },
      { factorProof: factorProof() },
      403,
      'scope_mismatch',
      'factor proof challenge does not match the requested operation',
    ],
    [
      { origin: APP_ORIGIN },
      {
        factorProof: factorProof({
          webauthn_authentication: {
            ...webAuthnAssertion(CREDENTIAL_ID),
            clientExtensionResults: { prf: { results: { first: 'c2VjcmV0' } } },
          },
        }),
      },
      400,
      'invalid_owner_proof',
      'factorProof.webauthn_authentication.clientExtensionResults must be redacted',
    ],
  ] as const;
  for (const [headers, body, status, code, message] of cases) {
    expect(await fake.router.call('POST', PATH, { headers, body })).toEqual({
      status,
      body: { ok: false, code, message },
    });
  }
  expect(fake.prepareAssertion.calls).toEqual([]);
  expect(fake.listCredentials.calls).toEqual([]);
});

test('the credential list needs a full-owner method and a verified assertion', async () => {
  const signingOnly = custodyRouter({
    permissions: buildSigningOnlyDelegatedWalletAuthorityV1().permissions,
  });
  expect(
    await signingOnly.router.call('POST', PATH, {
      headers: { origin: APP_ORIGIN },
      body: { factorProof: factorProof() },
    }),
  ).toEqual({
    status: 403,
    body: { ok: false, code: 'forbidden', message: 'Full owner authority is required' },
  });

  const failed = custodyRouter({
    assertion: { success: false, code: 'challenge_mismatch', message: 'wrong challenge' },
  });
  expect(
    await failed.router.call('POST', PATH, {
      headers: { origin: APP_ORIGIN },
      body: { factorProof: factorProof() },
    }),
  ).toEqual({
    status: 401,
    body: { ok: false, code: 'challenge_mismatch', message: 'wrong challenge' },
  });
  expect(failed.listCredentials.calls).toEqual([]);
});
