import { WalletText, WalletLocaleContext } from '@/react/context/WalletLocale';
import type { CSSProperties } from 'react';
import type { HostedAuthMenuMode } from './types';

const shellStyle: CSSProperties = {
  display: 'grid',
  gap: 16,
  boxSizing: 'border-box',
  width: '100%',
  padding: 28,
  borderRadius: 24,
  border: '1px solid var(--seams-colors-borderPrimary, #ddd8d1)',
  background: 'var(--seams-colors-colorBackground, #fffdf9)',
  color: 'var(--seams-colors-textPrimary, #292524)',
  pointerEvents: 'none',
  margin: 0,
  minWidth: 0,
  font: '14px / 1.5 system-ui, sans-serif',
  letterSpacing: 'normal',
  textTransform: 'none',
};

const rowStyle: CSSProperties = {
  display: 'block',
  height: 48,
  borderRadius: 12,
  background: 'currentColor',
  opacity: 0.08,
  width: '100%',
  margin: 0,
  padding: 0,
  border: 0,
};

/** Inert artwork for loading and previews; contains no auth controls or wallet logic. */
export function SeamsAuthMenuMock({
  initialMode = 'login',
  locale = 'en',
}: {
  initialMode?: HostedAuthMenuMode;
  locale?: import('@/core/ui/locale').WalletLocale;
}) {
  return (
    <WalletLocaleContext.Provider value={locale}>
      <span
        data-seams-root=""
        className="seams-auth-menu-mock"
        data-seams-auth-menu-mock="true"
        aria-hidden="true"
        style={shellStyle}
      >
        <strong style={{ fontSize: 24 }}>
          {initialMode === 'register' ? (
            <WalletText message="Create a wallet" />
          ) : (
            <WalletText message="Unlock wallet" />
          )}
        </strong>
        <span style={{ ...rowStyle, height: 12, width: '65%' }} />
        <span style={rowStyle} />
        <span style={rowStyle} />
        <span style={{ ...rowStyle, height: 12, width: '30%', justifySelf: 'center' }} />
        <span style={rowStyle} />
        <span style={rowStyle} />
      </span>
    </WalletLocaleContext.Provider>
  );
}
