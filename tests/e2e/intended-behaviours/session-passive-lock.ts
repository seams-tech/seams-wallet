import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { IntendedBehaviourHarness } from './harness';
import { walletFrame } from './session-restore-lock';

class SessionTrafficProbe {
  static original: MessagePort['postMessage'];
  static sessionQueries: number;
  static sessionEvents: number;

  static install(): void {
    SessionTrafficProbe.original = MessagePort.prototype.postMessage;
    SessionTrafficProbe.sessionQueries = 0;
    SessionTrafficProbe.sessionEvents = 0;
    MessagePort.prototype.postMessage = SessionTrafficProbe.post;
  }

  static post(this: MessagePort, ...args: unknown[]): void {
    const message = args[0];
    if (message !== null && typeof message === 'object') {
      const type = Reflect.get(message, 'type');
      if (type === 'PM_GET_EXACT_WALLET_SESSION_STATE' || type === 'PM_GET_WALLET_SESSION') {
        SessionTrafficProbe.sessionQueries += 1;
      }
      if (type === 'SESSION_CHANGED') SessionTrafficProbe.sessionEvents += 1;
    }
    Reflect.apply(SessionTrafficProbe.original, this, args);
  }

  static read(): { sessionQueries: number; sessionEvents: number } {
    return {
      sessionQueries: SessionTrafficProbe.sessionQueries,
      sessionEvents: SessionTrafficProbe.sessionEvents,
    };
  }
}

type SessionTraffic = ReturnType<typeof SessionTrafficProbe.read>;

function reportPassiveTabError(error: Error): void {
  console.error('[passive-lock-page-error]', error);
}

export async function verifyPassiveWalletLock(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(180_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const other = await page.context().newPage();
  other.on('pageerror', reportPassiveTabError);
  try {
    await other.addInitScript({
      content: `${SessionTrafficProbe.toString()}; SessionTrafficProbe.install(); globalThis.__walletSessionTrafficProbe = SessionTrafficProbe;`,
    });
    await other.goto(page.url(), { waitUntil: 'domcontentloaded' });
    const otherUi = other.getByTestId('intended-e2e-page');
    await expect(otherUi).toHaveAttribute('data-login-state', 'logged_in');
    const frame = await walletFrame(other);
    const beforeClient = await other.evaluate<SessionTraffic>(
      'globalThis.__walletSessionTrafficProbe.read()',
    );
    const beforeHost = await frame.evaluate<SessionTraffic>(
      'globalThis.__walletSessionTrafficProbe.read()',
    );
    await harness.lockWallet();
    await expect(otherUi).toHaveAttribute('data-login-state', 'logged_out');
    await expect(otherUi).toHaveAttribute('data-login-wallet-id', '');
    const afterClient = await other.evaluate<SessionTraffic>(
      'globalThis.__walletSessionTrafficProbe.read()',
    );
    const afterHost = await frame.evaluate<SessionTraffic>(
      'globalThis.__walletSessionTrafficProbe.read()',
    );
    expect(afterClient.sessionQueries).toBe(beforeClient.sessionQueries);
    expect(afterHost.sessionEvents).toBeGreaterThan(beforeHost.sessionEvents);
    const artifact = testInfo.outputPath('passive-cross-tab-lock.json');
    await writeFile(
      artifact,
      JSON.stringify({ beforeClient, beforeHost, afterClient, afterHost }, null, 2),
    );
    await testInfo.attach('passive cross-tab lock', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await other.close();
  }
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
}
