import React from 'react';
import { SeamsContextProvider } from '.';
import { DARK_TOKENS, LIGHT_TOKENS, Theme } from '../components/theme';
import type { ThemeOverrides, ThemeProps, ThemeMode } from '../components/theme';
import { usePreconnectWalletAssets } from '../hooks/usePreconnectWalletAssets';
import { useWalletIframeZIndex } from '../hooks/useWalletIframeZIndex';
import type { SeamsContextProviderProps } from '../types';
import { deepMerge } from '../components/theme/utils';

export type SeamsWebProviderThemeProps = Omit<ThemeProps, 'children'> & {
  setTheme?: (theme: ThemeMode) => void;
};

export interface SeamsWebProviderProps {
  /** SeamsContextProvider configuration */
  config: SeamsContextProviderProps['config'];
  /** Theme props for the boundary (defaults to provider+scope).
   * Token precedence:
   * 1) `theme.tokens` (React override)
   * 2) `config.appearance.theme.colors` (SDK config default)
   * 3) built-in SDK theme tokens
   */
  theme?: SeamsWebProviderThemeProps;
  /**
   * Optional z-index override for the wallet iframe overlay.
   * Sets the CSS variable --seams-wallet-overlay-z on the document root.
   *
   * Defaults and layering:
   * - Wallet iframe overlay: `var(--seams-wallet-overlay-z, 2147483646)`
   * - Linked Devices modal + QR scanner: `overlayZ - 2` / `overlayZ - 1`
   *   (always below the wallet overlay so tx confirmer wins)
   * - ProfileSettingsMenu/HostedSeamsAuthMenu: small local z-indexes only (1–3),
   *   no fullscreen overlay z-index.
   */
  walletOverlayZIndex?: number;
  /**
   * When true, pre-warm iframe + workers on idle after mount.
   * Defaults to false (lazy by default).
   */
  eager?: boolean;
  children: React.ReactNode;
}

function resolveConfigTokenOverrides(
  config: SeamsWebProviderProps['config'],
): ThemeOverrides | undefined {
  const theme = config.appearance?.theme;
  const mode = theme?.mode;
  const colors = theme?.colors;
  if ((mode !== 'light' && mode !== 'dark') || !colors) return undefined;
  return {
    [mode]: { colors },
  };
}

function resolveConfigThemeMode(config: SeamsWebProviderProps['config']): ThemeMode | undefined {
  const mode = config.appearance?.theme?.mode;
  return mode === 'light' || mode === 'dark' ? mode : undefined;
}

function resolveConfigThemeId(config: SeamsWebProviderProps['config']): string {
  return config.appearance?.theme?.id || 'default';
}

function mergeThemeOverrideLayers(
  layers: Array<ThemeOverrides | undefined>,
): ThemeOverrides | undefined {
  let hasLayer = false;
  let merged: ThemeOverrides = {};
  for (const layer of layers) {
    if (!layer) continue;
    hasLayer = true;
    if (layer.light) {
      merged = { ...merged, light: deepMerge(merged.light ?? {}, layer.light) };
    }
    if (layer.dark) {
      merged = { ...merged, dark: deepMerge(merged.dark ?? {}, layer.dark) };
    }
  }
  return hasLayer ? merged : undefined;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function extractThemeColorOverrides(overrides?: ThemeOverrides): {
  light: { colors: Record<string, string> };
  dark: { colors: Record<string, string> };
} {
  return {
    light: { colors: toStringRecord(overrides?.light?.colors) },
    dark: { colors: toStringRecord(overrides?.dark?.colors) },
  };
}

/**
 * SeamsWebProvider — ergonomic composition of Theme + PasskeyProvider.
 * Renders a theming boundary (Theme) and provides Passkey context.
 */
export const SeamsWebProvider: React.FC<SeamsWebProviderProps> = ({
  config,
  theme,
  walletOverlayZIndex,
  eager,
  children,
}) => {
  // Internal: opportunistically add preconnect/prefetch hints for wallet + relayer
  usePreconnectWalletAssets(config);

  // Optionally override the wallet iframe overlay z-index via CSS variable
  useWalletIframeZIndex(walletOverlayZIndex);

  const {
    theme: controlledTheme,
    setTheme,
    tokens: reactTokenOverrides,
    ...themeOverrides
  } = theme || ({} as any);
  const configTokenOverrides = React.useMemo(() => resolveConfigTokenOverrides(config), [config]);
  const rootTheme = controlledTheme || resolveConfigThemeMode(config) || 'dark';
  const resolvedReactTokenOverrides = React.useMemo<ThemeOverrides | undefined>(() => {
    if (!reactTokenOverrides) return undefined;
    return typeof reactTokenOverrides === 'function'
      ? reactTokenOverrides({ light: LIGHT_TOKENS, dark: DARK_TOKENS })
      : reactTokenOverrides;
  }, [reactTokenOverrides]);
  const mergedTokenOverrides = React.useMemo<ThemeOverrides | undefined>(
    () => mergeThemeOverrideLayers([configTokenOverrides, resolvedReactTokenOverrides]),
    [configTokenOverrides, resolvedReactTokenOverrides],
  );
  const mergedTokens = React.useMemo<ThemeProps['tokens']>(() => {
    if (!mergedTokenOverrides) return undefined;
    return mergedTokenOverrides;
  }, [mergedTokenOverrides]);

  const mergedThemeColorOverrides = React.useMemo(
    () => extractThemeColorOverrides(mergedTokenOverrides),
    [mergedTokenOverrides],
  );
  const providerConfig = React.useMemo<SeamsWebProviderProps['config']>(() => {
    const lightColors = mergedThemeColorOverrides.light.colors;
    const darkColors = mergedThemeColorOverrides.dark.colors;
    const activeColors = rootTheme === 'dark' ? darkColors : lightColors;
    return {
      ...config,
      appearance: {
        ...(config.appearance || {}),
        theme: {
          id: resolveConfigThemeId(config),
          mode: rootTheme,
          colors: activeColors,
        },
      },
    };
  }, [config, mergedThemeColorOverrides.dark.colors, mergedThemeColorOverrides.light.colors, rootTheme]);

  const providerAppearance = providerConfig.appearance;

  React.useEffect(() => {
    if (rootTheme === 'light' || rootTheme === 'dark') {
      try {
        document.documentElement.setAttribute('data-seams-theme', rootTheme);
      } catch {}
    }
  }, [rootTheme]);

  const themeProps: ThemeProps = {
    theme: controlledTheme,
    setTheme,
    tokens: mergedTokens,
    ...(themeOverrides as Omit<ThemeProps, 'children' | 'theme'>),
  };
  return (
    <SeamsContextProvider
      config={providerConfig}
      eager={eager}
      theme={
        rootTheme === 'light' || rootTheme === 'dark'
          ? { theme: rootTheme, setTheme, appearance: providerAppearance }
          : undefined
      }
    >
      <Theme {...themeProps}>{children}</Theme>
    </SeamsContextProvider>
  );
};

export default SeamsWebProvider;
