import { loadSpeakToSignApprover } from '@/core/transactionFeatures/hostRegistry';
import {
  parseWalletApprovalPlugins,
  type WalletApprovalPlugin,
} from '@/core/transactionFeatures/plugins';

let enabled: readonly WalletApprovalPlugin[] = [];

function configure(useSpeakToSign: boolean): void {
  enabled = parseWalletApprovalPlugins(
    useSpeakToSign ? [{ kind: 'spoken', network: 'testnet' }] : [],
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

/**
 * Opens the Wallet's phrase card on `sentence`, as the first spoken card does, and closes it.
 * It says what the card drew and how its recording ended.
 */
async function openCard(
  sentence: string,
): Promise<{ sentence: string | null; walletTheme: boolean; recording: string }> {
  const { openPhrase } = await import('@/core/transactionFeatures/approver/phraseCard');
  const surface = openPhrase({
    sentence,
    signal: new AbortController().signal,
    surfaceMeasurementBinding: { kind: 'disabled' },
  });
  const recording = surface.record();
  const element = document.querySelector('.seams-auth-method-activation-surface');
  const drawn = {
    sentence: element?.querySelector('.seams-voiceid-phrase')?.textContent ?? null,
    walletTheme: element?.classList.contains('seams-wallet-ui') ?? false,
  };
  surface.close();
  return { ...drawn, recording: (await recording).kind };
}

declare global {
  interface Window {
    speakToSignPluginProbe: {
      configure: typeof configure;
      loadHost: typeof loadHost;
      startFlow: typeof startFlow;
      openCard: typeof openCard;
    };
  }
}
window.speakToSignPluginProbe = { configure, loadHost, startFlow, openCard };
