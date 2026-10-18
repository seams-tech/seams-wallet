import { useState } from 'react';
import { HostedSeamsAuthMenu, useSeams } from '@seams/wallet/react';

export function AssetMenu() {
  const { seams } = useSeams();
  const [mode, setMode] = useState<'closed' | 'login' | 'register'>('closed');
  // Sign-in intent starts the wallet runtime download before the click mounts the menu.
  const prepareSignIn = seams.authMenu.prepare;
  return (
    <section>
      <button
        data-testid="asset-open-auth-menu"
        onPointerEnter={prepareSignIn}
        onFocus={prepareSignIn}
        onClick={setMode.bind(null, 'login')}
      >
        Open wallet menu
      </button>
      <button data-testid="asset-open-registration-menu" onClick={setMode.bind(null, 'register')}>
        Open registration menu
      </button>
      {mode !== 'closed' && (
        <HostedSeamsAuthMenu
          initialMode={mode}
          registrationAccountInput={
            mode === 'register' ? 'sponsored_named_near_account' : 'implicit_wallet'
          }
          showRegistrationInput={mode === 'register'}
          onOutcome={setMode.bind(null, 'closed')}
        />
      )}
    </section>
  );
}
