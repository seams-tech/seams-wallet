import type { SeamsWeb } from '@seams/wallet';
import {
  HostedSeamsAuthMenu,
  type HostedAuthMenuOutcome,
  SHAPE_PRESETS,
  Theme,
} from '@seams/wallet/react';

const colors = {
  colorBackground: '#ffffff',
  textPrimary: '#000000',
  buttonBackground: '#000000',
};

export function ThemedAuthMenu({
  onOutcome,
}: {
  onOutcome: (outcome: HostedAuthMenuOutcome) => void;
}) {
  return (
    <Theme
      theme="light"
      tokens={{
        light: {
          colors,
          shape: SHAPE_PRESETS.rounded,
        },
      }}
    >
      <HostedSeamsAuthMenu onOutcome={onOutcome} />
    </Theme>
  );
}

export function applyWalletTheme(seams: SeamsWeb): void {
  seams.setAppearance({
    theme: {
      id: 'brand',
      mode: 'light',
      colors,
      shape: { ...SHAPE_PRESETS.rounded },
    },
    palette: 'default',
  });
}
