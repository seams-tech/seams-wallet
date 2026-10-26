// Builds the wallet-service HTML that the package build emits to dist/public.
import {
  normalizeWalletHostVariant,
  walletHostScriptFileForVariant,
  type WalletHostVariant,
} from '../core/browser/walletIframe/hostVariant';

function withAssetVersion(url: string, assetVersion?: string): string {
  const version = String(assetVersion || '').trim();
  if (!version) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

// Builds wallet service HTML that links only external CSS/JS (no inline),
// so strict CSP (style-src 'self'; style-src-attr 'none') works in dev/prod.
export function buildWalletServiceHtml(
  sdkBasePath: string = '/sdk',
  assetVersion?: string,
  walletHostVariant: WalletHostVariant = 'runtime',
): string {
  const walletUiCss = withAssetVersion(`${sdkBasePath}/wallet-ui.css`, assetVersion);
  const walletShimsJs = withAssetVersion(`${sdkBasePath}/wallet-shims.js`, assetVersion);
  const walletHostScript = withAssetVersion(
    `${sdkBasePath}/${walletHostScriptFileForVariant(normalizeWalletHostVariant(walletHostVariant))}`,
    assetVersion,
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Web3Authn Wallet Service</title>
    <!-- Surface styles are external so strict CSP can keep style-src 'self' -->
    <link rel="stylesheet" href="${walletUiCss}" />
    <!-- Minimal shims some ESM bundles expect (externalized to enable strict CSP) -->
    <script src="${walletShimsJs}"></script>
    <!-- Hint the browser to fetch the host script earlier -->
    <link rel="modulepreload" href="${walletHostScript}" crossorigin>
  </head>
  <body>
    <!-- sdkBasePath points to the SDK root (e.g. '/sdk'). Load the host directly. -->
    <script type="module" src="${walletHostScript}"></script>
  </body>
</html>`;
}
