import { WalletText } from '@/react/context/WalletLocale';
import React, { useState } from 'react';

async function copyCodes(
  codes: readonly string[],
  feedback: (message: string) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${codes.join('\n')}\n`);
    feedback('Copied all codes.');
  } catch {
    feedback('Unable to copy. Download the codes instead.');
  }
}

function downloadCodes(codes: readonly string[], feedback: (message: string) => void): void {
  try {
    const url = URL.createObjectURL(
      new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'seams-recovery-codes.txt';
    try {
      anchor.click();
    } finally {
      setTimeout(URL.revokeObjectURL.bind(URL, url), 0);
    }
    feedback('Downloaded all codes.');
  } catch {
    feedback('Unable to download. Copy the codes instead.');
  }
}

export function RecoveryCodeActions({ codes }: { codes: readonly string[] }): React.JSX.Element {
  const [feedback, setFeedback] = useState('');
  return (
    <>
      <div className="seams-recovery-code-actions">
        <button
          type="button"
          className="seams-account-action"
          onClick={copyCodes.bind(null, codes, setFeedback)}
        >
          <WalletText message="Copy all" />
        </button>
        <button
          type="button"
          className="seams-account-action"
          onClick={downloadCodes.bind(null, codes, setFeedback)}
        >
          <WalletText message="Download all" />
        </button>
      </div>
      <p className="seams-recovery-code-action-status" role="status" aria-live="polite">
        <WalletText copy={feedback} />
      </p>
    </>
  );
}
