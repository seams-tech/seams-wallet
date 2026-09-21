import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import {
  SeamsWebProvider,
  defineSeamsConfig,
  useSeams,
  useWallet,
  useWalletAuth,
  ExternalEvmController,
  ExternalEvmWalletPicker,
  useExternalEvm,
  type ExternalEvmConnection,
  type LoginState,
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

type PlaygroundPage = 'wallet' | 'recovery';

type SigningCheckState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'signed'; message: string }
  | { kind: 'failed'; message: string };

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
  return (
    <SeamsWebProvider eager config={config}>
      <WalletPlayground workspace={workspace} />
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
    chains: [{ network: 'near-testnet' }, { network: 'tempo-testnet', chainId: 42_431 }],
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

function createExternalEvmController(): ExternalEvmController {
  return new ExternalEvmController([
    {
      chainId: 11_155_111,
      name: 'Sepolia testnet',
      rpcUrl: 'https://rpc.sepolia.org',
    },
  ]);
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

function WalletPlayground({ workspace }: { workspace: ReadyLocalWorkspace }) {
  const { walletIframeConnected } = useSeams();
  const { loginState, lock, refreshLoginState } = useWalletAuth();
  const wallet = useWallet();
  const externalEvm = useMemo(createExternalEvmController, []);
  const [signingCheck, setSigningCheck] = useState<SigningCheckState>({ kind: 'idle' });
  const [page, setPage] = useState<PlaygroundPage>('wallet');

  const refreshSession = useCallback(async () => {
    if (!loginState.isLoggedIn) return;
    await refreshLoginState(loginState.walletId);
  }, [loginState, refreshLoginState]);

  const lockWallet = useCallback(async () => {
    await lock();
    setSigningCheck({ kind: 'idle' });
  }, [lock]);

  const runSigningCheck = useCallback(async () => {
    if (wallet.status !== 'ready') return;
    setSigningCheck({ kind: 'signing' });
    try {
      const result = await wallet.near.signNEP413Message({
        params: {
          message: 'Seams Wallet Console Lite local signing check',
          recipient: 'wallet-console-lite.local',
          state: 'local-signing-check-v1',
        },
      });
      setSigningCheck(
        result.success
          ? { kind: 'signed', message: 'Message signed locally. No funds were broadcast.' }
          : { kind: 'failed', message: result.error },
      );
    } catch (error) {
      setSigningCheck({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Signing check failed',
      });
    }
  }, [wallet]);

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
              canSign={wallet.status === 'ready'}
              onRefresh={refreshSession}
              onLock={lockWallet}
              onSigningCheck={runSigningCheck}
            />
          )}

          <ExternalEvmPanel controller={externalEvm} />

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

type ExternalEvmActionState =
  | { kind: 'idle' }
  | { kind: 'running'; label: string }
  | { kind: 'succeeded'; message: string }
  | { kind: 'failed'; message: string };

type ExternalEvmActionSetter = Dispatch<SetStateAction<ExternalEvmActionState>>;

async function runExternalMessageSigning(
  controller: ExternalEvmController,
  connection: ExternalEvmConnection,
  setAction: ExternalEvmActionSetter,
): Promise<void> {
  setAction({ kind: 'running', label: 'Waiting for wallet approval…' });
  const result = await controller.signMessage(
    connection,
    new TextEncoder().encode('Seams external EVM wallet check'),
  );
  setAction(
    result.ok
      ? { kind: 'succeeded', message: `Message signed: ${result.value.slice(0, 18)}…` }
      : { kind: 'failed', message: result.message },
  );
}

async function runExternalTypedDataSigning(
  controller: ExternalEvmController,
  connection: ExternalEvmConnection,
  setAction: ExternalEvmActionSetter,
): Promise<void> {
  setAction({ kind: 'running', label: 'Waiting for typed-data approval…' });
  const result = await controller.signTypedData(connection, {
    types: { SeamsCheck: [{ name: 'message', type: 'string' }] },
    primaryType: 'SeamsCheck',
    domain: { name: 'Seams Wallet', version: '1', chainId: connection.chainId },
    message: { message: 'External EVM wallet check' },
  });
  setAction(
    result.ok
      ? {
          kind: 'succeeded',
          message: `Typed data signed: ${result.value.slice(0, 18)}…`,
        }
      : { kind: 'failed', message: result.message },
  );
}

async function runExternalTestnetTransaction(
  controller: ExternalEvmController,
  connection: ExternalEvmConnection,
  setAction: ExternalEvmActionSetter,
): Promise<void> {
  setAction({ kind: 'running', label: 'Waiting for transaction approval…' });
  const result = await controller.sendTransaction(connection, {
    to: '0x000000000000000000000000000000000000dEaD',
    data: '0x',
    value: 0n,
    gas: { kind: 'wallet' },
    fees: { kind: 'wallet' },
  });
  setAction(
    result.ok
      ? { kind: 'succeeded', message: `Submitted ${result.value.hash}` }
      : { kind: 'failed', message: result.message },
  );
}

function ExternalEvmPanel({ controller }: { controller: ExternalEvmController }) {
  const externalEvm = useExternalEvm(controller);
  const { busy, connection } = externalEvm;
  const [action, setAction] = useState<ExternalEvmActionState>({ kind: 'idle' });

  return (
    <section className="panel external-evm-panel">
      <div className="section-heading">
        <p className="eyebrow">External account</p>
        <h2>MetaMask, Rabby, or Phantom (EVM)</h2>
      </div>
      <p className="section-description">
        This account keeps its keys in the browser wallet. Seams never imports or stores them.
      </p>
      <ExternalEvmWalletPicker controller={controller} snapshot={externalEvm} />
      {connection.kind === 'connected' ? (
        <div className="actions external-evm-actions">
          <button
            type="button"
            onClick={runExternalMessageSigning.bind(null, controller, connection, setAction)}
            disabled={busy}
          >
            Sign message
          </button>
          <button
            type="button"
            onClick={runExternalTypedDataSigning.bind(null, controller, connection, setAction)}
            disabled={busy}
          >
            Sign typed data
          </button>
          <button
            type="button"
            onClick={runExternalTestnetTransaction.bind(null, controller, connection, setAction)}
            disabled={busy || connection.network.kind !== 'configured'}
          >
            Send zero-value Sepolia transaction
          </button>
        </div>
      ) : null}
      {action.kind === 'running' ? (
        <p className="message" role="status">{action.label}</p>
      ) : null}
      {action.kind === 'succeeded' || action.kind === 'failed' ? (
        <p
          className={`message ${action.kind === 'failed' ? 'error' : 'success'}`}
          role="status"
        >
          {action.message}
        </p>
      ) : null}
    </section>
  );
}

function SignedInPanel(props: {
  loginState: Extract<LoginState, { isLoggedIn: true }>;
  signingCheck: SigningCheckState;
  canSign: boolean;
  onRefresh: () => Promise<void>;
  onLock: () => Promise<void>;
  onSigningCheck: () => Promise<void>;
}) {
  const authMethod =
    props.loginState.currentAuthMethod.kind === 'selected'
      ? props.loginState.currentAuthMethod.binding.kind
      : 'signing only';
  return (
    <section className="panel wallet-panel">
      <div className="section-heading">
        <p className="eyebrow">Active Wallet</p>
        <h2>Wallet session</h2>
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
          onClick={props.onSigningCheck}
          disabled={!props.canSign || props.signingCheck.kind === 'signing'}
        >
          {props.signingCheck.kind === 'signing' ? 'Signing…' : 'Run signing check'}
        </button>
        <button type="button" onClick={props.onLock}>
          Lock wallet
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
