import React from 'react';
import { useSeams } from '@seams/wallet/react';
import type { GoogleEmailOtpWalletAuthLoginFlow } from '@seams/wallet';

type Auth = ReturnType<typeof useSeams>['seams']['auth'];
type State =
  | { kind: 'idle' }
  | { kind: 'challenge'; flow: GoogleEmailOtpWalletAuthLoginFlow }
  | { kind: 'unlocked'; walletId: string };
type SetState = React.Dispatch<React.SetStateAction<State>>;
type SetMessage = React.Dispatch<React.SetStateAction<string>>;

export function EmailCodeUnlock(): React.ReactNode {
  const { seams } = useSeams();
  const [state, setState] = React.useState<State>({ kind: 'idle' });
  const [message, setMessage] = React.useState('');
  return (
    <section aria-label="Email code unlock">
      <form onSubmit={requestCode.bind(null, seams.auth, setState, setMessage)}>
        <label>
          Email wallet to unlock <input name="walletId" required />
        </label>
        <label>
          Email address for local method <input name="email" type="email" />
        </label>
        <button type="submit">Request email code</button>
      </form>
      {state.kind === 'challenge' && (
        <form onSubmit={submitCode.bind(null, seams.auth, state.flow, setState, setMessage)}>
          <label>
            Email unlock code <input name="code" required />
          </label>
          <button type="submit">Unlock with email code</button>
          <button type="button" onClick={resendCode.bind(null, state.flow, setState, setMessage)}>
            Resend email code
          </button>
          <button type="button" onClick={cancelCode.bind(null, state.flow, setMessage)}>
            Cancel email code
          </button>
        </form>
      )}
      <output data-testid="email-code-result" data-state={state.kind}>
        {message}
      </output>
    </section>
  );
}

async function requestCode(
  auth: Auth,
  setState: SetState,
  setMessage: SetMessage,
  event: React.FormEvent<HTMLFormElement>,
): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const walletId = form.get('walletId');
  const email = form.get('email');
  try {
    if (typeof walletId !== 'string') throw new Error('Wallet is required');
    const idToken = new URL(location.href).searchParams.get('googleIdToken');
    if (!idToken) throw new Error('Google token is required');
    const result =
      typeof email === 'string' && email
        ? await auth.requestEmailCode({ method: 'email', walletId, email })
        : await auth.requestEmailCode({
            method: 'google',
            idToken,
            target: { kind: 'wallet', walletId },
          });
    if (!result.ok) throw new Error(result.error.message);
    setState({ kind: 'challenge', flow: result.value });
    setMessage('Code requested');
  } catch (error) {
    setMessage(errorMessage(error));
  }
}

async function submitCode(
  auth: Auth,
  challenge: GoogleEmailOtpWalletAuthLoginFlow,
  setState: SetState,
  setMessage: SetMessage,
  event: React.FormEvent<HTMLFormElement>,
): Promise<void> {
  event.preventDefault();
  const code = new FormData(event.currentTarget).get('code');
  try {
    if (typeof code !== 'string') throw new Error('Code is required');
    const result = await auth.unlockWithEmailCode({ challenge, code });
    if (!result.ok) throw new Error(result.error.message);
    setState({ kind: 'unlocked', walletId: result.value.walletId });
    setMessage('Wallet unlocked');
  } catch (error) {
    setMessage(errorMessage(error));
  }
}

async function resendCode(
  challenge: GoogleEmailOtpWalletAuthLoginFlow,
  setState: SetState,
  setMessage: SetMessage,
): Promise<void> {
  try {
    const result = await challenge.resend();
    if (!result.ok) throw new Error(result.error.message);
    if (result.value.mode !== 'login') throw new Error('Expected an unlock challenge');
    setState({ kind: 'challenge', flow: result.value });
    setMessage('Code resent');
  } catch (error) {
    setMessage(errorMessage(error));
  }
}

async function cancelCode(
  challenge: GoogleEmailOtpWalletAuthLoginFlow,
  setMessage: SetMessage,
): Promise<void> {
  try {
    await challenge.cancel();
    setMessage('Code cancelled');
  } catch (error) {
    setMessage(errorMessage(error));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
