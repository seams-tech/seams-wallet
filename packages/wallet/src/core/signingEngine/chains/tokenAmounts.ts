/** A base-unit integer string as an exact decimal amount. */
export function formatTokenBaseUnits(baseUnits: string, decimals: number): string {
  if (decimals === 0) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}
