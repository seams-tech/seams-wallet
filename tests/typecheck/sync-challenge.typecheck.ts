import type {
  WebAuthnSyncChallengeStore,
  WebAuthnSyncChallengeRecord,
} from '../../packages/wallet-server/src/core/WebAuthnSyncChallengeStore';

type Consumed = Awaited<ReturnType<WebAuthnSyncChallengeStore['consume']>>;
type Created = Awaited<ReturnType<WebAuthnSyncChallengeStore['create']>>;
declare const record: WebAuthnSyncChallengeRecord;
declare const consumed: Consumed;

// @ts-expect-error An unavailable authority cannot return consumable proof state.
const failedWithRecord: Consumed = {
  ok: false,
  code: 'wallet_home_unavailable',
  message: 'Unavailable',
  record,
};
// @ts-expect-error A failure cannot carry a successful record through a spread.
const failedSpread: Consumed = {
  ...consumed,
  ok: false,
  code: 'wallet_home_conflict',
  message: 'Conflict',
  record,
};
// @ts-expect-error Consumption success must explicitly distinguish absent and present records.
const missingRecord: Consumed = { ok: true };
const conflictingCreation: Created = {
  ok: true,
  // @ts-expect-error Creation success cannot also report failure.
  code: 'wallet_home_unavailable',
  message: 'Unavailable',
};
void [failedWithRecord, failedSpread, missingRecord, conflictingCreation];
