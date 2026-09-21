export const TEST_BROWSER_IMPORTS = {
  preact: '/_test-preact/preact.module.js',
  'preact/hooks': '/_test-preact/hooks.module.js',
  'preact/jsx-runtime': '/_test-preact/jsxRuntime.module.js',
  react: 'https://esm.sh/react@19.1.1',
  'react/jsx-runtime': 'https://esm.sh/react@19.1.1/jsx-runtime',
  'react/jsx-dev-runtime': 'https://esm.sh/react@19.1.1/jsx-dev-runtime',
  'react-dom': 'https://esm.sh/react-dom@19.1.1',
  'react-dom/client': 'https://esm.sh/react-dom@19.1.1/client',
  bs58: 'https://esm.sh/bs58@6.0.0',
  idb: 'https://esm.sh/idb@8.0.0',
  '@noble/ed25519': 'https://esm.sh/@noble/ed25519@3.0.0',
  '@noble/curves/': 'https://esm.sh/@noble/curves@2.0.1/',
  '@noble/hashes/': 'https://esm.sh/@noble/hashes@2.0.1/',
  qrcode: 'https://esm.sh/qrcode@1.5.4',
  jsqr: 'https://esm.sh/jsqr@1.4.0',
  '@near-js/types': 'https://esm.sh/@near-js/types@2.0.1',
  tslib: 'https://esm.sh/tslib@2.8.1',
  buffer: 'https://esm.sh/buffer@6.0.3',
} as const;

export const TEST_BROWSER_IMPORT_MAP_ATTR = 'data-seams-importmap';
export const TEST_BROWSER_IMPORT_MAP_MARKER = `${TEST_BROWSER_IMPORT_MAP_ATTR}="1"`;

export function buildTestBrowserImportMapHtml(): string {
  return `<script type="importmap" ${TEST_BROWSER_IMPORT_MAP_MARKER}>${JSON.stringify({
    imports: TEST_BROWSER_IMPORTS,
  })}</script>`;
}
