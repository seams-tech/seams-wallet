import { WalletText } from '@/react/context/WalletLocale';
import React, { useState } from 'react';

function updateAcknowledgement(
  setAcknowledged: (value: boolean) => void,
  event: React.ChangeEvent<HTMLInputElement>,
): void {
  setAcknowledged(event.currentTarget.checked);
}

export function RecoveryCodeAcknowledgement({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <>
      <label className="seams-account-recovery-acknowledgement">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={updateAcknowledgement.bind(null, setAcknowledged)}
        />
        <span>
          <WalletText message="I’ve saved these codes. They won’t be shown again." />
        </span>
      </label>
      <button
        type="button"
        className="seams-account-action primary"
        disabled={!acknowledged}
        onClick={onDone}
      >
        <WalletText message="Done" />
      </button>
    </>
  );
}
