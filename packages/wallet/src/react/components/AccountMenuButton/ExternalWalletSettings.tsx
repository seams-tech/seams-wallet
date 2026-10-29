import { useRef, useState } from 'react';
import type { ExternalWalletSettings } from '@shared/auth/externalAuth';
import { useSeams } from '../../context';
import { AccountMenuDialogFrame } from './AccountMenuDialog';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuSessionIdFromBoundary,
} from '@/SeamsWeb/walletIframe/shared/messages';
import type { WalletId } from '@shared/utils/domainIds';

type Props = {
  settings: ExternalWalletSettings;
  view: 'methods' | 'devices';
  presentation: 'page' | 'embedded';
  onClose: () => void;
};

export function ExternalWalletSettingsView(props: Props) {
  const { seams, refreshSession } = useSeams();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const title = props.view === 'methods' ? 'Authentication methods' : 'Linked devices';
  const details =
    props.view === 'methods'
      ? props.settings.methods.map(methodDetail)
      : props.settings.devices.map(deviceDetail);
  return (
    <AccountMenuDialogFrame
      presentation={props.presentation}
      onClose={props.onClose}
      dialogRef={ref}
      contentClassName=""
      titleId={`external-wallet-${props.view}`}
      title={title}
    >
      <AccountMenuDeviceDetails
        title="Wallet access"
        description="Connected to your wallet"
        details={details}
      />
      <p>Confirm with a wallet authentication method to make security changes.</p>
      <button
        type="button"
        className="seams-settings-action"
        onClick={unlockOwner.bind(
          null,
          seams,
          refreshSession,
          props.settings.authentication.walletId,
          setError,
        )}
      >
        Authenticate to make changes
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </AccountMenuDialogFrame>
  );
}

function methodDetail(method: ExternalWalletSettings['methods'][number], index: number) {
  const names = { passkey: 'Passkey', email_otp: 'Email code', voiceid: 'VoiceID' };
  return { label: `Method ${index + 1}`, value: names[method.kind] };
}

function deviceDetail(_device: ExternalWalletSettings['devices'][number], index: number) {
  return { label: `Device ${index + 1}`, value: 'Active' };
}

async function unlockOwner(
  seams: ReturnType<typeof useSeams>['seams'],
  refresh: ReturnType<typeof useSeams>['refreshSession'],
  walletId: WalletId,
  report: (message: string) => void,
): Promise<void> {
  report('');
  try {
    await seams.auth.lock();
    const authMenuSessionId = hostedAuthMenuSessionIdFromBoundary(crypto.randomUUID());
    if (!authMenuSessionId) throw new Error('Authentication request identity is invalid.');
    const outcome = await seams.authMenu.open(
      buildHostedAuthMenuOpenRequest({
        authMenuSessionId,
        initialMode: 'login',
        loginTarget: { kind: 'wallet_sync', walletId },
        registrationAccountInput: 'implicit_wallet',
        showRegistrationInput: false,
        showProgress: true,
        enabledExternalProviders: [],
      }),
    );
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') throw new Error(outcome.message);
    if (outcome.walletId !== walletId)
      throw new Error('Wallet authentication selected another wallet.');
    if (outcome.kind === 'account_synced') {
      const result = await seams.auth.unlock(walletId);
      if (!result.success) throw new Error(result.error || 'Wallet authentication failed.');
    }
    await refresh(walletId);
  } catch (error) {
    report(error instanceof Error ? error.message : 'Wallet authentication failed.');
  }
}
