import {
  ActionType,
  parseOwnerNearRecovery,
  type ExternalWalletAuthentication,
  type OwnerNearOperation,
  type OwnerNearOperationState,
  type OwnerNearRecovery,
} from '@seams/wallet';
import { parseWebAuthnRpId } from '@seams/wallet/advanced';
import { useOwnerNearOperation, useSeams } from '@seams/wallet/react';
import React from 'react';

type Seams = ReturnType<typeof useSeams>['seams'];
type SavedOwnerTransaction = { readonly recovery: OwnerNearRecovery } & (
  | { readonly kind: 'unknown'; readonly transactionId?: never }
  | { readonly kind: 'known'; readonly transactionId: string }
);
type Connection =
  | { kind: 'disconnected' }
  | { kind: 'working'; message: string }
  | {
      kind: 'readable';
      authentication: ExternalWalletAuthentication;
      nearAccountId: string;
      operation: OwnerNearOperation | null;
    }
  | { kind: 'failed'; message: string };

/** The application authenticates first. Its backend supplies /api/wallet/handoff. */
export function ApplicationAuthExample({ walletRpId }: { walletRpId: string }): React.ReactNode {
  const { seams } = useSeams();
  return <ApplicationWallet seams={seams} walletRpId={walletRpId} />;
}

class ApplicationWallet extends React.Component<
  { seams: Seams; walletRpId: string },
  { walletId: string; connection: Connection }
> {
  state: { walletId: string; connection: Connection } = {
    walletId: '',
    connection: { kind: 'disconnected' },
  };

  componentDidMount(): void {
    void this.restore().catch(this.fail.bind(this));
  }

  async restore(): Promise<void> {
    const session = await this.props.seams.auth.getSession();
    if (session.authentication.kind === 'external_authenticated') {
      await this.showReadable(session.authentication);
    }
  }

  setWallet(event: React.ChangeEvent<HTMLInputElement>): void {
    this.setState({ walletId: event.target.value, connection: { kind: 'disconnected' } });
  }

  async register(): Promise<void> {
    this.setState({ connection: { kind: 'working', message: 'Enroll a wallet owner passkey.' } });
    try {
      const rpId = parseWebAuthnRpId(this.props.walletRpId);
      if (!rpId.ok) throw new Error('Invalid wallet relying party.');
      const result = await this.props.seams.registration.registerOwnerWallet({
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
      if (!result.success || result.kind !== 'wallet_owner_registered')
        throw new Error(result.success ? 'Unexpected registration result.' : result.error);
      this.setState({ walletId: String(result.walletId), connection: { kind: 'disconnected' } });
    } catch (error) {
      this.fail(error);
    }
  }

  async link(): Promise<void> {
    const walletId = this.state.walletId;
    this.setState({
      connection: {
        kind: 'working',
        message: 'Approve the application association in the wallet.',
      },
    });
    try {
      const attempt = await this.props.seams.auth.prepareExternalAssociation(walletId);
      if (!attempt.ok) throw new Error(attempt.message);
      const code = await handoff(attempt.value);
      const result = await this.props.seams.auth.associateExternalAuth({
        method: 'handoff',
        walletId,
        attemptId: attempt.value.attemptId,
        code,
      });
      if (!result.ok) throw new Error(result.message);
      await this.connect();
    } catch (error) {
      this.fail(error);
    }
  }

  async connect(): Promise<void> {
    const walletId = this.state.walletId;
    this.setState({
      connection: { kind: 'working', message: 'Connect the signed-in application account.' },
    });
    try {
      const attempt = await this.props.seams.auth.prepareExternalAuth(walletId);
      if (!attempt.ok) throw new Error(attempt.message);
      const code = await handoff(attempt.value);
      const result = await this.props.seams.auth.authenticate({
        method: 'handoff',
        walletId,
        attemptId: attempt.value.attemptId,
        code,
      });
      if (!result.ok) throw new Error(result.message);
      await this.showReadable(result.value);
    } catch (error) {
      this.fail(error);
    }
  }

  async showReadable(authentication: ExternalWalletAuthentication): Promise<void> {
    const session = await this.props.seams.auth.getSession(String(authentication.walletId));
    if (
      session.authentication.kind !== 'external_authenticated' ||
      session.appIdentity.kind !== 'resolved' ||
      !session.appIdentity.nearAccountId
    )
      throw new Error('The readable wallet has no NEAR account.');
    const saved = readRecovery(String(authentication.walletId));
    const operation = saved
      ? this.props.seams.near.resumeOwnerTransaction({
          authentication: session.authentication,
          recovery: saved.recovery,
        })
      : null;
    this.setState({
      walletId: String(authentication.walletId),
      connection: {
        kind: 'readable',
        authentication: session.authentication,
        nearAccountId: String(session.appIdentity.nearAccountId),
        operation,
      },
    });
  }

  transfer(): void {
    const connection = this.state.connection;
    if (connection.kind !== 'readable') return;
    if (connection.operation && blocksNewTransfer(connection.operation.getState())) return;
    const operation = this.props.seams.near.prepareOwnerTransaction({
      authentication: connection.authentication,
      nearAccountId: connection.nearAccountId,
      transaction: {
        receiverId: connection.nearAccountId,
        actions: [{ type: ActionType.Transfer, amount: '1' }],
      },
    });
    sessionStorage.setItem(
      recoveryKey(operation.getState().recovery.walletId),
      JSON.stringify({ kind: 'unknown', recovery: operation.getState().recovery }),
    );
    this.setState({
      connection: {
        kind: 'readable',
        authentication: connection.authentication,
        nearAccountId: connection.nearAccountId,
        operation,
      },
    });
  }

  fail(error: unknown): void {
    this.setState({
      connection: {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  render(): React.ReactNode {
    const connection = this.state.connection;
    return (
      <section aria-label="Application authentication" data-state={connection.kind}>
        <h1>Application login and wallet approval</h1>
        <p>Sign in to your application first. Each transfer requires a wallet owner passkey.</p>
        <label>
          Wallet ID <input value={this.state.walletId} onChange={this.setWallet.bind(this)} />
        </label>
        <button onClick={this.register.bind(this)}>Create owner wallet</button>
        <button onClick={this.link.bind(this)} disabled={!this.state.walletId}>
          Link application account
        </button>
        <button onClick={this.connect.bind(this)} disabled={!this.state.walletId}>
          Connect wallet
        </button>
        {connection.kind === 'working' || connection.kind === 'failed' ? (
          <p role="status">{connection.message}</p>
        ) : null}
        {connection.kind === 'readable' ? (
          <>
            <p role="status">Wallet connected for reading.</p>
            {connection.operation ? (
              <OwnerTransaction
                operation={connection.operation}
                prepare={this.transfer.bind(this)}
              />
            ) : (
              <button onClick={this.transfer.bind(this)}>
                Prepare one yoctoNEAR self-transfer
              </button>
            )}
          </>
        ) : null}
      </section>
    );
  }
}

function OwnerTransaction({
  operation,
  prepare,
}: {
  operation: OwnerNearOperation;
  prepare: () => void;
}): React.ReactNode {
  const state = useOwnerNearOperation(operation);
  const transactionId = displayedTransactionId(state);
  React.useEffect(persistRecovery.bind(null, state), [state]);
  return (
    <section aria-label="Owner transaction" data-state={state.kind}>
      <button onClick={prepare} disabled={blocksNewTransfer(state)}>
        Prepare one yoctoNEAR self-transfer
      </button>
      <p role="status">{state.kind}</p>
      {state.kind === 'prepared' ? (
        <button onClick={operation.approve.bind(operation)}>Review and approve transfer</button>
      ) : null}
      {state.kind === 'prepared' || state.kind === 'approval' ? (
        <button onClick={operation.cancel.bind(operation)}>Cancel transfer</button>
      ) : null}
      {state.kind === 'unknown' ||
      state.kind === 'unresolved' ||
      state.kind === 'recovery_unavailable' ? (
        <button onClick={operation.recover.bind(operation)}>Check existing transaction</button>
      ) : null}
      {transactionId ? <p>Transaction: {transactionId}</p> : null}
      {state.kind === 'not_submitted' ||
      state.kind === 'reverted' ||
      state.kind === 'unresolved' ||
      state.kind === 'recovery_unavailable' ? (
        <p>{state.error}</p>
      ) : null}
    </section>
  );
}

function blocksNewTransfer(state: OwnerNearOperationState): boolean {
  switch (state.kind) {
    case 'approval':
    case 'submitting':
    case 'unknown':
    case 'unresolved':
    case 'recovery_unavailable':
      return true;
    case 'prepared':
    case 'completed':
    case 'reverted':
    case 'cancelled':
    case 'expired':
    case 'not_submitted':
      return false;
    default:
      return assertNeverOperationState(state);
  }
}

function assertNeverOperationState(state: never): never {
  throw new Error(`Unsupported owner operation state: ${String(state)}`);
}

async function handoff(attempt: {
  walletId: string;
  attemptId: string;
  purpose: 'authenticate' | 'associate';
}): Promise<string> {
  const response = await fetch('/api/wallet/handoff', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attempt),
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    !result ||
    typeof result !== 'object' ||
    typeof Reflect.get(result, 'code') !== 'string'
  )
    throw new Error('The application wallet handoff failed.');
  return Reflect.get(result, 'code');
}

function recoveryKey(walletId: string): string {
  return `application-owner-near-recovery:${walletId}`;
}

function readRecovery(walletId: string): SavedOwnerTransaction | null {
  const key = recoveryKey(walletId);
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const raw: unknown = JSON.parse(stored);
    if (!raw || typeof raw !== 'object') throw new Error('Invalid saved operation.');
    const kind: unknown = Reflect.get(raw, 'kind');
    // Older examples persisted the identity alone. Normalize that storage shape here.
    const recovery = parseOwnerNearRecovery(
      kind === undefined ? raw : Reflect.get(raw, 'recovery'),
    );
    if (String(recovery.walletId) !== walletId) throw new Error('Saved operation wallet mismatch.');
    if (kind === undefined || kind === 'unknown') return { kind: 'unknown', recovery };
    const transactionId: unknown = Reflect.get(raw, 'transactionId');
    if (
      kind === 'known' &&
      typeof transactionId === 'string' &&
      transactionId.length > 0 &&
      transactionId.trim() === transactionId
    )
      return { kind: 'known', recovery, transactionId };
  } catch {}
  sessionStorage.removeItem(key);
  return null;
}

function persistRecovery(state: OwnerNearOperationState): void {
  const key = recoveryKey(state.recovery.walletId);
  const saved = readRecovery(state.recovery.walletId);
  switch (state.kind) {
    case 'submitting':
    case 'unresolved':
      sessionStorage.setItem(
        key,
        JSON.stringify({
          kind: 'known',
          recovery: state.recovery,
          transactionId: state.transactionId,
        }),
      );
      return;
    case 'prepared':
    case 'approval':
    case 'unknown':
    case 'recovery_unavailable':
      if (saved?.kind === 'known' && saved.recovery.operationId === state.recovery.operationId)
        return;
      sessionStorage.setItem(key, JSON.stringify({ kind: 'unknown', recovery: state.recovery }));
      return;
    case 'completed':
    case 'reverted':
    case 'cancelled':
    case 'expired':
    case 'not_submitted':
      if (saved?.recovery.operationId === state.recovery.operationId)
        sessionStorage.removeItem(key);
      return;
    default:
      state satisfies never;
      throw new Error('Unsupported owner transaction state.');
  }
}

function displayedTransactionId(state: OwnerNearOperationState): string | null {
  if (state.kind === 'completed') return state.result.transactionId;
  if (state.kind === 'submitting' || state.kind === 'unresolved' || state.kind === 'reverted')
    return state.transactionId;
  const saved = readRecovery(state.recovery.walletId);
  if (saved?.kind === 'known' && saved.recovery.operationId === state.recovery.operationId)
    return saved.transactionId;
  return null;
}
