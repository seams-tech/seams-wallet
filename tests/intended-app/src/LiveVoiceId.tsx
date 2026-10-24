import React from 'react';
import { useSeams } from '@seams/wallet/react';
import type { WalletSession } from '@seams/wallet';
import { parseWebAuthnRpId, toWalletId } from '@seams/wallet/advanced';
import { ReviewedNearTransfer } from './ReviewedNearTransfer';

type Seams = ReturnType<typeof useSeams>['seams'];
type SessionRead = { kind: 'loading' } | { kind: 'loaded'; session: WalletSession };
type Operation =
  | { kind: 'idle' }
  | { kind: 'running'; message: string }
  | { kind: 'succeeded'; message: string }
  | { kind: 'failed'; message: string };
type Command =
  | { kind: 'register' | 'owner_unlock' | 'activate' | 'lock' | 'refresh' }
  | { kind: 'voice_unlock'; walletAuthMethodId: string };
type AuthMethod = Extract<
  WalletSession['appIdentity'],
  { kind: 'resolved' }
>['authMethods'][number];

export function LiveVoiceId(): React.ReactNode {
  const { seams } = useSeams();
  const walletId = new URL(window.location.href).searchParams.get('walletId');
  if (!walletId) throw new Error('The live VoiceID page requires a walletId.');
  const [read, setRead] = React.useState<SessionRead>({ kind: 'loading' });
  const [operation, setOperation] = React.useState<Operation>({ kind: 'idle' });
  React.useEffect(startSessionRead.bind(null, seams, walletId, setRead, setOperation), [
    seams,
    walletId,
  ]);
  const session = read.kind === 'loaded' ? read.session : null;
  const identity = session?.appIdentity.kind === 'resolved' ? session.appIdentity : null;
  const voice = identity?.authMethods.find(isVoiceMethod) ?? null;
  const authentication = session?.authentication ?? { kind: 'signed_out' };
  const ownerUnlocked =
    authentication.kind === 'authenticated' && authentication.authMethod !== 'voiceid';
  const busy = operation.kind === 'running';
  const perform = runCommand.bind(null, seams, walletId, setRead, setOperation);
  return (
    <main
      style={{
        maxWidth: '48rem',
        margin: '3rem auto',
        padding: '0 1.5rem',
        fontFamily: 'system-ui',
        lineHeight: 1.6,
      }}
    >
      <title>VoiceID live wallet</title>
      <p>NEAR testnet · live microphone</p>
      <h1>Unlock and sign with your voice</h1>
      <p>
        Use your existing voice enrollment on this Mac. Recording starts only after you select the
        button inside the Wallet.
      </p>
      <p>
        When the Wallet says it is listening, say <strong>“I approve this operation.”</strong>
      </p>
      <dl>
        <dt>Wallet</dt>
        <dd data-testid="live-voiceid-wallet">{walletId}</dd>
        <dt>Authentication</dt>
        <dd data-testid="live-voiceid-auth">
          {authentication.kind === 'authenticated' ? authentication.authMethod : 'locked'}
        </dd>
        <dt>VoiceID</dt>
        <dd>{voice ? 'Activated on this device' : 'Needs activation after owner unlock'}</dd>
        <dt>NEAR account</dt>
        <dd data-testid="live-voiceid-account" style={{ overflowWrap: 'anywhere' }}>
          {identity?.nearAccountId ?? 'Create the test wallet first'}
        </dd>
      </dl>
      <section aria-label="Wallet setup">
        <h2>1. Set up once</h2>
        <p>
          Create a test wallet with a passkey. Save its recovery codes in the Wallet dialog. Then
          activate VoiceID.
        </p>
        <button
          disabled={busy || identity?.nearAccountId != null}
          onClick={perform.bind(null, { kind: 'register' })}
        >
          Create test wallet
        </button>{' '}
        <button disabled={busy} onClick={perform.bind(null, { kind: 'owner_unlock' })}>
          Unlock with passkey
        </button>{' '}
        <button
          disabled={busy || !ownerUnlocked || voice !== null}
          onClick={perform.bind(null, { kind: 'activate' })}
        >
          Activate VoiceID
        </button>
      </section>
      <section aria-label="Voice unlock">
        <h2>2. Lock, then unlock with your voice</h2>
        <button disabled={busy} onClick={perform.bind(null, { kind: 'lock' })}>
          Lock wallet
        </button>{' '}
        <button
          disabled={busy || voice === null}
          onClick={
            voice
              ? perform.bind(null, {
                  kind: 'voice_unlock',
                  walletAuthMethodId: voice.walletAuthMethodId,
                })
              : undefined
          }
        >
          Unlock with VoiceID
        </button>{' '}
        <button disabled={busy} onClick={perform.bind(null, { kind: 'refresh' })}>
          Refresh status
        </button>
      </section>
      <section aria-label="NEAR transfer">
        <h2>3. Review and sign</h2>
        <p>
          This sends one yoctoNEAR to this wallet’s own testnet account. The account needs testnet
          funds for network fees.
        </p>
        <ReviewedNearTransfer />
      </section>
      <output
        role="status"
        aria-live="polite"
        data-testid="live-voiceid-operation"
        data-state={operation.kind}
      >
        {operation.kind === 'idle' ? 'Ready. Start with wallet setup.' : operation.message}
      </output>
    </main>
  );
}

function isVoiceMethod(method: AuthMethod): method is Extract<AuthMethod, { kind: 'voiceid' }> {
  return method.kind === 'voiceid';
}

function startSessionRead(
  seams: Seams,
  walletId: string,
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
): void {
  void seams.auth
    .getSession(walletId)
    .then(storeSession.bind(null, setRead))
    .catch(showFailure.bind(null, setOperation));
}

function storeSession(
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  session: WalletSession,
): void {
  setRead({ kind: 'loaded', session });
}

function showFailure(
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
  error: unknown,
): void {
  setOperation({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
}

async function runCommand(
  seams: Seams,
  walletId: string,
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
  command: Command,
): Promise<void> {
  setOperation({ kind: 'running', message: 'Complete the current step in the Wallet.' });
  try {
    switch (command.kind) {
      case 'register': {
        const rpId = parseWebAuthnRpId(new URL(seams.configs.wallet.iframe.origin).hostname);
        if (!rpId.ok) throw new Error(rpId.error.message);
        const result = await seams.registration.registerWallet({
          wallet: { kind: 'provided', walletId: toWalletId(walletId) },
          authMethod: { kind: 'passkey', rpId: rpId.value },
          signerSelection: {
            kind: 'signer_set',
            signers: [
              {
                kind: 'near_ed25519',
                accountProvisioning: {
                  kind: 'implicit_account',
                  accountIdSource: 'ed25519_public_key',
                },
                signerSlot: 1,
                participantIds: [1, 2],
                derivationVersion: 1,
              },
            ],
          },
          options: { recoveryCodeBackup: { kind: 'show_builtin_dialog' } },
        });
        if (!result.success) throw new Error(result.error);
        break;
      }
      case 'owner_unlock': {
        const result = await seams.auth.unlock(walletId, {
          unlockSelection: { mode: 'ed25519_only', ed25519: true },
        });
        if (!result.success) throw new Error(result.error);
        break;
      }
      case 'activate':
        await seams.registration.activateAuthMethod({ walletId, method: 'voiceid' });
        break;
      case 'voice_unlock': {
        const result = await seams.auth.unlockWithAuthMethod({
          walletId,
          walletAuthMethodId: command.walletAuthMethodId,
          method: 'voiceid',
        });
        if (!result.success) throw new Error(result.error);
        break;
      }
      case 'lock':
        await seams.auth.lock();
        break;
      case 'refresh':
        break;
      default:
        command satisfies never;
    }
    const session = await seams.auth.getSession(walletId);
    setRead({ kind: 'loaded', session });
    setOperation({ kind: 'succeeded', message: successMessage(command) });
  } catch (error) {
    showFailure(setOperation, error);
  }
}

function successMessage(command: Command): string {
  switch (command.kind) {
    case 'register':
      return 'Test wallet created. Activate VoiceID next.';
    case 'owner_unlock':
      return 'Owner unlocked. Activate VoiceID next.';
    case 'activate':
      return 'VoiceID activated. Lock the wallet, then unlock with VoiceID.';
    case 'voice_unlock':
      return 'VoiceID unlocked the wallet. You can review a NEAR transfer.';
    case 'lock':
      return 'Wallet locked. Select Unlock with VoiceID.';
    case 'refresh':
      return 'Wallet status updated.';
  }
  command satisfies never;
  throw new Error('Unknown live VoiceID command');
}
