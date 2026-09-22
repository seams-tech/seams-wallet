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
type AuthenticationInventoryMode = 'pending' | 'owner_session_inactive';

async function mountModalWithPendingInventory(
  page: Page,
  kind: ModalKind,
  authenticationInventoryMode: AuthenticationInventoryMode = 'pending',
  presentation: 'modal' | 'page' = 'modal',
): Promise<void> {
  await page.evaluate(
    async ({ paths, walletId, walletAuthMethodId, modalKind, inventoryMode, presentation }) => {
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

      let inventoryAttempts = 0;
      let ownerUnlocks = 0;
      const seams = {
        configs: {
          wallet: { iframe: { rpIdOverride: 'wallet.example.localhost' } },
        },
        auth: {
          unlock: async () => {
            ownerUnlocks += 1;
            return { success: true };
          },
        },
        devices: {
          listLinkedDevices: async () => {
            inventoryAttempts += 1;
            if (inventoryMode === 'pending') {
              await new Promise((resolve) => window.setTimeout(resolve, 2_000));
            } else if (inventoryAttempts === 1) {
              throw new Error('The owner Wallet Session must be renewed');
            }
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
          __accountMenuModalOwnerUnlockCount?: () => number;
        }
      ).__accountMenuModalTestContext = {
        seams,
        loginState,
        refreshLoginState: async () => undefined,
      };
      (
        globalThis as typeof globalThis & {
          __accountMenuModalOwnerUnlockCount?: () => number;
        }
      ).__accountMenuModalOwnerUnlockCount = () => ownerUnlocks;

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
              presentation,
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
      inventoryMode: authenticationInventoryMode,
      presentation,
    },
  );
}

test.describe('account-menu modal responsiveness', () => {
  test('page authentication content keeps sidebar navigation outside a modal focus trap', async ({
    page,
  }) => {
    await mountModalWithPendingInventory(page, 'authentication_methods', 'pending', 'page');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const content = page.getByRole('region', { name: 'Authentication methods' });
    await expect(content).toBeVisible();
    await expect(content.getByText('Passkey', { exact: true })).toBeVisible();
    await expect(
      content.getByRole('button', { name: 'Close authentication methods' }),
    ).toBeHidden();
  });
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

  test('emits seams-prefixed variables from every React theme boundary', async ({ page }) => {
    const themeVariables = await page.evaluate(
      async ({ themePath }) => {
        const React = await import('react');
        const ReactDOMClient = await import('react-dom/client');
        const ReactDOM = await import('react-dom');
        const themeModule = await import(themePath);
        const Theme = themeModule.Theme;

        const mount = document.createElement('div');
        document.body.appendChild(mount);
        const root = ReactDOMClient.createRoot(mount);
        ReactDOM.flushSync(() => {
          root.render(
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Theme, { theme: 'dark' }, React.createElement('span')),
            ),
          );
        });

        return Array.from(mount.querySelectorAll<HTMLElement>('.seams-theme-provider')).map(
          (element) => ({
            seamsPrimary: element.style.getPropertyValue('--seams-colors-primary'),
            retiredPrimary: element.style.getPropertyValue('--w3a-colors-primary'),
          }),
        );
      },
      {
        themePath: IMPORT_PATHS.theme,
      },
    );

    expect(themeVariables).toHaveLength(1);
    for (const variables of themeVariables) {
      expect(variables.seamsPrimary).not.toBe('');
      expect(variables.retiredPrimary).toBe('');
    }
  });

  test('shows the selected authentication method while remote inventory is pending', async ({
    page,
  }) => {
    await mountModalWithPendingInventory(page, 'authentication_methods');

    const dialog = page.getByRole('dialog', { name: 'Authentication methods' });
    await expect(dialog).toBeVisible({ timeout: 500 });
    await expect(dialog.getByText('Passkey', { exact: true })).toBeVisible({ timeout: 500 });
    await expect(dialog.getByText('Passkey on this device', { exact: true })).toBeVisible({
      timeout: 500,
    });
  });

  test('unlocks owner management explicitly after passive inventory authorization fails', async ({
    page,
  }) => {
    await mountModalWithPendingInventory(page, 'authentication_methods', 'owner_session_inactive');

    const dialog = page.getByRole('dialog', { name: 'Authentication methods' });
    const unlockButton = dialog.getByRole('button', { name: 'Unlock wallet' });
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();

    await expect(dialog.getByRole('heading', { name: 'Add Email OTP' })).toBeVisible();
    await expect(dialog).toBeFocused();
    const unlockCount = await page.evaluate(() => {
      const read = (
        globalThis as typeof globalThis & {
          __accountMenuModalOwnerUnlockCount?: () => number;
        }
      ).__accountMenuModalOwnerUnlockCount;
      return read?.() ?? 0;
    });
    expect(unlockCount).toBe(1);
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
    await page.evaluate(
      async ({ path }) => {
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
      },
      { path: IMPORT_PATHS.userAccountButton },
    );

    await expect(page.getByText('coral-reef-r8f5ju', { exact: true })).toBeVisible();
    await expect(page.getByText('n6378056@gmail.com', { exact: true })).toBeVisible();
  });
});
