export const MAX_WALLET_ICON_LENGTH = 131_072;

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
