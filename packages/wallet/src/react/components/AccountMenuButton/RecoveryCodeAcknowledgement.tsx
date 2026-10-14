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
          I’ve saved these codes somewhere safe.
          <small>They won’t be shown again after you finish.</small>
        </span>
      </label>
      <button
        type="button"
        className="seams-account-action primary"
        disabled={!acknowledged}
        onClick={onDone}
      >
        Done
      </button>
    </>
  );
}
