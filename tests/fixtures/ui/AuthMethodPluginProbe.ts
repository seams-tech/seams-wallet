import { loadWalletAuthMethodHostPlugin } from '@/core/authMethods/hostRegistry';
import { parseWalletAuthMethodPlugins, type WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import { voiceIdAuthMethod } from '@voiceid/descriptor';

let enabled: readonly WalletAuthMethodPlugin[] = [];

function configure(useVoiceId: boolean): void {
  enabled = parseWalletAuthMethodPlugins(useVoiceId ? [voiceIdAuthMethod()] : []);
}

async function load(): Promise<void> {
  await loadWalletAuthMethodHostPlugin(enabled, 'voiceid');
}

declare global {
  interface Window {
    authMethodPluginProbe: { configure: typeof configure; load: typeof load };
  }
}
window.authMethodPluginProbe = { configure, load };
