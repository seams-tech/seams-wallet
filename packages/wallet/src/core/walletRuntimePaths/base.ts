/**
 * SDK Base (wallet origin)
 *
 * The wallet iframe host announces the absolute SDK base URL so that all
 * embedded assets (host script, wallet UI bundles) and module workers resolve from
 * the wallet origin in production. This keeps sensitive execution isolated
 * under the wallet site while allowing cross‑origin embedding.
 *
 * Writers:
 *  - Wallet iframe host (service) on boot and after PM_SET_CONFIG
 *  - App provider hook in dev when walletOrigin is configured
 *
 * Readers:
 *  - WebAuthnManager (to set worker base origin for managers)
 *  - wallet UI hosts (to resolve embedded script/css URLs)
 */
export const SEAMS_WALLET_SDK_BASE_KEY = '__SEAMS_WALLET_SDK_BASE__';
export const SEAMS_WALLET_SDK_BASE_EVENT = 'SEAMS_WALLET_SDK_BASE_CHANGED';
export const SEAMS_WALLET_ASSET_VERSION_KEY = '__SEAMS_WALLET_ASSET_VERSION__';

/**
 * Typed CustomEvent emitted when the wallet SDK base changes.
 * Detail contains the absolute base URL string (e.g., `${walletOrigin}/sdk/`).
 */
export type WalletSdkBaseChangedEvent = CustomEvent<string>;

export interface WalletSDKBase {
  [SEAMS_WALLET_SDK_BASE_KEY]?: string;
  [SEAMS_WALLET_ASSET_VERSION_KEY]?: string;
}

/**
 * @returns Absolute SDK base URL (e.g., `${walletOrigin}/sdk/`) when set, otherwise undefined.
 */
export function getEmbeddedBase(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as WalletSDKBase;
  const v = w[SEAMS_WALLET_SDK_BASE_KEY];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * @param url - Absolute SDK base URL (e.g., `${walletOrigin}/sdk/`).
 * @returns void
 */
export function setEmbeddedBase(url: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as WalletSDKBase;
  w[SEAMS_WALLET_SDK_BASE_KEY] = url;
  window.dispatchEvent(new CustomEvent(SEAMS_WALLET_SDK_BASE_EVENT as any, { detail: url }));
}

export function getEmbeddedAssetVersion(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = (window as unknown as WalletSDKBase)[SEAMS_WALLET_ASSET_VERSION_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function setEmbeddedAssetVersion(version: string): void {
  if (typeof window === 'undefined') return;
  const normalized = version.trim();
  if (!normalized) return;
  (window as unknown as WalletSDKBase)[SEAMS_WALLET_ASSET_VERSION_KEY] = normalized;
}

/**
 * @param cb - Callback invoked with the new absolute base URL when it changes.
 * @returns Unsubscribe function to remove the listener.
 */
export function onEmbeddedBaseChange(cb: (url: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: WalletSdkBaseChangedEvent) => {
    const d = e.detail;
    if (typeof d === 'string' && d.length > 0) cb(d);
  };
  window.addEventListener(SEAMS_WALLET_SDK_BASE_EVENT, handler as EventListener, { passive: true });
  return () => window.removeEventListener(SEAMS_WALLET_SDK_BASE_EVENT, handler as EventListener);
}
