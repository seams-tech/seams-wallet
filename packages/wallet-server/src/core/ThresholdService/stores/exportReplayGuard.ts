// An export authorization nonce stays reserved until its expiry plus this skew, and for at least
// the minimum retention, so a replay near expiry is still refused.
export const EXPORT_REPLAY_GUARD_CLOCK_SKEW_MS = 5 * 60_000;
export const EXPORT_REPLAY_GUARD_MIN_RETENTION_MS = 24 * 60 * 60_000;
