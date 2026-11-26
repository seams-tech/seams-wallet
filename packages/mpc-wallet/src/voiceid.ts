// The VoiceID page code: the app's opt-in descriptor and the host contract that the
// VoiceID host plugin of `@seams/host/voiceid` runs against.
export * from './voiceid-host';
export { voiceIdAuthMethod, type VoiceIdOptions } from './core/authMethods/voiceId/descriptor';
