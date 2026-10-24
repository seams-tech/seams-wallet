import { DEFAULT_CONFIRMATION_CONFIG } from '@/core/types/signer-worker';
import { IndexedDBManager } from '@/core/indexedDB';
import { type NearSignerPreference } from '@/core/types/nearSigningKeys';
import type { WalletId } from '@shared/utils/domainIds';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { requirePrimaryChainByFamily } from '@/core/config/chains';
import { readNearSignerMetadata } from './nearSignerMetadata';
import { resolveMlDsaPasskeyOwner } from './mlDsaOwner';

type PreferenceScope = {
  readonly walletId: WalletId;
  readonly nearAccountId: string;
  readonly configs: SeamsConfigsReadonly;
};
function scopeKey(input: PreferenceScope): string {
  return JSON.stringify([
    requirePrimaryChainByFamily(input.configs.network.chains, 'near').network,
    input.nearAccountId,
  ]);
}
export async function readDefaultNearSigner(input: PreferenceScope): Promise<NearSignerPreference> {
  const preferences = await IndexedDBManager.getWalletPreferences(input.walletId);
  return preferences.nearSigningKeys?.[scopeKey(input)] ?? { kind: 'ed25519' };
}
export async function setDefaultNearSigner(
  input: PreferenceScope & { readonly preference: NearSignerPreference },
): Promise<void> {
  const owner = await resolveMlDsaPasskeyOwner(input.walletId);
  if (owner.kind !== 'owner')
    throw new Error('Unlock a full-owner passkey to change the default signing key.');
  const preference = input.preference;
  if (preference.kind === 'near_ml_dsa_65') {
    const inventory = await readNearSignerMetadata({
      walletId: input.walletId,
      relayerUrl: input.configs.network.relayer.url,
    });
    if (inventory.kind !== 'inventory') throw new Error(inventory.message);
    let found = false;
    for (const entry of inventory.entries) {
      if (entry.kind === 'published' && entry.key.signingKeyId === preference.signingKeyId)
        found = true;
    }
    if (!found) throw new Error('This ML-DSA signer is not available in the current wallet.');
  }
  const preferences = await IndexedDBManager.getWalletPreferences(input.walletId);
  const next = { ...preferences.nearSigningKeys, [scopeKey(input)]: preference };
  const updated = await IndexedDBManager.updateWalletPreferences({
    walletId: input.walletId,
    preferences: {
      nearSigningKeys: next,
      confirmationConfig: preferences.confirmationConfig ?? DEFAULT_CONFIRMATION_CONFIG,
    },
  });
  if (!updated) throw new Error('Unable to save the signing preference. Try again.');
}
