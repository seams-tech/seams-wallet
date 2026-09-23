import { replaceNearFixtureAuthority } from './helpers/nearRegistration.fixtures';
import { expect, test } from '@playwright/test';
import {
  extendEcdsaWalletAuthorityWithEd25519,
  isEd25519ExtensionOfEcdsaWalletAuthority,
  isActiveEcdsaWalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import { walletSessionPreservesCapabilities } from '@shared/device-linking/activeWalletSession';
import {
  buildEmailOtpEcdsaWalletSessionFixture,
  extendFixtureAuthorityWithEd25519Signer,
  buildPromotedActiveWalletSessionFixture,
} from './helpers/linkedDeviceManagement.fixtures';

test('NEAR authority extension preserves ECDSA identity, session lifetime and existing permissions', async () => {
  const fixture = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'near-extension',
    expiresAtMs: Date.now() + 60_000,
  });
  const expected = await extendFixtureAuthorityWithEd25519Signer(fixture.authority);
  if (!isActiveEcdsaWalletAuthorityV1(fixture.authority) || !expected.signerActivations.ed25519) {
    throw new Error('Fixture requires an ECDSA authority and its NEAR extension');
  }
  const extended = await extendEcdsaWalletAuthorityWithEd25519({
    authority: fixture.authority,
    ed25519: expected.signerActivations.ed25519,
    now: Date.now(),
  });
  expect(isEd25519ExtensionOfEcdsaWalletAuthority(fixture.authority, extended)).toBe(true);
  expect(isEd25519ExtensionOfEcdsaWalletAuthority(extended, fixture.authority)).toBe(false);
  expect(extended.authorityDigestB64u).toBe(expected.authorityDigestB64u);
  expect(extended.signerActivations.ecdsa).toEqual(fixture.authority.signerActivations.ecdsa);
  expect(extended.revocationEpoch).toBe(fixture.authority.revocationEpoch);
  for (const change of ['revocation_epoch', 'ecdsa_material'] as const) {
    const replacement = await replaceNearFixtureAuthority(extended, change);
    expect(isEd25519ExtensionOfEcdsaWalletAuthority(fixture.authority, replacement)).toBe(false);
  }
  const promoted = buildPromotedActiveWalletSessionFixture({
    source: fixture.activeWalletSession,
    authority: extended,
  });
  expect(walletSessionPreservesCapabilities(fixture.activeWalletSession, promoted)).toBe(true);
  expect(walletSessionPreservesCapabilities(promoted, fixture.activeWalletSession)).toBe(false);
  expect(promoted.authorizationId).toBe(fixture.activeWalletSession.authorizationId);
  expect(promoted.quotaId).toBe(fixture.activeWalletSession.quotaId);
  expect(promoted.issuedAtMs).toBe(fixture.activeWalletSession.issuedAtMs);
  expect(promoted.expiresAtMs).toBe(fixture.activeWalletSession.expiresAtMs);
  const anotherWallet = await buildEmailOtpEcdsaWalletSessionFixture({
    label: 'other-near-extension',
    expiresAtMs: Date.now() + 60_000,
  });
  if (!isActiveEcdsaWalletAuthorityV1(anotherWallet.authority)) throw new Error('Expected ECDSA');
  expect(isEd25519ExtensionOfEcdsaWalletAuthority(anotherWallet.authority, extended)).toBe(false);
  await expect(
    extendEcdsaWalletAuthorityWithEd25519({
      authority: anotherWallet.authority,
      ed25519: expected.signerActivations.ed25519,
      now: Date.now(),
    }),
  ).rejects.toThrow('different wallet');
});
