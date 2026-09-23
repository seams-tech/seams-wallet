import { expect, test } from '@playwright/test';
import {
  buildStoredWalletRegistrationPreparedContext,
  parseStoredWalletRegistrationPreparedContext,
} from '../../packages/wallet-server/src/core/RegistrationCeremonyStore';
import {
  buildWalletHomeLane,
  buildWalletLaneContext,
  nextWalletLaneEpoch,
} from '../../packages/shared-ts/src/wallet-region';
import {
  computeWalletRegistrationSetupDigestB64u,
  parseWalletRegistrationSetupClaims,
} from '../../packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationSetupPayload';
import { buildNearRegistrationAuthorityFixture } from './helpers/nearRegistration.fixtures';
import { buildWalletLaneAdmissionFixture } from './helpers/walletRegion.fixtures';

function setupClaims(laneContext: ReturnType<typeof buildWalletLaneAdmissionFixture>['context']) {
  return {
    kind: 'wallet_registration_setup_v1',
    registrationCeremonyId: 'registration-ceremony:lane-context',
    walletId: String(laneContext.walletId),
    laneContext,
    orgId: 'org:lane-context',
    signingRootId: 'signing-root:lane-context',
    signingRootVersion: '1',
    policy: { kind: 'signing_root_only' },
    setupDigestB64u: 'setup-digest',
    expiresAtMs: 10_000,
  } as const;
}

test('requires the signed registration setup to carry its exact wallet lane context', () => {
  const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
  const claims = setupClaims(fixture.context);

  expect(parseWalletRegistrationSetupClaims(JSON.parse(JSON.stringify(claims)))).toEqual(claims);
  expect(
    parseWalletRegistrationSetupClaims({
      ...claims,
      laneContext: undefined,
    }),
  ).toBeNull();
  expect(
    parseWalletRegistrationSetupClaims({
      ...claims,
      walletId: 'wallet:another-registration',
    }),
  ).toBeNull();
});

test('binds the registration setup digest and durable prepared context to the lane epoch', async () => {
  const first = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
  const nextLaneContext = buildWalletLaneContext({
    homeLane: buildWalletHomeLane({
      walletId: first.context.walletId,
      laneId: first.context.laneId,
      laneEpoch: nextWalletLaneEpoch(first.context.laneEpoch),
    }),
    directoryRevision: first.context.directoryRevision,
  });
  const registration = await buildNearRegistrationAuthorityFixture('lane-context');
  const digestInput = {
    registrationCeremonyId: 'registration-ceremony:lane-context',
    intent: registration.intent,
    intentDigestB64u: 'intent-digest',
    orgId: 'org:lane-context',
    signingRootId: 'signing-root:lane-context',
    signingRootVersion: '1',
    expectedOrigin: 'https://wallet.example.test',
  };

  await expect(
    computeWalletRegistrationSetupDigestB64u({
      ...digestInput,
      laneContext: first.context,
    }),
  ).resolves.not.toBe(
    await computeWalletRegistrationSetupDigestB64u({
      ...digestInput,
      laneContext: nextLaneContext,
    }),
  );

  const prepared = buildStoredWalletRegistrationPreparedContext({
    laneContext: first.context,
    signingRootId: 'signing-root:lane-context',
    signingRootVersion: '1',
    runtimePolicyScope: null,
    ecdsaChainTargets: null,
  });
  expect(parseStoredWalletRegistrationPreparedContext(JSON.stringify(prepared))).toEqual(prepared);
  expect(
    parseStoredWalletRegistrationPreparedContext(
      JSON.stringify({ ...prepared, laneContext: undefined }),
    ),
  ).toBeNull();
});
