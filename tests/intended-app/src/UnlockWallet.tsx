import React from 'react';
import { useSeams } from '@seams/wallet/react';

type Auth = ReturnType<typeof useSeams>['seams']['auth'];
type UnlockResult = Awaited<ReturnType<Auth['unlock']>>;
type UnlockState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'unlocked'; result: UnlockResult; events: readonly string[]; completions: number }
  | { kind: 'failed'; message: string; errors: number; completions: number };

class UnlockCallbacks {
  readonly events: string[] = [];
  errors = 0;
  completions = 0;

  onEvent(event: Parameters<NonNullable<NonNullable<Parameters<Auth['unlock']>[1]>['onEvent']>>[0]): void {
    this.events.push(event.phase);
  }

  onError(): void {
    this.errors += 1;
  }

  afterCall(): void {
    this.completions += 1;
  }
}

export function UnlockWallet(): React.ReactNode {
  const { seams } = useSeams();
  const [state, setState] = React.useState<UnlockState>({ kind: 'idle' });
  return (
    <form onSubmit={unlockWallet.bind(null, seams.auth, setState)}>
      <label>
        Wallet to unlock <input name="walletId" required />
      </label>
      <label>
        Require NEAR <input name="requireNear" type="checkbox" />
      </label>
      <button type="submit" disabled={state.kind === 'pending'}>
        Unlock wallet
      </button>
      <output data-testid="wallet-unlock-result" data-state={state.kind}>
        {JSON.stringify(state)}
      </output>
    </form>
  );
}

async function unlockWallet(
  auth: Auth,
  setState: React.Dispatch<React.SetStateAction<UnlockState>>,
  event: React.FormEvent<HTMLFormElement>,
): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const callbacks = new UnlockCallbacks();
  setState({ kind: 'pending' });
  try {
    const walletId = form.get('walletId');
    if (typeof walletId !== 'string') throw new Error('Wallet is required');
    const result = await auth.unlock(walletId, {
      unlockSelection:
        form.get('requireNear') === 'on' ? { mode: 'ed25519_only', ed25519: true } : undefined,
      onEvent: callbacks.onEvent.bind(callbacks),
      onError: callbacks.onError.bind(callbacks),
      afterCall: callbacks.afterCall.bind(callbacks),
    });
    if (!result.success) throw new Error(result.error);
    setState({
      kind: 'unlocked',
      result,
      events: callbacks.events,
      completions: callbacks.completions,
    });
  } catch (error) {
    setState({
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
      errors: callbacks.errors,
      completions: callbacks.completions,
    });
  }
}
