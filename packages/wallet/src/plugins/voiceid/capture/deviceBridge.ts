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
import { readVoiceEnrollment, enrollBrowserVoice, verifyBrowserVoice } from '../browser/enrollment';
import { requireVoiceUserAction } from '../browser/microphone';

export async function captureVoiceIdActivation(input: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly signal: AbortSignal;
  readonly onListening: () => void;
}): Promise<{
  kind: 'activated';
  publicKeyB64u: VoiceIdDevicePublicKeyB64u;
  deviceKeyId: DigestB64u;
  factorSecret32: Uint8Array;
}> {
  requireVoiceUserAction();
  if (await readVoiceEnrollment()) await verifyBrowserVoice(input.signal, input.onListening);
  else await enrollBrowserVoice(input.signal);
  input.signal.throwIfAborted();
  const device = await createBrowserVoiceDevice(input.walletId, input.walletAuthMethodId);
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
  readonly onListening: () => void;
}): Promise<{ kind: 'unlocked'; assertion: VoiceIdDeviceAssertion; factorSecret32: Uint8Array }> {
  requireVoiceUserAction();
  const { challenge } = input;
  if (challenge.requestOrigin !== location.origin || challenge.expiresAtMs <= Date.now())
    throw new Error('VoiceID challenge is expired or belongs to another Wallet origin.');
  const device = await readBrowserVoiceDevice(challenge.walletId, challenge.walletAuthMethodId);
  if (!device || device.deviceKeyId !== challenge.deviceKeyId)
    throw new Error('VoiceID device key is unavailable in this browser.');
  await verifyBrowserVoice(input.signal, input.onListening);
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
