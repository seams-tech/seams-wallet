import type {
  SignNEP413MessageParams,
  SignNEP413MessageResult,
} from '../../../packages/mpc-wallet/src/core/types/sdkPublicResults';
import { verifyNearMessageSignature } from './near-message-signatures';
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import type { IntendedEmailOtpCodeRequest } from '../../intended-app/src/intendedContract';

export type WalletIframeAutoConfirmDiagnostics = {
  attempts: number;
  clicked: boolean;
  recoveryBackupAcknowledged?: boolean;
  otpFilled?: boolean;
  otpChallengeMissing?: boolean;
  otpLookupKind?: IntendedEmailOtpCodeRequest['kind'];
  lastOtpError?: string;
  lastConfirmationError?: string;
  firstIframeAttachedMs?: number;
  firstFrameResolvedMs?: number;
  firstOtpInputVisibleMs?: number;
  firstOtpCodeResolvedMs?: number;
  firstOtpFillDispatchMs?: number;
  firstButtonVisibleMs?: number;
  firstClickDispatchMs?: number;
  firstClickDurationMs?: number;
  totalMs?: number;
};

type WalletIframeAutoConfirmTimingKey =
  | 'firstIframeAttachedMs'
  | 'firstFrameResolvedMs'
  | 'firstOtpInputVisibleMs'
  | 'firstOtpCodeResolvedMs'
  | 'firstOtpFillDispatchMs'
  | 'firstButtonVisibleMs'
  | 'firstClickDispatchMs'
  | 'firstClickDurationMs'
  | 'totalMs';

type WalletIframeConfirmationFingerprint = {
  readonly intendedAction: string;
  readonly controlIdentity: string;
  readonly stateIdentity: string | null;
};

function recordAutoConfirmMark(
  diagnostics: WalletIframeAutoConfirmDiagnostics | undefined,
  startedAtMs: number | undefined,
  key: WalletIframeAutoConfirmTimingKey,
  valueMs?: number,
): void {
  if (!diagnostics || startedAtMs == null) return;
  if (diagnostics[key] != null) return;
  diagnostics[key] = Math.max(0, Math.round(valueMs ?? Date.now() - startedAtMs));
}

async function fillWalletIframeEmailOtpIfAvailable(
  page: Page,
  frame: FrameLocator,
  opts?: {
    timeoutMs?: number;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    diagnosticsStartedAtMs?: number;
  },
): Promise<'absent' | 'filled' | 'ready'> {
  const timeoutMs = Math.max(50, Math.floor(opts?.timeoutMs ?? 500));
  const input = frame
    .locator(
      'input[name="email-code"][autocomplete="one-time-code"], #seams-auth-menu-google-otp, #seams-recovery-google-otp',
    )
    .first();
  const visible = await input
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!visible) return 'absent';
  const currentValue = await input.inputValue().catch(() => '');
  if (/^\d{6}$/.test(currentValue)) return 'ready';
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpInputVisibleMs');
  let otpIdentity: { challengeId: string; walletId: string | null } | null = null;
  try {
    otpIdentity = (await input.evaluate(readWalletIframeConfirmationState)).otpIdentity;
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = `challenge probe failed: ${compactUnknownErrorForDiagnostics(error)}`;
    }
  }
  const walletId =
    otpIdentity?.walletId ||
    (await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id'));
  if (!walletId) {
    throw new Error('Email OTP auto-confirm requires current intended wallet id');
  }
  const otpLookup: IntendedEmailOtpCodeRequest = otpIdentity
    ? {
        kind: 'challenge',
        challengeId: otpIdentity.challengeId,
        walletId,
      }
    : {
        kind: 'latest_for_wallet',
        walletId,
      };
  if (opts?.diagnostics) {
    opts.diagnostics.otpLookupKind = otpLookup.kind;
  }
  let otpCode: string;
  try {
    otpCode = await page.evaluate(readIntendedEmailOtpCodeFromPage, otpLookup);
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = compactUnknownErrorForDiagnostics(error);
    }
    return 'absent';
  }
  if (!otpIdentity && opts?.diagnostics) {
    opts.diagnostics.otpChallengeMissing = true;
  }
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpCodeResolvedMs');
  try {
    await input.fill(otpCode, { timeout: timeoutMs });
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastOtpError = compactUnknownErrorForDiagnostics(error);
    }
    return 'absent';
  }
  if (opts?.diagnostics) {
    opts.diagnostics.otpFilled = true;
  }
  recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstOtpFillDispatchMs');
  const recoveryOtp = frame.locator('#seams-recovery-google-otp').first();
  if (await recoveryOtp.isVisible().catch(() => false)) {
    await frame.locator('[data-auth-menu-primary]').first().click({ timeout: timeoutMs });
    if (opts?.diagnostics) {
      opts.diagnostics.clicked = true;
    }
  }
  return 'filled';
}

function compactUnknownErrorForDiagnostics(error: unknown): string {
  const text = error instanceof Error ? error.message || String(error) : String(error || '');
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function readWalletIframeConfirmationState(anchor: Element): {
  otpIdentity: { challengeId: string; walletId: string | null } | null;
  requestIdentity: string | null;
  controlIdentity: string;
} {
  const challengeId = String(anchor.getAttribute('data-email-otp-challenge-id') || '').trim();
  const walletId = String(anchor.getAttribute('data-email-otp-wallet-id') || '').trim();
  let otpIdentity = challengeId ? { challengeId, walletId: walletId || null } : null;
  let requestIdentity: string | null = null;

  const roots: Array<Document | ShadowRoot> = [anchor.ownerDocument];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const elements = Array.from(roots[rootIndex].querySelectorAll('*'));
    for (const element of elements) {
      const promptElement = element as HTMLElement & {
        emailOtpPrompt?: { challengeId?: unknown };
        intentDigest?: unknown;
        requestId?: unknown;
      };
      if (!otpIdentity) {
        const promptChallengeId = String(promptElement.emailOtpPrompt?.challengeId || '').trim();
        if (promptChallengeId) {
          otpIdentity = { challengeId: promptChallengeId, walletId: null };
        }
      }
      if (!requestIdentity) {
        const intentDigest = String(promptElement.intentDigest || '').trim();
        const requestId = String(promptElement.requestId || '').trim();
        requestIdentity = intentDigest || requestId || null;
      }
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return {
    otpIdentity,
    requestIdentity,
    controlIdentity: JSON.stringify({
      tagName: anchor.tagName.toLowerCase(),
      id: anchor.id,
      className: anchor.getAttribute('class') || '',
      name: anchor.getAttribute('name') || '',
      ariaLabel: anchor.getAttribute('aria-label') || '',
      text: String(anchor.textContent || '')
        .replace(/\s+/g, ' ')
        .trim(),
      registrationActivation: anchor.getAttribute('data-seams-registration-activation-start'),
      authMenuPrimary: anchor.getAttribute('data-auth-menu-primary'),
      authMenuProvider: anchor.getAttribute('data-auth-menu-provider'),
    }),
  };
}

async function readWalletIframeConfirmationFingerprint(
  control: Locator,
  intendedAction: string | null,
  timeoutMs: number,
): Promise<WalletIframeConfirmationFingerprint> {
  const state = await control.evaluate(readWalletIframeConfirmationState, undefined, {
    timeout: timeoutMs,
  });
  return {
    intendedAction: intendedAction || '',
    controlIdentity: state.controlIdentity,
    stateIdentity: state.otpIdentity
      ? `email-otp:${state.otpIdentity.challengeId}`
      : state.requestIdentity,
  };
}

function walletIframeConfirmationAlreadyDispatched(
  dispatched: readonly WalletIframeConfirmationFingerprint[],
  current: WalletIframeConfirmationFingerprint,
): boolean {
  return dispatched.some((previous) => {
    if (
      previous.intendedAction !== current.intendedAction ||
      previous.controlIdentity !== current.controlIdentity
    ) {
      return false;
    }
    if (previous.stateIdentity && current.stateIdentity) {
      return previous.stateIdentity === current.stateIdentity;
    }
    return true;
  });
}

async function readIntendedEmailOtpCodeFromPage(
  input: IntendedEmailOtpCodeRequest,
): Promise<string> {
  const reader = window.__seamsIntendedE2EReadEmailOtpCode;
  if (typeof reader !== 'function') {
    throw new Error('Intended page Email OTP reader is not installed');
  }
  const otpCode = String(await reader(input)).trim();
  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error('Intended page Email OTP reader returned an invalid OTP code');
  }
  return otpCode;
}

function intendedActionRequiresSecureConfirmation(action: string | null): boolean {
  switch (action) {
    case 'signNearTransaction':
    case 'signTempoTransaction':
    case 'signArcEvmTransaction':
    case 'exportEd25519Key':
    case 'exportEcdsaKey':
      return true;
    default:
      return false;
  }
}

export function isAutomatedSecureConfirmationCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('Request cancelled.') &&
    message.includes('User cancelled secure confirm request')
  );
}

export function intendedActionRequiresConfirmationSettlement(action: string): boolean {
  return (
    action === 'signNearTransaction' ||
    action === 'signTempoTransaction' ||
    action === 'signArcEvmTransaction'
  );
}

function walletIframeSecureConfirmationControl(frame: FrameLocator): Locator {
  return frame
    .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
    .last();
}

export async function waitForWalletIframeConfirmationSettlement(page: Page): Promise<void> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  if ((await iframe.count()) === 0) return;
  await walletIframeSecureConfirmationControl(iframe.contentFrame()).waitFor({
    state: 'hidden',
    timeout: 5_000,
  });
  await page.waitForTimeout(100);
  const minimizeReceipt = iframe.contentFrame().getByRole('button', {
    name: 'Minimize transaction',
    exact: true,
  });
  if (await minimizeReceipt.isVisible()) {
    await minimizeReceipt.click({ timeout: 5_000 });
  }
}

/**
 * Returns the Confirm control of the reviewed request on screen, once a click on it can land.
 *
 * The previous request's receipt surface stays mounted with `data-seams-confirm-ready` and no
 * `inert`, so the surface checks must name the surface that holds the Confirm control. The parent
 * page also keeps the wallet iframe inert while the review hands off to the wallet. Playwright
 * checks actionability inside the iframe only, so a click before the handoff ends reaches the
 * parent dialog and is lost.
 */
export async function waitForWalletIframeReviewedConfirm(page: Page): Promise<Locator> {
  const iframe = page.locator('iframe.seams-wallet-overlay-iframe');
  const confirm = iframe
    .contentFrame()
    .locator(
      '.seams-confirmation-surface[data-seams-confirm-ready="true"]:not([inert]) button.confirm',
    );
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await expect(iframe).not.toHaveJSProperty('inert', true);
  return confirm;
}

async function resolveWalletIframeConfirmControl(input: {
  readonly frame: FrameLocator;
  readonly intendedAction: string | null;
  readonly timeoutMs: number;
}): Promise<Locator> {
  const secureConfirm = walletIframeSecureConfirmationControl(input.frame);
  if (intendedActionRequiresSecureConfirmation(input.intendedAction)) {
    await secureConfirm.waitFor({ state: 'visible', timeout: input.timeoutMs });
    return secureConfirm;
  }
  if (await secureConfirm.isVisible().catch(() => false)) {
    return secureConfirm;
  }
  return input.frame
    .locator('[data-seams-registration-activation-start="true"], [data-auth-menu-primary]')
    .first();
}

async function clickWalletIframeConfirm(
  page: Page,
  dispatchedConfirmations: WalletIframeConfirmationFingerprint[],
  opts?: {
    timeoutMs?: number;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    diagnosticsStartedAtMs?: number;
  },
): Promise<boolean> {
  const timeoutMs = Math.max(50, Math.floor(opts?.timeoutMs ?? 15_000));
  if (opts?.diagnostics) {
    opts.diagnostics.attempts += 1;
  }
  try {
    const iframeEl = page.locator('iframe[allow*="publickey-credentials-get"]').last();
    const attached = await iframeEl
      .waitFor({ state: 'attached', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!attached) return false;
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstIframeAttachedMs');
    const frame = iframeEl.contentFrame();
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstFrameResolvedMs');

    let intendedAction: string | null = null;
    try {
      intendedAction = await page.getByTestId('intended-action-status').getAttribute('data-action');
    } catch {
      intendedAction = null;
    }

    const otpState = await fillWalletIframeEmailOtpIfAvailable(page, frame, {
      timeoutMs: Math.min(500, timeoutMs),
      diagnostics: opts?.diagnostics,
      diagnosticsStartedAtMs: opts?.diagnosticsStartedAtMs,
    });
    if (otpState === 'filled') return true;
    if (intendedAction === 'unlockEmailOtpWallet' || intendedAction === 'unlockWithAddedEmailOtp') {
      /* A wallet that also holds a passkey is offered both methods at once,
         and the menu's primary control starts the passkey unlock, which the
         virtual authenticator answers. An email-code unlock therefore presses
         the Google control or nothing; a complete code submits itself. */
      const google = frame.locator('[data-auth-menu-provider="google"]').first();
      if (!(await google.isVisible().catch(() => false))) return false;
      const fingerprint = await readWalletIframeConfirmationFingerprint(
        google,
        intendedAction,
        timeoutMs,
      );
      if (walletIframeConfirmationAlreadyDispatched(dispatchedConfirmations, fingerprint)) {
        return false;
      }
      await google.click({ timeout: timeoutMs });
      dispatchedConfirmations.push(fingerprint);
      if (opts?.diagnostics) {
        opts.diagnostics.clicked = true;
      }
      return true;
    }

    if (intendedAction === 'unlockPasskeyWallet') {
      const primary = frame.locator('[data-auth-menu-primary]').first();
      const primaryEnabled = await primary.isEnabled({ timeout: timeoutMs }).catch(() => false);
      if (!primaryEnabled) {
        const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
        if (!walletId) {
          throw new Error('Passkey auto-confirm requires current intended wallet id');
        }
        const accountMenuTrigger = frame.locator('.seams-account-menu-trigger').first();
        const triggerVisible = await accountMenuTrigger.isVisible().catch(() => false);
        if (triggerVisible) {
          await accountMenuTrigger.click({ timeout: timeoutMs });
          const passkeyAccount = frame
            .locator(
              `.seams-account-menu-option[data-wallet-id=${JSON.stringify(
                walletId,
              )}][data-auth-method="passkey"]`,
            )
            .first();
          const passkeyAccountVisible = await passkeyAccount.isVisible().catch(() => false);
          if (passkeyAccountVisible) {
            const selected = await passkeyAccount
              .getAttribute('aria-selected')
              .then((value) => value === 'true')
              .catch(() => false);
            if (!selected) {
              await passkeyAccount.click({ timeout: timeoutMs });
            } else {
              await accountMenuTrigger.click({ timeout: timeoutMs });
            }
            return true;
          }
        }
      }
    }

    const confirmBtn = await resolveWalletIframeConfirmControl({
      frame,
      intendedAction,
      timeoutMs,
    });
    await confirmBtn.waitFor({ state: 'visible', timeout: timeoutMs });
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstButtonVisibleMs');
    const fingerprint = await readWalletIframeConfirmationFingerprint(
      confirmBtn,
      intendedAction,
      timeoutMs,
    );
    if (walletIframeConfirmationAlreadyDispatched(dispatchedConfirmations, fingerprint)) {
      return false;
    }
    const clickStartedAtMs = Date.now();
    await confirmBtn.click({ timeout: timeoutMs });
    dispatchedConfirmations.push(fingerprint);
    if (opts?.diagnostics) {
      opts.diagnostics.clicked = true;
    }
    recordAutoConfirmMark(opts?.diagnostics, opts?.diagnosticsStartedAtMs, 'firstClickDispatchMs');
    recordAutoConfirmMark(
      opts?.diagnostics,
      opts?.diagnosticsStartedAtMs,
      'firstClickDurationMs',
      Date.now() - clickStartedAtMs,
    );
    return true;
  } catch (error) {
    if (opts?.diagnostics) {
      opts.diagnostics.lastConfirmationError = compactUnknownErrorForDiagnostics(error);
    }
    return false;
  }
}

export async function closeExportViewerFrameButton(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const closeButton = frame.getByRole('button', { name: 'Close' }).first();
    const visible = await closeButton
      .waitFor({ state: 'visible', timeout: 500 })
      .then(() => true)
      .catch(() => false);
    if (!visible) continue;
    await closeButton.click({ timeout: 2_000 });
    return true;
  }
  return false;
}

async function acknowledgeWalletRecoveryCodeBackup(
  page: Page,
  diagnostics?: WalletIframeAutoConfirmDiagnostics,
): Promise<readonly string[] | null> {
  for (const frame of page.frames()) {
    const acknowledgement = frame
      .locator('[data-seams-wallet-recovery-backup-acknowledgement]')
      .first();
    const visible = await acknowledgement.isVisible().catch(() => false);
    if (!visible) continue;
    const recoveryCodes = await frame.locator('.recovery-code-value').allTextContents();
    if (recoveryCodes.length === 0 || recoveryCodes.some((code) => !code.trim())) {
      throw new Error('Wallet recovery backup omitted its recovery codes');
    }
    if (!(await acknowledgement.isChecked())) {
      await acknowledgement.evaluate((input) => {
        if (!(input instanceof HTMLInputElement)) {
          throw new Error('Wallet recovery backup acknowledgement is not an input');
        }
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    // With the acknowledgement checked, the single close control completes the
    // backup (there is no separate "Finish backup" button).
    await frame.locator('[data-seams-wallet-recovery-backup-close]').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Wallet recovery backup close control is not a button');
      }
      button.click();
    });
    if (diagnostics) diagnostics.recoveryBackupAcknowledged = true;
    return recoveryCodes.map((code) => code.trim());
  }
  return null;
}

export async function waitForWalletRecoveryCodeBackup(
  page: Page,
  diagnostics?: WalletIframeAutoConfirmDiagnostics,
): Promise<readonly string[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const recoveryCodes = await acknowledgeWalletRecoveryCodeBackup(page, diagnostics);
    if (recoveryCodes) return recoveryCodes;
    await page.waitForTimeout(100);
  }
  throw new Error('Wallet registration did not present recovery codes');
}

export async function autoConfirmWalletIframeUntil<T>(
  page: Page,
  task: Promise<T>,
  opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    stopAfterClick?: boolean;
    diagnostics?: WalletIframeAutoConfirmDiagnostics;
    onRecoveryCodes?: (codes: readonly string[]) => void;
  },
): Promise<T> {
  const timeoutMs = Math.max(250, Math.floor(opts?.timeoutMs ?? 55_000));
  const intervalMs = Math.max(50, Math.floor(opts?.intervalMs ?? 250));
  const stopAfterClick = opts?.stopAfterClick === true;
  let done = false;
  const startedAtMs = Date.now();
  const diagnostics = opts?.diagnostics;
  if (diagnostics) {
    diagnostics.attempts = 0;
    diagnostics.clicked = false;
  }

  const loop = runWalletIframeAutoConfirmLoop({
    page,
    timeoutMs,
    intervalMs,
    stopAfterClick,
    diagnostics,
    onRecoveryCodes: opts?.onRecoveryCodes,
    startedAtMs,
    isDone: () => done,
  });
  const loopFailure = new Promise<never>((_resolve, reject) => {
    void loop.catch(reject);
  });

  try {
    return await Promise.race([task, loopFailure]);
  } finally {
    done = true;
    if (diagnostics) {
      diagnostics.totalMs = Math.max(0, Math.round(Date.now() - startedAtMs));
    }
    await loop.catch(() => undefined);
  }
}

async function runWalletIframeAutoConfirmLoop(args: {
  page: Page;
  timeoutMs: number;
  intervalMs: number;
  stopAfterClick: boolean;
  diagnostics?: WalletIframeAutoConfirmDiagnostics;
  onRecoveryCodes?: (codes: readonly string[]) => void;
  startedAtMs: number;
  isDone: () => boolean;
}): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  const dispatchedConfirmations: WalletIframeConfirmationFingerprint[] = [];
  while (!args.isDone() && Date.now() < deadline) {
    const recoveryCodes = await acknowledgeWalletRecoveryCodeBackup(args.page, args.diagnostics);
    if (recoveryCodes) {
      args.onRecoveryCodes?.(recoveryCodes);
      if (args.stopAfterClick) return;
      await args.page.waitForTimeout(args.intervalMs);
      continue;
    }
    const clicked = await clickWalletIframeConfirm(args.page, dispatchedConfirmations, {
      timeoutMs: Math.min(500, args.intervalMs),
      diagnostics: args.diagnostics,
      diagnosticsStartedAtMs: args.startedAtMs,
    });
    if (clicked && args.stopAfterClick) return;
    const authMenuError = await readWalletIframeAuthMenuError(args.page);
    if (authMenuError) {
      throw new Error(`Wallet auth menu failed: ${authMenuError}`);
    }
    await args.page.waitForTimeout(args.intervalMs);
  }
}

async function readWalletIframeAuthMenuError(page: Page): Promise<string | null> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  if (!(await iframe.isVisible().catch(() => false))) return null;
  const notice = iframe
    .contentFrame()
    .locator('.seams-auth-footer[data-state="notice"] .seams-auth-footer-text');
  if (!(await notice.isVisible().catch(() => false))) return null;
  return (await notice.textContent())?.trim() || null;
}

export async function signAndVerifyNearMessage(
  page: Page,
  message: string,
  registration: { readonly nearAccountId: string; readonly operationalPublicKey: string },
  options: Pick<SignNEP413MessageParams, 'callbackUrl' | 'state'> = { state: 'quote-170' },
) {
  const params = { message, recipient: 'checkout.example', ...options };
  const result = await autoConfirmWalletIframeUntil(
    page,
    page.evaluate(invokeIntendedSignMessage, { nearAccountId: registration.nearAccountId, params }),
  );
  if (!result.success) throw new Error(result.error);
  expect(result.accountId).toBe(registration.nearAccountId);
  expect(result.publicKey).toBe(registration.operationalPublicKey);
  const proof = await verifyNearMessageSignature(params, result);
  await waitForWalletIframeConfirmationSettlement(page);
  return proof;
}

async function invokeIntendedSignMessage(input: {
  nearAccountId: string;
  params: SignNEP413MessageParams;
}): Promise<SignNEP413MessageResult> {
  const sign = window.__seamsIntendedE2ESignMessage;
  if (!sign) throw new Error('Intended message-signing helper is unavailable');
  return await sign(input);
}
