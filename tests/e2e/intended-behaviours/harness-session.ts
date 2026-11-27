import { expect } from '@playwright/test';
import { isRequestTraceEntry, type TraceEntry } from './harness-core';
import { SigningFlows } from './harness-signing';
import {
  requireEmailOtpUnlockResult,
  requirePasskeySyncResult,
  requirePasskeyUnlockResult,
} from './intended-page-snapshot';
import {
  requireEmailOtpRegisteredWalletSnapshot,
  requireNearReadyRegisteredWallet,
  requirePasskeyRegisteredWalletSnapshot,
} from './registered-wallet';

async function lockWalletFromIntendedPage(): Promise<void> {
  const lock = window.__seamsIntendedE2ELockWallet;
  if (!lock) throw new Error('Wallet lock helper is unavailable');
  await lock();
}

async function readWalletLockStateFromIntendedPage() {
  const read = window.__seamsIntendedE2EReadWalletLockState;
  if (!read) throw new Error('Wallet lock-state helper is unavailable');
  return await read();
}

function isRegistrationPostRequest(entry: TraceEntry): boolean {
  return isRequestTraceEntry(entry) && entry.message.startsWith('POST /wallets/register/');
}

function isWalletUnlockVerifyRequest(entry: TraceEntry): boolean {
  return entry.url !== undefined && new URL(entry.url).pathname === '/wallet/unlock/verify';
}

function isWalletSessionStatusRequest(entry: TraceEntry): boolean {
  return entry.url !== undefined && new URL(entry.url).pathname === '/wallet/session/status';
}

/** Unlock, cold sync, reload and lock of a registered wallet. */
export class SessionFlows extends SigningFlows {
  async unlockPasskeyWithPendingNear(): Promise<void> {
    this.recordStage('unlock_passkey_with_pending_near');
    await this.resetRuntimeOnlyState();
    const snapshot = await this.runIntendedPageAction('unlockPasskeyWallet');
    if (snapshot.action?.status !== 'success')
      throw new Error('Pending NEAR Passkey unlock failed');
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
  }

  async unlockEmailOtpWithPendingNear(): Promise<void> {
    this.recordStage('unlock_email_otp_with_pending_near');
    await this.resetRuntimeOnlyState();
    const snapshot = await this.runIntendedPageAction('unlockEmailOtpWallet');
    if (snapshot.action?.status !== 'success') {
      throw new Error('Pending NEAR Email OTP unlock failed');
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
  }

  async unlockPasskeyWallet(options?: { readonly stopAfterClick?: boolean }): Promise<void> {
    this.recordStage('unlock_passkey_wallet');
    const registration = this.requireRegisteredWalletForSigning();
    if (registration.nearReadiness === 'pending') {
      throw new Error('Use the pending-NEAR unlock scenario while provisioning is incomplete');
    }
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('unlockPasskeyWallet', options);
    const result = requirePasskeyUnlockResult(snapshot, registration);
    const observedPaths = this.routerPathsSince(traceStartIndex);
    if (!observedPaths.includes('/wallet/unlock/verify')) {
      throw new Error('Passkey unlock did not traverse /wallet/unlock/verify');
    }
    if (observedPaths.includes('/router-ab/wallet-session/ed25519')) {
      throw new Error('Passkey unlock requested a second Ed25519 Wallet Session ceremony');
    }
    const walletPage = this.page.getByTestId('intended-e2e-page');
    await expect(walletPage).toHaveAttribute('data-login-state', 'logged_in');
    await expect(walletPage).toHaveAttribute('data-login-wallet-id', this.walletId);
    await expect(walletPage).toHaveAttribute(
      'data-login-near-ready',
      registration.nearReadiness === 'ready' ? 'ready' : 'pending',
    );
    const unlockRequests = this.trace.slice(traceStartIndex).filter(isRequestTraceEntry);
    const verifyIndex = unlockRequests.findIndex(isWalletUnlockVerifyRequest);
    const statusReads = unlockRequests.slice(verifyIndex + 1).filter(isWalletSessionStatusRequest);
    const statusIdentities = new Set<string>();
    for (const read of statusReads) {
      if (!read.walletSessionStatusIdentity) {
        throw new Error('Wallet status request omitted its exact session identity');
      }
      statusIdentities.add(read.walletSessionStatusIdentity);
    }
    // Each sibling session requires its own authenticated reconciliation read.
    // Keep the original allowance of two further reads across the whole unlock.
    expect(
      statusReads.length - statusIdentities.size,
      'post-passkey unlock must avoid redundant reads of the same session',
    ).toBeLessThanOrEqual(2);
    this.recordService(
      `unlock status reads=${statusReads.length} distinctSessions=${statusIdentities.size}`,
    );
    this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
      kind: 'passkey_unlock',
    });
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
    this.recordService(
      `passkey unlock succeeded wallet=${result.walletId} near=${registration.nearReadiness}`,
    );
  }

  async syncPasskeyWalletFromEmptyStorage(): Promise<void> {
    this.recordStage('sync_passkey_wallet_from_empty_storage');
    const registration = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Passkey cold sync',
    );
    await this.clearBrowserStorageForColdSync();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('syncPasskeyWallet');
    const result = requirePasskeySyncResult(snapshot, registration);
    const observedPaths = this.routerPathsSince(traceStartIndex);
    if (!observedPaths.includes('/sync-account/verify')) {
      throw new Error('Passkey cold sync did not traverse /sync-account/verify');
    }
    if (observedPaths.some((path) => path.startsWith('/wallets/recovery/'))) {
      throw new Error('Passkey cold sync unexpectedly consumed wallet recovery state');
    }
    // The SDK warms the setup route with a preflight when its runtime starts.
    // Only a POST creates registration state.
    if (this.trace.slice(traceStartIndex).some(isRegistrationPostRequest)) {
      throw new Error('Passkey cold sync unexpectedly created another wallet registration');
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.passkeyPromptCount += 1;
    this.recordService(
      `passkey cold sync restored wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  async unlockEmailOtpWallet(): Promise<void> {
    this.recordStage('unlock_email_otp_wallet');
    const emailOtpRegistration = requireNearReadyRegisteredWallet(
      requireEmailOtpRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Email OTP unlock',
    );
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('unlockEmailOtpWallet');
    const result = requireEmailOtpUnlockResult(snapshot, emailOtpRegistration);
    this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
      kind: 'email_otp_unlock',
    });
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
    this.recordService(
      `email otp unlock succeeded wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  async refreshPagePreservingWalletStorage(): Promise<void> {
    this.recordStage('page_refresh_preserving_wallet_storage');
    this.latestPageSnapshot = null;
    await this.page.goto(this.intendedPageUrl().href, { waitUntil: 'domcontentloaded' });
    await this.page.getByTestId('intended-e2e-page').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
      { timeout: 15_000 },
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      this.walletId,
      { timeout: 15_000 },
    );
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
    this.recordService('page refreshed preserving wallet storage');
  }

  async lockWallet(): Promise<void> {
    await this.page.evaluate(lockWalletFromIntendedPage);
  }

  /** The application reads its session, so the wallet reads fresh server status. */
  async readWalletAuthenticationKind(): Promise<string> {
    const state = await this.page.evaluate(readWalletLockStateFromIntendedPage);
    return state.authenticationKind;
  }

  async assertWalletLocked(): Promise<void> {
    expect(await this.readWalletAuthenticationKind()).not.toBe('authenticated');
  }

  async assertLockedPageReloadStaysLocked(): Promise<void> {
    this.recordStage('locked_page_reload_stays_locked');
    await this.ensureIntendedPageOpen();
    await this.lockWallet();
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_out',
    );

    this.latestPageSnapshot = null;
    await this.page.goto(this.intendedPageUrl().href, { waitUntil: 'domcontentloaded' });
    const pageRoot = this.page.getByTestId('intended-e2e-page');
    await pageRoot.waitFor({ state: 'visible', timeout: 15_000 });
    await this.page.waitForFunction(
      () => typeof window.__seamsIntendedE2EReadWalletLockState === 'function',
      undefined,
      { timeout: 15_000 },
    );
    const lockState = await this.page.evaluate(readWalletLockStateFromIntendedPage);
    if (lockState.authenticationKind === 'authenticated') {
      throw new Error('A locked wallet remained authenticated after page reload');
    }
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
    await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
    this.recordService(
      `locked page reload remained locked authentication=${lockState.authenticationKind}`,
    );
  }
}
