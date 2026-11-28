import { base64UrlEncode } from '@shared/utils/base64';
import { sha256BytesUtf8 } from '@shared/utils/digests';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { isPlainObject } from '@shared/utils/validation';
import { authFailure, type AuthFailure } from '../codes';
import { webauthnChallengeB64u } from '../proofs/audience';
import { deviceKeyProofBytes, verifyDeviceKeySignature } from '../proofs/deviceKey';
import {
  issueLoginToken,
  type AuthFactor,
  type AuthJwks,
  type AuthMethodKind,
  type TokenSigner,
} from '../proofs/tokens';
import {
  assertionCredentialId,
  verifyPasskeyAssertion,
  type PasskeyCeremonyScope,
} from '../proofs/webauthn';
import type { PurposeText } from './emailText';
import type { IdentityTrust } from './identities';
import {
  AuthStore,
  type AuthDatabase,
  type AuthMethodRecord,
  type AuthScope,
  type AuthSessionRecord,
  type EmailCodeRecord,
} from './store';

// The configuration of the Auth Worker and the checks that its operations share: the login
// session, the challenge, and the proof of a method for an audience. The Worker holds no custody
// material. It never reads the body of a wallet challenge; to this code an audience and a
// challenge are text.

/** What the operator allows for one audience other than `login`. */
export type AuthAudienceConfig = {
  /**
   * The factors for which the Auth Worker signs a statement. A server that pins the key of a
   * method checks a passkey or a device key itself, so its audience lists `email_code` only.
   */
  readonly statementFactors: readonly AuthFactor[];
  /** The purposes that a request can name, with the text that the email shows for each one. */
  readonly purposes: Readonly<Record<string, PurposeText>>;
};

export type AuthServiceConfig = {
  /** The public URL of the Auth Worker: the `iss` of each token, and the base of its JWKS. */
  readonly issuer: string;
  readonly appName: string;
  readonly passkeys: PasskeyCeremonyScope;
  readonly signer: TokenSigner;
  /** The public keys that a verifier accepts: the signer's key and the keys of older tokens. */
  readonly jwks: AuthJwks;
  /** An HMAC key for the stored form of an email code. */
  readonly codeKey: CryptoKey;
  readonly audiences: Readonly<Record<string, AuthAudienceConfig>>;
  /** Each URL gets a notice before a method is removed, and each one must agree. */
  readonly removalSubscribers: readonly string[];
};

export type AuthServicePorts = {
  readonly database: AuthDatabase;
  sendEmail(message: { to: string; subject: string; text: string }): Promise<void>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  now(): number;
};

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const EMAIL_CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const LOGIN_TOKEN_TTL_MS = 10 * 60_000;
export const STATEMENT_TTL_MS = 2 * 60_000;
export const REMOVAL_NOTICE_TTL_MS = 60_000;
export const EMAIL_CODES_PER_ADDRESS_PER_HOUR = 5;
export const EMAIL_CODES_PER_SOURCE_PER_HOUR = 20;
const WRONG_CODES_ALLOWED = 5;

/** The audiences of the Auth Worker's own challenges. No operator configuration names them. */
export const ADD_METHOD_AUDIENCE = 'auth_add_method';
export const REMOVE_METHOD_AUDIENCE = 'auth_remove_method';
export const PASSKEY_REGISTRATION_AUDIENCE = 'auth_passkey_registration';

export const FACTOR_OF_METHOD = {
  passkey: 'webauthn',
  email_otp: 'email_code',
  voiceid: 'device_key',
} as const satisfies Record<AuthMethodKind, AuthFactor>;

/** A method as the account origin sees it: no key, and the email address in a masked form. */
export type PublicAuthMethod = {
  readonly id: string;
  readonly kind: AuthMethodKind;
  readonly label: string;
  readonly createdAtMs: number;
};

export type SignedIn = {
  readonly ok: true;
  /** The secret of the login session. It stays in the account origin. */
  readonly sessionToken: string;
  readonly sessionExpiresAtMs: number;
  readonly accountId: string;
  readonly methods: readonly PublicAuthMethod[];
  /** The short-lived token that the app page gives to its backend. */
  readonly loginToken: string;
  readonly loginTokenExpiresAtMs: number;
};

export type Result<Value extends object> = ({ readonly ok: true } & Value) | AuthFailure;

/** The proof of one method, as the account origin sends it. */
export type FactorProof =
  | { readonly factor: 'webauthn'; readonly assertion: unknown }
  | { readonly factor: 'email_code'; readonly codeId: string; readonly code: string }
  | { readonly factor: 'device_key'; readonly methodId: string; readonly signatureB64u: string };

/** A credential of another login provider: a Google ID token or a login handoff. */
export type IdentityProof = {
  readonly factor: 'identity';
  readonly provider: 'google' | 'application';
  readonly credential: string;
};

export function parseIdentityProof(value: unknown): IdentityProof | null {
  if (!isPlainObject(value) || value.factor !== 'identity') return null;
  const credential = text(value.credential, 8192);
  if (!credential || (value.provider !== 'google' && value.provider !== 'application')) {
    return null;
  }
  return { factor: 'identity', provider: value.provider, credential };
}

export function text(value: unknown, maxLength = 512): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

export function parseFactorProof(value: unknown): FactorProof | null {
  if (!isPlainObject(value)) return null;
  switch (value.factor) {
    case 'webauthn':
      return isPlainObject(value.assertion)
        ? { factor: 'webauthn', assertion: value.assertion }
        : null;
    case 'email_code': {
      const codeId = text(value.codeId);
      const code = typeof value.code === 'string' ? value.code.trim() : '';
      return codeId && /^[0-9]{6}$/.test(code) ? { factor: 'email_code', codeId, code } : null;
    }
    case 'device_key': {
      const methodId = text(value.methodId);
      const signatureB64u = text(value.signatureB64u);
      return methodId && signatureB64u ? { factor: 'device_key', methodId, signatureB64u } : null;
    }
    default:
      return null;
  }
}

export function normalizeEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** `a•••@example.com`: enough for the owner to know the address, and not the address. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

export function publicMethod(method: AuthMethodRecord): PublicAuthMethod {
  return {
    id: method.methodId,
    kind: method.kind,
    label: method.email ? maskEmail(method.email) : '',
    createdAtMs: method.createdAtMs,
  };
}

export async function digestB64u(value: string): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(value));
}

export function newId(prefix: string): string {
  return `${prefix}_${secureRandomBase64Url(16)}`;
}

/** A six-digit code with no bias: each value below 1,000,000 has the same chance. */
export function newEmailCode(): string {
  const limit = 4_294_000_000;
  for (;;) {
    const [value = limit] = crypto.getRandomValues(new Uint32Array(1));
    if (value < limit) return String(value % 1_000_000).padStart(6, '0');
  }
}

function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** What the checked publishable key says about the project environment of a request. */
export type AuthRequestContext = {
  readonly scope: AuthScope;
  /** The ID of the environment, as the app's configuration names it. */
  readonly environmentId: string;
  readonly identityTrust: IdentityTrust;
};

export class AuthCore {
  protected readonly store: AuthStore;
  protected readonly scope: AuthScope;

  constructor(
    protected readonly config: AuthServiceConfig,
    protected readonly ports: AuthServicePorts,
    protected readonly context: AuthRequestContext,
  ) {
    this.scope = context.scope;
    this.store = new AuthStore(ports.database, context.scope);
  }

  protected async codeMac(codeId: string, code: string): Promise<string> {
    const { orgId, projectId, envId } = this.scope;
    const message = new TextEncoder().encode(
      `${orgId}\n${projectId}\n${envId}\n${codeId}\n${code}`,
    );
    return base64UrlEncode(await crypto.subtle.sign('HMAC', this.config.codeKey, message));
  }

  protected async newChallenge(
    audience: string,
    bound: { accountId?: string; binding?: string } = {},
  ): Promise<{ challengeId: string; challenge: string; expiresAtMs: number }> {
    const challenge = {
      challengeId: newId('chal'),
      audience,
      challenge: secureRandomBase64Url(32),
      accountId: bound.accountId ?? null,
      binding: bound.binding ?? '',
      expiresAtMs: this.ports.now() + CHALLENGE_TTL_MS,
    };
    await this.store.putChallenge(challenge);
    return {
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      expiresAtMs: challenge.expiresAtMs,
    };
  }

  protected async liveSession(sessionToken: unknown): Promise<AuthSessionRecord | null> {
    const token = text(sessionToken);
    if (!token) return null;
    const session = await this.store.sessionByTokenHash(await digestB64u(token), this.ports.now());
    if (!session?.identity) return session;
    // A session from another login provider ends when the operator changes the trust.
    const trust = this.context.identityTrust;
    return session.identity.provider === trust.kind &&
      session.identity.trustRevision === trust.revision
      ? session
      : null;
  }

  protected async openSession(
    accountId: string,
    method: AuthMethodRecord | null,
    identity: AuthSessionRecord['identity'] = null,
  ): Promise<SignedIn> {
    const nowMs = this.ports.now();
    const sessionToken = secureRandomBase64Url(32);
    const session: AuthSessionRecord = {
      sessionId: newId('sess'),
      accountId,
      methodId: method?.methodId ?? null,
      methodKind: method?.kind ?? null,
      email: method?.email ?? null,
      identity,
      expiresAtMs: nowMs + SESSION_TTL_MS,
    };
    await this.store.putSession({ ...session, tokenHash: await digestB64u(sessionToken) }, nowMs);
    const loginToken = await this.mintLoginToken(session);
    return {
      ok: true,
      sessionToken,
      sessionExpiresAtMs: session.expiresAtMs,
      accountId,
      methods: (await this.store.activeMethodsOfAccount(accountId)).map(publicMethod),
      loginToken: loginToken.token,
      loginTokenExpiresAtMs: loginToken.expiresAtMs,
    };
  }

  protected async mintLoginToken(
    session: AuthSessionRecord,
  ): Promise<{ token: string; expiresAtMs: number }> {
    const nowMs = this.ports.now();
    return await issueLoginToken(this.config.signer, {
      issuer: this.config.issuer,
      nowMs,
      ttlMs: Math.min(LOGIN_TOKEN_TTL_MS, session.expiresAtMs - nowMs),
      accountId: session.accountId,
      projectId: this.scope.projectId,
      envId: this.scope.envId,
      sessionId: session.sessionId,
      method: session.methodKind,
      email: session.email,
    });
  }

  /**
   * Checks a passkey assertion for an audience and a challenge, and stores the new counter.
   * `ofAccount` limits the check to the methods of one account.
   */
  protected async provePasskey(
    audience: string,
    challenge: string,
    assertion: unknown,
  ): Promise<Result<{ method: AuthMethodRecord }>> {
    const credentialId = assertionCredentialId(assertion);
    if (!credentialId) return authFailure('invalid_body');
    const [method] = await this.store.activeMethodsByIdentifier('passkey', credentialId);
    if (!method?.publicKeyB64u) return authFailure('unknown_credential');
    const verified = await verifyPasskeyAssertion({
      assertion,
      scope: { rpId: method.rpId, origins: this.config.passkeys.origins },
      expectedChallengeB64u: await webauthnChallengeB64u(audience, challenge),
      key: {
        credentialIdB64u: method.identifier,
        publicKeyB64u: method.publicKeyB64u,
        counter: method.counter,
      },
    });
    if (!verified.ok) return verified;
    await this.store.advanceCounter(method.methodId, verified.newCounter, this.ports.now());
    return { ok: true, method };
  }

  protected async proveDeviceKey(
    audience: string,
    challenge: string,
    proof: Extract<FactorProof, { factor: 'device_key' }>,
  ): Promise<Result<{ method: AuthMethodRecord }>> {
    const method = await this.store.methodById(proof.methodId);
    if (!method || method.status !== 'active' || method.kind !== 'voiceid') {
      return authFailure('unknown_credential');
    }
    const verified = await verifyDeviceKeySignature({
      publicKeyB64u: method.publicKeyB64u ?? '',
      deviceKeyId: method.identifier,
      signatureB64u: proof.signatureB64u,
      signedBytes: deviceKeyProofBytes({
        audience,
        challenge,
        methodId: method.methodId,
        deviceKeyId: method.identifier,
      }),
    });
    return verified ? { ok: true, method } : authFailure('invalid_proof');
  }

  /**
   * Checks an email code. A wrong code counts, and the code is locked after the allowed number.
   * A correct code stays until `takeEmailCode` uses it, so one more request can name an account.
   */
  protected async checkEmailCode(
    proof: Extract<FactorProof, { factor: 'email_code' }>,
    audience: string,
    challenge: string | null,
  ): Promise<Result<{ record: EmailCodeRecord }>> {
    const record = await this.store.emailCode(proof.codeId);
    if (
      !record ||
      record.expiresAtMs <= this.ports.now() ||
      record.audience !== audience ||
      (challenge !== null && record.challenge !== challenge)
    ) {
      return authFailure('challenge_expired_or_invalid');
    }
    if (record.attempts >= WRONG_CODES_ALLOWED) return authFailure('email_code_locked');
    if (!sameText(await this.codeMac(record.codeId, proof.code), record.codeMac)) {
      const attempts = await this.store.countWrongEmailCode(record.codeId);
      return authFailure(
        attempts >= WRONG_CODES_ALLOWED ? 'email_code_locked' : 'email_code_invalid',
      );
    }
    await this.store.markEmailCodeVerified(record.codeId, this.ports.now());
    return { ok: true, record };
  }

  protected async proveEmailMethod(
    proof: Extract<FactorProof, { factor: 'email_code' }>,
    audience: string,
    challenge: string,
  ): Promise<Result<{ method: AuthMethodRecord; purpose: string }>> {
    const checked = await this.checkEmailCode(proof, audience, challenge);
    if (!checked.ok) return checked;
    const method = checked.record.methodId
      ? await this.store.methodById(checked.record.methodId)
      : null;
    if (!method || method.status !== 'active' || method.kind !== 'email_otp') {
      return authFailure('unknown_credential');
    }
    if (!(await this.store.takeEmailCode(checked.record.codeId))) {
      return authFailure('challenge_expired_or_invalid');
    }
    return { ok: true, method, purpose: checked.record.purpose };
  }

  /** The proof of an existing method for an audience and a challenge. */
  protected async proveMethod(
    audience: string,
    challenge: string,
    proof: FactorProof,
  ): Promise<Result<{ method: AuthMethodRecord; purpose: string }>> {
    switch (proof.factor) {
      case 'webauthn': {
        const proven = await this.provePasskey(audience, challenge, proof.assertion);
        return proven.ok ? { ...proven, purpose: '' } : proven;
      }
      case 'device_key': {
        const proven = await this.proveDeviceKey(audience, challenge, proof);
        return proven.ok ? { ...proven, purpose: '' } : proven;
      }
      case 'email_code':
        return await this.proveEmailMethod(proof, audience, challenge);
    }
  }

  protected async addEmailMethod(
    accountId: string,
    record: EmailCodeRecord,
  ): Promise<Result<{ method: AuthMethodRecord }>> {
    const nowMs = this.ports.now();
    const method = {
      methodId: newId('email'),
      accountId,
      kind: 'email_otp',
      identifier: record.emailHashHex,
      publicKeyB64u: null,
      counter: 0,
      rpId: '',
      email: record.email,
    } as const;
    if (!(await this.store.addMethod(method, nowMs))) return authFailure('method_exists');
    return { ok: true, method: { ...method, status: 'active', createdAtMs: nowMs } };
  }
}

/** Imports the secret of the email codes as an HMAC key. */
export async function importCodeKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('The email code secret must have 32 characters or more');
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}
