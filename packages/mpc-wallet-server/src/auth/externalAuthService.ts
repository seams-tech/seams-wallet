import type {
  ExternalAuthResult,
  ExternalWalletAuthentication,
  ExternalWalletSettings,
  ExternalIdentity,
  ExternalIdentityProof,
  ExternalAuthPurpose,
  ExternalAuthAttempt,
} from '@shared/auth/externalAuth';
import { externalAuthFailure } from '@shared/auth/externalAuth';
import type { WalletId } from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { D1WalletStore } from '../core/d1WalletStore';
import type { WalletAuthMethodV2Store } from '../core/d1WalletAuthMethodStore';
import { verifyGoogleOidcToken } from '../router/cloudflare/d1/oidc/googleOidcToken';
import { ExternalAuthStore, type ExternalAuthTrust } from './externalAuthStore';
import { verifyApplicationAuthAssertion } from './applicationAuth';
import type { Variant } from '@shared/utils/variant';

export class ExternalAuthService {
  constructor(
    readonly store: ExternalAuthStore,
    private readonly wallets: D1WalletStore,
    private readonly methods: WalletAuthMethodV2Store,
  ) {}

  async verifyGoogle(
    trust: Variant<ExternalAuthTrust, 'kind', 'google'>,
    idToken: string,
  ): Promise<
    ExternalAuthResult<{
      identity: ExternalIdentity;
      expiresAtMs: number;
    }>
  > {
    const proof = await verifyGoogleOidcToken(trust.clientId, idToken);
    if (!proof.ok)
      return externalAuthFailure(proof.code === 'expired' ? 'expired' : 'invalid_credential');
    if (
      (proof.audienceCount > 1 && proof.authorizedParty === null) ||
      (proof.authorizedParty !== null && proof.authorizedParty !== trust.clientId)
    )
      return externalAuthFailure('invalid_credential');
    return {
      ok: true,
      value: {
        identity: { provider: 'google', issuer: 'https://accounts.google.com', subject: proof.sub },
        expiresAtMs: proof.expiresAtMs,
      },
    };
  }

  async prepare(input: {
    purpose: ExternalAuthPurpose;
    walletId: WalletId;
    originBinding: string;
    binding: string;
    sessionToken: string;
  }): Promise<ExternalAuthResult<ExternalAuthAttempt<ExternalAuthPurpose>>> {
    const attemptId = crypto.randomUUID();
    const expiresAtMs = Date.now() + 120_000;
    await this.store.prepareAttempt({
      purpose: input.purpose,
      attemptId,
      walletId: input.walletId,
      originBinding: input.originBinding,
      bindingHash: await sha256HexUtf8(input.binding),
      sessionTokenHash: await sha256HexUtf8(input.sessionToken),
      expiresAtMs,
    });
    return { ok: true, value: { purpose: input.purpose, attemptId, walletId: input.walletId, expiresAtMs } };
  }

  async exchange(input: {
    walletId: WalletId;
    attemptId: string;
    proof: ExternalIdentityProof;
    trust: ExternalAuthTrust;
  }): Promise<ExternalAuthResult<{ code: string }>> {
    const purpose = await this.store.readPreparedPurpose(input.walletId, input.attemptId, Date.now());
    if (purpose === null) return externalAuthFailure('access_denied');
    const verified = await this.verifyIdentity({
      trust: input.trust, proof: input.proof, walletId: input.walletId, attemptId: input.attemptId, purpose,
    });
    if (!verified.ok) return verified;
    const code = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const nowMs = Date.now();
    const committed = await this.store.verifyAttempt({
      attemptId: input.attemptId,
      walletId: input.walletId,
      identity: verified.value.identity,
      trust: input.trust,
      codeHash: await sha256HexUtf8(code),
      nowMs,
      sessionExpiresAtMs: Math.min(nowMs + 3_600_000, verified.value.expiresAtMs),
      purpose,
    });
    return committed ? { ok: true, value: { code } } : externalAuthFailure('access_denied');
  }

  async prepareUnlink(input: {
    walletId: WalletId;
    associationId: string;
    originBinding: string;
    binding: string;
    sessionToken: string;
    trustRevision: number;
  }): Promise<ExternalAuthResult<{ attemptId: string; code: string; expiresAtMs: number }>> {
    const attemptId = crypto.randomUUID();
    const code = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAtMs = Date.now() + 120_000;
    const created = await this.store.prepareUnlink({
      walletId: input.walletId,
      associationId: input.associationId,
      attemptId,
      originBinding: input.originBinding,
      bindingHash: await sha256HexUtf8(input.binding),
      sessionTokenHash: await sha256HexUtf8(input.sessionToken),
      codeHash: await sha256HexUtf8(code),
      expiresAtMs,
      trustRevision: input.trustRevision,
    });
    return created ? { ok: true, value: { attemptId, code, expiresAtMs } } : externalAuthFailure('access_denied');
  }

  async verifyIdentity(input: {
    readonly trust: ExternalAuthTrust;
    readonly proof: ExternalIdentityProof;
    readonly walletId: WalletId;
    readonly attemptId: string;
    readonly purpose: ExternalAuthPurpose;
  }): Promise<ExternalAuthResult<{ identity: ExternalIdentity; expiresAtMs: number }>> {
    if (input.trust.kind === 'google' && input.proof.kind === 'google') {
      return this.verifyGoogle(input.trust, input.proof.idToken);
    }
    if (input.trust.kind === 'application' && input.proof.kind === 'application') {
      return verifyApplicationAuthAssertion({
        trust: input.trust,
        assertion: input.proof.assertion,
        environmentId: this.store.scope.envId,
        walletId: input.walletId,
        attemptId: input.attemptId,
        nowMs: Date.now(),
        purpose: input.purpose,
      });
    }
    return externalAuthFailure('invalid_credential');
  }

  async settings(authentication: ExternalWalletAuthentication): Promise<ExternalWalletSettings> {
    const walletId = authentication.walletId;
    const [ed25519, ecdsa, methods, devices] = await Promise.all([
      this.wallets.listEd25519SignersForWallet({ walletId }),
      this.wallets.listEcdsaSignersForWallet({ walletId }),
      this.methods.listForWalletV2({ walletId }),
      this.store.devices(walletId),
    ]);
    const accounts: Array<ExternalWalletSettings['accounts'][number]> = [];
    for (const signer of ed25519) {
      accounts.push({
        family: 'ed25519',
        address: signer.nearAccountId,
        publicKey: signer.publicKey,
      });
    }
    for (const signer of ecdsa) {
      accounts.push({
        family: 'ecdsa',
        address: signer.walletKey.thresholdOwnerAddress,
        publicKey: signer.walletKey.thresholdEcdsaPublicKeyB64u,
      });
    }
    const summaries: Array<ExternalWalletSettings['methods'][number]> = [];
    for (const method of methods) {
      if (method.status === 'active')
        summaries.push({ id: method.walletAuthMethodId, kind: method.kind });
    }
    return { authentication, accounts, methods: summaries, devices };
  }
}
