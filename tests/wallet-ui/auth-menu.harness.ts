import type { Page } from '@playwright/test';
import { routePreactModules } from '../setup/preact';
import type {
  AuthMenuIntent,
  AuthMenuViewModel,
} from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import type { AuthMenuSurfaceHandle } from '@/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface';

declare global {
  interface Window {
    __authMenu: {
      handle: AuthMenuSurfaceHandle;
      model: AuthMenuViewModel;
      onIntent: (intent: AuthMenuIntent) => void;
    };
  }
}

export async function prepareAuthMenuDocument(page: Page): Promise<void> {
  await routePreactModules(page);
  await page.evaluate(async () => {
    for (const [filename, marker] of [['wallet-ui.css', 'data-seams-wallet-ui-css']]) {
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/_test-sdk/esm/sdk/' + filename;
        link.setAttribute(marker, '');
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Failed to load ' + filename));
        document.head.appendChild(link);
      });
    }
  });
}

export async function mountAuthMenu(page: Page, viewModel: AuthMenuViewModel): Promise<void> {
  await page.evaluate(async (model) => {
    const { mountAuthMenuSurface } =
      await import('/_test-sdk/esm/SeamsWeb/walletIframe/host/ui/auth-menu/mountAuthMenuSurface.js');
    window.__authMenu?.handle.dispose();
    const parent = document.getElementById('test-root') ?? document.body;
    const handle = mountAuthMenuSurface({
      parent,
      viewModel: model,
      onIntent: (intent: AuthMenuIntent) => window.__authMenu.onIntent(intent),
    });
    window.__authMenu = { handle, model, onIntent: () => {} };
  }, viewModel);
}
