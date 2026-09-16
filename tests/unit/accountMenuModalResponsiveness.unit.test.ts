import { expect, test, type Page } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';

const IMPORT_PATHS = {
  authenticationMethods:
    '/_test-sdk/esm/react/components/AccountMenuButton/AuthenticationMethodsModal.js',
  linkedDevices: '/_test-sdk/esm/react/components/AccountMenuButton/LinkedDevicesModal.js',
  theme: '/_test-sdk/esm/react/components/theme/ThemeProvider.js',
  userAccountButton: '/_test-sdk/esm/react/components/AccountMenuButton/UserAccountButton.js',
} as const;

const TEST_CONTEXT_ROUTE = '**/_test-sdk/esm/react/context/index.js';
const WALLET_ID = 'swift-sable-hgmrzh';
const WALLET_AUTH_METHOD_ID = 'passkey:wallet.example.localhost:credential-owner';

type ModalKind = 'authentication_methods' | 'linked_devices';

async function mountModalWithPendingInventory(page: Page, kind: ModalKind): Promise<void> {
  await page.evaluate(
    async ({ paths, walletId, walletAuthMethodId, modalKind }) => {
      const React = await import('react');
      const ReactDOMClient = await import('react-dom/client');
      const ReactDOM = await import('react-dom');
      const themeModule = await import(paths.theme);
      const modalModule =
        modalKind === 'authentication_methods'
          ? await import(paths.authenticationMethods)
          : await import(paths.linkedDevices);
      const Modal =
        modalKind === 'authentication_methods'
          ? modalModule.AuthenticationMethodsModal || modalModule.default
          : modalModule.LinkedDevicesModal || modalModule.default;
      const Theme = themeModule.Theme;

      if (typeof Modal !== 'function' || typeof Theme !== 'function') {
        throw new Error('Account-menu modal test exports are unavailable');
      }

      const seams = {
        configs: {
          wallet: { iframe: { rpIdOverride: 'wallet.example.localhost' } },
        },
        devices: {
          listLinkedDevices: async () => {
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
        currentAuthMethod: {
          kind: 'selected',
          binding: { walletAuthMethodId },
        },
      };
      (
        globalThis as typeof globalThis & { __accountMenuModalTestContext?: unknown }
      ).__accountMenuModalTestContext = {
        seams,
        loginState,
        refreshLoginState: async () => undefined,
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
      modalKind: kind,
    },
  );
}

test.describe('account-menu modal responsiveness', () => {
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

  test('shows Authentication Methods while its inventory request is pending', async ({ page }) => {
    await mountModalWithPendingInventory(page, 'authentication_methods');

    const dialog = page.getByRole('dialog', { name: 'Authentication methods' });
    await expect(dialog).toBeVisible({ timeout: 500 });
    await expect(dialog.getByText('Checking authentication methods…')).toBeVisible({
      timeout: 500,
    });
  });

  test('shows Linked Devices while its inventory request is pending', async ({ page }) => {
    await mountModalWithPendingInventory(page, 'linked_devices');

    const dialog = page.getByRole('dialog', { name: 'Your devices' });
    await expect(dialog).toBeVisible({ timeout: 500 });
    await expect(dialog.getByText('Checking your devices…')).toBeVisible({ timeout: 500 });
  });

  test('shows the Email OTP address under the wallet id when the menu is open', async ({
    page,
  }) => {
    await page.evaluate(async ({ path }) => {
      const React = await import('react');
      const ReactDOMClient = await import('react-dom/client');
      const ReactDOM = await import('react-dom');
      const { UserAccountButton } = await import(path);
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const root = ReactDOMClient.createRoot(mount);
      ReactDOM.flushSync(() => {
        root.render(
          React.createElement(UserAccountButton, {
            username: 'User',
            hideUsername: false,
            fullAccountId: 'coral-reef-r8f5ju',
            emailAddress: 'n6378056@gmail.com',
            isOpen: true,
            onClick: () => undefined,
            theme: 'light',
          }),
        );
      });
    }, { path: IMPORT_PATHS.userAccountButton });

    await expect(page.getByText('coral-reef-r8f5ju', { exact: true })).toBeVisible();
    await expect(page.getByText('n6378056@gmail.com', { exact: true })).toBeVisible();
  });
});
