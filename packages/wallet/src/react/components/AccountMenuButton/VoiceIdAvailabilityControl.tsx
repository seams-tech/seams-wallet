import React from 'react';
import { useSeams } from '../../context';
import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import { AuthenticationMethodRow } from './AuthenticationMethodRow';
import { ChevronRightIcon } from './icons/ChevronRightIcon';
import './TransactionSettingsSection.css';

type Seams = ReturnType<typeof useSeams>['seams'];
type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; availability: AuthMethodAvailability; message?: string }
  | { kind: 'updating'; availability: AuthMethodAvailability }
  | { kind: 'error'; message: string };
type VoiceIdAvailability = Readonly<{
  state: ViewState;
  ready: boolean;
  enabled: boolean;
  passkeySelected: boolean;
  toggle: (() => Promise<void>) | undefined;
  manage: (() => Promise<void>) | undefined;
}>;

/** The VoiceID row in Authentication methods: the switch, its state, and the voice actions. */
export function VoiceIdMethodRow({
  walletId,
  disabled,
  onChanged,
  title,
  chip,
  remove,
  confirmation,
  children,
}: {
  walletId: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
  title: string;
  chip?: string;
  remove: React.ReactNode;
  confirmation: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  const voice = useVoiceIdAvailability(walletId, onChanged);
  const status = voiceIdStatus(voice);
  const enrolled =
    (voice.state.kind === 'ready' || voice.state.kind === 'updating') &&
    voice.state.availability.kind !== 'not_enrolled';
  const actions =
    enrolled || remove ? (
      <>
        {enrolled ? (
          <button
            type="button"
            className="seams-auth-method-text-action"
            disabled={disabled || !voice.ready || !voice.passkeySelected || !voice.enabled}
            onClick={voice.manage}
          >
            Manage voice
            <ChevronRightIcon size={16} strokeWidth={1.75} />
          </button>
        ) : (
          <span />
        )}
        {remove}
      </>
    ) : null;
  return (
    <AuthenticationMethodRow
      kind="voiceid"
      title={title}
      chip={chip}
      description={
        <span role="status" data-tone={status.tone}>
          {status.text}
        </span>
      }
      action={<VoiceIdSwitch voice={voice} disabled={disabled} />}
      footer={confirmation ?? actions}
    >
      {children}
    </AuthenticationMethodRow>
  );
}

/** The VoiceID card under "Add a method", before this wallet has a VoiceID method. */
export function VoiceIdSetupRow({
  walletId,
  disabled,
  onChanged,
}: {
  walletId: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const voice = useVoiceIdAvailability(walletId, onChanged);
  const status = voiceIdStatus(voice);
  return (
    <AuthenticationMethodRow
      kind="voiceid"
      title="VoiceID"
      chip="Experimental"
      description={
        <span role="status" data-tone={status.tone}>
          {status.text}
        </span>
      }
      action={<VoiceIdSwitch voice={voice} disabled={disabled} />}
    >
      <span className="seams-linked-devices-modal-item-detail">
        First-time setup downloads voice tools and records three samples. Your current login method
        stays selected.
      </span>
    </AuthenticationMethodRow>
  );
}

function VoiceIdSwitch({
  voice,
  disabled,
}: {
  voice: VoiceIdAvailability;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="seams-transaction-switch"
      aria-label="Enable VoiceID in this browser"
      aria-checked={voice.enabled}
      disabled={disabled || !voice.ready}
      onClick={voice.toggle}
    >
      <span aria-hidden="true" />
    </button>
  );
}

function useVoiceIdAvailability(
  walletId: string,
  onChanged: () => Promise<void>,
): VoiceIdAvailability {
  const { seams, refreshSession, loginState } = useSeams();
  const [state, setState] = React.useState<ViewState>({ kind: 'loading' });
  React.useEffect(loadAvailability.bind(null, seams, walletId, setState), [seams, walletId]);
  const passkeySelected =
    loginState.isLoggedIn &&
    loginState.currentAuthMethod.kind === 'selected' &&
    loginState.currentAuthMethod.binding.kind === 'passkey';
  const ready = state.kind === 'ready';
  const change = ready
    ? changeAvailability.bind(
        null,
        seams,
        walletId,
        state.availability,
        setState,
        refreshSession,
        onChanged,
      )
    : undefined;
  return {
    state,
    ready,
    enabled: (ready || state.kind === 'updating') && state.availability.kind === 'enabled',
    passkeySelected,
    toggle: change?.bind(null, 'toggle'),
    manage: change?.bind(null, 'manage'),
  };
}

function voiceIdStatus(voice: VoiceIdAvailability): { text: string; tone?: 'error' } {
  switch (voice.state.kind) {
    case 'loading':
      return { text: 'Checking VoiceID…' };
    case 'updating':
      return { text: 'Updating VoiceID…' };
    case 'error':
      return { text: voice.state.message, tone: 'error' };
    case 'ready':
      if (voice.state.message) return { text: voice.state.message, tone: 'error' };
      switch (voice.state.availability.kind) {
        case 'enabled':
          return {
            text: voice.passkeySelected
              ? 'On in this browser'
              : 'On in this browser. Unlock with a passkey to manage your voice.',
          };
        case 'disabled':
          return { text: 'Off in this browser. Turn it on to manage your voice.' };
        case 'not_enrolled':
          return { text: 'Not set up in this browser. Turn it on to record your voice.' };
      }
  }
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
  action: 'toggle' | 'manage',
): Promise<void> {
  setState({ kind: 'updating', availability: previous });
  try {
    if (previous.kind === 'not_enrolled' || action === 'manage') {
      const activation = await seams.registration.activateAuthMethod({
        walletId,
        method: 'voiceid',
      });
      if (activation.kind === 'cancelled') {
        setState({ kind: 'ready', availability: previous });
        return;
      }
    }
    const availability =
      action === 'manage'
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
