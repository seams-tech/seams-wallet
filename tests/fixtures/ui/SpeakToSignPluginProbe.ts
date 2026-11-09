import { loadSpeakToSignHost } from '@/core/transactionFeatures/hostRegistry';
import {
  parseWalletTransactionFeaturePlugins,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';
import type { SpeakToSignTransferResult } from '@/core/transactionFeatures/hostPlugin';
import { walletIdFromString } from '@shared/utils/registrationIds';

let enabled: readonly WalletTransactionFeaturePlugin[] = [];

function configure(useSpeakToSign: boolean): void {
  enabled = parseWalletTransactionFeaturePlugins(
    useSpeakToSign ? [{ kind: 'speak_to_sign', network: 'testnet' }] : [],
  );
}

async function requestTransfer(): Promise<SpeakToSignTransferResult> {
  const plugin = await loadSpeakToSignHost(enabled);
  return await plugin.requestTransfer({
    walletId: walletIdFromString('alice.testnet'),
    network: 'testnet',
    signal: new AbortController().signal,
  });
}

declare global {
  interface Window {
    speakToSignPluginProbe: { configure: typeof configure; requestTransfer: typeof requestTransfer };
  }
}
window.speakToSignPluginProbe = { configure, requestTransfer };
