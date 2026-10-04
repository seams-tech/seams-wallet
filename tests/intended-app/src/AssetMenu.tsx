import { useState } from 'react';
import { HostedSeamsAuthMenu } from '@seams/wallet/react';

export function AssetMenu() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button data-testid="asset-open-auth-menu" onClick={setOpen.bind(null, true)}>
        Open wallet menu
      </button>
      {open && <HostedSeamsAuthMenu onOutcome={setOpen.bind(null, false)} />}
    </section>
  );
}
