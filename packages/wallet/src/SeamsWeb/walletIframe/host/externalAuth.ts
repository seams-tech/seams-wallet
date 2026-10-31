import { toAccountId } from '@/core/types/accountIds';
import type { SeamsConfigsReadonly, WalletSession } from '@/core/types/seams';
import { base64UrlEncode } from '@shared/utils/base64';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import {
  EXTERNAL_AUTH_PATH,
  externalAuthFailure,
  parseExternalWalletSettings,
  parseExternalOwnerChallenge,
  parseExternalAuthFailure,
  type ExternalAuthenticateInput,
  type ExternalAuthAttempt,
  type ExternalAuthResult,
  type ExternalWalletAuthentication,
  type ExternalWalletSettings,
} from '@shared/auth/externalAuth';
import { ExternalOwnerApprovalError, type ExternalOwnerApproval } from './externalOwnerApproval';

type Attempt = { walletId: WalletId; attemptId: string; binding: string; sessionToken: string };
type OwnerOperationSubmission = Attempt & {
  readonly code: string;
  readonly factorProof: Awaited<ReturnType<ExternalOwnerApproval>>;
};
type ConnectionState =
  | { kind: 'empty' }
  | { kind: 'restoring'; attempt: Attempt }
  | { kind: 'authenticated'; attempt: Attempt; settings: ExternalWalletSettings };
type State = ConnectionState
  | { kind: 'prepared'; attempt: Attempt }
  | {
      kind: 'owner_operation'; purpose: 'associate' | 'unlink'; attempt: Attempt;
      connection: ConnectionState;
      approval: { kind: 'ready' } | { kind: 'pending'; controller: AbortController };
    };

function externalConnection(state: State): ConnectionState {
  switch (state.kind) {
    case 'owner_operation':
      return state.connection;
    case 'prepared':
      return { kind: 'empty' };
    case 'empty':
    case 'restoring':
    case 'authenticated':
      return state;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported external authentication state: ${String(value)}`);
}

export class HostedExternalAuth {
  private state: State = { kind: 'empty' };
  private generation = 0;

  constructor(
    private readonly configs: SeamsConfigsReadonly,
    private readonly lockOwner: () => Promise<void>,
    private readonly approveOwner: ExternalOwnerApproval,
    private readonly parentOrigin: string,
  ) {
    this.restore();
  }

  private storageKey(): string {
    return `seams.external-auth:${this.parentOrigin}:${this.configs.network.relayer.url}:${this.configs.registration.projectEnvironmentId}`;
  }

  private restore(): void {
    try {
      const serialized = sessionStorage.getItem(this.storageKey());
      if (!serialized) return;
      const record = requireRecord(JSON.parse(serialized), 'external session');
      const walletId = parseWalletId(record.walletId);
      if (!walletId.ok) throw new Error('Invalid wallet');
      this.state = {
        kind: 'restoring',
        attempt: {
          walletId: walletId.value,
          attemptId: requireCanonicalString(record.attemptId, 'attemptId'),
          binding: requireCanonicalString(record.binding, 'binding'),
          sessionToken: requireCanonicalString(record.sessionToken, 'sessionToken'),
        },
      };
    } catch {
      sessionStorage.removeItem(this.storageKey());
    }
  }

  private async request(action: string, body: object): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this.configs.network.relayer.url.replace(/\/$/, '')}${EXTERNAL_AUTH_PATH}/${action}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.configs.registration.publishableKey}`,
          'x-seams-environment-id': this.configs.registration.projectEnvironmentId,
        },
        body: JSON.stringify({ ...body, appOrigin: this.parentOrigin }),
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status >= 500) return externalAuthFailure('unavailable');
    if (response.status === 429) return externalAuthFailure('rate_limited');
    return requireRecord(await response.json(), 'external authentication response');
  }

  async lock(): Promise<void> {
    const previous = this.state;
    const connection = externalConnection(previous);
    if (previous.kind === 'owner_operation' && previous.approval.kind === 'pending') {
      previous.approval.controller.abort();
    }
    this.generation += 1;
    this.state = { kind: 'empty' };
    sessionStorage.removeItem(this.storageKey());
    if (previous.kind !== 'empty') {
      await this.request('logout', {
        walletId: previous.attempt.walletId,
        sessionToken: previous.attempt.sessionToken,
      });
    }
    if (previous.kind === 'owner_operation' && connection.kind !== 'empty') {
      await this.request('logout', {
        walletId: connection.attempt.walletId,
        sessionToken: connection.attempt.sessionToken,
      });
    }
  }

  async releaseForOwner(): Promise<void> {
    if (this.state.kind !== 'empty') await this.lock();
  }

  async prepare(walletId: string): Promise<ExternalAuthResult<ExternalAuthAttempt>> {
    const parsed = parseWalletId(walletId);
    if (!parsed.ok) return externalAuthFailure('invalid_request');
    const locking = this.lock();
    const generation = this.generation;
    await locking;
    if (generation !== this.generation) return externalAuthFailure('superseded');
    await this.lockOwner();
    if (generation !== this.generation) return externalAuthFailure('superseded');
    const binding = randomSecret();
    const sessionToken = randomSecret();
    const result = await this.request('prepare', { walletId: parsed.value, binding, sessionToken });
    if (generation !== this.generation) return externalAuthFailure('superseded');
    if (result.ok !== true) return parseExternalAuthFailure(result);
    const value = requireRecord(result.value, 'external authentication attempt');
    const attemptId = requireCanonicalString(value.attemptId, 'attemptId');
    if (typeof value.expiresAtMs !== 'number' || value.walletId !== parsed.value || value.purpose !== 'authenticate')
      throw new Error('Invalid attempt');
    const attempt = { walletId: parsed.value, attemptId, binding, sessionToken };
    this.state = { kind: 'prepared', attempt };
    return {
      ok: true,
      value: { purpose: 'authenticate', walletId: parsed.value, attemptId, expiresAtMs: value.expiresAtMs },
    };
  }

  async authenticate(
    input: ExternalAuthenticateInput,
    assertActive: () => void = activeRequest,
  ): Promise<ExternalAuthResult<ExternalWalletAuthentication>> {
    assertActive();
    if (input.method === 'google') {
      const prepared = await this.prepare(input.walletId);
      if (!prepared.ok) return prepared;
    }
    const current = this.state;
    const generation = this.generation;
    if (current.kind !== 'prepared' || current.attempt.walletId !== input.walletId)
      return externalAuthFailure('access_denied');
    const attempt = current.attempt;
    let code: string;
    if (input.method === 'google') {
      const exchanged = await this.request('exchange', {
        walletId: input.walletId,
        attemptId: attempt.attemptId,
        idToken: input.idToken,
      });
      if (exchanged.ok !== true) return parseExternalAuthFailure(exchanged);
      code = requireCanonicalString(requireRecord(exchanged.value, 'exchange').code, 'code');
    } else {
      if (input.attemptId !== attempt.attemptId) return externalAuthFailure('access_denied');
      code = input.code;
    }
    if (generation !== this.generation) return externalAuthFailure('superseded');
    assertActive();
    const result = await this.request('redeem', {
      walletId: attempt.walletId,
      attemptId: attempt.attemptId,
      binding: attempt.binding,
      sessionToken: attempt.sessionToken,
      code,
    });
    if (result.ok !== true) return parseExternalAuthFailure(result);
    try {
      assertActive();
    } catch {
      await this.request('logout', {
        walletId: attempt.walletId,
        sessionToken: attempt.sessionToken,
      });
      return externalAuthFailure('superseded');
    }
    const settings = parseBoundSettings(
      result.value,
      attempt,
      this.configs.registration.projectEnvironmentId,
    );
    if (generation !== this.generation) {
      await this.request('logout', {
        walletId: attempt.walletId,
        sessionToken: attempt.sessionToken,
      });
      return externalAuthFailure('superseded');
    }
    this.state = { kind: 'authenticated', attempt, settings };
    sessionStorage.setItem(this.storageKey(), JSON.stringify(attempt));
    return { ok: true, value: settings.authentication };
  }

  async prepareAssociation(walletId: string): Promise<ExternalAuthResult<ExternalAuthAttempt<'associate'>>> {
    const wallet = parseWalletId(walletId);
    if (!wallet.ok) return externalAuthFailure('invalid_request');
    const previous = this.state;
    const connection = externalConnection(previous);
    const generation = ++this.generation;
    if (previous.kind === 'owner_operation' && previous.approval.kind === 'pending') {
      previous.approval.controller.abort();
    }
    this.state = connection;
    if (previous.kind === 'prepared' || previous.kind === 'owner_operation') {
      await this.request('logout', {
        walletId: previous.attempt.walletId,
        sessionToken: previous.attempt.sessionToken,
      });
    }
    const binding = randomSecret();
    const sessionToken = randomSecret();
    const result = await this.request('prepare-association', { walletId: wallet.value, binding, sessionToken });
    if (generation !== this.generation) return externalAuthFailure('superseded');
    if (result.ok !== true) return parseExternalAuthFailure(result);
    const value = requireRecord(result.value, 'external association attempt');
    const attemptId = requireCanonicalString(value.attemptId, 'attemptId');
    if (typeof value.expiresAtMs !== 'number' || value.walletId !== wallet.value || value.purpose !== 'associate') {
      throw new Error('Invalid external association attempt');
    }
    this.state = {
      kind: 'owner_operation', purpose: 'associate', approval: { kind: 'ready' },
      attempt: { walletId: wallet.value, attemptId, binding, sessionToken },
      connection,
    };
    return {
      ok: true,
      value: { purpose: 'associate', walletId: wallet.value, attemptId, expiresAtMs: value.expiresAtMs },
    };
  }

  async associate(
    input: ExternalAuthenticateInput,
    assertActive: () => void = activeRequest,
  ): Promise<ExternalAuthResult<null>> {
    assertActive();
    if (input.method === 'google') {
      const prepared = await this.prepareAssociation(input.walletId);
      if (!prepared.ok) return prepared;
    }
    const current = this.state;
    if (current.kind !== 'owner_operation' || current.purpose !== 'associate' || current.attempt.walletId !== input.walletId) {
      return externalAuthFailure('access_denied');
    }
    const generation = this.generation;
    let code: string;
    if (input.method === 'google') {
      const exchanged = await this.request('exchange', {
        walletId: input.walletId, attemptId: current.attempt.attemptId, idToken: input.idToken,
      });
      if (exchanged.ok !== true) return parseExternalAuthFailure(exchanged);
      code = requireCanonicalString(requireRecord(exchanged.value, 'association exchange').code, 'code');
    } else {
      if (input.attemptId !== current.attempt.attemptId) return externalAuthFailure('access_denied');
      code = input.code;
    }
    return this.completeOwnerOperation(current.attempt, code, generation, assertActive);
  }

  private assertOwnerOperation(generation: number, attemptId: string, assertActive: () => void): void {
    assertActive();
    if (generation !== this.generation || this.state.kind !== 'owner_operation' || this.state.attempt.attemptId !== attemptId) {
      throw new ExternalOwnerApprovalError('cancelled');
    }
  }

  private async completeOwnerOperation(
    attempt: Attempt,
    code: string,
    generation: number,
    assertActive: () => void,
  ): Promise<ExternalAuthResult<null>> {
    const assertCurrent = this.assertOwnerOperation.bind(
      this,
      generation,
      attempt.attemptId,
      assertActive,
    );
    try {
      assertCurrent();
      const response = await this.request('owner-challenge', {
        walletId: attempt.walletId,
        attemptId: attempt.attemptId,
        binding: attempt.binding,
        sessionToken: attempt.sessionToken,
        code,
      });
      assertCurrent();
      if (response.ok !== true) return parseExternalAuthFailure(response);
      const challenge = parseExternalOwnerChallenge(response.value);
      if (
        this.state.kind !== 'owner_operation' ||
        challenge.kind !== this.state.purpose ||
        challenge.walletId !== attempt.walletId ||
        challenge.attemptId !== attempt.attemptId
      ) {
        return externalAuthFailure('access_denied');
      }
      const controller = new AbortController();
      this.state = {
        kind: 'owner_operation',
        purpose: this.state.purpose,
        attempt,
        connection: this.state.connection,
        approval: { kind: 'pending', controller },
      };
      const factorProof = await this.approveOwner({
        challenge,
        signal: controller.signal,
        assertCurrent,
      });
      assertCurrent();
      if (challenge.expiresAtMs <= Date.now()) return externalAuthFailure('expired');
      const result = await this.submitOwnerOperation(
        challenge.kind,
        {
          walletId: attempt.walletId,
          attemptId: attempt.attemptId,
          binding: attempt.binding,
          sessionToken: attempt.sessionToken,
          code,
          factorProof,
        },
        challenge.expiresAtMs,
        assertCurrent,
      );
      assertCurrent();
      return result.ok === true ? { ok: true, value: null } : parseExternalAuthFailure(result);
    } catch (error) {
      if (generation !== this.generation) return externalAuthFailure('superseded');
      if (error instanceof ExternalOwnerApprovalError) return externalAuthFailure(error.code);
      return externalAuthFailure('unavailable');
    } finally {
      if (
        generation === this.generation &&
        this.state.kind === 'owner_operation' &&
        this.state.attempt.attemptId === attempt.attemptId
      ) {
        const current = this.state;
        if (current.approval.kind === 'pending') current.approval.controller.abort();
        this.state = current.connection;
        try {
          await this.request('logout', {
            walletId: attempt.walletId,
            sessionToken: attempt.sessionToken,
          });
        } catch {}
      }
    }
  }

  private async submitOwnerOperation(
    action: 'associate' | 'unlink',
    body: OwnerOperationSubmission,
    expiresAtMs: number,
    assertCurrent: () => void,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertCurrent();
      if (expiresAtMs <= Date.now()) return externalAuthFailure('expired');
      try {
        const result = await this.request(action, body);
        if (result.ok === true || attempt === 1) return result;
        const failure = parseExternalAuthFailure(result);
        if (failure.code !== 'unavailable') return result;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    return externalAuthFailure('unavailable');
  }

  async captureOwnerOperation(authentication: ExternalWalletAuthentication): Promise<() => void> {
    const session = await this.getSession(String(authentication.walletId));
    if (
      session?.authentication.kind !== 'external_authenticated' ||
      session.authentication.sessionId !== authentication.sessionId ||
      session.authentication.associationId !== authentication.associationId
    ) throw new Error('The external wallet connection changed.');
    return this.assertOwnerOperationCurrent.bind(this, this.generation, authentication);
  }

  private assertOwnerOperationCurrent(generation: number, authentication: ExternalWalletAuthentication): void {
    const connection = externalConnection(this.state);
    if (
      generation !== this.generation ||
      connection.kind !== 'authenticated' ||
      connection.settings.authentication.sessionId !== authentication.sessionId ||
      connection.settings.authentication.expiresAtMs <= Date.now()
    ) throw new Error('The external wallet connection changed or expired.');
  }

  async getSession(walletId?: string): Promise<WalletSession | null> {
    const state = this.state;
    const current = externalConnection(state);
    if (current.kind === 'empty' || (walletId && walletId !== current.attempt.walletId))
      return null;
    const generation = this.generation;
    let result: Record<string, unknown>;
    try {
      result = await this.request('settings', {
        walletId: current.attempt.walletId,
        sessionToken: current.attempt.sessionToken,
      });
    } catch (error) {
      if (generation !== this.generation) return null;
      this.suspendConnection(current.attempt);
      throw error;
    }
    if (generation !== this.generation) return null;
    if (result.ok !== true) {
      const failure = parseExternalAuthFailure(result);
      if (
        failure.code !== 'access_denied' &&
        failure.code !== 'expired' &&
        failure.code !== 'invalid_credential'
      ) {
        this.suspendConnection(current.attempt);
        throw new Error('Wallet authentication is temporarily unavailable. Try again.');
      }
      if (this.state.kind === 'owner_operation') {
        this.state = {
          kind: 'owner_operation',
          purpose: this.state.purpose,
          attempt: this.state.attempt,
          approval: this.state.approval,
          connection: { kind: 'empty' },
        };
        sessionStorage.removeItem(this.storageKey());
      } else {
        await this.lock();
      }
      return null;
    }
    let settings: ExternalWalletSettings;
    try {
      settings = parseBoundSettings(
        result.value,
        current.attempt,
        this.configs.registration.projectEnvironmentId,
      );
    } catch (error) {
      this.suspendConnection(current.attempt);
      throw error;
    }
    const connection: ConnectionState = {
      kind: 'authenticated',
      attempt: current.attempt,
      settings,
    };
    this.state =
      this.state.kind === 'owner_operation'
        ? {
            kind: 'owner_operation',
            purpose: this.state.purpose,
            attempt: this.state.attempt,
            approval: this.state.approval,
            connection,
          }
        : connection;
    return sessionFromSettings(settings);
  }

  private suspendConnection(attempt: Attempt): void {
    if (this.state.kind === 'owner_operation' && this.state.approval.kind === 'pending') {
      this.state.approval.controller.abort();
    }
    this.generation += 1;
    this.state = { kind: 'restoring', attempt };
  }

  async remove(input: {
    walletId: string;
    associationId: string;
  }, assertActive: () => void = activeRequest): Promise<ExternalAuthResult<null>> {
    assertActive();
    const wallet = parseWalletId(input.walletId);
    if (!wallet.ok) return externalAuthFailure('invalid_request');
    const previous = this.state;
    const connection = externalConnection(previous);
    const generation = ++this.generation;
    if (previous.kind === 'owner_operation' && previous.approval.kind === 'pending') previous.approval.controller.abort();
    this.state = connection;
    const binding = randomSecret();
    const sessionToken = randomSecret();
    const response = await this.request('prepare-unlink', {
      walletId: wallet.value, associationId: input.associationId, binding, sessionToken,
    });
    if (generation !== this.generation) return externalAuthFailure('superseded');
    if (response.ok !== true) return parseExternalAuthFailure(response);
    const prepared = requireRecord(response.value, 'association removal attempt');
    const attempt: Attempt = {
      walletId: wallet.value,
      attemptId: requireCanonicalString(prepared.attemptId, 'attemptId'), binding, sessionToken,
    };
    this.state = { kind: 'owner_operation', purpose: 'unlink', attempt, connection, approval: { kind: 'ready' } };
    return this.completeOwnerOperation(attempt, requireCanonicalString(prepared.code, 'code'), generation, assertActive);
  }
}

function randomSecret(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

function activeRequest(): void {}

function parseBoundSettings(
  raw: unknown,
  attempt: Attempt,
  environmentId: string,
): ExternalWalletSettings {
  const settings = parseExternalWalletSettings(raw);
  const authentication = settings.authentication;
  if (
    authentication.walletId !== attempt.walletId ||
    authentication.sessionId !== attempt.attemptId ||
    authentication.environmentId !== environmentId
  ) {
    throw new Error('External settings do not match the requested session');
  }
  return settings;
}

function sessionFromSettings(settings: ExternalWalletSettings): WalletSession {
  let nearAccountId: string | null = null;
  let nearPublicKey: string | null = null;
  let evmAddress: string | null = null;
  let evmPublicKey: string | null = null;
  for (const account of settings.accounts) {
    if (account.family === 'ed25519') {
      nearAccountId = account.address;
      nearPublicKey = account.publicKey;
    } else {
      evmAddress = account.address;
      evmPublicKey = account.publicKey;
    }
  }
  return {
    appIdentity: {
      kind: 'resolved',
      walletId: settings.authentication.walletId,
      nearAccountId: nearAccountId === null ? null : toAccountId(nearAccountId),
      nearOperationalPublicKey: nearPublicKey,
      userData: null,
      authMethods: [],
      thresholdEcdsaEthereumAddress: evmAddress,
      thresholdEcdsaPublicKeyB64u: evmPublicKey,
    },
    authentication: settings.authentication,
    externalSettings: settings,
    capabilityProjection: { kind: 'not_requested' },
    nonceDiagnostics: null,
  };
}
