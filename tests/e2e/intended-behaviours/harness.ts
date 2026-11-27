import { test as base, type Browser, type BrowserContext } from '@playwright/test';
import { DeviceLinkingFlows } from './harness-device-linking';
import {
  installHostedBenchmarkAccess,
  intendedNetworkModeFromEnv,
  lifecycleFlowFromTestFile,
} from './harness-environment';
import { requireLinkableRegisteredWallet } from './registered-wallet';

/** The harness a contract test drives: every flow layer, and the devices it links. */
export class IntendedBehaviourHarness extends DeviceLinkingFlows {
  /**
   * Opens the next device for this wallet: a fresh browser context with its
   * own storage and its own virtual authenticator. It shares nothing with the
   * devices already open except the wallet it is about to join, which is why
   * it starts on the same wallet id and no credential. A linked device opens
   * the device it will approve in turn.
   */
  async openLinkedDevice(
    browser: Browser,
    prepareContext?: (context: BrowserContext) => Promise<void>,
  ): Promise<IntendedBehaviourHarness> {
    this.recordStage('open_linked_device');
    requireLinkableRegisteredWallet(this.requireRegisteredWalletForSigning());
    const deviceNumber = this.deviceNumber + 1;
    if (this.linkedDevice) throw new Error(`Device ${deviceNumber} is already open`);
    const context = await browser.newContext();
    try {
      if (this.networkMode === 'external_staging') {
        await installHostedBenchmarkAccess(context);
      }
      await prepareContext?.(context);
      const page = await context.newPage();
      const device2 = new IntendedBehaviourHarness({
        context,
        flow: this.flow,
        networkMode: this.networkMode,
        page,
        request: this.request,
      });
      device2.walletId = this.walletId;
      device2.deviceNumber = deviceNumber;
      this.linkedDevice = { harness: device2, context };
      await device2.initialize();
      this.recordService(
        `Device ${deviceNumber} opened with its own storage and virtual authenticator`,
      );
      return device2;
    } catch (error) {
      if (!this.linkedDevice) await context.close();
      throw error;
    }
  }
}

export const intendedTest = base.extend<{
  harness: IntendedBehaviourHarness;
}>({
  harness: async ({ context, page, request }, use, testInfo) => {
    const flow = lifecycleFlowFromTestFile(testInfo.file);
    const networkMode = intendedNetworkModeFromEnv();
    if (networkMode === 'external_staging') {
      await installHostedBenchmarkAccess(context);
    }
    const harness = new IntendedBehaviourHarness({
      context,
      flow,
      networkMode,
      page,
      request,
    });
    await harness.initialize();
    await use(harness);
    await harness.attachTrace(testInfo);
    await harness.closeLinkedDevice(testInfo);
    harness.assertNoLifecycleViolations();
    harness.assertNoWrongAuthPath();
  },
});
