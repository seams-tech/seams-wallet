import { isPlainObject } from '@shared/utils/validation';
import { parseWalletImageUrl } from '@/core/ui/walletIcon';

export type HostedAuthMenuRecoveryOptions = 'collapsible' | 'expanded' | 'hidden';

export type HostedAuthMenuFooterBrand =
  | { readonly kind: 'seams'; readonly logo?: never; readonly name?: never }
  | { readonly kind: 'custom'; readonly logo: string; readonly name: string };

export function parseAuthMenuRecoveryOptions(value: unknown): HostedAuthMenuRecoveryOptions | null {
  if (value === undefined) return 'collapsible';
  switch (value) {
    case 'collapsible':
      return 'collapsible';
    case 'expanded':
      return 'expanded';
    case 'hidden':
      return 'hidden';
    default:
      return null;
  }
}

export function parseAuthMenuFooterBrand(value: unknown): HostedAuthMenuFooterBrand | null {
  if (value === undefined) return { kind: 'seams' };
  if (!isPlainObject(value)) return null;
  if (value.kind === 'seams' && Object.keys(value).length === 1) return { kind: 'seams' };
  if (
    value.kind !== 'custom' ||
    Object.keys(value).length !== 3 ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 512
  )
    return null;
  const logo = parseWalletImageUrl(value.logo);
  return logo ? { kind: 'custom', logo, name: value.name.trim() } : null;
}
