import {
  expect,
  type Response,
  type BrowserContext,
  type Route,
  type Browser,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { SigningTimingEvidence } from './signing-timing-evidence';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

function enableLinkedSigningTiming(): void {
  process.env.SEAMS_INTENDED_SIGNING_SESSION_DEBUG = '1';
}

test.beforeAll(enableLinkedSigningTiming);

class LinkedActivationPrefillEvidence {
  private readonly responses: { device: number; response: Response }[] = [];

  record(device: number, response: Response): void {
    if (
      response.ok() &&
      new URL(response.url()).pathname === '/router-ab/ecdsa-derivation/presignature-pool/fill/step'
    ) {
      this.responses.push({ device, response });
    }
  }

  async completed(device: number): Promise<string[]> {
    const ids = [];
    for (const entry of this.responses) {
      if (entry.device !== device) continue;
      const body: unknown = await entry.response.json();
      if (!isPlainObject(body)) throw new Error('Invalid presign step response');
      if (body.event !== 'presign_done') continue;
      if (typeof body.presignatureId !== 'string')
        throw new Error('Missing completed material identity');
      ids.push(body.presignatureId);
    }
    return ids;
  }

  async count(device: number): Promise<number> {
    return (await this.completed(device)).length;
  }
}

function newlyOpenedContext(browser: Browser, previous: readonly BrowserContext[]): BrowserContext {
  const opened = browser.contexts().filter(isNewContext.bind(undefined, previous));
  if (opened.length !== 1) throw new Error('Expected one linked-device browser context');
  return opened[0];
}

function isNewContext(previous: readonly BrowserContext[], context: BrowserContext): boolean {
  return !previous.includes(context);
}

function preparedPresignatureId(response: Response): string | null {
  if (!response.url().endsWith('/sign/prepare')) return null;
  const body: unknown = response.request().postDataJSON();
  if (!isPlainObject(body) || typeof body.client_presignature_id !== 'string') {
    throw new Error('Signing prepare omitted its presignature identity');
  }
  return body.client_presignature_id;
}

class LinkedSigningMeasurements {
  device = 0;
  signature = 0;
  readonly timing = new SigningTimingEvidence();
  readonly signatures: {
    device: number;
    signature: number;
    browserWindowMs: number;
    clientTiming: ReturnType<SigningTimingEvidence['window']>;
  }[] = [];
  private readonly responses: {
    readonly device: number;
    readonly signature: number;
    readonly response: Response;
  }[] = [];

  record(response: Response): void {
    const pathname = new URL(response.url()).pathname;
    if (
      pathname === '/router-ab/ecdsa-derivation/sign' ||
      pathname === '/router-ab/ecdsa-derivation/sign/prepare'
    ) {
      this.responses.push({ device: this.device, signature: this.signature, response });
    }
  }

  async sign(
    harness: IntendedBehaviourHarness,
    device: number,
    signature: number,
    stage: 'post_registration' | 'post_device_link',
  ): Promise<void> {
    this.device = device;
    this.signature = signature;
    const startedAt = performance.now();
    await harness.signTempoTransaction(stage);
    const endedAt = performance.now();
    this.signatures.push({
      device,
      signature,
      browserWindowMs: endedAt - startedAt,
      clientTiming: this.timing.window(startedAt, endedAt),
    });
  }

  async evidence() {
    const measurements = [];
    for (const { device, signature, response } of this.responses) {
      const header = await response.headerValue('X-Benchmark-D1');
      measurements.push({
        device,
        signature,
        path: new URL(response.url()).pathname,
        status: response.status(),
        preparedPresignatureId: preparedPresignatureId(response),
        gatewayPlacement: await response.headerValue('X-Benchmark-Placement'),
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
 * address stay the same, and every device signs repeatedly so the second
 * linked signing exercises inventory after the presign authority switch.
 */
test('a linked device links a third device on an ECDSA-only wallet, which signs Tempo', async ({
  harness,
  browser,
}, testInfo) => {
  await harness.registerPasskeyEcdsaOnlyWallet();

  const prefills = new LinkedActivationPrefillEvidence();
  const originalContexts = browser.contexts();
  const device2 = await harness.openLinkedDevice(browser);
  const device2Context = newlyOpenedContext(browser, originalContexts);
  const recordDevice2Prefill = prefills.record.bind(prefills, 2);
  device2Context.on('response', recordDevice2Prefill);
  await harness.linkDeviceWithPasskey(device2);
  await expect.poll(prefills.count.bind(prefills, 2), { timeout: 60_000 }).toBeGreaterThan(0);
  const beforeDevice3 = browser.contexts();
  const device3 = await device2.openLinkedDevice(browser);
  const device3Context = newlyOpenedContext(browser, beforeDevice3);
  const recordDevice3Prefill = prefills.record.bind(prefills, 3);
  device3Context.on('response', recordDevice3Prefill);
  await device2.linkDeviceWithPasskey(device3);
  await expect.poll(prefills.count.bind(prefills, 3), { timeout: 60_000 }).toBeGreaterThan(0);
  const readyBeforeSigning = {
    device2: await prefills.completed(2),
    device3: await prefills.completed(3),
  };

  const measurements = new LinkedSigningMeasurements();
  const record = measurements.record.bind(measurements);
  const recordTiming = measurements.timing.record.bind(measurements.timing);
  const contexts = browser.contexts();
  for (const context of contexts) {
    context.on('response', record);
    context.on('console', recordTiming);
  }
  try {
    for (const signature of [1, 2, 3]) {
      await measurements.sign(device3, 3, signature, 'post_device_link');
      await measurements.sign(device2, 2, signature, 'post_device_link');
      await measurements.sign(harness, 1, signature, 'post_registration');
    }
  } finally {
    for (const context of contexts) {
      context.off('response', record);
      context.off('console', recordTiming);
    }
  }
  device2Context.off('response', recordDevice2Prefill);
  device3Context.off('response', recordDevice3Prefill);
  const responses = await measurements.evidence();
  for (const response of responses) {
    if (response.signature !== 1 || response.preparedPresignatureId === null) continue;
    if (response.device === 2)
      expect(readyBeforeSigning.device2).toContain(response.preparedPresignatureId);
    if (response.device === 3)
      expect(readyBeforeSigning.device3).toContain(response.preparedPresignatureId);
  }
  const hosted = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';
  const region = process.env.SEAMS_INTENDED_PROBE_REGION;
  const runId = process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID;
  const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
  if (
    hosted &&
    (!region ||
      !runId ||
      !/^[a-z0-9-]+$/u.test(region) ||
      !/^[a-z0-9-]+$/u.test(runId) ||
      (arm !== 'do' && arm !== 'd1'))
  ) {
    throw new Error('Hosted linked workload requires region, run identity, and backend arm');
  }
  const evidence = {
    kind: 'gateway_ecdsa_linked_custody_chain_v1',
    host: hosted ? `hosted_${arm}` : (process.env.SEAMS_INTENDED_WALLET_HOST ?? 'workers_local'),
    verifiedSignatures: 9,
    signatures: measurements.signatures,
    backgroundRefills: measurements.timing.refillResults,
    readyBeforeSigning,
    responses,
  };
  const suffix = hosted ? `-${region}-${runId}-${testInfo.repeatEachIndex}` : '';
  const artifactName = `gateway-ecdsa-linked-chain-${evidence.host}${suffix}.json`;
  const artifactPath = path.resolve(
    testInfo.config.rootDir,
    hosted ? '../.artifacts/r151' : '../.artifacts/r150',
    artifactName,
  );
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
  readonly rejections: {
    boundary: string;
    status: number;
    proof: string;
    quotaBefore: number;
    quotaAfter: number;
  }[] = [];
  exactReplayMatches = false;

  constructor(readonly material: 'canonical' | 'linked') {}

  async rejectRetiredMaterial(
    route: Route,
    boundary: 'claim' | 'existing',
    target: 'canonical' | 'linked',
  ): Promise<void> {
    const token = randomUUID();
    const mode = `${target}_${boundary}`;
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        'x-seams-intended-material-admission-fault-v1': mode,
        'x-seams-intended-material-admission-token-v1': token,
      },
    });
    const proof = response.headers()['x-seams-intended-material-admission-proof-v1'];
    expect(proof).toMatch(new RegExp(`^${token}:${mode}:[1-9][0-9]*:[0-9]+:[0-9]+$`));
    const [observedToken, observedMode, rows, quotaBefore, quotaAfter] = proof.split(':');
    expect(observedToken).toBe(token);
    expect(observedMode).toBe(mode);
    expect(Number(rows)).toBeGreaterThan(0);
    expect(quotaAfter).toBe(quotaBefore);
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'material_mismatch' });
    this.rejections.push({
      boundary,
      status: response.status(),
      proof,
      quotaBefore: Number(quotaBefore),
      quotaAfter: Number(quotaAfter),
    });
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
    if (this.material === 'linked')
      await this.rejectRetiredMaterial(route, 'existing', 'canonical');
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const signature: unknown = await response.json();
    await this.rejectRetiredMaterial(route, 'existing', this.material);
    if (this.material === 'linked')
      await this.rejectRetiredMaterial(route, 'existing', 'canonical');
    const replay = await route.fetch();
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(signature);
    this.exactReplayMatches = true;
    await route.fulfill({ response });
  }
}

async function installRace(
  contexts: readonly BrowserContext[],
  race: MaterialAdmissionRace,
): Promise<void> {
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

test('material retirement between resolution and admission rejects canonical and linked claims, finalize, and replay', async ({
  harness,
  browser,
}, testInfo) => {
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
    canonical,
    linked,
  };
  const artifact = `material-admission-race-${evidence.host}.json`;
  const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r151', artifact);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2), 'utf8');
  await testInfo.attach(artifact, {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
