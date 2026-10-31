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
    const recovery = readRecovery(String(authentication.walletId));
    const operation =
      recovery && recovery.walletId === String(authentication.walletId)
        ? this.props.seams.near.resumeOwnerTransaction({
            authentication: session.authentication,
            recovery,
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
      JSON.stringify(operation.getState().recovery),
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
            <button onClick={this.transfer.bind(this)}>Prepare one yoctoNEAR self-transfer</button>
            {connection.operation ? <OwnerTransaction operation={connection.operation} /> : null}
          </>
        ) : null}
      </section>
    );
  }
}

function OwnerTransaction({ operation }: { operation: OwnerNearOperation }): React.ReactNode {
  const state = useOwnerNearOperation(operation);
  React.useEffect(persistRecovery.bind(null, state), [state]);
  return (
    <section aria-label="Owner transaction" data-state={state.kind}>
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
      {state.kind === 'completed' ? <p>Transaction: {state.result.transactionId}</p> : null}
      {state.kind === 'submitting' || state.kind === 'unresolved' ? (
        <p>Transaction: {state.transactionId}</p>
      ) : null}
      {state.kind === 'not_submitted' ||
      state.kind === 'reverted' ||
      state.kind === 'unresolved' ||
      state.kind === 'recovery_unavailable' ? (
        <p>{state.error}</p>
      ) : null}
    </section>
  );
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

function readRecovery(walletId: string): OwnerNearRecovery | null {
  const key = recoveryKey(walletId);
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const recovery = parseOwnerNearRecovery(JSON.parse(stored));
    if (String(recovery.walletId) === walletId) return recovery;
  } catch {}
  sessionStorage.removeItem(key);
  return null;
}

function persistRecovery(state: OwnerNearOperationState): void {
  const key = recoveryKey(state.recovery.walletId);
  switch (state.kind) {
    case 'prepared':
    case 'approval':
    case 'submitting':
    case 'unknown':
    case 'unresolved':
    case 'recovery_unavailable':
      sessionStorage.setItem(key, JSON.stringify(state.recovery));
      return;
    case 'completed':
    case 'reverted':
    case 'cancelled':
    case 'expired':
    case 'not_submitted':
      if (readRecovery(state.recovery.walletId)?.operationId === state.recovery.operationId)
        sessionStorage.removeItem(key);
      return;
    default:
      state satisfies never;
      throw new Error('Unsupported owner transaction state.');
  }
}
