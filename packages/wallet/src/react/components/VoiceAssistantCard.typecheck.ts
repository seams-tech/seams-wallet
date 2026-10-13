import type { VoiceAssistantInput, VoiceAssistantState } from './VoiceAssistantCard';

// @ts-expect-error Listening requires an explicit audio source.
const voiceWithoutInput: VoiceAssistantState = { kind: 'listening' };

// @ts-expect-error One source cannot provide both a level and a microphone.
const mixedVoiceInput: VoiceAssistantInput = {
  kind: 'level',
  level: 0.4,
  stream: new MediaStream(),
};

const listeningVoice = {
  kind: 'listening' as const,
  input: { kind: 'level' as const, level: 0.4 },
};

// @ts-expect-error Processing cannot retain the audio input through a spread.
const processingWithInput: VoiceAssistantState = {
  ...listeningVoice,
  kind: 'processing',
};

// @ts-expect-error A direct assertion cannot add audio to the idle state.
const unsafeVoiceCast = {
  kind: 'idle',
  input: { kind: 'level', level: 0.4 },
} as VoiceAssistantState;

void [voiceWithoutInput, mixedVoiceInput, processingWithInput, unsafeVoiceCast];
