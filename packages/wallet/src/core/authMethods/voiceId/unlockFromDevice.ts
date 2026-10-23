import type { VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { captureVoiceIdUnlock } from '@/core/signingEngine/uiConfirm/voiceId/deviceBridge';
import type { VoiceIdHttpClient, VoiceIdVerifiedSession } from './httpClient';

/** The installer must finish custody activation before the caller reports unlock. */
export async function verifyVoiceIdChallengeWithDevice<T>(input: {
  readonly authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  readonly challenge: VoiceIdWalletSessionChallenge;
  readonly http: Pick<VoiceIdHttpClient, 'verify'>;
  readonly capture: typeof captureVoiceIdUnlock;
  readonly install: (verified: VoiceIdVerifiedSession, factorSecret32: Uint8Array) => Promise<T>;
  readonly signal: AbortSignal;
  readonly onListening: () => void;
}): Promise<T> {
  const { authMethod, challenge } = input;
  if (
    challenge.walletId !== authMethod.walletId ||
    challenge.walletAuthMethodId !== authMethod.walletAuthMethodId ||
    challenge.walletAuthorityId !== authMethod.walletAuthorityId ||
    challenge.deviceKeyId !== authMethod.deviceKeyId
  ) {
    throw new Error('VoiceID challenge does not match the selected device method.');
  }
  const captured = await input.capture({
    challenge,
    signal: input.signal,
    onListening: input.onListening,
  });
  try {
    const verified = await input.http.verify({ assertion: captured.assertion, signal: input.signal });
    if (
      verified.walletSession.walletId !== authMethod.walletId ||
      verified.walletSession.authMethodId !== authMethod.walletAuthMethodId ||
      verified.walletSession.authorityId !== authMethod.walletAuthorityId ||
      verified.custodyEnvelope.factor.deviceKeyId !== authMethod.deviceKeyId
    ) {
      throw new Error('VoiceID server verified a different device method.');
    }
    return await input.install(verified, captured.factorSecret32);
  } finally {
    captured.factorSecret32.fill(0);
  }
}
