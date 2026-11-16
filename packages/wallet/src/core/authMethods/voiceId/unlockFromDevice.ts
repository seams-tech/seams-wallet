import type { VoiceIdWalletSessionChallenge } from '@shared/authorization/voiceIdDeviceAssertion';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { WalletSessionBudget } from '@shared/threshold/walletSessionBudget';
import type { VoiceIdUnlockCapture } from './contracts';
import type { VoiceIdHttpClient, VoiceIdVerifiedSession } from './httpClient';

/** The installer must finish custody activation before the caller reports unlock. */
export async function verifyVoiceIdChallengeWithDevice<T>(input: {
  readonly authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  readonly challenge: VoiceIdWalletSessionChallenge;
  readonly http: Pick<VoiceIdHttpClient, 'verify'>;
  /** The app's Wallet Session budget. Absent or null: the app asks for none. */
  readonly walletSessionBudget?: WalletSessionBudget | null;
  readonly capture: VoiceIdUnlockCapture;
  readonly install: (verified: VoiceIdVerifiedSession, factorSecret32: Uint8Array) => Promise<T>;
  readonly signal: AbortSignal;
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
  });
  try {
    if (input.signal.aborted) throw new Error('VoiceID unlock was cancelled.');
    const verified = await input.http.verify({
      assertion: captured.assertion,
      walletSessionBudget: input.walletSessionBudget,
      signal: input.signal,
    });
    if (input.signal.aborted) throw new Error('VoiceID unlock was cancelled.');
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
