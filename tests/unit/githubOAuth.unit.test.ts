import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { verifyGithubOAuthCodeWithIdentityStore } from '../../packages/wallet-server/src/core/authService/githubOAuth';
import { D1IdentityStore } from '../../packages/wallet-server/src/core/d1IdentityStore';
import { nodeSqliteConnection } from '../../packages/wallet-server/src/router/node/nodeSqlite';
import { createSyncSqliteDatabase } from '../../packages/wallet-server/src/storage/syncSqlite';

const CONFIG = {
  clientId: 'github-client-id',
  clientSecret: 'github-client-secret',
  callbackUrl: 'https://example.localhost/dashboard/login',
};

/** The gateways' identity store, over an in-memory SQLite database. */
function createIdentityStoreFixture(): D1IdentityStore {
  return new D1IdentityStore({
    database: createSyncSqliteDatabase(nodeSqliteConnection(new DatabaseSync(':memory:'))),
    namespace: 'test',
    orgId: 'org',
    projectId: 'project',
    envId: 'env',
  });
}

async function mockGithubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://github.com/login/oauth/access_token') {
    const body = new URLSearchParams(String(init?.body || ''));
    expect(Object.fromEntries(body)).toEqual({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      code: 'temporary-code',
      redirect_uri: CONFIG.callbackUrl,
    });
    return Response.json({ access_token: 'github-user-access-token', token_type: 'bearer' });
  }
  if (url === 'https://api.github.com/user') {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer github-user-access-token');
    return Response.json({ id: 42, login: 'octocat', name: 'The Octocat', email: null });
  }
  if (url === 'https://api.github.com/user/emails') {
    return Response.json([
      { email: 'secondary@example.com', primary: false, verified: true },
      { email: 'octocat@github.com', primary: true, verified: true },
    ]);
  }
  return Response.json({ message: 'not found' }, { status: 404 });
}

test('GitHub OAuth code exchange resolves and links a stable provider identity', async () => {
  const identityStore = createIdentityStoreFixture();
  const result = await verifyGithubOAuthCodeWithIdentityStore({
    request: { code: 'temporary-code' },
    config: CONFIG,
    identityStore,
    fetchImpl: mockGithubFetch,
  });
  expect(result).toEqual({
    ok: true,
    verified: true,
    userId: 'github:42',
    providerSubject: 'github:42',
    iss: 'https://github.com',
    aud: ['github-client-id'],
    sub: '42',
    email: 'octocat@github.com',
    name: 'The Octocat',
  });
  await expect(identityStore.getUserIdBySubject('github:42')).resolves.toBe('github:42');
});

test('GitHub OAuth code exchange fails closed without complete configuration', async () => {
  const identityStore = createIdentityStoreFixture();
  await expect(
    verifyGithubOAuthCodeWithIdentityStore({
      request: { code: 'temporary-code' },
      config: undefined,
      identityStore,
      fetchImpl: mockGithubFetch,
    }),
  ).resolves.toEqual({
    ok: false,
    verified: false,
    code: 'not_configured',
    message: 'GitHub OAuth is not configured',
  });
});
