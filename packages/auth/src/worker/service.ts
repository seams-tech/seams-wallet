import { sha256HexUtf8 } from '@shared/utils/digests';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { authFailure, type AuthFailure } from '../codes';
import { LOGIN_AUDIENCE } from '../proofs/audience';
import { issueProofStatement } from '../proofs/tokens';
import {
  ADD_METHOD_AUDIENCE,
  EMAIL_CODES_PER_ADDRESS_PER_HOUR,
  EMAIL_CODES_PER_SOURCE_PER_HOUR,
  EMAIL_CODE_TTL_MS,
  FACTOR_OF_METHOD,
  REMOVE_METHOD_AUDIENCE,
  STATEMENT_TTL_MS,
  digestB64u,
  newEmailCode,
  newId,
  normalizeEmail,
  publicMethod,
  type FactorProof,
  type IdentityProof,
  type PublicAuthMethod,
  type Result,
  type SignedIn,
} from './core';
import { emailCodeMessage, type AuthLocale, type PurposeText } from './emailText';
import { verifyGoogleIdToken, verifyLoginHandoff, type ExternalIdentity } from './identities';
import { AuthMethodChanges } from './methodChanges';
import type { AuthMethodRecord } from './store';

// The sign-in operations of the Auth Worker, the proof of a method to an audience, and the
// login session. `core.ts` holds the checks that these operations share.

export class AuthService extends AuthMethodChanges {
  /** The challenge of a sign-in with a passkey or a device key. */
  async startSignIn(): Promise<
    Result<{ challengeId: string; challenge: string; rpId: string; expiresAtMs: number }>
  > {
    await this.store.deleteExpired(this.ports.now());
    const challenge = await this.newChallenge(LOGIN_AUDIENCE);
    return { ok: true, ...challenge, rpId: this.config.passkeys.rpId };
  }

  /**
   * Signs a user in. A passkey or a device key answers the challenge of `startSignIn`. An email
   * code signs in to the account of the address, and it makes a new account for a new address.
   */
  async signIn(input: {
    readonly proof: FactorProof | IdentityProof;
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
    if (input.proof.factor === 'identity') {
      return await this.signInWithIdentity(input.proof, challenge.challenge);
    }
    const proven = await this.proveMethod(LOGIN_AUDIENCE, challenge.challenge, input.proof);
    if (!proven.ok) return proven;
    return await this.openSession(proven.method.accountId, proven.method);
  }

  /**
   * Signs in with a credential of the login provider that the operator trusts for this
   * environment. A new identity gets a new account with no method.
   */
  private async signInWithIdentity(
    proof: IdentityProof,
    challenge: string,
  ): Promise<SignedIn | AuthFailure> {
    const trust = this.context.identityTrust;
    const nowMs = this.ports.now();
    let identity: ExternalIdentity | null = null;
    if (trust.kind === 'application' && proof.provider === 'application') {
      identity = await verifyLoginHandoff({
        trust,
        assertion: proof.credential,
        environmentId: this.context.environmentId,
        challenge,
        nowMs,
      });
    } else if (trust.kind === 'google' && proof.provider === 'google') {
      identity = await verifyGoogleIdToken({
        trust,
        idToken: proof.credential,
        challenge,
        nowMs,
        fetch: this.ports.fetch,
      });
    } else {
      return authFailure('not_configured');
    }
    if (!identity) return authFailure('invalid_proof');
    let accountId = await this.store.accountOfIdentity(identity);
    if (!accountId) {
      accountId = newId('acct');
      await this.store.linkIdentity(identity, accountId, nowMs);
      accountId = (await this.store.accountOfIdentity(identity)) ?? accountId;
    }
    return await this.openSession(accountId, null, {
      provider: identity.provider,
      trustRevision: trust.revision,
    });
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
}
