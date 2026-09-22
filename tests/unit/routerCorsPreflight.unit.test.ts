import { expect, test } from '@playwright/test';
import { withCors } from '../../packages/wallet-server/src/router/framework/http';

const endpoint =
  'https://test.api.wallet.seams.sh/router-ab/ecdsa-derivation/presignature-pool/fill/step';
const corsOrigins = ['https://wallet.seams.sh'];

test('preflight caches an allowed origin while actual responses still check the current origin', () => {
  const preflight = new Headers();
  withCors(
    preflight,
    { corsOrigins },
    new Request(endpoint, { method: 'OPTIONS', headers: { Origin: corsOrigins[0] } }),
  );
  expect(preflight.get('Access-Control-Allow-Origin')).toBe(corsOrigins[0]);
  expect(preflight.get('Access-Control-Max-Age')).toBe('600');

  const allowedResponse = new Headers();
  withCors(
    allowedResponse,
    { corsOrigins },
    new Request(endpoint, { method: 'POST', headers: { Origin: corsOrigins[0] } }),
  );
  expect(allowedResponse.get('Access-Control-Allow-Origin')).toBe(corsOrigins[0]);
  expect(allowedResponse.has('Access-Control-Max-Age')).toBe(false);

  const revokedResponse = new Headers();
  withCors(
    revokedResponse,
    { corsOrigins: ['https://replacement.example'] },
    new Request(endpoint, { method: 'POST', headers: { Origin: corsOrigins[0] } }),
  );
  expect(revokedResponse.has('Access-Control-Allow-Origin')).toBe(false);

  const rejectedPreflight = new Headers();
  withCors(
    rejectedPreflight,
    { corsOrigins },
    new Request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } }),
  );
  expect(rejectedPreflight.has('Access-Control-Allow-Origin')).toBe(false);
  expect(rejectedPreflight.has('Access-Control-Max-Age')).toBe(false);
});
