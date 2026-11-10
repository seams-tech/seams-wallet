import { useState } from 'react';
import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuSessionIdFromBoundary,
  type HostedAuthMenuOutcome,
} from '@seams/wallet';
import { useSeams, type WalletModalBeforeControls } from '@seams/wallet/react';

/**
 * App steps around the sign-in card in the Wallet's own modal: the app's step, then the
 * Wallet's sign-in card with Back, then the app's step with the result. The app has no dialog
 * of its own; TransactionReviewHost shows the modal.
 */
export function ModalStepsExample() {
  const { seams } = useSeams();
  const [message, setMessage] = useState('');

  const join = async () => {
    const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary(`join-${crypto.randomUUID()}`);
    if (!authMenuSessionId) return;
    setMessage('');
    try {
      const outcome = await seams.authMenu.open(
        buildHostedAuthMenuOpenRequest({ authMenuSessionId }),
        undefined,
        {
          steps: {
            title: 'Join the market',
            before: (controls) => <JoinStep controls={controls} />,
            after: (result, { close }) => <JoinedStep outcome={result} onDone={close} />,
          },
        },
      );
      if (outcome.kind === 'cancelled') setMessage('You left before you signed in.');
    } catch {
      setMessage('The Wallet modal could not open.');
    }
  };

  return (
    <section className="panel one-dialog-demo" id="modal-steps">
      <h2>App steps in the Wallet modal</h2>
      <p className="section-description">
        An app step, the Wallet&apos;s sign-in card and an app step, in the Wallet&apos;s own modal.
      </p>
      <button type="button" onClick={() => void join()}>
        Join the market
      </button>
      {message ? <p className="message">{message}</p> : null}
    </section>
  );
}

function JoinStep({ controls }: { controls: WalletModalBeforeControls }) {
  // Back in the card returns here with this state kept.
  const [name, setName] = useState('');
  return (
    <div className="one-dialog-step">
      <label>
        Display name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="one-dialog-actions">
        <button type="button" onClick={controls.cancel}>
          Cancel
        </button>
        <button type="button" onClick={controls.continueToWallet}>
          Continue
        </button>
      </div>
    </div>
  );
}

function JoinedStep({ outcome, onDone }: { outcome: HostedAuthMenuOutcome; onDone: () => void }) {
  return (
    <div className="one-dialog-step">
      <p>{'walletId' in outcome ? `Signed in as ${outcome.walletId}.` : 'You are signed in.'}</p>
      <div className="one-dialog-actions">
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
