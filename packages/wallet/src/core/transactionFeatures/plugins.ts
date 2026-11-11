import { hasExactKeys } from '@shared/utils/exactKeys';
import type { Variant } from '@shared/utils/variant';
import type { SpeakToSignNetwork } from '@shared/speakToSign/spokenRequest';

export type { SpeakToSignNetwork };

/**
 * Approval by voice (Speak-to-Sign): the owner says a sentence, and the Wallet signs with no
 * confirm. It is data only and loads no code.
 */
export type SpokenApprovalPlugin = Readonly<{
  kind: 'spoken';
  network: SpeakToSignNetwork;
}>;

/**
 * The descriptor that turns approval by voice on: `approvals: [spoken({ network })]`. It is
 * data only. The flow is a part of the Wallet that loads on the first spoken request. Only
 * `testnet` has a verifier today.
 */
export function spoken(options: Readonly<{ network: SpeakToSignNetwork }>): SpokenApprovalPlugin {
  return { kind: 'spoken', network: options.network };
}

/**
 * An approval is a way for the owner of an unlocked wallet to approve a request, other than the
 * Wallet's confirm. Unlike an auth method, it never unlocks a wallet or opens a session.
 */
export type WalletApprovalPlugin = SpokenApprovalPlugin;

export function parseWalletApprovalPlugins(value: unknown): readonly WalletApprovalPlugin[] {
  if (!Array.isArray(value)) {
    throw new Error('approvals must be an array of wallet approval descriptors.');
  }
  const plugins: WalletApprovalPlugin[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !hasExactKeys(candidate, ['kind', 'network']) ||
      candidate.kind !== 'spoken' ||
      (candidate.network !== 'testnet' && candidate.network !== 'mainnet') ||
      seen.has(candidate.kind)
    ) {
      throw new Error('Unsupported or duplicate wallet approval descriptor.');
    }
    seen.add(candidate.kind);
    plugins.push({ kind: 'spoken', network: candidate.network });
  }
  return plugins;
}

export function findWalletApproval<K extends WalletApprovalPlugin['kind']>(
  plugins: readonly WalletApprovalPlugin[],
  kind: K,
): Variant<WalletApprovalPlugin, 'kind', K> | null {
  for (const plugin of plugins) {
    if (isKind(kind, plugin)) return plugin;
  }
  return null;
}

function isKind<K extends WalletApprovalPlugin['kind']>(
  kind: K,
  plugin: WalletApprovalPlugin,
): plugin is Variant<WalletApprovalPlugin, 'kind', K> {
  return plugin.kind === kind;
}
