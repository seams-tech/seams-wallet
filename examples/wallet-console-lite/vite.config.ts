import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const exampleRoot = fileURLToPath(new URL('.', import.meta.url));
  const walletDistRoot = fileURLToPath(new URL('../../packages/wallet/dist', import.meta.url));
  const environment = loadEnv(mode, exampleRoot, '');
  const walletAssetHost = environment.VITE_SEAMS_WALLET_ASSET_HOST === '1';

  return {
    root: exampleRoot,
    clearScreen: false,
    publicDir: walletAssetHost ? `${walletDistRoot}/public` : false,
    plugins: [walletOriginPlugin(walletAssetHost), react()],
    // This repository-only showcase renders the SDK's actual internal UI.
    resolve: {
      alias: {
        '@wallet-preview/SeamsWeb/walletIframe/client/overlay/overlay-controller': `${walletDistRoot}/../src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts`,
        '@wallet-preview': `${walletDistRoot}/esm`,
        '@': `${walletDistRoot}/../src`,
        '@shared': `${walletDistRoot}/../../shared-ts/src`,
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: `${exampleRoot}/index.html`,
          confirmationPreview: `${exampleRoot}/confirmation-preview.html`,
        },
      },
    },
    server: {
      host: 'localhost',
      port: walletAssetHost ? 4202 : 4201,
      strictPort: true,
      allowedHosts: ['localhost'],
      proxy: walletAssetHost
        ? undefined
        : {
            '/__local-workspace': {
              target: 'http://127.0.0.1:4203',
            },
          },
    },
  };
});

function walletOriginPlugin(walletAssetHost: boolean) {
  return {
    name: 'seams-wallet-console-lite-origin',
    configureServer(server: { middlewares: { use: (handler: WalletOriginMiddleware) => void } }) {
      server.middlewares.use(createWalletOriginMiddleware(walletAssetHost));
    },
  };
}

type WalletOriginMiddleware = (
  request: { url?: string },
  response: { statusCode: number; end: () => void },
  next: () => void,
) => void;

function createWalletOriginMiddleware(walletAssetHost: boolean): WalletOriginMiddleware {
  return function walletOriginMiddleware(request, response, next) {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (walletAssetHost) {
      if (pathname === '/wallet-service' || pathname === '/wallet-service/') {
        request.url = '/wallet-service/index.html';
      }
      next();
      return;
    }
    if (pathname === '/wallet-service' || pathname.startsWith('/wallet-service/')) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (pathname.startsWith('/sdk/')) {
      response.statusCode = 404;
      response.end();
      return;
    }
    next();
  };
}
