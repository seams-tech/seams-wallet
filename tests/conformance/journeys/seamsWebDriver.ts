import type { Browser } from '@playwright/test';
import type {
  IntendedBehaviourHarness,
  IntendedSigningStage,
} from '../../e2e/intended-behaviours/harness';
import type { ConformanceDevice, ConformanceMethod, ConformanceMethodRole } from './driver';
import type { Journey } from './journeys';

/**
 * The driver for today's API: the intended-behaviour harness, which calls `SeamsWeb` in the
 * intended test app against a local Wallet system. It goes away with the `SeamsWeb` API.
 */
class SeamsWebDevice implements ConformanceDevice {
  private readonly harness: IntendedBehaviourHarness;
  private readonly browser: Browser;
  /** What the harness expects of the next signature: a warm session or a fresh proof. */
  private stage: IntendedSigningStage;
  private method: ConformanceMethod = 'passkey';

  constructor(harness: IntendedBehaviourHarness, browser: Browser, stage: IntendedSigningStage) {
    this.harness = harness;
    this.browser = browser;
    this.stage = stage;
  }

  async register(method: ConformanceMethod): Promise<void> {
    if (method === 'passkey') await this.harness.registerPasskeyWallet();
    else await this.harness.registerEmailOtpWallet();
    await this.harness.awaitNearReady();
    this.method = method;
    this.stage = 'post_registration';
  }

  async expectSignedIn(): Promise<void> {
    await this.harness.assertRegistrationOwnerSessionIsActive();
  }

  async signInOnEmptyBrowser(): Promise<void> {
    this.requirePasskeyAccount('sign-in on an empty browser');
    await this.harness.syncPasskeyWalletFromEmptyStorage();
    this.stage = 'post_unlock';
  }

  async lockAndReload(): Promise<void> {
    await this.harness.assertLockedPageReloadStaysLocked();
  }

  async unlock(method: ConformanceMethod, role: ConformanceMethodRole): Promise<void> {
    if (method === 'passkey') {
      if (role === 'registered') await this.harness.unlockPasskeyWallet();
      else await this.harness.unlockWithAddedPasskey();
    } else if (role === 'registered') await this.harness.unlockEmailOtpWallet();
    else await this.harness.unlockWithAddedEmailOtp();
    this.stage = 'post_unlock';
  }

  async reload(): Promise<void> {
    await this.harness.refreshPagePreservingWalletStorage();
    this.stage = 'after_refresh_recovery';
  }

  async sign(): Promise<void> {
    const stage = this.stage;
    if (stage === 'after_refresh_recovery') await this.harness.signNearTransactionAfterRefresh();
    else await this.harness.signNearTransaction(stage);
    await this.harness.signTempoTransaction(stage);
  }

  async signWithFreshProof(): Promise<void> {
    await this.harness.exhaustSigningBudget();
    this.stage = 'step_up_required';
    await this.harness.signNearTransaction(this.stage);
  }

  async exportKey(): Promise<void> {
    await this.harness.exportEcdsaKey();
  }

  async addMethod(method: ConformanceMethod): Promise<void> {
    if (method === 'passkey') await this.harness.addPasskeyAuthMethod();
    else await this.harness.addEmailOtpAuthMethod();
  }

  async removeMethod(role: ConformanceMethodRole): Promise<void> {
    await this.harness.revokeSourceAuthMethod(role === 'registered' ? 'source' : 'added');
  }

  async expectLastMethodKept(): Promise<void> {
    await this.harness.assertFinalAuthMethodCannotBeRevoked();
  }

  async linkNewDevice(): Promise<ConformanceDevice> {
    this.requirePasskeyAccount('device linking');
    const linked = await this.harness.openLinkedDevice(this.browser);
    await this.harness.linkDeviceWithPasskey(linked);
    return new SeamsWebDevice(linked, this.browser, 'post_device_link');
  }

  async removeLinkedDevice(): Promise<void> {
    this.requirePasskeyAccount('removing a linked device');
    await this.harness.revokeLinkedDeviceWithOwnerPasskey();
  }

  async expectCannotSign(): Promise<void> {
    await this.harness.assertRevokedDeviceCannotSign();
  }

  async recoverOnEmptyBrowser(): Promise<void> {
    await this.harness.recoverPasskeyWalletFromFreshBrowser();
    await this.harness.assertRecoveryAuthorityIsAdditive('passkey');
    this.stage = 'post_unlock';
  }

  /** The harness drives these steps for a passkey account only. */
  private requirePasskeyAccount(step: string): void {
    if (this.method === 'passkey') return;
    throw new Error(`The SeamsWeb driver runs ${step} on passkey accounts only`);
  }
}

/** The body of a test that runs one journey with today's API. */
export function runWithSeamsWeb(journey: Journey) {
  return async ({ harness, browser }: { harness: IntendedBehaviourHarness; browser: Browser }) => {
    await journey.run(new SeamsWebDevice(harness, browser, 'post_registration'));
  };
}
