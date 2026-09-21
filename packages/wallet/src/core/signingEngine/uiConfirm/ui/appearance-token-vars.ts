import type { AppearanceConfig } from '@/core/types/seams';

function sanitizeTokenName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeTokenValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024) return undefined;
  if (/[{};\n\r]/.test(trimmed)) return undefined;
  return trimmed;
}

function appearanceTokenCssVars(appearance?: AppearanceConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const group of ['colors', 'shape'] as const) {
    for (const [rawName, rawValue] of Object.entries(appearance?.theme[group] ?? {})) {
      if (typeof rawValue !== 'string') continue;
      const name = sanitizeTokenName(rawName);
      if (!name) continue;
      const value = sanitizeTokenValue(rawValue);
      if (!value) continue;
      vars[`--seams-${group}-${name}`] = `${value} !important`;
    }
  }
  return vars;
}

export function appearanceTokenCssRule(
  elementId: string,
  appearance?: AppearanceConfig,
): string {
  const declarations = Object.entries(appearanceTokenCssVars(appearance))
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  // Live wallet-host overrides take precedence over a surface's initial appearance.
  return `:where(#${elementId}){${declarations}}`;
}
