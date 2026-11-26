import {
  parseWalletSessionAuthorizationV2,
  type WalletSessionAuthorizationV2,
} from '../../../../authorization/domain';

type PersistedWalletSessionAuthorizationRecord = Record<string, unknown>;

function isPersistedWalletSessionAuthorizationRecord(
  value: unknown,
): value is PersistedWalletSessionAuthorizationRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePersistedWalletSessionAuthorizationV2(
  value: unknown,
): WalletSessionAuthorizationV2 {
  if (!isPersistedWalletSessionAuthorizationRecord(value) || !('laneContext' in value)) {
    return parseWalletSessionAuthorizationV2(value);
  }
  const { laneContext: _retiredGeographicLaneContext, ...currentRecord } = value;
  return parseWalletSessionAuthorizationV2(currentRecord);
}
