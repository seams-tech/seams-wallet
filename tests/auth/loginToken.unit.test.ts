import { expect, test } from '@playwright/test';
import { verifyLoginToken } from '../../packages/auth/src/server/index';
import { ISSUER, PROJECT_ID, openAuthWorker, type AuthWorkerHarness } from './harness';

// `verifyLoginToken` of `@seams/auth/server`, as an app backend calls it: it loads the key set
// of the Auth Worker once and checks each token with it.

let worker: AuthWorkerHarness;

test.beforeAll(async () => {
  worker = await openAuthWorker();
});

test.afterAll(async () => {
  await worker.close();
});

test('verifyLoginToken gives the user of a valid token and null for each other token', async () => {
  const loads: string[] = [];
  const load = async (url: string | URL | Request) => {
    loads.push(String(url));
    return await worker.send('GET', '/.well-known/jwks.json', undefined, {
      key: null,
      origin: null,
      appOrigin: null,
      environmentId: null,
    });
  };
  const { session } = await worker.signUpWithPasskey();
  const options = { projectId: PROJECT_ID, issuer: `${ISSUER}/`, fetch: load as typeof fetch };
  expect(await verifyLoginToken(session.loginToken, options)).toMatchObject({
    accountId: session.accountId,
    projectId: PROJECT_ID,
    method: 'passkey',
  });
  expect(
    await verifyLoginToken(session.loginToken, { ...options, projectId: 'project-2' }),
  ).toBeNull();
  expect(await verifyLoginToken('not-a-token', options)).toBeNull();
  // The key set was loaded once, from the issuer without its trailing slash.
  expect(loads).toEqual([`${ISSUER}/.well-known/jwks.json`]);
});
