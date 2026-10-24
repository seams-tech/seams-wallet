import type { WalletSessionCapabilityLaneReadiness } from '@/core/types/seams';

export function signingKeyReadinessLabel(readiness: WalletSessionCapabilityLaneReadiness): string {
  switch (readiness.kind) {
    case 'ready':
      return 'Available';
    case 'pending':
      return readiness.resume === 'restore_material' ? 'Preparation required' : 'Setup in progress';
    case 'authorization_required':
      return 'Approval required';
    case 'superseded':
      return 'Refresh signing keys';
    case 'failed':
      return 'Unavailable';
    default:
      return assertNever(readiness);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unsupported signing key readiness: ${String(value)}`);
}
