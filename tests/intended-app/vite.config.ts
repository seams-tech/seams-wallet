import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
  const appRoot = fileURLToPath(new URL('.', import.meta.url));
  const workspaceNodeModules = fileURLToPath(new URL('../../node_modules', import.meta.url));
  const environment = loadEnv(mode, workspaceRoot, '');
  const walletDistRoot = String(environment.VITE_SEAMS_WALLET_DIST_ROOT || '').trim();
  const walletAliases = walletDistRoot
    ? [
        {
          find: /^@seams\/wallet\/react\/styles$/,
          replacement: `${walletDistRoot}/esm/react/styles/styles.css`,
        },
        {
          find: /^@seams\/wallet\/react$/,
          replacement: `${walletDistRoot}/esm/react/index.js`,
        },
        {
          find: /^@seams\/wallet\/advanced$/,
          replacement: `${walletDistRoot}/esm/advanced.js`,
        },
        { find: /^@seams\/wallet$/, replacement: `${walletDistRoot}/esm/index.js` },
      ]
    : [];

  return {
    root: appRoot,
    envDir: workspaceRoot,
    cacheDir: environment.VITE_CACHE_DIR || undefined,
    clearScreen: false,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 4004,
      strictPort: true,
      allowedHosts: ['localhost'],
      fs: { allow: [workspaceRoot] },
    },
    resolve: {
      alias: [
        ...walletAliases,
        { find: /^react$/, replacement: `${workspaceNodeModules}/react/index.js` },
        {
          find: /^react\/jsx-runtime$/,
          replacement: `${workspaceNodeModules}/react/jsx-runtime.js`,
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: `${workspaceNodeModules}/react/jsx-dev-runtime.js`,
        },
        { find: /^react-dom$/, replacement: `${workspaceNodeModules}/react-dom/index.js` },
        {
          find: /^react-dom\/client$/,
          replacement: `${workspaceNodeModules}/react-dom/client.js`,
        },
      ],
      dedupe: ['react', 'react-dom'],
    },
  };
});
