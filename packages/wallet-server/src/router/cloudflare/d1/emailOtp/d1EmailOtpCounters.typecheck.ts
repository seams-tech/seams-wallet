import type { EmailOtpCounterKey, EmailOtpRateLimitConsumeInput } from './d1EmailOtpRecords';

// @ts-expect-error Wallet counters require an explicit wallet owner.
const missingWallet: EmailOtpCounterKey = { kind: 'wallet', key: 'challenge' };
// @ts-expect-error Regional counters cannot carry a wallet owner.
const mixedOwner: EmailOtpCounterKey = { kind: 'regional', walletId: 'wallet', key: 'challenge' };
declare const walletCounter: Extract<EmailOtpCounterKey, { kind: 'wallet' }>;
// @ts-expect-error Spreading a wallet counter cannot convert it into regional state.
const spreadOwner: EmailOtpCounterKey = { ...walletCounter, kind: 'regional' };
void missingWallet;
void mixedOwner;
void spreadOwner;

// @ts-expect-error A caller must select wallet-owned or regional consumption explicitly.
const implicitOwner: EmailOtpRateLimitConsumeInput = { scope: 'challenge', walletId: 'wallet' };
// @ts-expect-error Selecting wallet-owned consumption requires its wallet identity.
const missingInputOwner: EmailOtpRateLimitConsumeInput = { kind: 'wallet', scope: 'challenge' };
void implicitOwner;
void missingInputOwner;
