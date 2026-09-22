import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AccountMenuButton,
  SeamsWebProvider,
  TransactionReviewHost,
  SHAPE_PRESETS,
  defineSeamsConfig,
  transfer,
  useSeams,
  useWallet,
  useWalletAuth,
  type LoginState,
  type SeamsContextType,
  type WalletShapeId,
} from '@seams/wallet/react';
import {
  HostedSeamsAuthMenu,
  type HostedAuthMenuOutcome,
} from '@seams/wallet/react/hosted-seams-auth-menu';
import {
  provisionLocalWorkspace,
  type LocalWorkspaceState,
  type ReadyLocalWorkspace,
} from './localWorkspace';
import { ServerShareRecovery } from './ServerShareRecovery';
import { PurchaseReviewExample } from './PurchaseReviewExample';

type PlaygroundPage = 'wallet' | 'recovery';

type SigningCheckState =
  | { kind: 'idle' }
  | { kind: 'signing'; operation: 'message' | 'transaction' }
  | { kind: 'signed'; message: string }
  | { kind: 'failed'; message: string };

type PlaygroundExportChain = 'near' | 'evm';

async function exportWalletKey(
  seams: SeamsContextType['seams'],
  chain: PlaygroundExportChain,
): Promise<void> {
  const result =
    chain === 'near'
      ? await seams.keys.exportKeypair({ kind: 'ed25519' })
      : await seams.keys.exportKeypair({ kind: 'ecdsa', chainTarget: 'arc-testnet' });
  if (result.kind === 'relink_required') {
    throw new Error('Key export requires re-linking this device to its owner credential.');
  }
}

export function WalletConsoleLite() {
  const [workspace, setWorkspace] = useState<LocalWorkspaceState>({ kind: 'empty' });
  const handleSetup = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const organizationName = String(form.get('organizationName') || '');
    const projectName = String(form.get('projectName') || '');
    setWorkspace({ kind: 'provisioning' });
    const result = await provisionLocalWorkspace({ organizationName, projectName });
    setWorkspace(result.ok ? result.workspace : { kind: 'failed', message: result.message });
  }, []);

  if (workspace.kind !== 'ready') {
    return <SetupScreen state={workspace} onSubmit={handleSetup} />;
  }
  return <ConfiguredWalletPlayground workspace={workspace} />;
}

function SetupScreen(props: {
  state: Exclude<LocalWorkspaceState, ReadyLocalWorkspace>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const provisioning = props.state.kind === 'provisioning';
  return (
    <main className="shell setup-shell">
      <header className="hero">
        <p className="eyebrow">Seams Wallet · local SDK playground</p>
        <h1>Set up a local Wallet project</h1>
        <p>
          Create one local organisation, project, and development environment. Runtime secrets stay
          in the local controller process.
        </p>
      </header>
      <form className="panel setup-form" onSubmit={props.onSubmit}>
        <label>
          Organisation name
          <input
            name="organizationName"
            autoComplete="organization"
            required
            maxLength={80}
            disabled={provisioning}
            placeholder="Acme Labs"
          />
        </label>
        <label>
          Project name
          <input
            name="projectName"
            required
            maxLength={80}
            disabled={provisioning}
            placeholder="Wallet prototype"
          />
        </label>
        <div className="fixed-environment">
          <span>Environment</span>
          <strong>dev</strong>
        </div>
        {props.state.kind === 'failed' ? (
          <p className="message error" role="alert">
            {props.state.message}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={provisioning}>
          {provisioning ? 'Starting local Wallet system…' : 'Create local project'}
        </button>
      </form>
    </main>
  );
}

function ConfiguredWalletPlayground({ workspace }: { workspace: ReadyLocalWorkspace }) {
  const config = useMemo(() => createWalletConfig(workspace), [workspace]);
  const [shape, setShape] = useState<WalletShapeId>('square');
  const theme = useMemo(
    () => ({
      tokens: {
        light: { shape: SHAPE_PRESETS[shape] },
        dark: { shape: SHAPE_PRESETS[shape] },
      },
    }),
    [shape],
  );
  const handleShapeChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    if (value === 'square' || value === 'rounded') setShape(value);
  }, []);
  return (
    <SeamsWebProvider eager config={config} theme={theme}>
      <TransactionReviewHost>
        <WalletPlayground workspace={workspace} shape={shape} onShapeChange={handleShapeChange} />
      </TransactionReviewHost>
    </SeamsWebProvider>
  );
}

function createWalletConfig(workspace: ReadyLocalWorkspace) {
  const { walletConfig } = workspace;
  return defineSeamsConfig({
    walletOrigin: walletConfig.walletOrigin,
    relayerUrl: walletConfig.gatewayUrl,
    projectEnvironmentId: walletConfig.projectEnvironmentId,
    publishableKey: walletConfig.publishableKey,
    iframeWallet: { rpIdOverride: new URL(walletConfig.walletOrigin).hostname },
    chains: [
      { network: 'near-testnet' },
      { network: 'tempo-testnet', chainId: 42_431 },
      {
        network: 'arc-testnet',
        chainId: 5_042_002,
        rpcUrl: 'https://rpc.testnet.arc.network',
        explorerUrl: 'https://testnet.arcscan.app',
      },
    ],
    signingSessionPersistenceMode: 'sealed_refresh_v1',
    routerAb: {
      normalSigning: {
        mode: 'enabled',
        signingWorkerId: walletConfig.signingWorkerId,
      },
    },
    routerAbEcdsaDerivationPresignaturePool: {
      enabled: true,
      targetDepth: 1,
      lowWatermark: 0,
      maxRefillInFlight: 1,
      refillAttemptTimeoutMs: 30_000,
    },
  });
}

function handleAuthOutcome(
  refreshLoginState: (walletId?: string) => Promise<void>,
  outcome: HostedAuthMenuOutcome,
): void {
  switch (outcome.kind) {
    case 'authenticated':
    case 'registered':
    case 'account_synced':
      void refreshLoginState(outcome.walletId);
      return;
    case 'failed':
      console.error(outcome.message);
      return;
    case 'cancelled':
      return;
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected auth outcome: ${JSON.stringify(value)}`);
}

function WalletPlayground({
  workspace,
  shape,
  onShapeChange,
}: {
  workspace: ReadyLocalWorkspace;
  shape: WalletShapeId;
  onShapeChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const { seams, walletIframeConnected } = useSeams();
  const { loginState, refreshLoginState } = useWalletAuth();
  const wallet = useWallet();
  const [signingCheck, setSigningCheck] = useState<SigningCheckState>({ kind: 'idle' });
  const [exportingKey, setExportingKey] = useState<PlaygroundExportChain | null>(null);
  const [page, setPage] = useState<PlaygroundPage>('wallet');

  const refreshSession = useCallback(async () => {
    if (!loginState.isLoggedIn) return;
    await refreshLoginState(loginState.walletId);
  }, [loginState, refreshLoginState]);

  const handleAccountMenuLock = useCallback(() => {
    setSigningCheck({ kind: 'idle' });
    setExportingKey(null);
  }, []);

  const handleAccountMenuError = useCallback((error: Error) => {
    setSigningCheck({ kind: 'failed', message: error.message });
  }, []);

  const runMessageSigningCheck = useCallback(async () => {
    if (wallet.status !== 'ready' || !loginState.isLoggedIn) return;
    setSigningCheck({ kind: 'signing', operation: 'message' });
    try {
      const result = await wallet.near.signNEP413Message({
        params: {
          message: 'Hello, Seams!',
          recipient: 'wallet-console-lite.local',
          state: 'local-signing-check-v1',
        },
        options: {
          confirmerText: {
            title: 'Review message signature',
            body: 'Review the signer, recipient, and message before signing.',
          },
        },
      });
      setSigningCheck(
        result.success
          ? { kind: 'signed', message: 'Message signed locally.' }
          : { kind: 'failed', message: result.error },
      );
    } catch (error) {
      setSigningCheck({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Message signing check failed',
      });
    }
  }, [loginState.isLoggedIn, wallet]);

  const runTransactionSigningCheck = useCallback(async () => {
    if (wallet.status !== 'ready' || !loginState.isLoggedIn) return;
    setSigningCheck({ kind: 'signing', operation: 'transaction' });
    try {
      await seams.near.signTransactionWithActions({
        transaction: {
          receiverId: wallet.near.accountId,
          actions: [transfer('0')],
        },
        options: {
          confirmerText: {
            title: 'Review transaction',
            body: 'Sign a zero-value transfer locally. Nothing will be broadcast.',
          },
        },
      });
      setSigningCheck({
        kind: 'signed',
        message: 'Transaction signed locally. Nothing was broadcast.',
      });
    } catch (error) {
      setSigningCheck({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Signing check failed',
      });
    }
  }, [loginState.isLoggedIn, seams, wallet]);

  const runKeyExport = useCallback(
    async (chain: PlaygroundExportChain) => {
      setExportingKey(chain);
      setSigningCheck({ kind: 'idle' });
      try {
        await exportWalletKey(seams, chain);
      } catch (error) {
        setSigningCheck({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Key export failed',
        });
      } finally {
        setExportingKey(null);
      }
    },
    [seams],
  );

  const exportNearKey = useCallback(async () => {
    await runKeyExport('near');
  }, [runKeyExport]);

  const exportEvmKey = useCallback(async () => {
    await runKeyExport('evm');
  }, [runKeyExport]);

  const showWallet = useCallback(() => setPage('wallet'), []);
  const showRecovery = useCallback(() => setPage('recovery'), []);

  return (
    <main className="shell playground-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Local Wallet project</p>
          <h1>{workspace.identity.projectName}</h1>
          <p>{workspace.identity.organizationName}</p>
        </div>
        <label>
          Wallet corners
          <select value={shape} onChange={onShapeChange}>
            <option value="square">Sharp</option>
            <option value="rounded">Rounded</option>
          </select>
        </label>
        <span className="environment-badge">dev</span>
      </header>

      <nav className="page-tabs" aria-label="Wallet Console Lite pages">
        <button type="button" className={page === 'wallet' ? 'active' : ''} onClick={showWallet}>
          Wallet
        </button>
        <button
          type="button"
          className={page === 'recovery' ? 'active' : ''}
          onClick={showRecovery}
        >
          Server share recovery
        </button>
      </nav>

      {page === 'wallet' ? (
        <>
          <section className="status-grid" aria-label="Local service status">
            <StatusCard label="Wallet Gateway" value="Ready" ready />
            <StatusCard
              label="Hosted Wallet iframe"
              value={walletIframeConnected ? 'Connected' : 'Connecting'}
              ready={walletIframeConnected}
            />
          </section>

          {!loginState.isLoggedIn ? (
            <section className="panel auth-panel">
              <div className="section-heading">
                <p className="eyebrow">Authentication</p>
                <h2>Register or unlock a Wallet</h2>
              </div>
              <HostedSeamsAuthMenu
                showProgress
                onOutcome={handleAuthOutcome.bind(null, refreshLoginState)}
              />
            </section>
          ) : (
            <SignedInPanel
              loginState={loginState}
              signingCheck={signingCheck}
              exportingKey={exportingKey}
              canSign={wallet.status === 'ready'}
              onRefresh={refreshSession}
              onAccountMenuLock={handleAccountMenuLock}
              onAccountMenuError={handleAccountMenuError}
              onMessageSigningCheck={runMessageSigningCheck}
              onTransactionSigningCheck={runTransactionSigningCheck}
              onExportNearKey={exportNearKey}
              onExportEvmKey={exportEvmKey}
            />
          )}

          <PurchaseReviewExample />

          <details className="panel configuration">
            <summary>Public local configuration</summary>
            <dl>
              <IdentityRow
                label="Project environment"
                value={workspace.walletConfig.projectEnvironmentId}
              />
              <IdentityRow label="Publishable key" value={workspace.walletConfig.publishableKey} />
              <IdentityRow label="Gateway" value={workspace.walletConfig.gatewayUrl} />
              <IdentityRow label="Wallet origin" value={workspace.walletConfig.walletOrigin} />
            </dl>
          </details>
        </>
      ) : (
        <ServerShareRecovery environmentId={workspace.identity.environmentId} />
      )}
    </main>
  );
}

function SignedInPanel(props: {
  loginState: Extract<LoginState, { isLoggedIn: true }>;
  signingCheck: SigningCheckState;
  exportingKey: PlaygroundExportChain | null;
  canSign: boolean;
  onRefresh: () => Promise<void>;
  onAccountMenuLock: () => void;
  onAccountMenuError: (error: Error) => void;
  onMessageSigningCheck: () => Promise<void>;
  onTransactionSigningCheck: () => Promise<void>;
  onExportNearKey: () => Promise<void>;
  onExportEvmKey: () => Promise<void>;
}) {
  const authMethod =
    props.loginState.currentAuthMethod.kind === 'selected'
      ? props.loginState.currentAuthMethod.binding.kind
      : 'signing only';
  return (
    <section className="panel wallet-panel">
      <div className="wallet-panel-heading">
        <div className="section-heading">
          <p className="eyebrow">Active Wallet</p>
          <h2>Wallet session</h2>
        </div>
        <AccountMenuButton
          nearAccountId={props.loginState.nearAccountId}
          username={props.loginState.walletId}
          onLock={props.onAccountMenuLock}
          onExportKeyError={props.onAccountMenuError}
        />
      </div>
      <dl className="identity-list">
        <IdentityRow label="Wallet ID" value={props.loginState.walletId} />
        <IdentityRow label="Authentication" value={authMethod} />
        <IdentityRow
          label="NEAR account"
          value={props.loginState.nearAccountId || 'Provisioning'}
        />
        <IdentityRow
          label="EVM address"
          value={props.loginState.thresholdEcdsaEthereumAddress || 'Provisioning'}
        />
      </dl>
      <div className="actions">
        <button type="button" onClick={props.onRefresh}>
          Refresh session
        </button>
        <button
          type="button"
          onClick={props.onMessageSigningCheck}
          disabled={!props.canSign || props.signingCheck.kind === 'signing'}
        >
          {props.signingCheck.kind === 'signing' && props.signingCheck.operation === 'message'
            ? 'Signing message…'
            : 'Sign message'}
        </button>
        <button
          type="button"
          onClick={props.onTransactionSigningCheck}
          disabled={!props.canSign || props.signingCheck.kind === 'signing'}
        >
          {props.signingCheck.kind === 'signing' && props.signingCheck.operation === 'transaction'
            ? 'Signing transaction…'
            : 'Sign transaction'}
        </button>
        <button
          type="button"
          onClick={props.onExportNearKey}
          disabled={props.exportingKey !== null || !props.loginState.nearAccountId}
        >
          {props.exportingKey === 'near' ? 'Exporting NEAR key…' : 'Export NEAR key'}
        </button>
        <button
          type="button"
          onClick={props.onExportEvmKey}
          disabled={props.exportingKey !== null || !props.loginState.thresholdEcdsaEthereumAddress}
        >
          {props.exportingKey === 'evm' ? 'Exporting EVM keys…' : 'Export EVM keys'}
        </button>
      </div>
      {props.signingCheck.kind === 'signed' || props.signingCheck.kind === 'failed' ? (
        <p
          className={`message ${props.signingCheck.kind === 'failed' ? 'error' : 'success'}`}
          role="status"
        >
          {props.signingCheck.message}
        </p>
      ) : null}
    </section>
  );
}

function StatusCard(props: { label: string; value: string; ready: boolean }) {
  return (
    <article className="status-card">
      <span className={`status-dot ${props.ready ? 'ready' : ''}`} aria-hidden="true" />
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </article>
  );
}

function IdentityRow(props: { label: string; value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}
