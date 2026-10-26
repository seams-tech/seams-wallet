import { expect, test, type Page } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';

const IMPORT_PATHS = {
  authenticationMethods:
    '/_test-sdk/esm/react/components/AccountMenuButton/AuthenticationMethodsModal.js',
  theme: '/_test-sdk/esm/react/components/theme/ThemeProvider.js',
} as const;

const TEST_CONTEXT_ROUTE = '**/_test-sdk/esm/react/context/index.js';
const WALLET_ID = 'swift-sable-hgmrzh';
const WALLET_AUTH_METHOD_ID = 'passkey:wallet.example.localhost:credential-owner';

async function mountAuthenticationMethods(page: Page): Promise<void> {
  await page.evaluate(
    async ({ paths, walletId, walletAuthMethodId }) => {
      const React = await import('react');
      const ReactDOMClient = await import('react-dom/client');
      const ReactDOM = await import('react-dom');
      const themeModule = await import(paths.theme);
      const { default: Modal } = await import(paths.authenticationMethods);
      const Theme = themeModule.Theme;

      if (typeof Modal !== 'function' || typeof Theme !== 'function') {
        throw new Error('Account-menu modal test exports are unavailable');
      }

      const seams = {
        configs: {
          wallet: { iframe: { rpIdOverride: 'wallet.example.localhost' } },
          authMethods: [],
        },
        devices: {
          list: async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 2_000));
            return {
              devices: [],
              ownerDevices: [
                {
                  walletId,
                  walletAuthorityId: 'wallet-authority-owner',
                  credential: {
                    kind: 'passkey',
                    walletAuthMethodId,
                    credentialIdB64u: 'credential-owner',
                    device: {
                      label: 'Original passkey',
                      browser: 'chrome',
                      os: 'macos',
                      synced: true,
                      transports: ['internal'],
                      provider: 'google-password-manager',
                      providerLabel: 'Google Password Manager',
                    },
                  },
                  createdAtMs: Date.now(),
                  lastActivityAtMs: Date.now(),
                },
              ],
              nextCursor: null,
            };
          },
        },
      };
      const loginState = {
        isLoggedIn: true,
        walletId,
        authMethods: [],
        currentAuthMethod: {
          kind: 'selected',
          binding: {
            kind: 'passkey',
            walletAuthMethodId,
            scope: { wallet: { walletId }, rpId: 'wallet.example.localhost' },
            credentialIdB64u: 'credential-owner',
          },
        },
      };
      (
        globalThis as typeof globalThis & {
          __accountMenuModalTestContext?: unknown;
        }
      ).__accountMenuModalTestContext = {
        seams,
        loginState,
        refreshSession: async () => undefined,
      };

      const mount = document.createElement('div');
      mount.id = 'account-menu-modal-test-root';
      document.body.appendChild(mount);
      const root = ReactDOMClient.createRoot(mount);
      ReactDOM.flushSync(() => {
        root.render(
          React.createElement(
            Theme,
            { theme: 'light' },
            React.createElement(Modal, {
              walletId,
              isOpen: true,
              presentation: 'page',
              onClose: () => undefined,
            }),
          ),
        );
      });
    },
    {
      paths: IMPORT_PATHS,
      walletId: WALLET_ID,
      walletAuthMethodId: WALLET_AUTH_METHOD_ID,
    },
  );
}

test.describe('account-menu authentication methods page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectImportMap(page);
    await page.context().route(TEST_CONTEXT_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: [
          'export function useSeams() {',
          '  const value = globalThis.__accountMenuModalTestContext;',
          '  if (!value) throw new Error("Account-menu modal test context is unavailable");',
          '  return value;',
          '}',
        ].join('\n'),
      });
    });
  });

  test('shows the selected authentication method while remote inventory is pending', async ({
    page,
  }) => {
    await mountAuthenticationMethods(page);

    const content = page.getByRole('region', { name: 'Authentication methods', exact: true });
    await expect(content).toBeVisible({ timeout: 500 });
    await expect(content.getByText('Passkey', { exact: true })).toBeVisible({ timeout: 500 });
    await expect(content.getByText('Passkey on this device', { exact: true })).toBeVisible({
      timeout: 500,
    });
    const addEmailButton = content.getByRole('button', { name: 'Add Email OTP', exact: true });
    await expect(addEmailButton).toBeVisible();
    await expect(addEmailButton).toBeDisabled();
    await expect(content.getByRole('button', { name: 'Unlock wallet' })).toHaveCount(0);
    const initialBounds = await addEmailButton.boundingBox();
    await expect(addEmailButton).toBeEnabled();
    expect(await addEmailButton.boundingBox()).toEqual(initialBounds);

    await addEmailButton.click();
    const emailInput = content.getByRole('textbox', { name: 'Email address' });
    await expect(emailInput).toBeFocused();
    await content.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(emailInput).toHaveAccessibleDescription(/^Enter the email address to verify\./);
    await content.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(addEmailButton).toBeFocused();
  });
});
