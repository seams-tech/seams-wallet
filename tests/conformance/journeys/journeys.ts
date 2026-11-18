import type { ConformanceDevice, ConformanceMethod } from './driver';

/**
 * The account journeys that each API must keep: registration, sign-in, unlock, step-up,
 * signing, adding and removing a method, device linking and recovery. A journey is only a list
 * of driver steps, so the old API and the new API run the same list.
 */
export type Journey = {
  readonly title: string;
  /** The first method of the account. One test file runs the journeys of one method. */
  readonly method: ConformanceMethod;
  readonly run: (device: ConformanceDevice) => Promise<void>;
};

function otherMethod(method: ConformanceMethod): ConformanceMethod {
  return method === 'passkey' ? 'email_otp' : 'passkey';
}

async function registration(device: ConformanceDevice, method: ConformanceMethod): Promise<void> {
  await device.register(method);
  await device.expectSignedIn();
  await device.sign();
}

async function unlockAndSigning(
  device: ConformanceDevice,
  method: ConformanceMethod,
): Promise<void> {
  await device.register(method);
  await device.lockAndReload();
  await device.unlock(method, 'registered');
  await device.sign();
  await device.reload();
  await device.sign();
}

async function stepUp(device: ConformanceDevice, method: ConformanceMethod): Promise<void> {
  await device.register(method);
  await device.sign();
  await device.signWithFreshProof();
  await device.exportKey();
}

/** The added method opens the wallet, and stays the only way in when the first one goes. */
async function addAndRemoveMethod(
  device: ConformanceDevice,
  method: ConformanceMethod,
): Promise<void> {
  const added = otherMethod(method);
  await device.register(method);
  await device.addMethod(added);
  await device.lockAndReload();
  await device.unlock(added, 'added');
  await device.sign();
  await device.removeMethod('registered');
  await device.expectLastMethodKept();
  await device.lockAndReload();
  await device.unlock(added, 'added');
  await device.sign();
}

async function signInOnEmptyBrowser(device: ConformanceDevice): Promise<void> {
  await device.register('passkey');
  await device.signInOnEmptyBrowser();
  await device.sign();
}

/** A linked device signs until the owner removes it, and the owner keeps signing. */
async function deviceLinking(device: ConformanceDevice): Promise<void> {
  await device.register('passkey');
  const linked = await device.linkNewDevice();
  await linked.sign();
  await device.removeLinkedDevice();
  await linked.expectCannotSign();
  await device.sign();
}

/** A recovery code recovers the account with a new passkey on a browser with empty storage. */
async function recovery(device: ConformanceDevice, method: ConformanceMethod): Promise<void> {
  await device.register(method);
  await device.sign();
  await device.recoverOnEmptyBrowser();
  await device.sign();
  if (method === 'passkey') return;
  // The recovered browser can add an email code again, and that code opens the wallet there.
  await device.addMethod('email_otp');
  await device.lockAndReload();
  await device.unlock('email_otp', 'added');
  await device.sign();
}

export const JOURNEYS: readonly Journey[] = [
  {
    title: 'registration with a passkey signs in and signs on both chains',
    method: 'passkey',
    run: (device) => registration(device, 'passkey'),
  },
  {
    title: 'registration with an email code signs in and signs on both chains',
    method: 'email_otp',
    run: (device) => registration(device, 'email_otp'),
  },
  {
    title: 'a passkey unlocks a locked wallet, and the session signs after a reload',
    method: 'passkey',
    run: (device) => unlockAndSigning(device, 'passkey'),
  },
  {
    title: 'an email code unlocks a locked wallet, and the session signs after a reload',
    method: 'email_otp',
    run: (device) => unlockAndSigning(device, 'email_otp'),
  },
  {
    title: 'a passkey wallet signs with a fresh proof when its session is used up, and exports',
    method: 'passkey',
    run: (device) => stepUp(device, 'passkey'),
  },
  {
    title: 'an email code wallet signs with a fresh proof when its session is used up, and exports',
    method: 'email_otp',
    run: (device) => stepUp(device, 'email_otp'),
  },
  {
    title: 'a passkey signs in on a browser with empty storage and signs',
    method: 'passkey',
    run: signInOnEmptyBrowser,
  },
  {
    title: 'an added email code opens the wallet and stays after the passkey is removed',
    method: 'passkey',
    run: (device) => addAndRemoveMethod(device, 'passkey'),
  },
  {
    title: 'an added passkey opens the wallet and stays after the email code is removed',
    method: 'email_otp',
    run: (device) => addAndRemoveMethod(device, 'email_otp'),
  },
  {
    title: 'a linked device signs until the owner removes it',
    method: 'passkey',
    run: deviceLinking,
  },
  {
    title: 'a recovery code recovers the account on a browser with empty storage',
    method: 'passkey',
    run: (device) => recovery(device, 'passkey'),
  },
  {
    title: 'a recovery code recovers an email code account on a browser with empty storage',
    method: 'email_otp',
    run: (device) => recovery(device, 'email_otp'),
  },
];
