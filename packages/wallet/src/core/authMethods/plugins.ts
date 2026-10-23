import { isPlainObject } from '@shared/utils/validation';

export type VoiceIdAuthMethodPlugin = Readonly<{ kind: 'voiceid' }>;
export type WalletAuthMethodPlugin = VoiceIdAuthMethodPlugin;

export function parseWalletAuthMethodPlugins(value: unknown): readonly WalletAuthMethodPlugin[] {
  if (!Array.isArray(value)) {
    throw new Error('authMethods must be an array of wallet auth method plugins.');
  }
  const plugins: WalletAuthMethodPlugin[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !isPlainObject(candidate) ||
      Object.keys(candidate).length !== 1 ||
      candidate.kind !== 'voiceid' ||
      seen.has(candidate.kind)
    ) {
      throw new Error('Unsupported or duplicate wallet auth method plugin.');
    }
    seen.add(candidate.kind);
    plugins.push({ kind: 'voiceid' });
  }
  return plugins;
}

export function walletAuthMethodPluginEnabled(
  plugins: readonly WalletAuthMethodPlugin[],
  kind: WalletAuthMethodPlugin['kind'],
): boolean {
  for (const plugin of plugins) {
    if (plugin.kind === kind) return true;
  }
  return false;
}
