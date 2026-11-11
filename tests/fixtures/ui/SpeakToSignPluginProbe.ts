import { loadSpeakToSignApprover } from '@/core/transactionFeatures/hostRegistry';
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

/** Gets the approver, as the first spoken request does, and names its methods. */
async function loadHost(): Promise<{ kind: 'loaded'; methods: string[] }> {
  const plugin = await loadSpeakToSignApprover(enabled);
  return { kind: 'loaded', methods: Object.keys(plugin).sort() };
}

/** Starts a request with no operations. It fails after the chunk of the flow loaded. */
async function startFlow(): Promise<'started'> {
  const approver = await loadSpeakToSignApprover(enabled);
  await approver
    .approve({ signal: new AbortController().signal, request: {} } as never)
    .catch(() => undefined);
  return 'started';
}

declare global {
  interface Window {
    speakToSignPluginProbe: {
      configure: typeof configure;
      loadHost: typeof loadHost;
      startFlow: typeof startFlow;
    };
  }
}
window.speakToSignPluginProbe = { configure, loadHost, startFlow };
