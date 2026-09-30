import { expect, type Response, type BrowserContext, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intendedTest as test } from './harness';

class LinkedSigningMeasurements {
  device = 0;
  private readonly responses: { readonly device: number; readonly response: Response }[] = [];

  record(response: Response): void {
    const pathname = new URL(response.url()).pathname;
    if (
      pathname === '/router-ab/ecdsa-derivation/sign' ||
      pathname === '/router-ab/ecdsa-derivation/sign/prepare'
    ) {
      this.responses.push({ device: this.device, response });
    }
  }

  async evidence(): Promise<unknown[]> {
    const measurements = [];
    for (const { device, response } of this.responses) {
      const header = await response.headerValue('X-Benchmark-D1');
      measurements.push({
        device,
        path: new URL(response.url()).pathname,
        status: response.status(),
        d1: header === null ? null : JSON.parse(header),
      });
    }
    return measurements;
  }
}

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
}, testInfo) => {
  await harness.registerPasskeyEcdsaOnlyWallet();

  const device2 = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(device2);
  const device3 = await device2.openLinkedDevice(browser);
  await device2.linkDeviceWithPasskey(device3);

  const measurements = new LinkedSigningMeasurements();
  const record = measurements.record.bind(measurements);
  const contexts = browser.contexts();
  for (const context of contexts) context.on('response', record);
  try {
    measurements.device = 3;
    await device3.signTempoTransaction('post_device_link');
    measurements.device = 2;
    await device2.signTempoTransaction('post_device_link');
    measurements.device = 1;
    await harness.signTempoTransaction('post_registration');
  } finally {
    for (const context of contexts) context.off('response', record);
  }
  const evidence = {
    kind: 'gateway_ecdsa_linked_custody_chain_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    verifiedSignatures: 3,
    responses: await measurements.evidence(),
  };
  const artifactName = `gateway-ecdsa-linked-chain-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifactName, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});

/**
 * On a wallet with NEAR, approving a link also hands the new device the
 * wallet's Ed25519 export root. Device 2 holds that root only as its own
 * sealed envelope, which its unlock opens for linking, and never as the
 * wallet custody seed. Device 3 is linked from Device 2's own material on
 * both curves, signs with the wallet's keys and exports them.
 */
test('a linked device links a third device, which signs NEAR and Tempo and exports both keys', async ({
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
  /* Device 3 exports both keys from its own custody: the Ed25519 key from the
     export root Device 2 sealed to it, which must match the wallet's
     registered key, and the ECDSA key from its own share. */
  await device3.exportEd25519Key();
  await device3.exportEcdsaKey();
  /* Linking Device 3 changed nothing for the devices that were already
     signing. */
  await device2.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_registration');
});

/**
 * Device 1 revokes Device 2 with an email code from the Email OTP method it
 * added. The Gateway refuses the revocation's first commit and that answer is
 * lost too, so the SDK sends the exact request again. The code is spent only
 * by the batch that revokes, so the retry commits on it. The committed request
 * sent once more is answered from the record, exactly, although its code is
 * spent, and copies naming another time or another code are refused. Device 2
 * then cannot sign, and Device 1 still signs.
 */
test('a linked device revoked with an email code across a refused commit is answered from what committed', async ({
  harness,
  browser,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();

  const device2 = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(device2);
  await device2.signTempoTransaction('post_device_link');

  /* Added after linking, which proves with the wallet's one founding passkey.
     The code proves the revocation only from a session on its own method. */
  await harness.addEmailOtpAuthMethod();
  await harness.unlockWithAddedEmailOtp();
  await harness.revokeLinkedDeviceWithOwnerEmailOtp({ refuseFirstRevocationCommit: true });
  await device2.assertRevokedDeviceCannotSign();
  await harness.signTempoTransaction('post_unlock');
});

const preparePath = '**/router-ab/ecdsa-derivation/sign/prepare';
const finalizePath = '**/router-ab/ecdsa-derivation/sign';

class MaterialAdmissionRace {
  readonly rejections: { boundary: string; status: number; proof: string; quotaBefore: number; quotaAfter: number }[] = [];
  exactReplayMatches = false;

  constructor(readonly material: 'canonical' | 'linked') {}

  async rejectRetiredMaterial(
    route: Route,
    boundary: 'claim' | 'existing',
    target: 'canonical' | 'linked',
  ): Promise<void> {
    const token = randomUUID();
    const mode = `${target}_${boundary}`;
    const response = await route.fetch({ headers: {
      ...route.request().headers(),
      'x-seams-intended-material-admission-fault-v1': mode,
      'x-seams-intended-material-admission-token-v1': token,
    } });
    const proof = response.headers()['x-seams-intended-material-admission-proof-v1'];
    expect(proof).toMatch(new RegExp(`^${token}:${mode}:[1-9][0-9]*:[0-9]+:[0-9]+$`));
    const [observedToken, observedMode, rows, quotaBefore, quotaAfter] = proof.split(':');
    expect(observedToken).toBe(token);
    expect(observedMode).toBe(mode);
    expect(Number(rows)).toBeGreaterThan(0);
    expect(quotaAfter).toBe(quotaBefore);
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'material_mismatch' });
    this.rejections.push({ boundary, status: response.status(), proof, quotaBefore: Number(quotaBefore), quotaAfter: Number(quotaAfter) });
  }

  async prepare(route: Route): Promise<void> {
    await this.rejectRetiredMaterial(route, 'claim', this.material);
    if (this.material === 'linked') await this.rejectRetiredMaterial(route, 'claim', 'canonical');
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ response });
  }

  async finalize(route: Route): Promise<void> {
    await this.rejectRetiredMaterial(route, 'existing', this.material);
    if (this.material === 'linked') await this.rejectRetiredMaterial(route, 'existing', 'canonical');
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const signature: unknown = await response.json();
    await this.rejectRetiredMaterial(route, 'existing', this.material);
    if (this.material === 'linked') await this.rejectRetiredMaterial(route, 'existing', 'canonical');
    const replay = await route.fetch();
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(signature);
    this.exactReplayMatches = true;
    await route.fulfill({ response });
  }
}

async function installRace(contexts: readonly BrowserContext[], race: MaterialAdmissionRace): Promise<void> {
  for (const context of contexts) {
    await context.route(preparePath, race.prepare.bind(race));
    await context.route(finalizePath, race.finalize.bind(race));
  }
}

async function removeRace(contexts: readonly BrowserContext[]): Promise<void> {
  for (const context of contexts) {
    await context.unroute(preparePath);
    await context.unroute(finalizePath);
  }
}

test('material retirement between resolution and admission rejects canonical and linked claims, finalize, and replay', async ({ harness, browser }, testInfo) => {
  await harness.registerPasskeyEcdsaOnlyWallet();
  const canonical = new MaterialAdmissionRace('canonical');
  let contexts = browser.contexts();
  await installRace(contexts, canonical);
  try {
    await harness.signTempoTransaction('post_registration');
  } finally {
    await removeRace(contexts);
  }
  const device2 = await harness.openLinkedDevice(browser);
  await harness.linkDeviceWithPasskey(device2);
  const device3 = await device2.openLinkedDevice(browser);
  await device2.linkDeviceWithPasskey(device3);
  const linked = new MaterialAdmissionRace('linked');
  contexts = browser.contexts();
  await installRace(contexts, linked);
  try {
    await device3.signTempoTransaction('post_device_link');
  } finally {
    await removeRace(contexts);
  }
  expect(canonical.rejections).toHaveLength(3);
  expect(linked.rejections).toHaveLength(6);
  expect(canonical.exactReplayMatches && linked.exactReplayMatches).toBe(true);
  const evidence = {
    kind: 'ecdsa_material_admission_race_v1',
    host: process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local',
    verifiedSignatures: 2,
    canonical, linked,
  };
  const artifact = `material-admission-race-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifact);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifact, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});
