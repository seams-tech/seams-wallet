/** The languages supported by SDK-owned wallet controls. */
export type WalletLocale = 'en' | 'ja';

/** Normalize a language tag at a configuration or request boundary. */
export function normalizeWalletLocale(value: unknown): WalletLocale {
  if (typeof value !== 'string') return 'en';
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return language === 'ja' ? 'ja' : 'en';
}
