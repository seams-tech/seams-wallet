import { loadSpeakToSignHost } from '@/core/transactionFeatures/hostRegistry';
import {
  parseWalletTransactionFeaturePlugins,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';

let enabled: readonly WalletTransactionFeaturePlugin[] = [];

function configure(useSpeakToSign: boolean): void {
  enabled = parseWalletTransactionFeaturePlugins(
    useSpeakToSign ? [{ kind: 'speak_to_sign', network: 'testnet' }] : [],
  );
}

/** Loads the host plugin, as the first spoken request does, and names its methods. */
async function loadHost(): Promise<{ kind: 'loaded'; methods: string[] }> {
  const plugin = await loadSpeakToSignHost(enabled);
  return { kind: 'loaded', methods: Object.keys(plugin).sort() };
}

declare global {
  interface Window {
    speakToSignPluginProbe: { configure: typeof configure; loadHost: typeof loadHost };
  }
}
window.speakToSignPluginProbe = { configure, loadHost };
