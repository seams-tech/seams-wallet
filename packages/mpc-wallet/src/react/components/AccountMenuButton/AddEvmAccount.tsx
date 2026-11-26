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
  | { readonly kind: 'adding'; readonly walletId: string }
  | {
      readonly kind: 'added';
      readonly walletId: string;
      readonly evmAddress: string;
      readonly nearAccountId: string | null;
    }
  | {
      readonly kind: 'failed';
      readonly walletId: string;
      readonly message: string;
    };

type SetupContext = {
  readonly seams: Seams;
  readonly nearAccountId: string | null;
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

async function addAccount(
  context: SetupContext,
  state: ActionState,
  walletId: string,
  targets: Targets,
): Promise<void> {
  if (state.kind === 'adding') return;
  if (state.kind === 'added' && state.walletId === walletId) return;
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
    if (
      result.kind !== 'wallet_signer_added' ||
      result.capabilities[0].kind !== 'evm_family_ecdsa'
    ) {
      throw new Error('The wallet did not return an EVM account.');
    }
    assertCurrentWallet(context, walletId);
    context.setState({
      kind: 'added',
      walletId,
      evmAddress: result.capabilities[0].thresholdEcdsaEthereumAddress,
      nearAccountId: context.nearAccountId,
    });
  } catch (error) {
    if (context.mounted.current)
      context.setState({ kind: 'failed', walletId, message: setupError(error) });
    return;
  }
  // Adding a signer changes the authority. Refresh its state without requesting
  // another proof. The next wallet action obtains its own current authorization.
  await context.refreshSession(walletId);
}

/** The menu owns setup across navigation between its screens. */
export function useEvmAccountSetup() {
  const { seams, refreshSession, loginState } = useSeams();
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const mounted = useRef(false);
  useEffect(trackMount.bind(null, mounted), [mounted]);
  return {
    state,
    add: addAccount.bind(
      null,
      { seams, refreshSession, mounted, setState, nearAccountId: loginState.nearAccountId },
      state,
    ),
  };
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
  const busy = state.kind === 'adding';
  const current = state.kind !== 'idle' && state.walletId === walletId;
  if (
    !targets ||
    (!busy &&
      !(current && state.kind === 'added') &&
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
  if (loginState.thresholdEcdsaEthereumAddress && !busy) return null;
  const hasPasskey = loginState.authMethods.some(isPasskey);
  let actionLabel = <WalletText message="Add EVM account" />;
  if (busy) actionLabel = <WalletText message="Adding EVM account…" />;
  return (
    <div>
      <button
        type="button"
        className="seams-account-action primary"
        disabled={busy || !hasPasskey}
        onClick={setup.add.bind(null, walletId, targets)}
      >
        {actionLabel}
      </button>
      <p className="seams-account-note" role={busy ? 'status' : undefined}>
        {hasPasskey || busy ? (
          <WalletText message="Enable this app’s EVM networks with your passkey." />
        ) : (
          <WalletText message="Add a passkey in Authentication methods first." />
        )}
      </p>
      {current && state.kind === 'failed' ? (
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
