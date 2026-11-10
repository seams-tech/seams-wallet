import { expect, test, type Page } from '@playwright/test';
import { setupBasicPasskeyTest } from '../setup';
import { prepareAuthMenuDocument, mountAuthMenu } from './auth-menu.harness';
import type {
  AuthMenuAccountOption,
  AuthMenuRecoveryViewModel,
  AuthMenuViewModel,
} from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import { parseWalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';

const AUTH_MENU_TAG = '.seams-auth-menu-surface';

const APPEARANCE = {
  theme: {
    id: 'default',
    mode: 'dark',
    colors: {},
  },
  palette: 'default',
} as const;

function loginViewModel(
  status: AuthMenuViewModel['status'] = { kind: 'idle', interaction: 'actionable' },
) {
  return {
    appearance: { ...APPEARANCE, theme: { ...APPEARANCE.theme, mode: 'light' as const } },
    hostname: 'wallet.example.test',
    closeLabel: 'Close authentication menu',
    heading: 'Sign in',
    subtitle: 'Use your passkey to continue.',
    ctaLabel: 'Continue with passkey',
    showProgress: true,
    kind: 'passkey' as const,
    mode: 'login' as const,
    accountOptions: [],
    selectedAccount: null,
    status,
  };
}

type RecoveryEntryViewModel = Extract<AuthMenuRecoveryViewModel, { readonly stage: 'enter_code' }>;

const RECOVERY_CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function recoveryEntryViewModel(
  overrides: Partial<{
    recoveryCode: string;
    recoveryCodeError: string | null;
  }> = {},
): RecoveryEntryViewModel {
  return {
    appearance: { ...APPEARANCE, theme: { ...APPEARANCE.theme, mode: 'light' as const } },
    hostname: 'wallet.example.test',
    closeLabel: 'Close authentication menu',
    kind: 'recovery',
    mode: 'login',
    heading: 'Recover wallet',
    subtitle: 'Enter a recovery code to recover your wallet.',
    ctaLabel: 'Continue',
    showProgress: true,
    enabledExternalProviders: [],
    stage: 'enter_code',
    recoveryCode: overrides.recoveryCode ?? '',
    recoveryCodeError: overrides.recoveryCodeError ?? null,
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

function recoveryMethodChoiceViewModel(
  enabledExternalProviders: readonly 'google'[],
): Extract<AuthMenuRecoveryViewModel, { readonly stage: 'choose_method' }> {
  return {
    ...recoveryEntryViewModel({ recoveryCode: RECOVERY_CODE }),
    subtitle: 'Choose how you will sign in to this wallet from now on.',
    enabledExternalProviders,
    stage: 'choose_method',
    status: { kind: 'idle', interaction: 'actionable' },
  };
}

async function recordIntents(page: Page): Promise<void> {
  await page.evaluate((tagName) => {
    const element = document.querySelector(tagName) as HTMLElement & { intents?: unknown[] };
    element.intents = [];
    window.__authMenu.onIntent = (intent) => {
      element.intents?.push(intent);
    };
  }, AUTH_MENU_TAG);
}

async function recordedIntents(page: Page): Promise<unknown[] | undefined> {
  return await page.evaluate(
    (tagName) => (document.querySelector(tagName) as HTMLElement & { intents?: unknown[] }).intents,
    AUTH_MENU_TAG,
  );
}

async function showViewModel(page: Page, viewModel: AuthMenuViewModel): Promise<void> {
  await page.evaluate(async (model) => {
    window.__authMenu.model = model;
    window.__authMenu.handle.update(window.__authMenu.model);
    await Promise.resolve();
  }, viewModel);
}

function recoveryFinalizingViewModel(): Extract<
  AuthMenuRecoveryViewModel,
  { readonly stage: 'finalizing' }
> {
  return {
    ...recoveryEntryViewModel(),
    walletId: 'wallet-1.test',
    stage: 'finalizing',
    target: parseWalletRecoveryTargetV1({ kind: 'passkey', rpId: 'example.test' }),
    recoveryCode: '',
    status: { kind: 'busy', headline: 'Finishing recovery…' },
  };
}

test.describe('wallet-host Preact auth menu surface', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page);
    await prepareAuthMenuDocument(page);
  });

  test('keeps recovery in the hosted menu with accessible validation and focus return', async ({
    page,
  }) => {
    await mountAuthMenu(page, loginViewModel());
    await page.evaluate((tagName) => {
      const element = document.querySelector(tagName) as HTMLElement & { intents?: unknown[] };
      element.intents = [];
      window.__authMenu.onIntent = (intent) => {
        element.intents?.push(intent);
      };
    }, AUTH_MENU_TAG);

    await page.getByText('Recover or link wallet', { exact: true }).click();
    await page.locator(`${AUTH_MENU_TAG} [data-recovery-action]`).click();
    expect(
      await page.evaluate(
        (tagName) =>
          (document.querySelector(tagName) as HTMLElement & { intents?: unknown[] }).intents,
        AUTH_MENU_TAG,
      ),
    ).toEqual([{ kind: 'recovery_open' }]);

    await page.evaluate(
      async ({ viewModel }) => {
        window.__authMenu.model = viewModel;
        window.__authMenu.handle.update(window.__authMenu.model);
        await Promise.resolve();
      },
      { tagName: AUTH_MENU_TAG, viewModel: recoveryEntryViewModel() },
    );

    const codeInput = page.locator(`${AUTH_MENU_TAG} [data-recovery-code]`);
    const recoveryFeedback = page.locator(`${AUTH_MENU_TAG} #seams-recovery-code-feedback`);
    const recoverySubhead = page.locator(`${AUTH_MENU_TAG} .seams-subhead`);
    await expect(recoverySubhead).toHaveText('Enter a recovery code to recover your wallet.');
    await expect(recoveryFeedback).toBeEmpty();
    await expect(codeInput).toHaveAttribute('aria-invalid', 'false');
    await codeInput.fill('ABCD-EFGH');

    await page.evaluate(
      async ({ viewModel }) => {
        window.__authMenu.model = viewModel;
        window.__authMenu.handle.update(window.__authMenu.model);
        await Promise.resolve();
      },
      {
        tagName: AUTH_MENU_TAG,
        viewModel: recoveryEntryViewModel({
          recoveryCodeError: 'Enter a recovery code.',
        }),
      },
    );
    await expect(codeInput).toBeFocused();
    await expect(codeInput).toHaveAttribute(
      'aria-describedby',
      'seams-recovery-code-feedback seams-recovery-code-count seams-recovery-code-hint',
    );
    await expect(recoveryFeedback).toHaveCount(1);
    await expect(recoveryFeedback).toHaveText('Enter a recovery code.');
    await expect(recoveryFeedback).toHaveAttribute('aria-hidden', 'false');

    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    const intents = await page.evaluate(
      (tagName) =>
        (document.querySelector(tagName) as HTMLElement & { intents?: unknown[] }).intents,
      AUTH_MENU_TAG,
    );
    expect(intents).toEqual([
      { kind: 'recovery_open' },
      { kind: 'recovery_code_changed', recoveryCode: 'ABCDEFGH' },
      { kind: 'back' },
    ]);

    await page.evaluate(
      async ({ viewModel }) => {
        window.__authMenu.model = viewModel;
        window.__authMenu.handle.update(window.__authMenu.model);
        await Promise.resolve();
      },
      { tagName: AUTH_MENU_TAG, viewModel: loginViewModel() },
    );
    await expect(page.locator(`${AUTH_MENU_TAG} [data-recovery-action]`)).toBeFocused();
  });

  test('takes the recovery code first, then the sign-in method recovery adds', async ({ page }) => {
    await mountAuthMenu(page, recoveryEntryViewModel());
    await recordIntents(page);

    const codeInput = page.locator(`${AUTH_MENU_TAG} [data-recovery-code]`);
    const continueButton = page.locator(`${AUTH_MENU_TAG} [data-recovery-continue]`);
    await expect(
      page.locator(`${AUTH_MENU_TAG} .seams-recovery-code-slots .seams-otp-slot`),
    ).toHaveCount(32);
    await expect(page.locator(`${AUTH_MENU_TAG} .seams-recovery-code-count`)).toHaveText('0/32');
    await expect(continueButton).toBeEnabled();
    await expect(page.locator(`${AUTH_MENU_TAG} [data-recovery-target]`)).toHaveCount(0);

    // Lowercase, separators, and the letters Crockford Base32 reads as digits.
    await codeInput.fill('o123-4567-89ab-cdef-ghjk-mnpq-rstv-wxyz');
    await expect
      .poll(() => recordedIntents(page))
      .toEqual([{ kind: 'recovery_code_changed', recoveryCode: RECOVERY_CODE }]);
    // The session owns the code: the input shows what the next view model holds.
    await showViewModel(page, recoveryEntryViewModel({ recoveryCode: RECOVERY_CODE }));
    await expect(codeInput).toHaveValue(RECOVERY_CODE);
    await expect(page.locator(`${AUTH_MENU_TAG} .seams-recovery-code-count`)).toHaveText('32/32');
    await expect(continueButton).toBeEnabled();
    await codeInput.press('Enter');

    await showViewModel(page, recoveryMethodChoiceViewModel(['google']));
    const passkeyChoice = page.locator(`${AUTH_MENU_TAG} [data-recovery-target="passkey"]`);
    const googleChoice = page.locator(`${AUTH_MENU_TAG} [data-recovery-target="google_email_otp"]`);
    await expect(passkeyChoice).toBeFocused();
    await expect(passkeyChoice).toHaveText('Create a passkey');
    await expect(googleChoice).toHaveText('Continue with Google');
    await expect(page.locator(`${AUTH_MENU_TAG} [data-recovery-code]`)).toHaveCount(0);
    await passkeyChoice.click();
    await page.keyboard.press('Escape');

    expect(await recordedIntents(page)).toEqual([
      { kind: 'recovery_code_changed', recoveryCode: RECOVERY_CODE },
      { kind: 'recovery_code_submit' },
      { kind: 'recovery_passkey_selected' },
      { kind: 'back' },
    ]);

    await showViewModel(page, recoveryMethodChoiceViewModel([]));
    await expect(passkeyChoice).toHaveCount(1);
    await expect(googleChoice).toHaveCount(0);
  });

  test('locks Back and Escape while recovery finalization is irreversible', async ({ page }) => {
    await mountAuthMenu(page, recoveryFinalizingViewModel());
    await page.evaluate((tagName) => {
      const element = document.querySelector(tagName) as HTMLElement & { intents?: unknown[] };
      element.intents = [];
      window.__authMenu.onIntent = (intent) => {
        element.intents?.push(intent);
      };
    }, AUTH_MENU_TAG);

    await expect(page.locator(`${AUTH_MENU_TAG} [data-auth-menu-close]`)).toBeDisabled();
    await page.keyboard.press('Escape');

    expect(
      await page.evaluate(
        (tagName) =>
          (document.querySelector(tagName) as HTMLElement & { intents?: unknown[] }).intents,
        AUTH_MENU_TAG,
      ),
    ).toEqual([]);
  });

  test('renders linked-wallet activation failures with a recovery action', async ({ page }) => {
    await mountAuthMenu(page, {
      ...loginViewModel(),
      kind: 'link_device',
      heading: 'Scan and link device',
      subtitle: 'Scan this code with your other device.',
      ctaLabel: '',
      linkDevice: {
        kind: 'activation_error',
        message: 'Wallet Session renewal failed',
      },
    });

    const result = await page.evaluate((tagName) => {
      const element = document.querySelector(tagName) as HTMLElement;
      const intents: unknown[] = [];
      window.__authMenu.onIntent = (intent) => {
        intents.push(intent);
      };
      (element.querySelector('[data-auth-menu-primary]') as HTMLButtonElement).click();
      return {
        title: element.querySelector('.qr-title')?.textContent?.trim(),
        alert: element.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim(),
        action: element.querySelector('[data-auth-menu-primary]')?.textContent?.trim(),
        intents,
      };
    }, AUTH_MENU_TAG);

    expect(result).toEqual({
      title: 'Device linked',
      alert: 'Unable to open the wallet. Go back and try again. Wallet Session renewal failed',
      action: 'Return to unlock wallet',
      intents: [{ kind: 'back' }],
    });
  });

  test('Back and Escape leave a running passkey wait; Escape on the menu is ignored', async ({
    page,
  }) => {
    await mountAuthMenu(page, loginViewModel({ kind: 'busy', headline: 'Unlocking wallet…' }));
    await recordIntents(page);
    await page.locator(`${AUTH_MENU_TAG} [data-auth-menu-close]`).click();
    expect(await recordedIntents(page)).toEqual([{ kind: 'back' }]);

    const fromWaiting = await page.evaluate(async () => {
      const received: unknown[] = [];
      window.__authMenu.onIntent = (intent) => {
        received.push(intent);
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return received;
    }, AUTH_MENU_TAG);
    expect(fromWaiting).toEqual([{ kind: 'back' }]);

    await mountAuthMenu(page, loginViewModel({ kind: 'idle', interaction: 'actionable' }));
    const fromMenu = await page.evaluate(async () => {
      const received: unknown[] = [];
      window.__authMenu.onIntent = (intent) => {
        received.push(intent);
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return received;
    }, AUTH_MENU_TAG);
    // On the menu itself Escape belongs to the embedding page.
    expect(fromMenu).toEqual([]);
  });

  test('reports a failure in the footer strip and retries; an expired preparation stays retryable', async ({
    page,
  }) => {
    await mountAuthMenu(page, loginViewModel());
    const card = page.locator(`${AUTH_MENU_TAG} .auth-menu-root`);
    const footer = page.locator(`${AUTH_MENU_TAG} .seams-auth-footer`);
    const notice = footer.locator('.seams-auth-footer-text');
    await expect(footer).toHaveAttribute('data-state', 'brand');
    await expect(footer.locator('.seams-auth-footer-brand')).toContainText('Secured by');
    await expect(notice).toBeHidden();

    const failedStatus = {
      kind: 'recoverable',
      reason: 'error',
      message: 'Can’t reach Seams right now.',
      detail: 'sync-account/options failed (HTTP 502)',
    } as const;
    const retryIntents = await page.evaluate(async (status) => {
      const received: unknown[] = [];
      window.__authMenu.onIntent = (intent) => {
        received.push(intent);
      };
      const model = window.__authMenu.model;
      if (model.kind !== 'passkey') throw new Error('Expected the menu model');
      window.__authMenu.model = { ...model, status };
      window.__authMenu.handle.update(window.__authMenu.model);
      await Promise.resolve();
      (document.querySelector('.seams-auth-footer-action') as HTMLButtonElement).click();
      return received;
    }, failedStatus);

    await expect(footer).toHaveAttribute('data-state', 'notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('Can’t reach Seams right now.');
    await expect(page.getByRole('alert')).toHaveText('Can’t reach Seams right now.');
    await expect(card).not.toContainText('HTTP 502');
    expect(retryIntents).toEqual([{ kind: 'submit', mode: 'login' }]);

    await page.evaluate(() => {
      const model = window.__authMenu.model;
      if (model.kind !== 'passkey') throw new Error('Expected the menu model');
      window.__authMenu.model = { ...model, status: { kind: 'idle', interaction: 'actionable' } };
      window.__authMenu.handle.update(window.__authMenu.model);
    });
    await expect(footer).toHaveAttribute('data-state', 'brand');
    await expect(notice).toBeHidden();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(footer.locator('.seams-auth-footer-action')).toBeDisabled();

    // An expired preparation shows no error and keeps the primary action as the retry.
    await mountAuthMenu(page, {
      ...loginViewModel({
        kind: 'recoverable',
        reason: 'expired',
        message: 'Passkey preparation expired',
      }),
      enabledExternalProviders: ['google'],
    });
    const snapshot = await page.evaluate(async (tagName) => {
      const element = document.querySelector(tagName) as HTMLElement;
      return {
        ctaDisabled: (element.querySelector('[data-auth-menu-primary]') as HTMLButtonElement)
          .disabled,
        providerDisabled: (element.querySelector('[data-auth-menu-provider]') as HTMLButtonElement)
          ?.disabled,
        error: element.querySelector('[role="alert"]')?.textContent?.trim() ?? '',
        retryCount: element.querySelectorAll('.auth-menu-retry').length,
        modeSwitchEnabled: !(
          element.querySelector('[data-auth-menu-mode="register"]') as HTMLButtonElement
        ).disabled,
      };
    }, AUTH_MENU_TAG);

    // The primary button is the retry affordance now, so it must stay usable.
    expect(snapshot.ctaDisabled).toBe(false);
    expect(snapshot.providerDisabled).toBe(false);
    expect(snapshot.error).toBe('');
    expect(snapshot.retryCount).toBe(0);
    expect(snapshot.modeSwitchEnabled).toBe(true);

    const submitIntent = await page.evaluate(async (tagName) => {
      const element = document.querySelector(tagName) as HTMLElement;
      const received: unknown[] = [];
      window.__authMenu.onIntent = (intent) => {
        received.push(intent);
      };
      (element.querySelector('[data-auth-menu-primary]') as HTMLButtonElement).click();
      return received;
    }, AUTH_MENU_TAG);
    expect(submitIntent).toEqual([{ kind: 'submit', mode: 'login' }]);
  });

  test('shows "Unlock with email code" only where the email code unlocks the selected wallet', async ({
    page,
  }) => {
    const passkey = { walletId: 'passkey-wallet.test', authMethod: 'passkey' } as const;
    const voice = {
      walletId: 'voice-wallet.test',
      authMethod: 'voiceid',
      walletAuthMethodId: 'voice-method-1',
    } as const;
    const email = {
      walletId: 'email-wallet.test',
      authMethod: 'email_otp',
      emailAddress: 'owner@example.test',
    } as const;
    const bothPasskey = { walletId: 'both-wallet.test', authMethod: 'passkey' } as const;
    const bothEmail = {
      walletId: 'both-wallet.test',
      authMethod: 'email_otp',
      emailAddress: 'both@example.test',
    } as const;
    const accountOptions = [passkey, voice, email, bothPasskey, bothEmail];
    const login = (
      selectedAccount: AuthMenuAccountOption | null,
      options: readonly AuthMenuAccountOption[] = accountOptions,
    ): AuthMenuViewModel => ({
      ...loginViewModel(),
      accountOptions: options,
      selectedAccount,
      enabledExternalProviders: ['google'],
    });
    const emailButton = page.locator(`${AUTH_MENU_TAG} [data-auth-menu-provider="google"]`);

    await mountAuthMenu(page, login(passkey));
    await expect(emailButton).toHaveCount(0);
    await showViewModel(page, login(voice));
    await expect(emailButton).toHaveCount(0);
    // The selected wallet changes to one that unlocks with the email code: the button follows.
    await showViewModel(page, login(email));
    await expect(emailButton).toHaveText('Unlock with email code');
    await expect(emailButton).toBeEnabled();
    await showViewModel(page, login(bothPasskey));
    await expect(emailButton).toHaveText('Unlock with email code');
    await showViewModel(page, login(passkey));
    await expect(emailButton).toHaveCount(0);
    // A device with no saved wallet keeps it: Google finds the wallet from the Google account.
    await showViewModel(page, login(null, []));
    await expect(emailButton).toHaveText('Unlock with email code');
    await expect(emailButton).toBeEnabled();
    // Without the Google provider, no wallet sees it.
    await showViewModel(page, { ...login(email), enabledExternalProviders: [] });
    await expect(emailButton).toHaveCount(0);

    // Create mode keeps "Continue with Google".
    const { accountOptions: _options, selectedAccount: _selected, ...common } = loginViewModel();
    await showViewModel(page, {
      ...common,
      mode: 'register',
      showRegistrationInput: false,
      passkeyNameReadOnly: false,
      passkeyName: 'new-wallet',
      passkeyNameLabel: 'Wallet name',
      enabledExternalProviders: ['google'],
    });
    await expect(emailButton).toHaveText('Continue with Google');
  });
});
