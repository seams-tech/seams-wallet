import { toAccountId } from '@/core/types/accountIds';
import type { SeamsConfigsReadonly, WalletSession } from '@/core/types/seams';
import { base64UrlEncode } from '@shared/utils/base64';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { parseWalletId } from '@shared/utils/domainIds';
import {
  EXTERNAL_AUTH_PATH,
  externalAuthFailure,
  parseExternalWalletSettings,
  parseExternalAuthFailure,
  type ExternalAuthenticateInput,
  type ExternalAuthAttempt,
  type ExternalAuthResult,
  type ExternalWalletAuthentication,
  type ExternalWalletSettings,
} from '@shared/auth/externalAuth';
import type { WalletHostOwnerAuthoritiesV1 } from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';

type Attempt = { walletId: string; attemptId: string; binding: string; sessionToken: string };
type State =
  | { kind: 'empty' }
  | { kind: 'prepared'; attempt: Attempt }
  | { kind: 'restoring'; attempt: Attempt }
  | { kind: 'authenticated'; attempt: Attempt; settings: ExternalWalletSettings };

export class HostedExternalAuth {
  private state: State = { kind: 'empty' };
  private generation = 0;

  constructor(
    private readonly configs: SeamsConfigsReadonly,
    private readonly lockOwner: () => Promise<void>,
    private readonly readOwnerCredential: WalletHostOwnerAuthoritiesV1['readOwnerCredential'],
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
      },
    );
    return requireRecord(await response.json(), 'external authentication response');
  }

  async lock(): Promise<void> {
    const previous = this.state;
    this.generation += 1;
    this.state = { kind: 'empty' };
    sessionStorage.removeItem(this.storageKey());
    if (previous.kind !== 'empty') {
      await this.request('logout', {
        walletId: previous.attempt.walletId,
        sessionToken: previous.attempt.sessionToken,
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
    if (typeof value.expiresAtMs !== 'number' || value.walletId !== parsed.value)
      throw new Error('Invalid attempt');
    const attempt = { walletId: parsed.value, attemptId, binding, sessionToken };
    this.state = { kind: 'prepared', attempt };
    return {
      ok: true,
      value: { walletId: parsed.value, attemptId, expiresAtMs: value.expiresAtMs },
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

  async associate(input: { walletId: string; idToken: string }): Promise<ExternalAuthResult<null>> {
    const wallet = parseWalletId(input.walletId);
    if (!wallet.ok) return externalAuthFailure('invalid_request');
    const owner = await this.readOwnerCredential(wallet.value);
    const result = await this.request('associate', {
      walletId: input.walletId,
      idToken: input.idToken,
      ownerCredential: owner.token,
    });
    return result.ok === true ? { ok: true, value: null } : externalAuthFailure('access_denied');
  }

  async getSession(walletId?: string): Promise<WalletSession | null> {
    const current = this.state;
    if (
      current.kind === 'empty' ||
      current.kind === 'prepared' ||
      (walletId && walletId !== current.attempt.walletId)
    )
      return null;
    const generation = this.generation;
    const result = await this.request('settings', {
      walletId: current.attempt.walletId,
      sessionToken: current.attempt.sessionToken,
    });
    if (generation !== this.generation) return null;
    if (result.ok !== true) {
      await this.lock();
      return null;
    }
    const settings = parseBoundSettings(
      result.value,
      current.attempt,
      this.configs.registration.projectEnvironmentId,
    );
    this.state = { kind: 'authenticated', attempt: current.attempt, settings };
    return sessionFromSettings(settings);
  }

  async remove(input: {
    walletId: string;
    associationId: string;
  }): Promise<ExternalAuthResult<null>> {
    const wallet = parseWalletId(input.walletId);
    if (!wallet.ok) return externalAuthFailure('invalid_request');
    const owner = await this.readOwnerCredential(wallet.value);
    const result = await this.request('unlink', {
      walletId: wallet.value,
      associationId: input.associationId,
      ownerCredential: owner.token,
    });
    return result.ok === true ? { ok: true, value: null } : externalAuthFailure('access_denied');
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
