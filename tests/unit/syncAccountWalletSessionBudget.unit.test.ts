import { expect, test } from '@playwright/test';
import { parseSyncAccountVerifyRequest } from '../../packages/wallet-server/src/router/domains/syncAccount/syncAccountRequestValidation';

const ASSERTION = {
  id: 'credential-1',
  rawId: 'credential-1',
  type: 'public-key',
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'authenticator-data',
    signature: 'signature',
    userHandle: null,
  },
};

function parse(body: Record<string, unknown>) {
  return parseSyncAccountVerifyRequest({
    body: { challengeId: 'challenge-1', webauthn_authentication: ASSERTION, ...body },
    origin: 'https://wallet.example.test',
  });
}

test("a sync carries the app's Wallet Session budget beside the verified request", () => {
  const parsed = parse({ walletSessionBudget: { ttlMs: 60_000, remainingUses: 7 } });
  if (!parsed.ok) throw new Error(parsed.body.message);
  expect(parsed.walletSessionBudget).toEqual({ ttlMs: 60_000, remainingUses: 7 });
  // The owner proof digests the request, so the budget stays out of it.
  expect(parsed.request).not.toHaveProperty('walletSessionBudget');
});

test('a sync with no budget asks for the default', () => {
  const parsed = parse({});
  if (!parsed.ok) throw new Error(parsed.body.message);
  expect(parsed.walletSessionBudget).toBeNull();
});

test('a sync with an invalid budget is refused', () => {
  for (const walletSessionBudget of [{ ttlMs: 0, remainingUses: 1 }, { ttlMs: 1 }, 'big']) {
    const parsed = parse({ walletSessionBudget });
    expect(parsed.ok).toBe(false);
  }
});
