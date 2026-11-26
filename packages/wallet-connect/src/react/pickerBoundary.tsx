import type { ReactNode } from 'react';
import './externalWalletPicker.css';

/**
 * The SDK theme boundary of a picker. The picker styles start with
 * `[data-seams-root].seams-theme-provider` and read only their own `--seams-wallet-picker-*`
 * variables, so the picker needs no wallet theme tokens.
 */
export function PickerBoundary({ children }: { children: ReactNode }) {
  return (
    <main data-seams-root="" className="seams-theme-provider">
      {children}
    </main>
  );
}
