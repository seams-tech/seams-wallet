import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import type { VoiceCaptureObserver } from '../browser/microphone';
import { VoicePhraseMismatchError, type SpokenPhrase } from '../browser/phrase';
import {
  voiceIdWalletSessionChallengeBytes,
  parseVoiceIdDeviceAssertion,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { WalletId, WalletAuthMethodId } from '@shared/utils/domainIds';
import type {
  VoiceIdDeviceAssertion,
  VoiceIdDevicePublicKeyB64u,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import { base64UrlEncode } from '@shared/utils/base64';
import {
  createBrowserVoiceDevice,
  readBrowserVoiceDevice,
  openBrowserVoiceFactor,
} from '../browser/deviceStore';
import { enrollBrowserVoice, verifyBrowserVoice } from '../browser/enrollment';
import {
  readVoiceEnrollment,
  voiceEnrollmentScope,
  resolveVoiceEnrollmentScope,
  type VoiceTemplateAccess,
} from '../browser/enrollmentStore';
import { prepareVoiceOwner } from '../activation/ownerConfirmation';
import { IndexedDBManager } from '@/core/indexedDB';
import {
  requireVoiceUserAction,
  requireVoiceForeground,
  InsufficientVoiceAudioError,
} from '../browser/microphone';

export async function captureVoiceIdActivation(input: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly signal: AbortSignal;
  readonly onCapture: VoiceCaptureObserver;
  readonly phrase: SpokenPhrase;
}): Promise<{
  kind: 'activated';
  publicKeyB64u: VoiceIdDevicePublicKeyB64u;
  deviceKeyId: DigestB64u;
  factorSecret32: Uint8Array;
}> {
  requireVoiceUserAction();
  const device = await createBrowserVoiceDevice(input.walletId, input.walletAuthMethodId);
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(input.walletId);
  if (selected.kind !== 'resolved')
    throw new Error('Select the owner wallet before enrolling VoiceID.');
  const scope = voiceEnrollmentScope(device, selected.authority.authorityId);
  const enrollment = await readVoiceEnrollment(scope);
  if (enrollment) {
    const owner = await prepareVoiceOwner(scope, 'activating');
    await requireVoiceMatch(
      { kind: 'activation', scope, owner },
      input.signal,
      input.onCapture,
      input.phrase,
    );
  } else {
    const guard = await prepareVoiceOwner(scope, 'activating');
    await enrollBrowserVoice(
      { kind: 'activate', scope, guard, snapshot: { kind: 'missing' } },
      input.signal,
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

export async function captureVoiceIdUnlock(input: {
  readonly challenge: VoiceIdWalletSessionChallenge;
  readonly signal: AbortSignal;
  readonly onCapture: VoiceCaptureObserver;
  readonly phrase: SpokenPhrase;
}): Promise<{ kind: 'unlocked'; assertion: VoiceIdDeviceAssertion; factorSecret32: Uint8Array }> {
  requireVoiceForeground();
  const { challenge } = input;
  if (challenge.requestOrigin !== location.origin || challenge.expiresAtMs <= Date.now())
    throw new Error('VoiceID challenge is expired or belongs to another Wallet origin.');
  const device = await readBrowserVoiceDevice(challenge.walletId, challenge.walletAuthMethodId);
  if (!device || device.deviceKeyId !== challenge.deviceKeyId)
    throw new Error('VoiceID device key is unavailable in this browser.');
  const scope = await resolveVoiceEnrollmentScope(challenge.walletId, challenge.walletAuthMethodId);
  await requireVoiceMatch({ kind: 'active', scope }, input.signal, input.onCapture, input.phrase);
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
): Promise<void> {
  const result = await verifyBrowserVoice(access, signal, onCapture, phrase);
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
