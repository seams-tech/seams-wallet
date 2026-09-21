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
};

const rowStyle: CSSProperties = {
  display: 'block',
  height: 48,
  borderRadius: 12,
  background: 'currentColor',
  opacity: 0.08,
};

/** Inert artwork for loading and previews; contains no auth controls or wallet logic. */
export function SeamsAuthMenuMock({ initialMode = 'login' }: { initialMode?: HostedAuthMenuMode }) {
  return (
    <span data-seams-auth-menu-mock="true" aria-hidden="true" style={shellStyle}>
      <strong style={{ fontSize: 24 }}>
        {initialMode === 'register' ? 'Create a wallet' : 'Sign in'}
      </strong>
      <span style={{ ...rowStyle, height: 12, width: '65%' }} />
      <span style={rowStyle} />
      <span style={rowStyle} />
      <span style={{ ...rowStyle, height: 12, width: '30%', justifySelf: 'center' }} />
      <span style={rowStyle} />
      <span style={rowStyle} />
    </span>
  );
}
