import React from 'react';
import { useSeams } from '../../context';
import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import './TransactionSettingsSection.css';

type Seams = ReturnType<typeof useSeams>['seams'];
type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; availability: AuthMethodAvailability; message?: string }
  | { kind: 'updating'; availability: AuthMethodAvailability }
  | { kind: 'error'; message: string };

export function VoiceIdAvailabilityControl({
  walletId,
  disabled,
  onChanged,
  setup = false,
}: {
  walletId: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
  setup?: boolean;
}): React.JSX.Element {
  const { seams, refreshSession, loginState } = useSeams();
  const [state, setState] = React.useState<ViewState>({ kind: 'loading' });
  React.useEffect(loadAvailability.bind(null, seams, walletId, setState), [seams, walletId]);
  const ownerSelected =
    loginState.isLoggedIn &&
    loginState.currentAuthMethod.kind === 'selected' &&
    loginState.currentAuthMethod.binding.kind !== 'voiceid';
  const ready = state.kind === 'ready';
  const enabled = (ready || state.kind === 'updating') && state.availability.kind === 'enabled';
  return (
    <div className="seams-voiceid-availability" data-setup={setup}>
      {setup ? <strong>VoiceID · Experimental</strong> : null}
      <button
        type="button"
        role="switch"
        className="seams-transaction-switch"
        aria-label="Enable VoiceID in this browser"
        aria-checked={enabled}
        disabled={disabled || !ready}
        onClick={
          ready
            ? changeAvailability.bind(
                null,
                seams,
                walletId,
                state.availability,
                setState,
                refreshSession,
                onChanged,
                'toggle',
              )
            : undefined
        }
      >
        <span aria-hidden="true" />
      </button>
      <span role="status">
        {state.kind === 'loading'
          ? 'Checking VoiceID…'
          : state.kind === 'updating'
            ? 'Updating VoiceID…'
            : state.kind === 'error'
              ? state.message
              : state.kind === 'ready' && state.message
                ? state.message
                : enabled
                  ? 'On in this browser'
                  : 'Off in this browser'}
      </span>
      {ready && state.availability.kind !== 'not_enrolled' && ownerSelected ? (
        <button
          type="button"
          className="seams-voiceid-reenroll"
          disabled={disabled}
          onClick={changeAvailability.bind(
            null,
            seams,
            walletId,
            state.availability,
            setState,
            refreshSession,
            onChanged,
            'reenroll',
          )}
        >
          Record voice again
        </button>
      ) : null}
      {setup ? (
        <p className="seams-linked-devices-modal-security-note">
          First-time setup downloads voice tools and records three samples. Your current login
          method stays selected.
        </p>
      ) : null}
    </div>
  );
}

function loadAvailability(
  seams: Seams,
  walletId: string,
  setState: React.Dispatch<React.SetStateAction<ViewState>>,
): () => void {
  const controller = new AbortController();
  setState({ kind: 'loading' });
  void readAvailability(seams, walletId, setState, controller.signal);
  return controller.abort.bind(controller);
}
async function readAvailability(
  seams: Seams,
  walletId: string,
  setState: React.Dispatch<React.SetStateAction<ViewState>>,
  signal: AbortSignal,
): Promise<void> {
  try {
    const availability = await seams.registration.getAuthMethodAvailability({
      walletId,
      method: 'voiceid',
    });
    if (!signal.aborted) setState({ kind: 'ready', availability });
  } catch (error) {
    if (!signal.aborted)
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not read VoiceID availability.',
      });
  }
}
async function changeAvailability(
  seams: Seams,
  walletId: string,
  previous: AuthMethodAvailability,
  setState: React.Dispatch<React.SetStateAction<ViewState>>,
  refreshSession: ReturnType<typeof useSeams>['refreshSession'],
  onChanged: () => Promise<void>,
  action: 'toggle' | 'reenroll',
): Promise<void> {
  setState({ kind: 'updating', availability: previous });
  try {
    if (previous.kind === 'not_enrolled' || action === 'reenroll')
      await seams.registration.activateAuthMethod({ walletId, method: 'voiceid' });
    const availability =
      action === 'reenroll'
        ? await seams.registration.getAuthMethodAvailability({ walletId, method: 'voiceid' })
        : await seams.registration.setAuthMethodEnabled({
            walletId,
            method: 'voiceid',
            enabled: previous.kind !== 'enabled',
          });
    await refreshSession(walletId);
    setState({ kind: 'ready', availability });
    await onChanged();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'VoiceID could not be updated. Try again.';
    try {
      const availability = await seams.registration.getAuthMethodAvailability({
        walletId,
        method: 'voiceid',
      });
      setState({ kind: 'ready', availability, message });
    } catch {
      setState({
        kind: 'error',
        message: 'Could not confirm VoiceID availability. Close and reopen settings.',
      });
    }
  }
}
