import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  configuredThresholdEcdsaChainTargets,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { useSeams } from '../../context';
import { accountMenuCapabilitiesForLoginState } from '../../context/reactLoginStateBuilders';
import { WalletText } from '../../context/WalletLocale';

type Seams = ReturnType<typeof useSeams>['seams'];
type Targets = readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]];
type ActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adding' | 'unlocking' | 'added'; readonly walletId: string }
  | {
      readonly kind: 'failed' | 'unlock_required';
      readonly walletId: string;
      readonly message: string;
    };

type SetupContext = {
  readonly seams: Seams;
  readonly mounted: React.MutableRefObject<boolean>;
  readonly setState: React.Dispatch<React.SetStateAction<ActionState>>;
  readonly refreshSession: ReturnType<typeof useSeams>['refreshSession'];
};

function trackMount(mounted: React.MutableRefObject<boolean>): () => void {
  mounted.current = true;
  return clearMount.bind(null, mounted);
}
function clearMount(mounted: React.MutableRefObject<boolean>): void {
  mounted.current = false;
}
function setupError(error: unknown): string {
  return error instanceof Error ? error.message : 'The account could not be added. Try again.';
}
function assertCurrentWallet(context: SetupContext, walletId: string): void {
  const selected = context.seams.preferences.getCurrentWalletId();
  if (!context.mounted.current || (selected && selected !== walletId)) {
    throw new Error('Account added. Open this wallet again to finish setup.');
  }
}

async function finishSetup(context: SetupContext, walletId: string): Promise<void> {
  if (!context.mounted.current) return;
  context.setState({ kind: 'unlocking', walletId });
  try {
    assertCurrentWallet(context, walletId);
    const session = await context.seams.auth.getSession(walletId);
    assertCurrentWallet(context, walletId);
    if (
      session.authentication.kind !== 'authenticated' ||
      session.authentication.walletId !== walletId
    ) {
      const unlocked = await context.seams.auth.unlock(walletId);
      if (!unlocked.success) throw new Error(unlocked.error);
    }
    assertCurrentWallet(context, walletId);
    await context.refreshSession(walletId);
    assertCurrentWallet(context, walletId);
    context.setState({ kind: 'added', walletId });
  } catch (error) {
    if (context.mounted.current)
      context.setState({ kind: 'unlock_required', walletId, message: setupError(error) });
  }
}

async function addAccount(
  context: SetupContext,
  state: ActionState,
  walletId: string,
  targets: Targets,
): Promise<void> {
  if (state.kind === 'adding' || state.kind === 'unlocking') return;
  if (state.kind === 'added' && state.walletId === walletId) return;
  if (state.kind === 'unlock_required' && state.walletId === walletId)
    return finishSetup(context, walletId);
  context.setState({ kind: 'adding', walletId });
  try {
    const rpId =
      context.seams.configs.wallet.iframe.rpIdOverride ||
      new URL(context.seams.configs.wallet.iframe.origin).hostname;
    const result = await context.seams.registration.addSigner({
      walletId,
      rpId,
      signerSelection: {
        mode: 'ecdsa',
        ecdsa: { chainTargets: [...targets], participantIds: [1, 2] },
      },
    });
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    if (context.mounted.current)
      context.setState({ kind: 'failed', walletId, message: setupError(error) });
    return;
  }
  await finishSetup(context, walletId);
}

/** The menu owns setup across navigation between its screens. */
export function useEvmAccountSetup() {
  const { seams, refreshSession } = useSeams();
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const mounted = useRef(false);
  useEffect(trackMount.bind(null, mounted), [mounted]);
  return { state, add: addAccount.bind(null, { seams, refreshSession, mounted, setState }, state) };
}

export function AddEvmAccount({
  walletId,
  setup,
}: {
  readonly walletId: string;
  readonly setup: ReturnType<typeof useEvmAccountSetup>;
}): React.JSX.Element | null {
  const { seams, loginState } = useSeams();
  const targets = useMemo(accountTargets.bind(null, seams.configs.network.chains), [
    seams.configs.network.chains,
  ]);
  const state = setup.state;
  const busy = state.kind === 'adding' || state.kind === 'unlocking';
  const current = state.kind !== 'idle' && state.walletId === walletId;
  const needsUnlock = current && state.kind === 'unlock_required';
  if (
    !targets ||
    (!busy &&
      !needsUnlock &&
      (loginState.walletId !== walletId ||
        accountMenuCapabilitiesForLoginState(loginState).kind !== 'owner'))
  )
    return null;
  if (current && state.kind === 'added')
    return (
      <p className="seams-account-note" role="status">
        <WalletText message="EVM account added." />
      </p>
    );
  if (loginState.thresholdEcdsaEthereumAddress && !busy && !needsUnlock) return null;
  const hasPasskey = loginState.authMethods.some(isPasskey);
  let actionLabel = <WalletText message="Add EVM account" />;
  if (busy) actionLabel = <WalletText message="Adding EVM account…" />;
  else if (needsUnlock) actionLabel = <WalletText message="Unlock with passkey" />;
  return (
    <div>
      <button
        type="button"
        className="seams-account-action primary"
        disabled={busy || (!hasPasskey && !needsUnlock)}
        onClick={setup.add.bind(null, walletId, targets)}
      >
        {actionLabel}
      </button>
      <p className="seams-account-note" role={busy ? 'status' : undefined}>
        {hasPasskey || busy || needsUnlock ? (
          <WalletText message="Enable this app’s EVM networks with your passkey." />
        ) : (
          <WalletText message="Add a passkey in Authentication methods first." />
        )}
      </p>
      {current && (state.kind === 'failed' || state.kind === 'unlock_required') ? (
        <p className="seams-account-error" role="alert">
          <WalletText copy={state.message} />
        </p>
      ) : null}
    </div>
  );
}
function isPasskey(
  method: ReturnType<typeof useSeams>['loginState']['authMethods'][number],
): boolean {
  return method.kind === 'passkey';
}
function accountTargets(chains: Seams['configs']['network']['chains']): Targets | null {
  const [first, ...rest] = configuredThresholdEcdsaChainTargets(chains);
  return first ? [first, ...rest] : null;
}
