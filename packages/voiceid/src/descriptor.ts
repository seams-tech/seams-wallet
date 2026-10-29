import type {
  VoiceIdAuthMethodPlugin,
  VoiceIdTranscriptionModel,
} from '@seams/wallet/voiceid-host';

export type VoiceIdOptions = Readonly<{ transcriptionModel?: VoiceIdTranscriptionModel }>;

/** A small opt-in descriptor with no capture, model, or host implementation. */
export function voiceIdAuthMethod(options: VoiceIdOptions = {}): VoiceIdAuthMethodPlugin {
  return { kind: 'voiceid', transcriptionModel: options.transcriptionModel ?? 'citrinet' };
}
