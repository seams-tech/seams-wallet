import { useRef, useState } from 'react';
import { WalletStep, transfer, useSeams, type WalletStepOutcome } from '@seams/wallet/react';

type Step = 'bet' | 'sign_in' | 'confirm' | 'placed';

const SIGNED_IN = new Set(['authenticated', 'registered', 'account_synced']);

/**
 * One dialog for a whole flow: an app step, then the Wallet's sign-in and confirm cards as steps
 * of the same dialog, then the app's result step. The Wallet cards stay in the Wallet iframe;
 * WalletStep places them over the dialog's body.
 */
export function OneDialogFlowExample() {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel one-dialog-demo" id="one-dialog-flow">
      <h2>One dialog for a flow</h2>
      <p className="section-description">
        App step, sign-in, Wallet confirm and app step in one dialog. It sends a zero-value transfer
        to your own account.
      </p>
      <button type="button" onClick={() => setOpen(true)}>
        Place a bet
      </button>
      {open ? <FlowDialog onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function FlowDialog({ onClose }: { onClose: () => void }) {
  const { loginState, wallet } = useSeams();
  const [step, setStep] = useState<Step>('bet');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [heldHeight, setHeldHeight] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const near = wallet?.access === 'wallet' ? wallet.near : null;

  // The next step keeps this height until its Wallet card has a size: one resize per change.
  const go = (next: Step) => {
    setHeldHeight(body.current?.offsetHeight ?? 0);
    setStep(next);
  };

  const onSignIn = (outcome: WalletStepOutcome<unknown>) => {
    if (outcome.kind === 'auth_menu' && SIGNED_IN.has(outcome.outcome.kind)) go('confirm');
  };

  const onConfirm = (outcome: WalletStepOutcome<{ success: boolean; error?: string }>) => {
    if (outcome.kind === 'result' && outcome.result.success) {
      setMessage(note ? `Your bet "${note}" is in.` : 'Your bet is in.');
      go('placed');
      return;
    }
    // Back already returned to the bet; any other end shows why.
    if (outcome.kind === 'result')
      setMessage(outcome.result.error ?? 'The Wallet did not send it.');
    if (outcome.kind === 'error') setMessage('The Wallet card could not open.');
  };

  return (
    <div className="one-dialog-overlay">
      <div className="one-dialog" role="dialog" aria-modal="true" aria-label="Place a bet">
        <div ref={body} className="one-dialog-body">
          {step === 'bet' ? (
            <div className="one-dialog-step">
              <h3>Place a bet</h3>
              <label>
                Your note
                <input value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              {message ? <p className="message">{message}</p> : null}
              <div className="one-dialog-actions">
                <button type="button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessage('');
                    go(loginState.isLoggedIn ? 'confirm' : 'sign_in');
                  }}
                >
                  Bet
                </button>
              </div>
            </div>
          ) : null}
          {step === 'sign_in' ? (
            <WalletStep
              surface={{ kind: 'auth_menu' }}
              chrome="back"
              initialHeight={heldHeight}
              onBack={() => go('bet')}
              onOutcome={onSignIn}
            />
          ) : null}
          {step === 'confirm' && near ? (
            <WalletStep
              surface={{
                kind: 'transaction_confirm',
                send: (presentation) =>
                  near.signAndSendTransaction({
                    receiverId: near.accountId,
                    actions: [transfer('0 NEAR')],
                    presentation,
                  }),
              }}
              chrome="back"
              initialHeight={heldHeight}
              onBack={() => go('bet')}
              onOutcome={onConfirm}
            />
          ) : null}
          {step === 'confirm' && !near ? (
            <div className="one-dialog-step">
              <p className="message">Preparing your NEAR account…</p>
            </div>
          ) : null}
          {step === 'placed' ? (
            <div className="one-dialog-step">
              <h3>Done</h3>
              <p>{message}</p>
              <div className="one-dialog-actions">
                <button type="button" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
