import { isPlainObject } from '@shared/utils/validation';

export type VoiceIdTranscriptionModel = 'aurora' | 'citrinet';
export type VoiceIdAuthMethodPlugin = Readonly<{
  kind: 'voiceid';
  transcriptionModel?: VoiceIdTranscriptionModel;
}>;
export type VoiceIdConfirmationOptions = Readonly<{
  /** App wording used only to select an action-only challenge. Maximum 256 characters. */
  confirmationCommand: string;
}>;
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
      Object.keys(candidate).some(unknownVoiceIdOption) ||
      candidate.kind !== 'voiceid' ||
      (candidate.transcriptionModel !== undefined &&
        candidate.transcriptionModel !== 'aurora' &&
        candidate.transcriptionModel !== 'citrinet') ||
      seen.has(candidate.kind)
    ) {
      throw new Error('Unsupported or duplicate wallet auth method plugin.');
    }
    seen.add(candidate.kind);
    plugins.push({
      kind: 'voiceid',
      transcriptionModel: candidate.transcriptionModel ?? 'citrinet',
    });
  }
  return plugins;
}

function unknownVoiceIdOption(key: string): boolean {
  return key !== 'kind' && key !== 'transcriptionModel';
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
