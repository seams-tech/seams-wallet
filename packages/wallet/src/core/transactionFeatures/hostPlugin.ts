import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignNetwork } from './plugins';

/** Wallet and `@seams/speak-to-sign` must use the same value. It is separate from VoiceID's. */
export const SPEAK_TO_SIGN_HOST_API_VERSION = 1;

export type SpeakToSignUnavailableReason = 'flow_not_available';

/** The spoken payment flow is not built yet, so every request ends as `unavailable`. */
export type SpeakToSignTransferResult = Readonly<{
  kind: 'unavailable';
  reason: SpeakToSignUnavailableReason;
}>;

export type SpeakToSignTransferRequest = Readonly<{ walletId: string }>;

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface SpeakToSignHostPlugin {
  requestTransfer(input: {
    readonly walletId: WalletId;
    readonly vault: string;
    readonly network: SpeakToSignNetwork;
    readonly signal: AbortSignal;
  }): Promise<SpeakToSignTransferResult>;
}
