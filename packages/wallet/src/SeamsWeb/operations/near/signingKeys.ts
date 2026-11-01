import type { SeamsWebPublicApi } from '@/SeamsWeb/publicApi/createPublicApi';
import type { AddedMlDsaSignerCapability, SeamsConfigsReadonly } from '@/core/types/seams';
import type { NearSignerPreference } from '@/core/types/nearSigningKeys';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { MinimalNearClient } from '@/core/rpcClients/near/NearClient';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { resolveWalletRpId } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { MlDsaSignerInventoryEntry } from '@shared/near/mlDsaInventory';
import type { MlDsaSigningFailure } from '@shared/near/mlDsaSigning';
import type { MlDsaNearEnrollmentOutcome } from '@/core/signingEngine/walletCustody/mlDsaEnrollment';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

type Wallet = Pick<SeamsWebPublicApi, 'near' | 'registration' | 'keys'>;
export type MlDsaSigningKeyRow = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'published';
      readonly signer: AddedMlDsaSignerCapability;
      readonly enrollment: MlDsaNearEnrollmentOutcome;
    }
  | {
      readonly kind: 'pending';
      readonly entry: Exclude<MlDsaSignerInventoryEntry, { readonly kind: 'published' }>;
    }
>;
export type NearSigningKeysSnapshot = {
  readonly rows: readonly MlDsaSigningKeyRow[];
  readonly preference: NearSignerPreference;
};
export type NearSigningKeysRead = ReadonlyExclusiveUnion<
  | { readonly kind: 'ready'; readonly snapshot: NearSigningKeysSnapshot }
  | { readonly kind: 'refused'; readonly failure: MlDsaSigningFailure }
>;
export type NearSigningKeyCreation = ReadonlyExclusiveUnion<
  | { readonly kind: 'unsupported_network' }
  | { readonly kind: 'registration_failed'; readonly message: string }
  | { readonly kind: 'created' }
>;
type Target = {
  readonly wallet: Wallet;
  readonly configs: SeamsConfigsReadonly;
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
};
type ExportOptions = Parameters<Wallet['keys']['exportKey']>[0]['options'];
type CreationOptions = Parameters<Wallet['registration']['addSigner']>[0]['options'];

/** Shared application lifecycle for settings and headless clients. No UI state or secrets. */
export class NearSigningKeysLifecycle {
  private readonly nearClient: MinimalNearClient;
  constructor(private readonly target: Target) {
    this.nearClient = new MinimalNearClient(
      resolvePrimaryNearRpcUrl(target.configs.network.chains),
    );
  }
  async read(): Promise<NearSigningKeysRead> {
    const { wallet, walletSession, nearAccount } = this.target;
    const [inventory, preference] = await Promise.all([
      wallet.near.getMlDsaSigners({ walletSession }),
      wallet.near.getDefaultSigner({ walletSession, nearAccount }),
    ]);
    if (inventory.kind !== 'inventory') return { kind: 'refused', failure: inventory };
    const rows: MlDsaSigningKeyRow[] = [];
    for (const entry of inventory.entries) {
      if (entry.kind !== 'published') {
        rows.push({ kind: 'pending', entry });
        continue;
      }
      const signer = publishedSigner(entry);
      const { resumeMlDsaNearEnrollment } =
        await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
      const enrollment = await resumeMlDsaNearEnrollment({
        nearClient: this.nearClient,
        continuation: {
          kind: 'awaiting_chain',
          request: {
            walletSession,
            nearAccount,
            publication: { walletId: walletSession.walletId, signer },
          },
        },
      });
      rows.push({ kind: 'published', signer, enrollment });
    }
    return { kind: 'ready', snapshot: { rows, preference } };
  }
  async create(options?: CreationOptions): Promise<NearSigningKeyCreation> {
    const { supportsMlDsaNearNetwork } =
      await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
    if (!(await supportsMlDsaNearNetwork(this.nearClient)))
      return { kind: 'unsupported_network' } as const;
    const { publishMlDsaNearSigner } = await import('../registration/mlDsaNearSigner');
    const { wallet, walletSession, configs } = this.target;
    const result = await publishMlDsaNearSigner({
      wallet,
      walletSession,
      rpId: resolveWalletRpId(configs),
      signerSlot: 1,
      options,
    });
    if (result.kind === 'registration_failed') return result;
    return { kind: 'created' } as const;
  }
  async activate(signer: AddedMlDsaSignerCapability): Promise<MlDsaNearEnrollmentOutcome> {
    const { enrollMlDsaNearSigner } =
      await import('@/core/signingEngine/walletCustody/mlDsaEnrollment');
    const { wallet, walletSession, nearAccount } = this.target;
    return enrollMlDsaNearSigner({
      near: wallet.near,
      nearClient: this.nearClient,
      walletSession,
      nearAccount,
      publication: { walletId: walletSession.walletId, signer },
    });
  }
  async setDefault(preference: NearSignerPreference): Promise<void> {
    const { wallet, walletSession, nearAccount } = this.target;
    await wallet.near.setDefaultSigner({ walletSession, nearAccount, preference });
  }
  async exportEd25519(options: ExportOptions): Promise<void> {
    const { wallet, walletSession, nearAccount } = this.target;
    await wallet.keys.exportKey({ kind: 'ed25519', walletSession, nearAccount, options });
  }
  async exportMlDsa(signer: AddedMlDsaSignerCapability, options: ExportOptions): Promise<void> {
    const { wallet, walletSession, nearAccount } = this.target;
    await wallet.keys.exportKey({ kind: 'ml_dsa_65', walletSession, nearAccount, signer, options });
  }
}

function publishedSigner(
  entry: Extract<MlDsaSignerInventoryEntry, { readonly kind: 'published' }>,
): AddedMlDsaSignerCapability {
  return {
    kind: 'near_ml_dsa_65',
    signingKeyId: entry.key.signingKeyId,
    publicKeyB64u: entry.key.publicKeyB64u,
    keyManifestDigestB64u: entry.key.keyManifestDigestB64u,
    materialEpoch: entry.key.materialEpoch,
  };
}
