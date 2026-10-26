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

type AuthenticationInventoryMode = 'pending' | 'owner_session_inactive';

async function mountAuthenticationMethods(
  page: Page,
  authenticationInventoryMode: AuthenticationInventoryMode,
): Promise<void> {
  await page.evaluate(
    async ({ paths, walletId, walletAuthMethodId, inventoryMode }) => {
      const React = await import('react');
      const ReactDOMClient = await import('react-dom/client');
      const ReactDOM = await import('react-dom');
      const themeModule = await import(paths.theme);
      const { default: Modal } = await import(paths.authenticationMethods);
      const Theme = themeModule.Theme;

      if (typeof Modal !== 'function' || typeof Theme !== 'function') {
        throw new Error('Account-menu modal test exports are unavailable');
      }

      let inventoryAttempts = 0;
      let ownerUnlocks = 0;
      const seams = {
        configs: {
          wallet: { iframe: { rpIdOverride: 'wallet.example.localhost' } },
          authMethods: [],
        },
        auth: {
          unlock: async () => {
            ownerUnlocks += 1;
            return { success: true };
          },
        },
        devices: {
          list: async () => {
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
        refreshSession: async () => undefined,
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
      inventoryMode: authenticationInventoryMode,
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
    await mountAuthenticationMethods(page, 'pending');

    const content = page.getByRole('region', { name: 'Authentication methods', exact: true });
    await expect(content).toBeVisible({ timeout: 500 });
    await expect(content.getByText('Passkey', { exact: true })).toBeVisible({ timeout: 500 });
    await expect(content.getByText('Passkey on this device', { exact: true })).toBeVisible({
      timeout: 500,
    });
    const emailInput = content.getByRole('textbox', { name: 'Email address' });
    const addEmailButton = content.getByRole('button', { name: 'Add Email OTP', exact: true });
    await expect(emailInput).toBeVisible();
    await expect(addEmailButton).toBeDisabled();
    await expect(content.getByRole('button', { name: 'Unlock wallet' })).toHaveCount(0);
    const initialBounds = await emailInput.boundingBox();
    await expect(addEmailButton).toBeEnabled();
    expect(await emailInput.boundingBox()).toEqual(initialBounds);
  });

  test('unlocks owner management explicitly after passive inventory authorization fails', async ({
    page,
  }) => {
    await mountAuthenticationMethods(page, 'owner_session_inactive');

    const content = page.getByRole('region', { name: 'Authentication methods', exact: true });
    const unlockButton = content.getByRole('button', { name: 'Unlock wallet' });
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();

    await expect(content.getByRole('heading', { name: 'Add a method' })).toBeVisible();
    await expect(content).toBeFocused();
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
});
