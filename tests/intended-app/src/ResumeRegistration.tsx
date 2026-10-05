import React from 'react';
import { useSeams } from '@seams/wallet/react';

type Registration = ReturnType<typeof useSeams>['seams']['registration'];
type ResumeState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | {
      kind: 'published';
      result: Awaited<ReturnType<Registration['resumePendingEcdsaRegistration']>>;
    }
  | { kind: 'failed'; message: string };

export function ResumeRegistration(): React.ReactNode {
  const { seams } = useSeams();
  const [state, setState] = React.useState<ResumeState>({ kind: 'idle' });
  return (
    <form onSubmit={resumeRegistration.bind(null, seams.registration, setState)}>
      <label>
        Pending wallet <input name="walletId" required />
      </label>
      <button type="submit" disabled={state.kind === 'pending'}>
        Resume with exact passkey
      </button>
      <output data-testid="registration-resume-result" data-state={state.kind}>
        {JSON.stringify(state)}
      </output>
    </form>
  );
}

async function resumeRegistration(
  registration: Registration,
  setState: React.Dispatch<React.SetStateAction<ResumeState>>,
  event: React.FormEvent<HTMLFormElement>,
): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  setState({ kind: 'pending' });
  try {
    const walletId = form.get('walletId');
    if (typeof walletId !== 'string') {
      throw new Error('Pending wallet is required');
    }
    const result = await registration.resumePendingEcdsaRegistration({
      walletId,
      exactMethod: { kind: 'passkey' },
    });
    setState({ kind: 'published', result });
  } catch (error) {
    setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}
