import React from 'react';

export function QRCodeScannerCamera({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="qr-scanner-camera-container">
      {children}
      <div className="qr-scanner-overlay">
        <div className="qr-scanner-box" />
      </div>
    </div>
  );
}
