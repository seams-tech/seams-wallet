import type { LinkedDeviceSessionServiceResultV1 } from '../../packages/wallet-server/src/core/deviceLinking/linkedDeviceSession';
import type { LinkedDeviceSessionRecordV1 } from '../../packages/wallet-server/src/core/deviceLinking/linkedDeviceSessionRecord';

declare const record: LinkedDeviceSessionRecordV1;
declare const result: LinkedDeviceSessionServiceResultV1;

const conflictWithRecord: LinkedDeviceSessionServiceResultV1 = {
  outcome: 'home_conflict',
  message: 'Conflict',
  // @ts-expect-error A home binding failure cannot carry an accepted record, including through a spread.
  record,
};
const failedSpread: LinkedDeviceSessionServiceResultV1 = {
  ...result,
  outcome: 'home_unavailable',
  message: 'Unavailable',
  // @ts-expect-error A home binding failure cannot carry an accepted record, including through a spread.
  record,
};
void [conflictWithRecord, failedSpread];
