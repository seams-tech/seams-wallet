import { IndexedDBManager, isPlainObject } from '@seams/wallet/voiceid-host';

const PREFERENCE_KEY = 'voiceid-microphone-v1';

type MicrophonePreference =
  | { readonly kind: 'system_default'; readonly deviceId?: never }
  | { readonly kind: 'device'; readonly deviceId: string };
let preference: MicrophonePreference | { readonly kind: 'unread' } = { kind: 'unread' };

export type VoiceMicrophone = Readonly<{
  stream: MediaStream;
  preference: MicrophonePreference;
  selection: 'default' | 'preferred' | 'replacement';
  label: string;
  processing: Readonly<{
    noiseSuppression: boolean | null;
    echoCancellation: boolean | string | null;
    autoGainControl: boolean | null;
    sampleRate: number | null;
  }>;
}>;

function concreteDeviceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== 'default' &&
    value !== 'communications'
  );
}

async function readPreference(): Promise<MicrophonePreference> {
  if (preference.kind !== 'unread') return preference;
  let saved: MicrophonePreference = { kind: 'system_default' };
  try {
    const raw = await IndexedDBManager.getAppState(PREFERENCE_KEY);
    if (isPlainObject(raw) && raw.kind === 'device' && concreteDeviceId(raw.deviceId)) {
      saved = { kind: 'device', deviceId: raw.deviceId };
    }
  } catch {
    // A microphone preference must not make restricted browser storage block capture.
  }
  if (preference.kind === 'unread') preference = saved;
  return preference;
}

function constraints(preference: MicrophonePreference): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (preference.kind === 'device') audio.deviceId = { exact: preference.deviceId };
  return { audio, video: false };
}

/** Select the concrete input behind a browser's moving default-device alias. */
async function resolvedPreference(settings: MediaTrackSettings): Promise<MicrophonePreference> {
  if (concreteDeviceId(settings.deviceId)) return { kind: 'device', deviceId: settings.deviceId };
  if (settings.groupId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const device of devices) {
        if (
          device.kind === 'audioinput' &&
          device.groupId === settings.groupId &&
          concreteDeviceId(device.deviceId)
        ) {
          return { kind: 'device', deviceId: device.deviceId };
        }
      }
    } catch {
      // Some browsers withhold device identifiers. Keep their default input usable.
    }
  }
  return { kind: 'system_default' };
}

export async function openVoiceMicrophone(signal: AbortSignal): Promise<VoiceMicrophone> {
  signal.throwIfAborted();
  const preference = await readPreference();
  signal.throwIfAborted();
  let stream: MediaStream;
  let selection: VoiceMicrophone['selection'] = preference.kind === 'device' ? 'preferred' : 'default';
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(preference));
  } catch (error) {
    signal.throwIfAborted();
    if (
      preference.kind !== 'device' ||
      !(error instanceof DOMException) ||
      (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError')
    ) {
      throw error;
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints({ kind: 'system_default' }));
    selection = 'replacement';
  }
  const stop = stopMicrophone.bind(null, stream);
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') throw new VoiceMicrophoneInterruptedError();
    // A stopped track can lose its settings. Snapshot them before the recorder owns it.
    const settings = track.getSettings();
    const resolved = await resolvedPreference(settings);
    signal.throwIfAborted();
    if (track.readyState !== 'live') throw new VoiceMicrophoneInterruptedError();
    return {
      stream,
      preference: resolved,
      selection,
      label: track.label || 'Default microphone',
      processing: {
        noiseSuppression: settings.noiseSuppression ?? null,
        echoCancellation: settings.echoCancellation ?? null,
        autoGainControl: settings.autoGainControl ?? null,
        sampleRate: settings.sampleRate ?? null,
      },
    };
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

function stopMicrophone(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export async function rememberVoiceMicrophone(microphone: VoiceMicrophone): Promise<void> {
  if (microphone.preference.kind !== 'device' || microphone.selection === 'replacement') return;
  await savePreference(microphone.preference);
}

export async function useSystemVoiceMicrophone(): Promise<void> {
  await savePreference({ kind: 'system_default' });
}

async function savePreference(selected: MicrophonePreference): Promise<void> {
  preference = selected;
  try {
    await IndexedDBManager.setAppState(PREFERENCE_KEY, selected);
  } catch {
    // Capture remains usable when preference storage is unavailable.
  }
}

export class VoiceMicrophoneInterruptedError extends Error {
  constructor() {
    super('The microphone disconnected or stopped. Check your microphone and try again.');
    this.name = 'VoiceMicrophoneInterruptedError';
  }
}
