import { base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import { authFailure, type AuthFailure } from '../codes';
import { webauthnChallengeB64u } from '../proofs/audience';
import { deviceKeyIdOf, deviceKeyProofBytes, verifyDeviceKeySignature } from '../proofs/deviceKey';
import { issueRemovalNotice } from '../proofs/tokens';
import { verifyPasskeyRegistration } from '../proofs/webauthn';
import {
  ADD_METHOD_AUDIENCE,
  AuthCore,
  PASSKEY_REGISTRATION_AUDIENCE,
  REMOVAL_NOTICE_TTL_MS,
  REMOVE_METHOD_AUDIENCE,
  newId,
  publicMethod,
  text,
  type FactorProof,
  type PublicAuthMethod,
  type Result,
  type SignedIn,
} from './core';
import type { AuthMethodRecord } from './store';

// The changes of the methods of an account: a new passkey, a new email address, a new device
// key, and the removal of a method. A removal waits for each removal subscriber.

export class AuthMethodChanges extends AuthCore {
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
}
