window.global ||= window;
window.process ||= { env: {} };

(function () {
  try {
    var script =
      typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : '';
    if (!script) return;
    var url = new URL(script, typeof location !== 'undefined' ? location.href : '');
    var href = url.href;
    var base = href.slice(0, href.lastIndexOf('/') + 1);
    if (typeof window === 'undefined') return;
    if (!window.__SEAMS_WALLET_SDK_BASE__) window.__SEAMS_WALLET_SDK_BASE__ = base;
    var assetVersion = url.searchParams.get('v');
    if (assetVersion) window.__SEAMS_WALLET_ASSET_VERSION__ = assetVersion;
  } catch (error) {}
})();
