import { intendedTest as test } from './harness';

/**
 * Linked Devices (docs/intended-behaviours.md): a second device joins an
 * existing passkey wallet through the QR link, signs with the wallet's
 * existing public keys under its own Wallet Session, and loses that ability
 * when Device 1 revokes its exact method.
 *
 * Device 2 is a separate browser context with its own storage and its own
 * virtual authenticator. There is no camera; Device 1 receives the QR payload
 * exactly as Device 2 produced it.
 */
test('a second device links with a passkey, signs NEAR and Tempo, and is revoked', async ({
  harness,
  browser,
}) => {
  await harness.registerPasskeyWallet();
  /* Linking pins the source signer manifest, so the NEAR signer must exist
     before Device 1 approves; otherwise Device 2 would join without it. */
  await harness.awaitNearReady();

  const device2 = await harness.openLinkedDevice(browser);
  /* The Router runs Device 2's target registration and reserves its
     material, but the Gateway loses the Router's answer. The Gateway's retry
     is marked as the Router's replay, and the Router answers it from that run
     with the same reservation, running nothing again. */
  const lostExecute = await harness.loseLinkExecuteRouterResponseOnce();
  /* Device 2's activation reaches the Gateway, which activates its authority
     and both curves' material, but the answer is lost. Device 2's own retry
     must get that same activation: linking still lists exactly one device,
     and the signing below uses the one set of material. */
  const lostActivation = await device2.loseLinkedActivationResponseOnce();
  try {
    await harness.linkDeviceWithPasskey(device2);
  } finally {
    await lostActivation.release();
    await lostExecute.release();
  }
  lostExecute.assertReplayed();
  lostActivation.assertReplayed();

  /* Device 2's own session signs every signer family the source authority
     had, and the signatures recover to the wallet's registered keys. */
  await device2.signNearTransaction('post_device_link');
  await device2.signTempoTransaction('post_device_link');

  await harness.revokeLinkedDeviceWithOwnerPasskey();
  await device2.assertRevokedDeviceCannotSign();
  /* Revocation retires only Device 2's authority; Device 1 keeps signing. */
  await harness.signTempoTransaction('post_registration');
});

/**
 * A linked device holds full owner authority, including linking. On a wallet
 * whose signers are ECDSA only, Device 2 approves Device 3 from its own ECDSA
 * share: Device 3's material is reserved from Device 2's, the wallet's key and
 * address stay the same, and every device keeps signing.
 */
test('a linked device links a third device on an ECDSA-only wallet, which signs Tempo', async ({
  harness,
  browser,
}) => {
  await harness.registerPasskeyEcdsaOnlyWallet();

  const device2 = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(device2);
  const device3 = await device2.openLinkedDevice(browser);
  await device2.linkDeviceWithPasskey(device3);

  await device3.signTempoTransaction('post_device_link');
  /* Linking Device 3 changed nothing for the devices that were already
     signing. */
  await device2.signTempoTransaction('post_device_link');
  await harness.signTempoTransaction('post_registration');
});

/**
 * On a wallet with NEAR, approving a link also hands the new device the
 * wallet's Ed25519 export root. Device 2 holds that root only as its own
 * sealed envelope, which its unlock opens for linking, and never as the
 * wallet custody seed. Device 3 is linked from Device 2's own material on
 * both curves and signs with the wallet's keys.
 */
test('a linked device links a third device, which signs NEAR and Tempo', async ({
  harness,
  browser,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();

  const device2 = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(device2);
  /* Only an unlock opens Device 2's export root: the Wallet Session linking
     handed Device 2 does not. */
  await device2.unlockPasskeyWallet();
  const device3 = await device2.openLinkedDevice(browser);
  await device2.linkDeviceWithPasskey(device3);

  await device3.signNearTransaction('post_device_link');
  await device3.signTempoTransaction('post_device_link');
  /* Linking Device 3 changed nothing for the devices that were already
     signing. */
  await device2.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_registration');
});
