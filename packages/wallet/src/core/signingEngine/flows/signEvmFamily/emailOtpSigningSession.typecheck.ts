import type { WalletSessionRef } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  createEmailOtpEcdsaTransactionSigningBridge,
  type EmailOtpEcdsaStepUpAuthority,
  type EmailOtpEcdsaChallengeAuthority,
} from './emailOtpSigningSession';
import type {
  EcdsaCommittedLane,
  EmailOtpEcdsaSigningSessionCommittedLane,
} from './ecdsaSelection';

declare const walletSession: WalletSessionRef;
declare const authority: EmailOtpEcdsaChallengeAuthority;
declare const operationFingerprintDigest: DigestB64u;
declare const committedLane: EcdsaCommittedLane;
declare const signingSessionCommittedLane: EmailOtpEcdsaSigningSessionCommittedLane;

const invalidLiveStepUpWithPublicLane: EmailOtpEcdsaStepUpAuthority = {
  kind: 'live_session',
  committedLane: signingSessionCommittedLane,
  // @ts-expect-error live authority cannot carry a second reauth lane.
  reauthLane: committedLane,
};
void invalidLiveStepUpWithPublicLane;

type SigningChallengeArgs = Parameters<
  NonNullable<
    Parameters<
      typeof createEmailOtpEcdsaTransactionSigningBridge
    >[0]['requestEmailOtpTransactionSigningChallenge']
  >
>[0];

declare function requestChallenge(args: SigningChallengeArgs): void;

requestChallenge({ walletSession, chain: 'evm', authority, operationFingerprintDigest });
requestChallenge({
  walletSession,
  // @ts-expect-error EVM-family step-up cannot target NEAR.
  chain: 'near',
  authority,
  operationFingerprintDigest,
});
requestChallenge({
  walletSession: {
    ...walletSession,
    // @ts-expect-error Signing challenges require the normalized wallet identity.
    walletId: 'wallet.testnet',
  },
  chain: 'evm',
  authority,
  operationFingerprintDigest,
});
// @ts-expect-error An operation-bound challenge requires its operation fingerprint.
requestChallenge({ walletSession, chain: 'evm', authority });

export {};
