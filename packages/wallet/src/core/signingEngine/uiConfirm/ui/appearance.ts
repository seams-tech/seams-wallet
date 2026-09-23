import type { AppearanceConfig, ThemeMode } from '@/core/types/seams';

const DEFAULT_UI_APPEARANCE: AppearanceConfig = {
  theme: {
    id: 'default',
    mode: 'dark',
    colors: {},
  },
  palette: 'default',
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function resolveUiAppearance(args: {
  requestedAppearance?: AppearanceConfig;
  getAppearance?: () => AppearanceConfig;
  requestedMode?: ThemeMode;
}): AppearanceConfig {
  const appearance =
    args.requestedAppearance ?? args.getAppearance?.() ?? DEFAULT_UI_APPEARANCE;
  if (!isThemeMode(args.requestedMode) || args.requestedMode === appearance.theme.mode) {
    return appearance;
  }
  return {
    ...appearance,
    theme: {
      ...appearance.theme,
      mode: args.requestedMode,
    },
  };
}
