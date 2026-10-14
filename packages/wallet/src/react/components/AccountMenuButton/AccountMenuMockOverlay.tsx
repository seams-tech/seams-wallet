import React from 'react';
import { Theme, useTheme } from '../theme/ThemeProvider';
import { AccountMenuDialogFrame, useAccountMenuDialogKeyboard } from './AccountMenuDialog';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import { QRCodeScannerCamera } from '../QRCodeScannerCamera';
import './LinkedDevicesModal.css';

type PreviewOverlay = 'methods' | 'scanner';

export function AccountMenuMockOverlay({
  kind,
  onClose,
}: {
  kind: PreviewOverlay;
  onClose: () => void;
}): React.JSX.Element {
  const { theme, tokens } = useTheme();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useAccountMenuDialogKeyboard({
    isOpen: true,
    presentation: 'modal',
    onClose,
    dialogRef,
    focusableSelector: 'button:not([disabled])',
  });
  if (kind === 'scanner') {
    return (
      <Theme theme={theme} tokens={theme === 'light' ? { light: tokens } : { dark: tokens }}>
        <div
          className="qr-scanner-modal"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-scanner-title"
        >
          <div className="qr-scanner-panel" tabIndex={-1}>
            <h2 id="qr-scanner-title" className="qr-scanner-visually-hidden">
              Scan and link a device
            </h2>
            <div className="qr-scanner-camera-section">
              <QRCodeScannerCamera>
                <div
                  className="qr-scanner-video is-ready"
                  aria-hidden="true"
                  style={{
                    background: 'radial-gradient(ellipse at 35% 40%, #454545, #171717 75%)',
                  }}
                />
              </QRCodeScannerCamera>
              <div className="qr-scanner-instructions">
                <p>Position the QR code within the frame</p>
              </div>
            </div>
          </div>
          <button
            className="qr-scanner-close"
            type="button"
            aria-label="Close scanner"
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </Theme>
    );
  }
  return (
    <AccountMenuDialogFrame
      presentation="modal"
      onClose={onClose}
      dialogRef={dialogRef}
      contentClassName="seams-auth-methods-modal-content"
      titleId="seams-auth-methods-modal-title"
      title="Authentication methods"
      closeLabel="Close authentication methods"
    >
      <p className="seams-auth-methods-modal-intro">Manage how your devices unlock the wallet.</p>
      <section className="seams-account-menu-section" aria-labelledby="seams-auth-methods-active">
        <h3 id="seams-auth-methods-active" className="seams-account-menu-section-label">
          Active methods
        </h3>
        <ul className="seams-linked-devices-modal-list seams-linked-devices-modal-list--grouped">
          <AuthenticationMethodRow
            kind="passkey"
            title="MacBook Pro"
            description="Touch ID · This device"
          />
          <AuthenticationMethodRow
            kind="passkey"
            title="iPhone"
            description="Face ID · iCloud Keychain"
          />
          <AuthenticationMethodRow
            kind="passkey"
            title="Pixel 9"
            description="Fingerprint · Google Password Manager"
          />
        </ul>
      </section>
    </AccountMenuDialogFrame>
  );
}
