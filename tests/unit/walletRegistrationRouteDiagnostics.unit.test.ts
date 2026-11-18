import { expect, test } from '@playwright/test';
import { parseWalletRegistrationRouteDiagnostics } from '@shared/utils/registrationContracts';

function finalizeDiagnostics(entries: unknown): Record<string, unknown> {
  return {
    kind: 'wallet_registration_route_diagnostics_v1',
    route: 'wallets_register_finalize',
    entries,
  };
}

test('a timing entry that the client does not know is dropped, and the parse does not throw', () => {
  const parsed = parseWalletRegistrationRouteDiagnostics(
    finalizeDiagnostics([
      { name: 'registerFinalizeTotalMs', durationMs: 42 },
      // The old server type allowed this name, but nothing emits it.
      { name: 'registrationKeygenMs', durationMs: 5 },
      { name: 'timingFromANewerServerMs', durationMs: 7 },
      { name: 'relayPersistenceMs', durationMs: -1 },
      { name: 'relayPersistenceMs', durationMs: '3' },
      { name: 'relayPersistenceMs', durationMs: Number.NaN },
      { name: 'relayPersistenceMs', durationMs: 3, extra: true },
      null,
      'registerFinalizeTotalMs',
    ]),
  );
  expect(parsed).toEqual(
    finalizeDiagnostics([
      { name: 'registerFinalizeTotalMs', durationMs: 42 },
      { name: 'relayPersistenceMs', durationMs: 3 },
    ]),
  );
});

test('each timing that the finalize route emits is kept', () => {
  const entries = [
    { name: 'registrationEcdsaBootstrapVerifyMs', durationMs: 1 },
    { name: 'registrationEmailOtpEnrollmentPlanMs', durationMs: 2 },
    { name: 'relayPersistenceMs', durationMs: 3 },
    { name: 'registerFinalizeTotalMs', durationMs: 0 },
  ];
  expect(parseWalletRegistrationRouteDiagnostics(finalizeDiagnostics(entries))).toEqual(
    finalizeDiagnostics(entries),
  );
});

test('a bad diagnostics envelope gives null, not an error', () => {
  const bad: unknown[] = [
    undefined,
    null,
    'diagnostics',
    [],
    { ...finalizeDiagnostics([]), kind: 'wallet_registration_route_diagnostics_v2' },
    { ...finalizeDiagnostics([]), route: 'wallets_register_setup' },
    finalizeDiagnostics({ name: 'registerFinalizeTotalMs', durationMs: 1 }),
  ];
  for (const value of bad) {
    expect(parseWalletRegistrationRouteDiagnostics(value)).toBeNull();
  }
});
