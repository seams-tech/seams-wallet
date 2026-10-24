import React from 'react';
import { useSeams } from '@seams/wallet/react';
import type { WalletSession } from '@seams/wallet';
import type { WalletId } from '@seams/wallet/advanced';
import { parseWebAuthnRpId, toWalletId } from '@seams/wallet/advanced';
import { ReviewedNearTransfer } from './ReviewedNearTransfer';

type Seams = ReturnType<typeof useSeams>['seams'];
type WalletTarget = { kind: 'new' } | { kind: 'selected'; walletId: WalletId };
type SessionRead =
  { kind: 'new' | 'loading' } | { kind: 'loaded'; walletId: WalletId; session: WalletSession };
type Operation =
  | { kind: 'idle' }
  | { kind: 'running'; message: string }
  | { kind: 'succeeded'; message: string }
  | { kind: 'failed'; message: string };
type Command =
  | { kind: 'register' }
  | { kind: 'owner_unlock' | 'backup' | 'activate' | 'lock' | 'refresh'; walletId: WalletId }
  | { kind: 'voice_unlock'; walletId: WalletId; walletAuthMethodId: string };
type AuthMethod = Extract<
  WalletSession['appIdentity'],
  { kind: 'resolved' }
>['authMethods'][number];

export function LiveVoiceId(): React.ReactNode {
  const { seams } = useSeams();
  const [target, setTarget] = React.useState<WalletTarget>(initialWalletTarget);
  const [read, setRead] = React.useState<SessionRead>({ kind: 'new' });
  const [operation, setOperation] = React.useState<Operation>({ kind: 'idle' });
  React.useEffect(startSessionRead.bind(null, seams, target, setRead, setOperation), [
    seams,
    target,
  ]);
  const session =
    read.kind === 'loaded' && target.kind === 'selected' && read.walletId === target.walletId
      ? read.session
      : null;
  const identity = session?.appIdentity.kind === 'resolved' ? session.appIdentity : null;
  const voice = identity?.authMethods.find(isVoiceMethod) ?? null;
  const authentication = session?.authentication ?? { kind: 'signed_out' };
  const ownerUnlocked =
    authentication.kind === 'authenticated' && authentication.authMethod !== 'voiceid';
  const voiceStatus = voiceStatusMessage(voice !== null, ownerUnlocked);
  const busy = operation.kind === 'running';
  const hasNearSigner = target.kind === 'selected' && identity?.nearAccountId != null;
  const perform = runCommand.bind(null, seams, setTarget, setRead, setOperation);
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
      <p>NEAR testnet · browser microphone</p>
      <h1>Unlock and sign with your voice</h1>
      <p>
        Enroll your voice in this browser after a passkey unlock. Recording starts only when you
        select Record inside the Wallet. No native host or system settings are required.
      </p>
      <p>
        When Listening appears, read the displayed sentence at your normal pace. Capture stops after
        a short pause, with an eight-second maximum. VoiceID checks your voice and the displayed
        phrase. The approval button confirms your intent.
      </p>
      <dl>
        <dt>Wallet</dt>
        <dd data-testid="live-voiceid-wallet">
          {target.kind === 'selected' ? target.walletId : 'Assigned during setup'}
        </dd>
        <dt>Authentication</dt>
        <dd data-testid="live-voiceid-auth">
          {authentication.kind === 'authenticated' ? authentication.authMethod : 'locked'}
        </dd>
        <dt>VoiceID</dt>
        <dd data-testid="live-voiceid-method">{voiceStatus}</dd>
        <dt>NEAR account</dt>
        <dd data-testid="live-voiceid-account" style={{ overflowWrap: 'anywhere' }}>
          {identity?.nearAccountId ?? 'Create the test wallet first'}
        </dd>
      </dl>
      <section aria-label="Wallet setup">
        <h2>1. Set up once</h2>
        <p>
          Create a test wallet with a passkey. Select Save recovery codes and complete the Wallet
          dialog. Then activate VoiceID.
        </p>
        <button disabled={busy || hasNearSigner} onClick={perform.bind(null, { kind: 'register' })}>
          Create test wallet
        </button>{' '}
        <button
          disabled={busy || !hasNearSigner}
          onClick={
            target.kind === 'selected'
              ? perform.bind(null, { kind: 'owner_unlock', walletId: target.walletId })
              : undefined
          }
        >
          Unlock with passkey
        </button>{' '}
        <button
          disabled={busy || !ownerUnlocked}
          onClick={
            target.kind === 'selected'
              ? perform.bind(null, { kind: 'backup', walletId: target.walletId })
              : undefined
          }
        >
          Save recovery codes
        </button>{' '}
        <button
          disabled={busy || !ownerUnlocked}
          onClick={
            target.kind === 'selected'
              ? perform.bind(null, { kind: 'activate', walletId: target.walletId })
              : undefined
          }
        >
          {voice ? 'Enroll voice again' : 'Activate VoiceID'}
        </button>
        <output
          role={operation.kind === 'failed' ? 'alert' : 'status'}
          aria-live={operation.kind === 'failed' ? 'assertive' : 'polite'}
          data-testid="live-voiceid-operation"
          data-state={operation.kind}
          style={{ display: 'block', marginTop: '1rem' }}
        >
          {operation.kind === 'idle' ? 'Ready. Start with wallet setup.' : operation.message}
        </output>
      </section>
      <section aria-label="Voice unlock">
        <h2>2. Lock, then unlock with your voice</h2>
        <button
          disabled={busy || !hasNearSigner || authentication.kind !== 'authenticated'}
          onClick={
            target.kind === 'selected'
              ? perform.bind(null, { kind: 'lock', walletId: target.walletId })
              : undefined
          }
        >
          Lock wallet
        </button>{' '}
        <button
          disabled={busy || voice === null}
          onClick={
            voice && target.kind === 'selected'
              ? perform.bind(null, {
                  kind: 'voice_unlock',
                  walletId: target.walletId,
                  walletAuthMethodId: voice.walletAuthMethodId,
                })
              : undefined
          }
        >
          Unlock with VoiceID
        </button>{' '}
        <button
          disabled={busy || target.kind === 'new'}
          onClick={
            target.kind === 'selected'
              ? perform.bind(null, { kind: 'refresh', walletId: target.walletId })
              : undefined
          }
        >
          Refresh status
        </button>
      </section>
      <section aria-label="NEAR transfer">
        <h2>3. Review and sign</h2>
        <p>
          This sends one yoctoNEAR to this wallet’s own testnet account. The account needs testnet
          funds for network fees.
        </p>
        <ReviewedNearTransfer walletId={target.kind === 'selected' ? target.walletId : null} />
      </section>
    </main>
  );
}

function voiceStatusMessage(activated: boolean, ownerUnlocked: boolean): string {
  if (activated) return 'Activated on this device';
  if (ownerUnlocked) return 'Select Activate VoiceID to finish setup';
  return 'Unlock with passkey, then activate VoiceID';
}

function isVoiceMethod(method: AuthMethod): method is Extract<AuthMethod, { kind: 'voiceid' }> {
  return method.kind === 'voiceid';
}

function startSessionRead(
  seams: Seams,
  target: WalletTarget,
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
): () => void {
  const controller = new AbortController();
  if (target.kind === 'new') {
    setRead({ kind: 'new' });
    return controller.abort.bind(controller);
  }
  setRead({ kind: 'loading' });
  void seams.auth
    .getSession(target.walletId)
    .then(storeSession.bind(null, setRead, target.walletId, controller.signal))
    .catch(showReadFailure.bind(null, setOperation, controller.signal));
  return controller.abort.bind(controller);
}

function storeSession(
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  walletId: WalletId,
  signal: AbortSignal,
  session: WalletSession,
): void {
  if (signal.aborted) return;
  setRead({ kind: 'loaded', walletId, session });
}

function showReadFailure(
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
  signal: AbortSignal,
  error: unknown,
): void {
  if (signal.aborted) return;
  setOperation({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
}

function initialWalletTarget(): WalletTarget {
  const walletId = new URL(window.location.href).searchParams.get('walletId');
  return walletId ? { kind: 'selected', walletId: toWalletId(walletId) } : { kind: 'new' };
}

function selectWallet(
  setTarget: React.Dispatch<React.SetStateAction<WalletTarget>>,
  walletId: WalletId,
): void {
  const url = new URL(window.location.href);
  url.searchParams.set('walletId', walletId);
  window.history.replaceState(null, '', url);
  setTarget(retainSelectedWallet.bind(null, walletId));
}

function retainSelectedWallet(walletId: WalletId, current: WalletTarget): WalletTarget {
  return current.kind === 'selected' && current.walletId === walletId
    ? current
    : { kind: 'selected', walletId };
}

async function runCommand(
  seams: Seams,
  setTarget: React.Dispatch<React.SetStateAction<WalletTarget>>,
  setRead: React.Dispatch<React.SetStateAction<SessionRead>>,
  setOperation: React.Dispatch<React.SetStateAction<Operation>>,
  command: Command,
): Promise<void> {
  setOperation({ kind: 'running', message: 'Complete the current step in the Wallet.' });
  try {
    const walletId = await executeCommand(seams, command);
    selectWallet(setTarget, walletId);
    setRead({ kind: 'loading' });
    const session = await seams.auth.getSession(walletId);
    setRead({ kind: 'loaded', walletId, session });
    setOperation({ kind: 'succeeded', message: successMessage(command) });
  } catch (error) {
    setOperation({
      kind: 'failed',
      message: `${commandLabel(command)}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function executeCommand(seams: Seams, command: Command): Promise<WalletId> {
  switch (command.kind) {
    case 'register': {
      const rpId = parseWebAuthnRpId(new URL(seams.configs.wallet.iframe.origin).hostname);
      if (!rpId.ok) throw new Error(rpId.error.message);
      const result = await seams.registration.registerWallet({
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
      });
      if (!result.success) throw new Error(result.error);
      return result.walletId;
    }
    case 'owner_unlock': {
      const result = await seams.auth.unlock(command.walletId, {
        unlockSelection: { mode: 'ed25519_only', ed25519: true },
      });
      if (!result.success) throw new Error(result.error);
      return command.walletId;
    }
    case 'backup': {
      const result = await seams.recovery.confirmBackup({
        walletId: command.walletId,
        authorization: { kind: 'passkey' },
      });
      if (result.kind !== 'acknowledged') throw new Error(result.message);
      return command.walletId;
    }
    case 'activate':
      await seams.registration.activateAuthMethod({
        walletId: command.walletId,
        method: 'voiceid',
      });
      return command.walletId;
    case 'voice_unlock': {
      const result = await seams.auth.unlockWithAuthMethod({
        walletId: command.walletId,
        walletAuthMethodId: command.walletAuthMethodId,
        method: 'voiceid',
      });
      if (!result.success) throw new Error(result.error);
      return command.walletId;
    }
    case 'lock':
      await seams.auth.lock();
      return command.walletId;
    case 'refresh':
      return command.walletId;
  }
  command satisfies never;
  throw new Error('Unknown live VoiceID command');
}

function commandLabel(command: Command): string {
  switch (command.kind) {
    case 'register':
      return 'Wallet setup failed';
    case 'owner_unlock':
      return 'Passkey unlock failed';
    case 'backup':
      return 'Recovery-code backup failed';
    case 'activate':
      return 'VoiceID activation failed';
    case 'voice_unlock':
      return 'VoiceID unlock failed';
    case 'lock':
      return 'Wallet lock failed';
    case 'refresh':
      return 'Wallet status failed';
  }
  command satisfies never;
  throw new Error('Unknown live VoiceID command');
}

function successMessage(command: Command): string {
  switch (command.kind) {
    case 'register':
      return 'Test wallet created. Save recovery codes, then activate VoiceID.';
    case 'owner_unlock':
      return 'Owner unlocked. Activate VoiceID next.';
    case 'backup':
      return 'Recovery codes saved. Activate VoiceID next.';
    case 'activate':
      return 'VoiceID activated. Lock the wallet, then unlock with VoiceID.';
    case 'voice_unlock':
      return 'VoiceID unlocked the wallet. You can review a NEAR transfer.';
    case 'lock':
      return 'Wallet locked.';
    case 'refresh':
      return 'Wallet status updated.';
  }
  command satisfies never;
  throw new Error('Unknown live VoiceID command');
}
