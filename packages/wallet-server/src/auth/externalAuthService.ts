import type {
  ExternalAuthResult,
  ExternalWalletAuthentication,
  ExternalWalletSettings,
} from '@shared/auth/externalAuth';
import { externalAuthFailure } from '@shared/auth/externalAuth';
import type { WalletId } from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256HexUtf8 } from '@shared/utils/digests';
import type { D1WalletStore } from '../core/d1WalletStore';
import type { WalletAuthMethodV2Store } from '../core/d1WalletAuthMethodStore';
import { verifyGoogleOidcToken } from '../router/cloudflare/d1/oidc/googleOidcToken';
import { ExternalAuthStore, type ExternalAuthTrust } from './externalAuthStore';

export class ExternalAuthService {
  constructor(
    readonly store: ExternalAuthStore,
    private readonly wallets: D1WalletStore,
    private readonly methods: WalletAuthMethodV2Store,
  ) {}

  async verifyGoogle(
    trust: ExternalAuthTrust,
    idToken: string,
  ): Promise<
    ExternalAuthResult<{
      subject: string;
      expiresAtMs: number;
      trust: ExternalAuthTrust;
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
    return { ok: true, value: { subject: proof.sub, expiresAtMs: proof.expiresAtMs, trust } };
  }

  async prepare(input: {
    walletId: WalletId;
    originBinding: string;
    binding: string;
    sessionToken: string;
  }): Promise<ExternalAuthResult<{ attemptId: string; walletId: WalletId; expiresAtMs: number }>> {
    const attemptId = crypto.randomUUID();
    const expiresAtMs = Date.now() + 120_000;
    await this.store.prepareAttempt({
      attemptId,
      walletId: input.walletId,
      originBinding: input.originBinding,
      bindingHash: await sha256HexUtf8(input.binding),
      sessionTokenHash: await sha256HexUtf8(input.sessionToken),
      expiresAtMs,
    });
    return { ok: true, value: { attemptId, walletId: input.walletId, expiresAtMs } };
  }

  async exchange(input: {
    walletId: WalletId;
    attemptId: string;
    idToken: string;
    trust: ExternalAuthTrust;
  }): Promise<ExternalAuthResult<{ code: string }>> {
    const verified = await this.verifyGoogle(input.trust, input.idToken);
    if (!verified.ok) return verified;
    const code = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const nowMs = Date.now();
    const committed = await this.store.verifyAttempt({
      attemptId: input.attemptId,
      walletId: input.walletId,
      subject: verified.value.subject,
      trust: verified.value.trust,
      codeHash: await sha256HexUtf8(code),
      nowMs,
      sessionExpiresAtMs: Math.min(nowMs + 3_600_000, verified.value.expiresAtMs),
    });
    return committed ? { ok: true, value: { code } } : externalAuthFailure('access_denied');
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
