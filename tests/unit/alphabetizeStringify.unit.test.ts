import { expect, test } from '@playwright/test';
import { alphabetizeStringify } from '@shared/utils/digests';

test('alphabetizeStringify recursively sorts object keys and preserves array order', () => {
  const value = {
    z: 3,
    a: { z: 'last', a: 'first' },
    m: [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ],
  };

  expect(alphabetizeStringify(value)).toBe(
    '{"a":{"a":"first","z":"last"},"m":[{"a":1,"b":2},{"c":3,"d":4}],"z":3}',
  );
});

test('alphabetizeStringify preserves ordinary JSON scalar encoding', () => {
  const values: readonly unknown[] = [null, true, false, 'quoted "value"\n', 0, -12.5, [], {}];

  for (const value of values) {
    expect(alphabetizeStringify(value)).toBe(JSON.stringify(value));
  }
});

test('alphabetizeStringify is independent of object insertion order', () => {
  const left = {
    walletId: 'wallet-1',
    policy: { threshold: 2, mode: 'strict' },
  };
  const right = {
    policy: { mode: 'strict', threshold: 2 },
    walletId: 'wallet-1',
  };

  expect(alphabetizeStringify(left)).toBe(alphabetizeStringify(right));
});

test('alphabetizeStringify does not mutate or replace the input graph', () => {
  const nested = { z: 2, a: 1 };
  const arrayEntry = { d: 4, c: 3 };
  const value = { z: nested, a: [arrayEntry] };
  const before = JSON.stringify(value);

  alphabetizeStringify(value);

  expect(JSON.stringify(value)).toBe(before);
  expect(value.z).toBe(nested);
  expect(value.a[0]).toBe(arrayEntry);
  expect(Object.keys(value)).toEqual(['z', 'a']);
  expect(Object.keys(nested)).toEqual(['z', 'a']);
});

test('alphabetizeStringify preserves representative protocol preimage bytes', () => {
  expect(
    alphabetizeStringify({
      operationId: 'operation-1',
      tenantId: 'tenant-1',
      digests: {
        intentDigest: 'intent-digest',
        displayDigest: 'display-digest',
        laneDigest: 'lane-digest',
      },
      operation: { kind: 'sign', payload: { z: 2, a: 1 } },
      principalId: 'principal-1',
      capabilityId: 'capability-1',
    }),
  ).toBe(
    '{"capabilityId":"capability-1","digests":{"displayDigest":"display-digest","intentDigest":"intent-digest","laneDigest":"lane-digest"},"operation":{"kind":"sign","payload":{"a":1,"z":2}},"operationId":"operation-1","principalId":"principal-1","tenantId":"tenant-1"}',
  );

  expect(
    alphabetizeStringify({
      version: 'wallet_auth_method_revoke_operation_v1',
      walletId: 'wallet-1',
      targetWalletAuthMethodId: 'method-1',
      requestedAtMs: 1234,
    }),
  ).toBe(
    '{"requestedAtMs":1234,"targetWalletAuthMethodId":"method-1","version":"wallet_auth_method_revoke_operation_v1","walletId":"wallet-1"}',
  );

  expect(
    alphabetizeStringify({
      reservationId: 'reservation-1',
      domain: 'seams/wallet-recovery/key-lifecycle/v1',
      keySetId: 'near_ed25519:key-1',
    }),
  ).toBe(
    '{"domain":"seams/wallet-recovery/key-lifecycle/v1","keySetId":"near_ed25519:key-1","reservationId":"reservation-1"}',
  );

  expect(
    alphabetizeStringify({
      receipt: {
        walletId: 'wallet-1',
        installationId: 'installation-1',
        authorityId: 'authority-1',
      },
      domain: 'seams/linked-device/local-authority-installation-receipt/v1',
    }),
  ).toBe(
    '{"domain":"seams/linked-device/local-authority-installation-receipt/v1","receipt":{"authorityId":"authority-1","installationId":"installation-1","walletId":"wallet-1"}}',
  );
});
