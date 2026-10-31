import { recordVoice, type VoiceCaptureObserver, type VoiceCaptureQuality } from './microphone';
import { checkSpokenPhrase, type SpokenPhrase } from './phrase';
import { voiceEmbedding, voiceSimilarity, VOICE_MATCH_THRESHOLD } from './model';
import { readVoiceTemplate } from './enrollmentStore';
import type { VoiceTemplateAccess, VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';

export async function verifyBrowserVoice(
  access: VoiceTemplateAccess,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
  model: VoiceIdTranscriptionModel,
): Promise<
  | { kind: 'matched' }
  | { kind: 'mismatch'; quality: VoiceCaptureQuality }
  | { kind: 'phrase_mismatch' }
  | { kind: 'insufficient_audio'; quality: VoiceCaptureQuality }
> {
  const pcm = await recordVoice(signal, onCapture);
  if (pcm.kind === 'insufficient_audio') {
    signal.throwIfAborted();
    return pcm;
  }
  try {
    signal.throwIfAborted();
    const phraseCheck = await checkSpokenPhrase(pcm.samples, phrase, model);
    const embedding = await voiceEmbedding(pcm.samples);
    let similarity: number;
    try {
      signal.throwIfAborted();
      const reference = await readVoiceTemplate(access, signal);
      try {
        similarity = voiceSimilarity(embedding, reference.template);
      } finally {
        reference.template.fill(0);
        reference.baseline.fill(0);
      }
    } finally {
      embedding.fill(0);
    }
    if (similarity < VOICE_MATCH_THRESHOLD) return { kind: 'mismatch', quality: pcm.quality };
    return phraseCheck.kind === 'matched' ? { kind: 'matched' } : { kind: 'phrase_mismatch' };
  } finally {
    pcm.samples.fill(0);
  }
}
