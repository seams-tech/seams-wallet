import { IndexedDBManager } from '@/core/indexedDB';
const PREFERENCE_KEY = 'voiceid-microphone-v1';
export function readVoiceMicrophonePreference(): Promise<unknown> {
  return IndexedDBManager.getAppState(PREFERENCE_KEY);
}
export function saveVoiceMicrophonePreference(value: VoiceMicrophonePreference): Promise<void> {
  return IndexedDBManager.setAppState(PREFERENCE_KEY, value);
}

export type VoiceMicrophonePreference =
  | { readonly kind: 'system_default'; readonly deviceId?: never }
  | { readonly kind: 'device'; readonly deviceId: string };
