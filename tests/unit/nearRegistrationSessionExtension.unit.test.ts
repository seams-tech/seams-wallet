import { replaceNearFixtureAuthority } from './helpers/nearRegistration.fixtures';
import { expect, test } from '@playwright/test';
import {
  extendEcdsaWalletAuthorityWithEd25519,
  isEd25519ExtensionOfEcdsaWalletAuthority,
  isActiveEcdsaWalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import {
  buildEmailOtpEcdsaWalletSessionFixture,
  extendFixtureAuthorityWithEd25519Signer,
} from './helpers/linkedDeviceManagement.fixtures';

test('a NEAR authority extension refuses another wallet and a changed epoch or ECDSA material', async () => {
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
  for (const change of ['revocation_epoch', 'ecdsa_material'] as const) {
    const replacement = await replaceNearFixtureAuthority(extended, change);
    expect(isEd25519ExtensionOfEcdsaWalletAuthority(fixture.authority, replacement)).toBe(false);
  }
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
