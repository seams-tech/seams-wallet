import { base64UrlEncode } from '@shared/utils/base64';
import { sha256BytesUtf8, sha256HexUtf8 } from '@shared/utils/digests';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { isPlainObject } from '@shared/utils/validation';
import { authFailure, type AuthFailure } from '../codes';
import { LOGIN_AUDIENCE, webauthnChallengeB64u } from '../proofs/audience';
import { deviceKeyIdOf, deviceKeyProofBytes, verifyDeviceKeySignature } from '../proofs/deviceKey';
import {
  issueLoginToken,
  issueProofStatement,
  issueRemovalNotice,
  type AuthFactor,
  type AuthJwks,
  type AuthMethodKind,
  type TokenSigner,
} from '../proofs/tokens';
import {
  assertionCredentialId,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
  type PasskeyCeremonyScope,
} from '../proofs/webauthn';
import { emailCodeMessage, type AuthLocale, type PurposeText } from './emailText';
import {
  AuthStore,
  type AuthDatabase,
  type AuthMethodRecord,
  type AuthScope,
  type AuthSessionRecord,
  type EmailCodeRecord,
} from './store';

// The operations of the Auth Worker: accounts, methods, login sessions, the proof of a method
// to an audience, and the removal of a method. The Worker holds no custody material. It never
// reads the body of a wallet challenge; to this code an audience and a challenge are text.

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

const CHALLENGE_TTL_MS = 5 * 60_000;
const EMAIL_CODE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const LOGIN_TOKEN_TTL_MS = 10 * 60_000;
const STATEMENT_TTL_MS = 2 * 60_000;
const REMOVAL_NOTICE_TTL_MS = 60_000;
const EMAIL_CODES_PER_ADDRESS_PER_HOUR = 5;
const EMAIL_CODES_PER_SOURCE_PER_HOUR = 20;
const WRONG_CODES_ALLOWED = 5;

/** The audiences of the Auth Worker's own challenges. No operator configuration names them. */
const ADD_METHOD_AUDIENCE = 'auth_add_method';
const REMOVE_METHOD_AUDIENCE = 'auth_remove_method';
const PASSKEY_REGISTRATION_AUDIENCE = 'auth_passkey_registration';

const FACTOR_OF_METHOD = {
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

type Result<Value extends object> = ({ readonly ok: true } & Value) | AuthFailure;

/** The proof of one method, as the account origin sends it. */
export type FactorProof =
  | { readonly factor: 'webauthn'; readonly assertion: unknown }
  | { readonly factor: 'email_code'; readonly codeId: string; readonly code: string }
  | { readonly factor: 'device_key'; readonly methodId: string; readonly signatureB64u: string };

function text(value: unknown, maxLength = 512): string | null {
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

function publicMethod(method: AuthMethodRecord): PublicAuthMethod {
  return {
    id: method.methodId,
    kind: method.kind,
    label: method.email ? maskEmail(method.email) : '',
    createdAtMs: method.createdAtMs,
  };
}

async function digestB64u(value: string): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(value));
}

function newId(prefix: string): string {
  return `${prefix}_${secureRandomBase64Url(16)}`;
}

/** A six-digit code with no bias: each value below 1,000,000 has the same chance. */
function newEmailCode(): string {
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

export class AuthService {
  private readonly store: AuthStore;

  constructor(
    private readonly config: AuthServiceConfig,
    private readonly ports: AuthServicePorts,
    private readonly scope: AuthScope,
  ) {
    this.store = new AuthStore(ports.database, scope);
  }

  private async codeMac(codeId: string, code: string): Promise<string> {
    const { orgId, projectId, envId } = this.scope;
    const message = new TextEncoder().encode(
      `${orgId}\n${projectId}\n${envId}\n${codeId}\n${code}`,
    );
    return base64UrlEncode(await crypto.subtle.sign('HMAC', this.config.codeKey, message));
  }

  private async newChallenge(
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

  private async liveSession(sessionToken: unknown): Promise<AuthSessionRecord | null> {
    const token = text(sessionToken);
    if (!token) return null;
    return await this.store.sessionByTokenHash(await digestB64u(token), this.ports.now());
  }

  private async openSession(accountId: string, method: AuthMethodRecord | null): Promise<SignedIn> {
    const nowMs = this.ports.now();
    const sessionToken = secureRandomBase64Url(32);
    const session: AuthSessionRecord = {
      sessionId: newId('sess'),
      accountId,
      methodId: method?.methodId ?? null,
      methodKind: method?.kind ?? null,
      email: method?.email ?? null,
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

  private async mintLoginToken(
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

  /** The challenge of a sign-in with a passkey or a device key. */
  async startSignIn(): Promise<
    Result<{ challengeId: string; challenge: string; rpId: string; expiresAtMs: number }>
  > {
    await this.store.deleteExpired(this.ports.now());
    const challenge = await this.newChallenge(LOGIN_AUDIENCE);
    return { ok: true, ...challenge, rpId: this.config.passkeys.rpId };
  }

  /**
   * Checks a passkey assertion for an audience and a challenge, and stores the new counter.
   * `ofAccount` limits the check to the methods of one account.
   */
  private async provePasskey(
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

  private async proveDeviceKey(
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
  private async checkEmailCode(
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

  private async proveEmailMethod(
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
  private async proveMethod(
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

  /**
   * Signs a user in. A passkey or a device key answers the challenge of `startSignIn`. An email
   * code signs in to the account of the address, and it makes a new account for a new address.
   */
  async signIn(input: {
    readonly proof: FactorProof;
    readonly challengeId?: string;
    /** Chooses one account when the email address is a method of more than one. */
    readonly accountId?: string;
  }): Promise<
    SignedIn | AuthFailure | (AuthFailure<'account_choice_required'> & { accounts: string[] })
  > {
    if (input.proof.factor === 'email_code')
      return await this.signInWithEmail(input.proof, input.accountId);
    const challenge = input.challengeId
      ? await this.store.takeChallenge(input.challengeId, this.ports.now())
      : null;
    if (!challenge || challenge.audience !== LOGIN_AUDIENCE) {
      return authFailure('challenge_expired_or_invalid');
    }
    const proven = await this.proveMethod(LOGIN_AUDIENCE, challenge.challenge, input.proof);
    if (!proven.ok) return proven;
    return await this.openSession(proven.method.accountId, proven.method);
  }

  private async signInWithEmail(
    proof: Extract<FactorProof, { factor: 'email_code' }>,
    accountId: string | undefined,
  ): Promise<
    SignedIn | AuthFailure | (AuthFailure<'account_choice_required'> & { accounts: string[] })
  > {
    const checked = await this.checkEmailCode(proof, LOGIN_AUDIENCE, null);
    if (!checked.ok) return checked;
    const { record } = checked;
    const methods = await this.store.activeMethodsByIdentifier('email_otp', record.emailHashHex);
    let method: AuthMethodRecord | undefined;
    if (accountId) {
      method = methods.find((candidate) => candidate.accountId === accountId);
      if (!method) return authFailure('forbidden');
    } else if (methods.length > 1) {
      return {
        ...authFailure('account_choice_required'),
        accounts: methods.map((candidate) => candidate.accountId),
      };
    } else {
      method = methods[0];
    }
    if (!(await this.store.takeEmailCode(record.codeId))) {
      return authFailure('challenge_expired_or_invalid');
    }
    if (!method) {
      const created = await this.addEmailMethod(newId('acct'), record);
      if (!created.ok) return created;
      method = created.method;
    }
    return await this.openSession(method.accountId, method);
  }

  private async addEmailMethod(
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

  /**
   * Sends an email code. For a sign-in or a new method, the request names the address. For each
   * other audience it names an email method, and the code goes to the address of that method.
   */
  async sendEmailCode(input: {
    readonly audience: string;
    readonly challenge?: string;
    readonly purpose?: string;
    readonly email?: string;
    readonly methodId?: string;
    readonly sessionToken?: string;
    readonly locale: AuthLocale;
    readonly sourceIp: string;
  }): Promise<Result<{ codeId: string; expiresAtMs: number }>> {
    const nowMs = this.ports.now();
    let email: string | null;
    let methodId: string | null = null;
    let challenge = input.challenge ?? '';
    let purpose: PurposeText | undefined;
    if (input.audience === LOGIN_AUDIENCE) {
      email = normalizeEmail(input.email);
      challenge = secureRandomBase64Url(32);
    } else if (input.audience === ADD_METHOD_AUDIENCE) {
      const session = await this.liveSession(input.sessionToken);
      if (!session) return authFailure('unauthorized');
      email = normalizeEmail(input.email);
      challenge = session.accountId;
    } else {
      const method = input.methodId ? await this.store.methodById(input.methodId) : null;
      if (!method || method.status !== 'active' || method.kind !== 'email_otp') {
        return authFailure('not_found');
      }
      if (input.audience !== REMOVE_METHOD_AUDIENCE) {
        const audience = this.config.audiences[input.audience];
        if (!audience?.statementFactors.includes('email_code')) {
          return authFailure('audience_not_allowed');
        }
        purpose = audience.purposes[input.purpose ?? ''];
        if (input.purpose && !purpose) return authFailure('invalid_body');
      }
      email = method.email;
      methodId = method.methodId;
    }
    if (!email || !challenge) return authFailure('invalid_body');
    const emailHashHex = await sha256HexUtf8(email);
    const sourceHash = input.sourceIp ? await digestB64u(`source\n${input.sourceIp}`) : '';
    const sent = await this.store.emailCodeCounts(emailHashHex, sourceHash, nowMs - 3_600_000);
    if (
      sent.toEmail >= EMAIL_CODES_PER_ADDRESS_PER_HOUR ||
      sent.fromSource >= EMAIL_CODES_PER_SOURCE_PER_HOUR
    ) {
      return authFailure('rate_limited');
    }
    const codeId = newId('code');
    const code = newEmailCode();
    const expiresAtMs = nowMs + EMAIL_CODE_TTL_MS;
    await this.store.putEmailCode(
      {
        codeId,
        email,
        emailHashHex,
        audience: input.audience,
        challenge,
        purpose: purpose ? (input.purpose ?? '') : '',
        methodId,
        codeMac: await this.codeMac(codeId, code),
        expiresAtMs,
      },
      sourceHash,
      nowMs,
    );
    await this.ports.sendEmail({
      to: email,
      ...emailCodeMessage({ appName: this.config.appName, code, locale: input.locale, purpose }),
    });
    return { ok: true, codeId, expiresAtMs };
  }

  /**
   * Proves a method to an audience and returns a signed statement. The server of the audience
   * issued the challenge and checks the statement with the key set of this Worker.
   */
  async prove(input: {
    readonly audience: string;
    readonly challenge: string;
    readonly proof: FactorProof;
  }): Promise<Result<{ statement: string; expiresAtMs: number }>> {
    const audience = this.config.audiences[input.audience];
    if (!audience?.statementFactors.includes(input.proof.factor)) {
      return authFailure('audience_not_allowed');
    }
    const proven = await this.proveMethod(input.audience, input.challenge, input.proof);
    if (!proven.ok) return proven;
    const nowMs = this.ports.now();
    const statement = await issueProofStatement(this.config.signer, {
      issuer: this.config.issuer,
      nowMs,
      ttlMs: STATEMENT_TTL_MS,
      accountId: proven.method.accountId,
      methodId: proven.method.methodId,
      method: proven.method.kind,
      factor: FACTOR_OF_METHOD[proven.method.kind],
      audience: input.audience,
      challenge: input.challenge,
      purpose: proven.purpose || null,
      emailHashHex: proven.method.kind === 'email_otp' ? proven.method.identifier : null,
    });
    return { ok: true, statement, expiresAtMs: nowMs + STATEMENT_TTL_MS };
  }

  /** The account of a login session and its methods. */
  async account(
    sessionToken: unknown,
  ): Promise<Result<{ accountId: string; methods: PublicAuthMethod[] }>> {
    const session = await this.liveSession(sessionToken);
    if (!session) return authFailure('unauthorized');
    const methods = await this.store.activeMethodsOfAccount(session.accountId);
    return { ok: true, accountId: session.accountId, methods: methods.map(publicMethod) };
  }

  /** A new login token for a live session. */
  async loginToken(
    sessionToken: unknown,
  ): Promise<Result<{ loginToken: string; loginTokenExpiresAtMs: number; accountId: string }>> {
    const session = await this.liveSession(sessionToken);
    if (!session) return authFailure('unauthorized');
    const minted = await this.mintLoginToken(session);
    return {
      ok: true,
      loginToken: minted.token,
      loginTokenExpiresAtMs: minted.expiresAtMs,
      accountId: session.accountId,
    };
  }

  async signOut(sessionToken: unknown): Promise<{ ok: true }> {
    const session = await this.liveSession(sessionToken);
    if (session) await this.store.revokeSession(session.sessionId, this.ports.now());
    return { ok: true };
  }

  /**
   * The options of a passkey registration. With a login session, the passkey is a new method
   * of that account. With none, it is the first method of a new account.
   */
  async passkeyOptions(input: {
    readonly sessionToken?: string;
    readonly userName?: string;
  }): Promise<
    Result<{
      challengeId: string;
      expiresAtMs: number;
      rp: { id: string; name: string };
      user: { idB64u: string; name: string };
      challengeB64u: string;
      excludeCredentialIds: string[];
    }>
  > {
    let accountId: string;
    let excludeCredentialIds: string[] = [];
    if (input.sessionToken) {
      const session = await this.liveSession(input.sessionToken);
      if (!session) return authFailure('unauthorized');
      accountId = session.accountId;
      const methods = await this.store.activeMethodsOfAccount(accountId);
      excludeCredentialIds = methods
        .filter((method) => method.kind === 'passkey')
        .map((method) => method.identifier);
    } else {
      accountId = newId('acct');
    }
    const challenge = await this.newChallenge(PASSKEY_REGISTRATION_AUDIENCE, {
      accountId,
      binding: input.sessionToken ? 'add' : 'create',
    });
    return {
      ok: true,
      challengeId: challenge.challengeId,
      expiresAtMs: challenge.expiresAtMs,
      rp: { id: this.config.passkeys.rpId, name: this.config.appName },
      // The user handle is the account ID, as it is the wallet ID for an account from a wallet.
      user: {
        idB64u: base64UrlEncode(new TextEncoder().encode(accountId)),
        name: text(input.userName, 64) ?? this.config.appName,
      },
      challengeB64u: await webauthnChallengeB64u(
        PASSKEY_REGISTRATION_AUDIENCE,
        challenge.challenge,
      ),
      excludeCredentialIds,
    };
  }

  /** Stores a registered passkey. For a new account, it also signs the user in. */
  async registerPasskey(input: {
    readonly challengeId: string;
    readonly registration: unknown;
    readonly sessionToken?: string;
  }): Promise<SignedIn | Result<{ method: PublicAuthMethod }>> {
    const nowMs = this.ports.now();
    const challenge = await this.store.takeChallenge(input.challengeId, nowMs);
    if (!challenge?.accountId || challenge.audience !== PASSKEY_REGISTRATION_AUDIENCE) {
      return authFailure('challenge_expired_or_invalid');
    }
    const session = input.sessionToken ? await this.liveSession(input.sessionToken) : null;
    if ((challenge.binding === 'add') !== Boolean(session)) return authFailure('unauthorized');
    if (session && session.accountId !== challenge.accountId) return authFailure('unauthorized');
    const registered = await verifyPasskeyRegistration({
      registration: input.registration,
      scope: this.config.passkeys,
      expectedChallengeB64u: await webauthnChallengeB64u(
        PASSKEY_REGISTRATION_AUDIENCE,
        challenge.challenge,
      ),
    });
    if (!registered.ok) return registered;
    const method = {
      methodId: newId('passkey'),
      accountId: challenge.accountId,
      kind: 'passkey',
      identifier: registered.credentialIdB64u,
      publicKeyB64u: registered.publicKeyB64u,
      counter: registered.counter,
      rpId: this.config.passkeys.rpId,
      email: null,
    } as const;
    if (!(await this.store.addMethod(method, nowMs))) return authFailure('method_exists');
    const record: AuthMethodRecord = { ...method, status: 'active', createdAtMs: nowMs };
    if (session) return { ok: true, method: publicMethod(record) };
    return await this.openSession(record.accountId, record);
  }

  /** A challenge for a method change of the session's account. */
  async startMethodChange(input: {
    readonly sessionToken: unknown;
    /** The method to remove. With none, the challenge is for a new device key. */
    readonly removeMethodId?: string;
  }): Promise<Result<{ challengeId: string; challenge: string; expiresAtMs: number }>> {
    const session = await this.liveSession(input.sessionToken);
    if (!session) return authFailure('unauthorized');
    const challenge = await this.newChallenge(
      input.removeMethodId ? REMOVE_METHOD_AUDIENCE : ADD_METHOD_AUDIENCE,
      { accountId: session.accountId, binding: input.removeMethodId ?? '' },
    );
    return { ok: true, ...challenge };
  }

  /** Adds an email address to the session's account, after a code proved the address. */
  async addEmail(input: {
    readonly sessionToken: unknown;
    readonly proof: Extract<FactorProof, { factor: 'email_code' }>;
  }): Promise<Result<{ method: PublicAuthMethod }>> {
    const session = await this.liveSession(input.sessionToken);
    if (!session) return authFailure('unauthorized');
    const checked = await this.checkEmailCode(input.proof, ADD_METHOD_AUDIENCE, session.accountId);
    if (!checked.ok) return checked;
    const methods = await this.store.activeMethodsOfAccount(session.accountId);
    if (methods.some((method) => method.identifier === checked.record.emailHashHex)) {
      return authFailure('method_exists');
    }
    if (!(await this.store.takeEmailCode(checked.record.codeId))) {
      return authFailure('challenge_expired_or_invalid');
    }
    const added = await this.addEmailMethod(session.accountId, checked.record);
    return added.ok ? { ok: true, method: publicMethod(added.method) } : added;
  }

  /**
   * Adds a device key (the factor of VoiceID) to the session's account. The device signs the
   * challenge of `startMethodChange`, which proves that it holds the private key.
   */
  async addDeviceKey(input: {
    readonly sessionToken: unknown;
    readonly challengeId: string;
    readonly publicKeyB64u: string;
    readonly signatureB64u: string;
  }): Promise<Result<{ method: PublicAuthMethod }>> {
    const session = await this.liveSession(input.sessionToken);
    if (!session) return authFailure('unauthorized');
    const nowMs = this.ports.now();
    const challenge = await this.store.takeChallenge(input.challengeId, nowMs);
    if (
      !challenge ||
      challenge.audience !== ADD_METHOD_AUDIENCE ||
      challenge.accountId !== session.accountId
    ) {
      return authFailure('challenge_expired_or_invalid');
    }
    let deviceKeyId: string;
    try {
      deviceKeyId = await deviceKeyIdOf(input.publicKeyB64u);
    } catch {
      return authFailure('invalid_body');
    }
    const methodId = newId('voiceid');
    const verified = await verifyDeviceKeySignature({
      publicKeyB64u: input.publicKeyB64u,
      deviceKeyId,
      signatureB64u: input.signatureB64u,
      signedBytes: deviceKeyProofBytes({
        audience: ADD_METHOD_AUDIENCE,
        challenge: challenge.challenge,
        methodId: deviceKeyId,
        deviceKeyId,
      }),
    });
    if (!verified) return authFailure('invalid_proof');
    const method = {
      methodId,
      accountId: session.accountId,
      kind: 'voiceid',
      identifier: deviceKeyId,
      publicKeyB64u: input.publicKeyB64u,
      counter: 0,
      rpId: '',
      email: null,
    } as const;
    if (!(await this.store.addMethod(method, nowMs))) return authFailure('method_exists');
    return { ok: true, method: publicMethod({ ...method, status: 'active', createdAtMs: nowMs }) };
  }

  /** Asks each removal subscriber. A subscriber that does not answer stops the removal. */
  private async askRemovalSubscribers(method: AuthMethodRecord): Promise<AuthFailure | null> {
    for (const subscriberUrl of this.config.removalSubscribers) {
      const notice = await issueRemovalNotice(this.config.signer, {
        issuer: this.config.issuer,
        nowMs: this.ports.now(),
        ttlMs: REMOVAL_NOTICE_TTL_MS,
        subscriberUrl,
        accountId: method.accountId,
        methodId: method.methodId,
        method: method.kind,
        removalId: `removal:${method.methodId}`,
      });
      let status: number;
      let answer: unknown;
      try {
        const response = await this.ports.fetch(subscriberUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notice }),
        });
        status = response.status;
        answer = await response.json();
      } catch {
        return authFailure('removal_unavailable');
      }
      if (status === 200 && isPlainObject(answer) && answer.ok === true) continue;
      return authFailure(status === 409 ? 'removal_refused' : 'removal_unavailable');
    }
    return null;
  }

  /**
   * Removes a method of the session's account. Another method of the account must prove
   * itself for the challenge of `startMethodChange`, and each removal subscriber must agree.
   */
  async removeMethod(input: {
    readonly sessionToken: unknown;
    readonly methodId: string;
    readonly challengeId: string;
    readonly proof: FactorProof;
  }): Promise<Result<{ methods: PublicAuthMethod[] }>> {
    const session = await this.liveSession(input.sessionToken);
    if (!session) return authFailure('unauthorized');
    const nowMs = this.ports.now();
    const challenge = await this.store.takeChallenge(input.challengeId, nowMs);
    if (
      !challenge ||
      challenge.audience !== REMOVE_METHOD_AUDIENCE ||
      challenge.accountId !== session.accountId ||
      challenge.binding !== input.methodId
    ) {
      return authFailure('challenge_expired_or_invalid');
    }
    const methods = await this.store.activeMethodsOfAccount(session.accountId);
    const target = methods.find((method) => method.methodId === input.methodId);
    if (!target) return authFailure('not_found');
    if (methods.length < 2) return authFailure('last_method');
    const proven = await this.proveMethod(REMOVE_METHOD_AUDIENCE, challenge.challenge, input.proof);
    if (!proven.ok) return proven;
    if (
      proven.method.accountId !== session.accountId ||
      proven.method.methodId === target.methodId
    ) {
      return authFailure('forbidden');
    }
    const refusal = await this.askRemovalSubscribers(target);
    if (refusal) return refusal;
    await this.store.revokeMethod(target.methodId, this.ports.now());
    return {
      ok: true,
      methods: methods.filter((method) => method !== target).map(publicMethod),
    };
  }

  jwks(): AuthJwks {
    return this.config.jwks;
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
