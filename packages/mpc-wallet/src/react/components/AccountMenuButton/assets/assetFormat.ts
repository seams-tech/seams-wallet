import { formatTokenBaseUnits } from '@/core/signingEngine/chains/tokenAmounts';
import type { WalletAsset } from '@/core/assets/assetList';
import type { AssetBalance } from '@/core/assets/readAssetBalances';

const DISPLAY_FRACTION_DIGITS = 4;
// A non-zero amount shows at least two places, as money does: 250.00, 4.10.
const MINIMUM_FRACTION_DIGITS = 2;

/**
 * A short display amount. It truncates and never rounds up, so the panel never shows more than
 * the wallet holds. A non-zero amount below the shown precision reads as "<0.0001".
 */
export function formatAssetAmount(baseUnits: string, decimals: number): string {
  const exact = formatTokenBaseUnits(baseUnits, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const trimmed = fraction.slice(0, DISPLAY_FRACTION_DIGITS).replace(/0+$/, '');
  if (whole === '0' && !trimmed && fraction)
    return `<0.${'0'.repeat(DISPLAY_FRACTION_DIGITS - 1)}1`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (whole === '0' && !trimmed) return '0';
  const places = Math.min(decimals, MINIMUM_FRACTION_DIGITS);
  const shown = trimmed.padEnd(places, '0');
  return shown ? `${grouped}.${shown}` : grouped;
}

/** The exact amount, for a Max button and for titles. */
export function exactAssetAmount(baseUnits: string, decimals: number): string {
  return formatTokenBaseUnits(baseUnits, decimals);
}

export const NETWORK_LABELS: Readonly<Record<WalletAsset['network'], string>> = {
  'near-mainnet': 'NEAR',
  'near-testnet': 'NEAR testnet',
  'arc-mainnet': 'Arc',
  'arc-testnet': 'Arc testnet',
  'ethereum-mainnet': 'Ethereum',
  'ethereum-sepolia': 'Sepolia',
};

export function networkLabel(asset: WalletAsset): string {
  return NETWORK_LABELS[asset.network];
}

function hasBalance(balance: AssetBalance): boolean {
  return balance.kind === 'read' && BigInt(balance.available) > 0n;
}

/** Primary assets always; a variant only while it holds something. */
export function visibleBalances(balances: readonly AssetBalance[]): AssetBalance[] {
  return balances.filter((balance) => balance.asset.primary || hasBalance(balance));
}

/**
 * The card's leading balances. With no prices, held assets come first in list order, so a large
 * count of a cheap token never hides a stablecoin. Primary assets fill the remaining rows.
 */
export function leadingBalances(balances: readonly AssetBalance[], count: number): AssetBalance[] {
  const held = balances.filter(hasBalance);
  const rest = visibleBalances(balances).filter((balance) => !hasBalance(balance));
  return [...held, ...rest].slice(0, count);
}
