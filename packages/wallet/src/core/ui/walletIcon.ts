export const MAX_WALLET_ICON_LENGTH = 131_072;

export function parseWalletImageUrl(value: unknown): string | null {
  const dataIcon = parseWalletDataIcon(value);
  if (dataIcon !== null) return dataIcon;
  if (typeof value !== 'string' || value.length > MAX_WALLET_ICON_LENGTH) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function parseWalletDataIcon(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_WALLET_ICON_LENGTH ||
    !/^data:image\/(?:png|webp|jpeg|svg\+xml)[;,]/i.test(value)
  ) {
    return null;
  }
  return value;
}
