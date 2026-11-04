import { useState } from 'react';
import { QRCodeScanner } from '@seams/wallet/react';
import type { LinkDeviceFlowEvent } from '@seams/wallet';

function logLinkEvent(event: LinkDeviceFlowEvent): void {
  console.log(event.phase, event.status, event.message);
}

// Device 1: `QRCodeScanner` opens the camera, reads the code that `ShowQRCode`
// displays on Device 2, and runs the approval. Mount it inside SeamsWebProvider.
export function ScanLinkCode() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Link a new device</button>
      {isOpen && (
        <QRCodeScanner
          isOpen={isOpen}
          onQRCodeScanned={(qrData) => console.log('Linked device', qrData)}
          onEvent={logLinkEvent}
          onError={(error) => console.error('Device link failed', error)}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
