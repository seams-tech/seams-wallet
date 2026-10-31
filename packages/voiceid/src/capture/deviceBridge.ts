import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import type { VoiceCaptureObserver } from '../browser/microphone';
import { VoicePhraseMismatchError, type SpokenPhrase } from '../browser/phrase';
import {
  voiceIdWalletSessionChallengeBytes,
  parseVoiceIdDeviceAssertion,
} from '@seams/wallet/voiceid-host';

import { base64UrlEncode } from '@seams/wallet/voiceid-host';
import {
  createBrowserVoiceDevice,
  readBrowserVoiceDevice,
  openBrowserVoiceFactor,
} from '@seams/wallet/voiceid-host';
import { enrollBrowserVoice, verifyBrowserVoice } from '../browser/enrollment';
import { readVoiceEnrollment } from '../browser/enrollmentStore';
import { resolveVoiceEnrollmentScope, type VoiceTemplateAccess } from '@seams/wallet/voiceid-host';
import {
  prepareVoiceOwner,
  resolveActivatingVoiceEnrollmentScope,
} from '@seams/wallet/voiceid-host';
import {
  requireVoiceUserAction,
  requireVoiceForeground,
  InsufficientVoiceAudioError,
} from '../browser/microphone';

import type { VoiceIdActivationCapture, VoiceIdUnlockCapture } from '@seams/wallet/voiceid-host';
type VoiceCapturePresentation = Readonly<{ onCapture: VoiceCaptureObserver; phrase: SpokenPhrase }>;

export async function captureVoiceIdActivation(
  model: VoiceIdTranscriptionModel,
  presentation: VoiceCapturePresentation,
  input: Parameters<VoiceIdActivationCapture>[0],
): ReturnType<VoiceIdActivationCapture> {
  requireVoiceUserAction();
  const device = await createBrowserVoiceDevice(input.walletId, input.walletAuthMethodId);
  const scope = await resolveActivatingVoiceEnrollmentScope(device);
  const enrollment = await readVoiceEnrollment(scope);
  if (enrollment) {
    const owner = await prepareVoiceOwner(scope, 'activating');
    await requireVoiceMatch(
      { kind: 'activation', scope, owner },
      input.signal,
      presentation.onCapture,
      presentation.phrase,
      model,
    );
  } else {
    const guard = await prepareVoiceOwner(scope, 'activating');
    await enrollBrowserVoice(
      { kind: 'activate', scope, guard, snapshot: { kind: 'missing' } },
      input.signal,
      model,
    );
  }
  input.signal.throwIfAborted();
  const factorSecret32 = await openBrowserVoiceFactor(device);
  if (input.signal.aborted) {
    factorSecret32.fill(0);
    throw new Error('VoiceID activation was cancelled.');
  }
  return {
    kind: 'activated' as const,
    publicKeyB64u: device.publicKeyB64u,
    deviceKeyId: device.deviceKeyId,
    factorSecret32,
  };
}

export async function captureVoiceIdUnlock(
  model: VoiceIdTranscriptionModel,
  presentation: VoiceCapturePresentation,
  input: Parameters<VoiceIdUnlockCapture>[0],
): ReturnType<VoiceIdUnlockCapture> {
  requireVoiceForeground();
  const { challenge } = input;
  if (challenge.requestOrigin !== location.origin || challenge.expiresAtMs <= Date.now())
    throw new Error('VoiceID challenge is expired or belongs to another Wallet origin.');
  const device = await readBrowserVoiceDevice(challenge.walletId, challenge.walletAuthMethodId);
  if (!device || device.deviceKeyId !== challenge.deviceKeyId)
    throw new Error('VoiceID device key is unavailable in this browser.');
  const scope = await resolveVoiceEnrollmentScope(challenge.walletId, challenge.walletAuthMethodId);
  await requireVoiceMatch(
    { kind: 'active', scope },
    input.signal,
    presentation.onCapture,
    presentation.phrase,
    model,
  );
  input.signal.throwIfAborted();
  if (challenge.expiresAtMs <= Date.now())
    throw new Error('VoiceID challenge expired. Start unlock again.');
  const signature = await crypto.subtle.sign(
    'Ed25519',
    device.privateKey,
    voiceIdWalletSessionChallengeBytes(challenge),
  );
  const factorSecret32 = await openBrowserVoiceFactor(device);
  if (input.signal.aborted || challenge.expiresAtMs <= Date.now()) {
    factorSecret32.fill(0);
    throw new Error('VoiceID unlock expired or was cancelled.');
  }
  return {
    kind: 'unlocked' as const,
    assertion: parseVoiceIdDeviceAssertion({
      kind: 'voiceid_device_assertion_v1',
      challenge,
      signatureB64u: base64UrlEncode(new Uint8Array(signature)),
    }),
    factorSecret32,
  };
}

async function requireVoiceMatch(
  access: VoiceTemplateAccess,
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
  model: VoiceIdTranscriptionModel,
): Promise<void> {
  const result = await verifyBrowserVoice(access, signal, onCapture, phrase, model);
  switch (result.kind) {
    case 'matched':
      return;
    case 'insufficient_audio':
      throw new InsufficientVoiceAudioError(result.quality);
    case 'mismatch':
      throw new VoiceSpeakerMismatchError(result.quality);
    case 'phrase_mismatch':
      throw new VoicePhraseMismatchError();
    default:
      return assertNever(result);
  }
}

function assertNever(result: never): never {
  throw new Error(`Unexpected voice result: ${String(result)}`);
}