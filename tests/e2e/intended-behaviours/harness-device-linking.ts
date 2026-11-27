import {
  type BrowserContext,
  expect,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { parseQrLinkedDeviceSessionPayloadV5 } from '@shared/device-linking/parsers';
import type { Variant } from '@shared/utils/variant';
import type {
  IntendedActionResult,
  IntendedDeviceLinkState,
  IntendedResult,
} from '../../intended-app/src/intendedContract';
import { randomUUID } from 'node:crypto';
import { RecoveryFlows } from './harness-recovery';
import { requireAuthenticatedKind, requireRecord, requireString } from './harness-validation';
import type { IntendedBehaviourHarness } from './harness';
import {
  type IntendedPageSnapshot,
  requireDeviceLinkApprovalResult,
} from './intended-page-snapshot';
import {
  requireLinkableRegisteredWallet,
  requireNearReadyRegisteredWallet,
} from './registered-wallet';
import {
  autoConfirmWalletIframeUntil,
  type WalletIframeAutoConfirmDiagnostics,
} from './wallet-iframe-confirm';

const LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1 = 'x-seams-intended-link-execute-fault-v1';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-link-execute-fault-token-v1';
const LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1 =
  'x-seams-intended-link-execute-fault-proof-v1';

async function readLinkedDevicesFromIntendedPage(): Promise<unknown> {
  const read = window.__seamsIntendedE2EReadLinkedDevices;
  if (!read) throw new Error('linked-device inventory helper is unavailable');
  return await read();
}

function presentDeviceLinkQrToIntendedPage(qrPayloadJson: string): void {
  window.__seamsIntendedE2EDeviceLinkQrPayloadJson = qrPayloadJson;
}

function presentLinkedDeviceRevocationToIntendedPage(revocationJson: string): void {
  window.__seamsIntendedE2ELinkedDeviceRevocationJson = revocationJson;
}

type LinkedDeviceOwnerMethodSnapshot = {
  readonly walletAuthMethodId: string;
  readonly credentialKind: 'passkey' | 'email_otp';
  readonly credentialIdB64u: string | null;
};

type LinkedDeviceEntrySnapshot = {
  readonly deviceId: string;
  readonly enrollmentId: string;
  readonly walletId: string;
  readonly walletAuthMethodId: string;
  readonly credentialKind: 'passkey' | 'email_otp';
  readonly state: 'provisioning' | 'active' | 'suspended' | 'expired' | 'revoked';
};

type LinkedDeviceInventorySnapshot = {
  readonly ownerDevices: readonly LinkedDeviceOwnerMethodSnapshot[];
  readonly devices: readonly LinkedDeviceEntrySnapshot[];
};

/** Device 2's settled link, read from page state rather than an action. */
type DeviceLinkSettledSnapshot = Variant<IntendedDeviceLinkState, 'status', 'active' | 'failed'>;

/** Linking a second device, and revoking it. */
export class DeviceLinkingFlows extends RecoveryFlows {
  /** The next device of a device-link contract, opened and closed by this one. */
  protected linkedDevice: {
    readonly harness: IntendedBehaviourHarness;
    readonly context: BrowserContext;
  } | null = null;

  /** This device's place in a device-link contract: Device 1 registered the wallet. */
  protected deviceNumber = 1;

  /**
   * Fixture teardown: attach the linked device's trace, apply its guards,
   * close it. A device it linked in turn closes first.
   */
  async closeLinkedDevice(testInfo: TestInfo): Promise<void> {
    const linked = this.linkedDevice;
    if (!linked) return;
    this.linkedDevice = null;
    try {
      await linked.harness.closeLinkedDevice(testInfo);
      await linked.harness.attachTrace(
        testInfo,
        `device-${linked.harness.deviceNumber}-intended-lifecycle-trace.json`,
      );
      linked.harness.assertNoLifecycleViolations();
      linked.harness.assertNoWrongAuthPath();
    } finally {
      await linked.context.close();
    }
  }

  /**
   * Device 2 shows a link QR, Device 1 approves the scanned payload, and
   * Device 2 answers its own passkey prompt. Both sides run at once, as they
   * do for a user holding two devices.
   *
   * Linking must add exactly one device-link authority with a fresh method,
   * leave Device 1's founding method untouched, and hand Device 2 a Wallet
   * Session whose NEAR identity is the wallet's existing one.
   */
  async linkDeviceWithPasskey(device2: IntendedBehaviourHarness): Promise<void> {
    this.recordStage('device_link_with_passkey');
    const target = `Device ${device2.deviceNumber}`;
    if (this.linkedDevice?.harness !== device2) {
      throw new Error(`${target} must be opened by this Device ${this.deviceNumber} harness`);
    }
    const registration = requireLinkableRegisteredWallet(this.requireRegisteredWalletForSigning());
    const before = await this.readLinkedDeviceInventory();
    /* Device 1 links first; each later link comes from the device linked
       just before it, so the wallet lists one linked device per earlier link. */
    if (before.devices.length !== this.deviceNumber - 1) {
      throw new Error(
        `wallet lists ${before.devices.length} linked devices before linking ${target}`,
      );
    }

    const qr = await device2.showDeviceLinkQr();
    await this.ensureIntendedPageOpen();
    await this.page.evaluate(presentDeviceLinkQrToIntendedPage, qr.qrPayloadJson);
    const approvalRun = this.runIntendedPageAction('scanAndLinkDevice');
    const activationRun = device2.waitForDeviceLinkAsTarget(qr.linkSessionId);
    /* Whichever side fails first names the failure. The other keeps running
       only until teardown closes its page, so its rejection is observed here. */
    approvalRun.catch(() => undefined);
    activationRun.catch(() => undefined);
    const [approvalSnapshot, active] = await Promise.all([approvalRun, activationRun]);
    const approval = requireDeviceLinkApprovalResult(approvalSnapshot, this.walletId);
    if (active.walletId !== this.walletId) {
      throw new Error(`${target} joined wallet ${active.walletId}; expected ${this.walletId}`);
    }
    if (active.enrollmentId !== approval.enrollmentId) {
      throw new Error(
        `${target} activated enrollment ${active.enrollmentId}; Device ${this.deviceNumber} approved ${approval.enrollmentId}`,
      );
    }
    for (const owner of before.ownerDevices) {
      if (active.sessionWalletAuthMethodId === owner.walletAuthMethodId) {
        throw new Error(`${target}'s Wallet Session names an existing owner method`);
      }
    }
    const walletNearAccountId = registration.nearAccountId ?? null;
    const walletOperationalPublicKey = registration.operationalPublicKey ?? null;
    if (
      active.nearAccountId !== walletNearAccountId ||
      active.operationalPublicKey !== walletOperationalPublicKey
    ) {
      throw new Error(
        `${target} holds NEAR ${active.nearAccountId}/${active.operationalPublicKey}; the wallet's is ${walletNearAccountId}/${walletOperationalPublicKey}`,
      );
    }

    /* Linking adds exactly one device and leaves every earlier one as it was. */
    const after = await this.readLinkedDeviceInventory();
    const earlier = new Set(before.devices.map((device) => JSON.stringify(device)));
    const [linked, ...extra] = after.devices.filter(
      (device) => !earlier.has(JSON.stringify(device)),
    );
    if (!linked || extra.length > 0 || after.devices.length !== before.devices.length + 1) {
      throw new Error(
        `linking ${target} must add exactly one device: ${JSON.stringify(before.devices)} -> ${JSON.stringify(after.devices)}`,
      );
    }
    if (
      linked.deviceId !== approval.deviceId ||
      linked.enrollmentId !== approval.enrollmentId ||
      linked.walletAuthMethodId !== active.sessionWalletAuthMethodId ||
      linked.credentialKind !== 'passkey' ||
      linked.state !== 'active'
    ) {
      throw new Error(
        `linked-device inventory does not name the device just linked: ${JSON.stringify(linked)}`,
      );
    }
    assertOwnerDevicesUnchanged(before, after, 'Device linking');

    /* A linked device signs with the wallet's public keys, so its signatures
       are verified against Device 1's registration rather than anything the
       linked device reports about itself. */
    device2.registeredWallet = registration;
    device2.nearSignerSlot = this.nearSignerSlot;
    device2.passkeyPromptCount += 1;
    this.recordService(
      `device linked wallet=${this.walletId} device=${linked.deviceId} method=${linked.walletAuthMethodId}`,
    );
  }

  /**
   * Device 1: its next source-contribution execute reaches the Router, which
   * runs Device 2's target registration and reserves its material, and the
   * local Gateway then loses the Router's answer. The Gateway must send that
   * same request again, marked as the Router's replay, and the Router must
   * answer it from the run it already made, with the same reservation. The
   * Gateway reports what it saw in a proof header.
   */
  async loseLinkExecuteRouterResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const executePath =
      /\/wallet\/device-linking\/v1\/sessions\/[^/]+\/source-contribution\/execute$/;
    const token = randomUUID();
    let armed = true;
    let proof: string | null = null;
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (
        !armed ||
        request.method() !== 'POST' ||
        !executePath.test(new URL(request.url()).pathname)
      ) {
        await route.fallback();
        return;
      }
      armed = false;
      const response = await route.fetch({
        headers: {
          ...request.headers(),
          [LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1]: 'drop_router_response_once',
          [LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1]: token,
        },
      });
      proof = response.headers()[LOCAL_INTENDED_LINK_EXECUTE_FAULT_PROOF_HEADER_V1] ?? null;
      await route.fulfill({ response });
    };
    await this.context.route('**/source-contribution/execute', handler);
    return {
      release: async () => {
        await this.context.unroute('**/source-contribution/execute', handler);
      },
      assertReplayed: () => {
        const expected = `${token}:replay_answered_same_reservation`;
        if (proof !== expected) {
          throw new Error(
            `linked-device execute expected the Router replay proof ${expected}, saw ${proof ?? 'none'}`,
          );
        }
        this.recordService(
          'linked-device execute lost its Router answer and replayed the reservation',
        );
      },
    };
  }

  /**
   * Device 2: lets its first successful activation reach the Gateway, which
   * activates the linked authority and both curves' reserved material, then
   * drops the response. Device 2 retries its committed delivery on its own;
   * the retry must carry the same installation receipt and receive exactly
   * the activation that was lost, never a second authority or session.
   */
  async loseLinkedActivationResponseOnce(): Promise<{
    readonly release: () => Promise<void>;
    readonly assertReplayed: () => void;
  }> {
    const receiptPath = /\/wallet\/device-linking\/v1\/sessions\/[^/]+\/receipt$/;
    type Attempt = { readonly request: string; readonly body: string };
    let lost: Attempt | null = null;
    let replayed: Attempt | null = null;
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      const requestBody = request.postData() ?? '';
      if (
        request.method() !== 'POST' ||
        !receiptPath.test(new URL(request.url()).pathname) ||
        !requestBody.includes('"local_authority_installation_receipt_v1"')
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const attempt = { request: requestBody, body: await response.text() };
      if (!lost && response.status() === 200) {
        lost = attempt;
        await route.abort('connectionreset');
        return;
      }
      if (lost && !replayed) replayed = attempt;
      await route.fulfill({ response });
    };
    await this.context.route('**/receipt', handler);
    return {
      release: async () => {
        await this.context.unroute('**/receipt', handler);
      },
      assertReplayed: () => {
        if (!lost || !replayed) {
          throw new Error(
            `linked-device activation expected one lost and one replayed response, saw lost=${Boolean(lost)} replayed=${Boolean(replayed)}`,
          );
        }
        const lostAttempt: Attempt = lost;
        const replayedAttempt: Attempt = replayed;
        if (replayedAttempt.request !== lostAttempt.request) {
          throw new Error('linked-device activation retry changed its installation receipt');
        }
        const activation = JSON.parse(lostAttempt.body) as {
          readonly kind?: unknown;
          readonly authority?: { readonly authorityId?: unknown };
        };
        if (activation.kind !== 'active') {
          throw new Error(`lost linked-device activation answered ${String(activation.kind)}`);
        }
        expect(JSON.parse(replayedAttempt.body)).toEqual(activation);
        this.recordService(
          `linked-device activation lost its response and replayed authority=${String(activation.authority?.authorityId)}`,
        );
      },
    };
  }

  /**
   * Device 1 revokes Device 2's exact method with a fresh assertion from its
   * own founding passkey, bound to this revocation's operation fingerprint.
   *
   * The SDK takes this proof as input and exposes no producer for it, so the
   * contract asks the authenticator for it inside the wallet frame - the
   * origin the Gateway checks for a request the wallet host sends.
   */
  async revokeLinkedDeviceWithOwnerPasskey(): Promise<void> {
    this.recordStage('revoke_linked_device_with_owner_passkey');
    const { before, linked } = await this.presentOnlyLinkedDeviceRevocation();
    const snapshot = await this.runIntendedPageAction('revokeLinkedDevice');
    if (snapshot.action.status !== 'success') {
      throw new Error(`linked-device revocation ended with ${snapshot.action.status}`);
    }
    const result = this.requireLinkedDeviceRevoked(snapshot.action.result, linked);

    await this.assertNoLinkedDeviceRemains(before);
    this.recordService(
      `linked device revoked method=${result.walletAuthMethodId} authority=${result.authorityId} epoch=${result.revocationEpoch}`,
    );
  }

  /**
   * Device 1 revokes its linked device with an email code from its Email OTP
   * method, as the account menu does, so Device 1 must be unlocked with that
   * method. The contract names the device and the time; the page requests a
   * challenge bound to the revocation and presents the code.
   */
  async revokeLinkedDeviceWithOwnerEmailOtp(
    options: { readonly refuseFirstRevocationCommit?: boolean } = {},
  ): Promise<void> {
    this.recordStage('revoke_linked_device_with_owner_email_otp');
    const { before, linked } = await this.presentOnlyLinkedDeviceRevocation();
    const refusedCommit = options.refuseFirstRevocationCommit
      ? await this.refuseFirstRevocationCommitOnce('linked_device')
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction('revokeLinkedDeviceWithEmailOtp');
    } finally {
      await refusedCommit?.release();
    }
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `linked-device revocation with an email code ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = this.requireLinkedDeviceRevoked(snapshot.action.result, linked);
    refusedCommit?.assertRecovered('email_otp');
    this.emailOtpVerificationCount += 1;

    await this.assertNoLinkedDeviceRemains(before);
    this.recordService(
      `linked device revoked with an email code method=${result.walletAuthMethodId} authority=${result.authorityId} epoch=${result.revocationEpoch}`,
    );
  }

  /**
   * Revocation retires Device 2's Wallet Session and signer activations, so
   * each signer family must refuse to sign rather than recover through
   * anything Device 1 still holds.
   */
  async assertRevokedDeviceCannotSign(): Promise<void> {
    this.recordStage('revoked_device_signing_refused');
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'Revoked-device signing',
    );
    const tempo = await this.runIntendedPageAction('signTempoTransaction', {
      expectedOutcome: 'error',
    });
    const near = await this.runIntendedPageAction('signNearTransaction', {
      nearAccountId: registration.nearAccountId,
      expectedOutcome: 'error',
    });
    for (const [label, snapshot] of [
      ['Tempo', tempo],
      ['NEAR', near],
    ] as const) {
      if (snapshot.action.status !== 'error') {
        throw new Error(`revoked Device 2 ${label} signing ended with ${snapshot.action.status}`);
      }
      this.recordService(`revoked Device 2 ${label} signing refused: ${snapshot.action.error}`);
    }
  }

  /** Device 1 names its only linked device as the target of the next revocation. */
  private async presentOnlyLinkedDeviceRevocation(): Promise<{
    readonly before: LinkedDeviceInventorySnapshot;
    readonly linked: LinkedDeviceEntrySnapshot;
  }> {
    const before = await this.readLinkedDeviceInventory();
    const [linked, ...extra] = before.devices;
    if (!linked || extra.length > 0) {
      throw new Error(`revocation expects one linked device, found ${before.devices.length}`);
    }
    await this.page.evaluate(
      presentLinkedDeviceRevocationToIntendedPage,
      JSON.stringify({ walletAuthMethodId: linked.walletAuthMethodId }),
    );
    return { before, linked };
  }

  /** The revocation removed the exact method of the device it named, on this wallet. */
  private requireLinkedDeviceRevoked(
    result: IntendedActionResult,
    linked: LinkedDeviceEntrySnapshot,
  ): IntendedResult<'linked_device_revoked'> {
    if (result.kind !== 'linked_device_revoked') {
      throw new Error(`linked-device revocation returned ${result.kind}`);
    }
    if (
      result.walletId !== this.walletId ||
      result.walletAuthMethodId !== linked.walletAuthMethodId
    ) {
      throw new Error(
        `revocation removed ${result.walletAuthMethodId} of ${result.walletId}; expected ${linked.walletAuthMethodId}`,
      );
    }
    return result;
  }

  /** No linked device is left, and Device 1's founding methods are as they were. */
  private async assertNoLinkedDeviceRemains(before: LinkedDeviceInventorySnapshot): Promise<void> {
    const after = await this.readLinkedDeviceInventory();
    if (after.devices.length !== 0) {
      throw new Error(`revoked device is still listed: ${JSON.stringify(after.devices)}`);
    }
    assertOwnerDevicesUnchanged(before, after, 'Linked-device revocation');
  }

  private async readLinkedDeviceInventory(): Promise<LinkedDeviceInventorySnapshot> {
    await this.ensureIntendedPageOpen();
    const inventory = parseLinkedDeviceInventory(
      await this.page.evaluate(readLinkedDevicesFromIntendedPage),
    );
    for (const device of inventory.devices) {
      if (device.walletId !== this.walletId) {
        throw new Error(`linked-device inventory listed a device of wallet ${device.walletId}`);
      }
    }
    return inventory;
  }

  /** Device 2: show the link QR and hand back its strictly parsed payload. */
  private async showDeviceLinkQr(): Promise<IntendedResult<'device_link_qr_ready'>> {
    this.recordStage('device_link_show_qr');
    const snapshot = await this.runIntendedPageAction('startDeviceLinkingAsTarget');
    if (snapshot.action.status !== 'success') {
      throw new Error(`device-link QR ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'device_link_qr_ready') {
      throw new Error(`device-link QR returned ${result.kind}`);
    }
    const payload = parseQrLinkedDeviceSessionPayloadV5(JSON.parse(result.qrPayloadJson));
    if (String(payload.linkSessionId) !== result.linkSessionId) {
      throw new Error('device-link QR payload names a different link session');
    }
    if (payload.targetFactor.kind !== 'passkey_prf') {
      throw new Error(`device-link QR targets ${payload.targetFactor.kind}, not a passkey`);
    }
    this.recordService(
      `Device ${this.deviceNumber} showing link QR session=${result.linkSessionId}`,
    );
    return result;
  }

  /**
   * Device 2: wait for the link to settle. The page answers the passkey prompt
   * itself; nothing is clicked on this page mid-link because the wallet keeps
   * its link surface over the page until the link settles.
   */
  private async waitForDeviceLinkAsTarget(
    linkSessionId: string,
  ): Promise<Omit<Variant<IntendedDeviceLinkState, 'status', 'active'>, 'status'>> {
    this.recordStage('device_link_target_settle');
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    try {
      await autoConfirmWalletIframeUntil(
        this.page,
        this.page.waitForFunction(intendedDeviceLinkSettled, undefined, { timeout: 150_000 }),
        { timeoutMs: 150_000, intervalMs: 250, diagnostics },
      );
    } catch (error) {
      throw new Error(
        [
          `Device ${this.deviceNumber} link did not settle: ${error instanceof Error ? error.message : String(error)}`,
          `Wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
    }
    const state = await readSettledDeviceLinkState(this.page);
    if (state.linkSessionId !== linkSessionId) {
      throw new Error(
        `Device ${this.deviceNumber} settled link ${state.linkSessionId}; expected ${linkSessionId}`,
      );
    }
    if (state.status === 'failed') {
      throw new Error(
        `Device ${this.deviceNumber} link failed: ${state.error}\n${this.recentTraceForError()}`,
      );
    }
    const { status: _status, ...active } = state;
    this.recordService(`Device ${this.deviceNumber} link active session=${linkSessionId}`);
    return active;
  }
}

function intendedDeviceLinkSettled(): boolean {
  const state = document
    .querySelector('[data-testid="intended-e2e-page"]')
    ?.getAttribute('data-device-link-state');
  return state === 'active' || state === 'failed';
}

async function readSettledDeviceLinkState(page: Page): Promise<DeviceLinkSettledSnapshot> {
  const text = await page.getByTestId('intended-result-json').textContent();
  if (!text) throw new Error('Intended page snapshot is empty');
  const snapshot = requireRecord(JSON.parse(text), 'intended page snapshot');
  const record = requireRecord(snapshot.deviceLink, 'device-link state');
  const status = requireString(record.status, 'device-link status');
  const linkSessionId = requireString(record.linkSessionId, 'device-link linkSessionId');
  switch (status) {
    case 'active':
      return {
        status,
        linkSessionId,
        walletId: requireString(record.walletId, 'device-link activation walletId'),
        enrollmentId: requireString(record.enrollmentId, 'device-link activation enrollmentId'),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'device-link activation sessionWalletAuthMethodId',
        ),
        nearAccountId:
          record.nearAccountId === null
            ? null
            : requireString(record.nearAccountId, 'device-link activation nearAccountId'),
        operationalPublicKey:
          record.operationalPublicKey === null
            ? null
            : requireString(
                record.operationalPublicKey,
                'device-link activation operationalPublicKey',
              ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'device-link activation authenticationKind',
        ),
      };
    case 'failed':
      return { status, linkSessionId, error: requireString(record.error, 'device-link error') };
    default:
      throw new Error(`device-link state is ${status}, not settled`);
  }
}

function parseLinkedDeviceCredentialKind(raw: unknown, label: string): 'passkey' | 'email_otp' {
  const value = requireString(raw, label);
  switch (value) {
    case 'passkey':
    case 'email_otp':
      return value;
    default:
      throw new Error(`${label} is ${value}`);
  }
}

function parseLinkedDeviceState(raw: unknown): LinkedDeviceEntrySnapshot['state'] {
  const value = requireString(raw, 'linked device state');
  switch (value) {
    case 'provisioning':
    case 'active':
    case 'suspended':
    case 'expired':
    case 'revoked':
      return value;
    default:
      throw new Error(`linked device state is ${value}`);
  }
}

function parseLinkedDeviceInventory(raw: unknown): LinkedDeviceInventorySnapshot {
  const record = requireRecord(raw, 'linked-device inventory');
  if (!Array.isArray(record.ownerDevices) || !Array.isArray(record.devices)) {
    throw new Error('linked-device inventory must list owner devices and linked devices');
  }
  return {
    ownerDevices: record.ownerDevices.map((entry): LinkedDeviceOwnerMethodSnapshot => {
      const owner = requireRecord(entry, 'owner device');
      const credentialKind = parseLinkedDeviceCredentialKind(
        owner.credentialKind,
        'owner device credential kind',
      );
      return {
        walletAuthMethodId: requireString(owner.walletAuthMethodId, 'owner walletAuthMethodId'),
        credentialKind,
        credentialIdB64u:
          credentialKind === 'passkey'
            ? requireString(owner.credentialIdB64u, 'owner passkey credential id')
            : null,
      };
    }),
    devices: record.devices.map((entry): LinkedDeviceEntrySnapshot => {
      const device = requireRecord(entry, 'linked device');
      return {
        deviceId: requireString(device.deviceId, 'linked deviceId'),
        enrollmentId: requireString(device.enrollmentId, 'linked enrollmentId'),
        walletId: requireString(device.walletId, 'linked device walletId'),
        walletAuthMethodId: requireString(
          device.walletAuthMethodId,
          'linked device walletAuthMethodId',
        ),
        credentialKind: parseLinkedDeviceCredentialKind(
          device.credentialKind,
          'linked device credential kind',
        ),
        state: parseLinkedDeviceState(device.state),
      };
    }),
  };
}

function assertOwnerDevicesUnchanged(
  before: LinkedDeviceInventorySnapshot,
  after: LinkedDeviceInventorySnapshot,
  label: string,
): void {
  const describe = (inventory: LinkedDeviceInventorySnapshot): string =>
    JSON.stringify(inventory.ownerDevices.map((owner) => owner.walletAuthMethodId).sort());
  if (describe(before) !== describe(after)) {
    throw new Error(
      `${label} changed Device 1's founding methods: ${describe(before)} -> ${describe(after)}`,
    );
  }
}
