import {
  getEmbeddedBase,
  setEmbeddedAssetVersion,
  setEmbeddedBase,
} from '@/core/walletRuntimePaths';

interface GlobalThis {
  global?: unknown;
  process?: { env?: Record<string, string | undefined> };
}

/**
 * Bootstrap tasks for the wallet iframe host.
 * - Provides Node-ish globals required by some libs
 * - Applies a transparent surface for the iframe document
 * - Emits early diagnostics to the parent window
 * - Establishes a default embedded asset base (if not already set)
 */
function ensureNodeLikeGlobals(): void {
  const g = globalThis as GlobalThis;
  if (g.global === undefined) {
    g.global = globalThis as unknown;
  }
  if (!g.process || typeof g.process !== 'object') {
    g.process = { env: {} };
  } else if (!g.process.env || typeof g.process.env !== 'object') {
    g.process.env = {};
  }
}

export function bootstrapTransparentHost(): void {
  // Some third‑party libs expect Node-ish globals. Provide minimal, safe shims.
  ensureNodeLikeGlobals();

  if (window.location.origin === 'null') {
    // Helpful in misconfigured cross-origin or COOP/COEP situations
    // (use direct '*' targeting before we know parent origin)
    window.parent?.postMessage(
      {
        type: 'SERVICE_HOST_DEBUG_ORIGIN',
        origin: window.location.origin,
        href: window.location.href,
      },
      '*',
    );
    // Keep a console trace locally too

    console.warn(
      '[WalletHost] iframe is running with opaque (null) origin. Check COEP/CORP headers and ensure navigation succeeded.',
    );
  }

  ensureTransparentSurface();

  // Early lifecycle signal for observers in the parent
  window.parent?.postMessage({ type: 'SERVICE_HOST_BOOTED' }, '*');
  window.parent?.postMessage(
    {
      type: 'SERVICE_HOST_DEBUG_ORIGIN',
      origin: window.location.origin,
      href: window.location.href,
    },
    '*',
  );

  // Establish a default embedded assets base as soon as this module loads.
  // This points to the directory containing the compiled SDK files (e.g., '/sdk/').
  const moduleUrl = new URL(import.meta.url);
  const assetVersion = moduleUrl.searchParams.get('v');
  if (assetVersion) setEmbeddedAssetVersion(assetVersion);
  const here = new URL('.', moduleUrl).toString();
  const norm = here.endsWith('/') ? here : here + '/';
  if (!getEmbeddedBase()) setEmbeddedBase(norm);
}

/**
 * Ensure the iframe document paints transparently, without dark-mode class bleed-through.
 */
export function ensureTransparentSurface(): void {
  const apply = () => {
    const doc = document;
    doc.documentElement.classList.add('seams-transparent');
    doc.body?.classList.add('seams-transparent');
    doc.documentElement.classList.remove('dark');
    doc.body?.classList.remove('dark');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
  } else {
    apply();
  }
  window.addEventListener('load', () => apply(), { once: true });
}
