import { hasExactKeys } from '@shared/utils/exactKeys';
import type { Variant } from '@shared/utils/variant';

export type SpeakToSignNetwork = 'testnet' | 'mainnet';

/** Spoken payments from the owner's own account. It is data only and loads no code. */
export type SpeakToSignFeaturePlugin = Readonly<{
  kind: 'speak_to_sign';
  network: SpeakToSignNetwork;
}>;

/**
 * Transaction features add an operation to an unlocked wallet. Unlike an auth method,
 * a feature never unlocks a wallet or opens a session.
 */
export type WalletTransactionFeaturePlugin = SpeakToSignFeaturePlugin;

export function parseWalletTransactionFeaturePlugins(
  value: unknown,
): readonly WalletTransactionFeaturePlugin[] {
  if (!Array.isArray(value)) {
    throw new Error('transactionFeatures must be an array of wallet transaction feature plugins.');
  }
  const plugins: WalletTransactionFeaturePlugin[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !hasExactKeys(candidate, ['kind', 'network']) ||
      candidate.kind !== 'speak_to_sign' ||
      (candidate.network !== 'testnet' && candidate.network !== 'mainnet') ||
      seen.has(candidate.kind)
    ) {
      throw new Error('Unsupported or duplicate wallet transaction feature plugin.');
    }
    seen.add(candidate.kind);
    plugins.push({ kind: 'speak_to_sign', network: candidate.network });
  }
  return plugins;
}

export function findWalletTransactionFeature<K extends WalletTransactionFeaturePlugin['kind']>(
  plugins: readonly WalletTransactionFeaturePlugin[],
  kind: K,
): Variant<WalletTransactionFeaturePlugin, 'kind', K> | null {
  for (const plugin of plugins) {
    if (isKind(kind, plugin)) return plugin;
  }
  return null;
}

function isKind<K extends WalletTransactionFeaturePlugin['kind']>(
  kind: K,
  plugin: WalletTransactionFeaturePlugin,
): plugin is Variant<WalletTransactionFeaturePlugin, 'kind', K> {
  return plugin.kind === kind;
}
