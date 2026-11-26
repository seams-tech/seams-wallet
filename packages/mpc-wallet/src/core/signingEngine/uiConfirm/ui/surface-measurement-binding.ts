import type { UiConfirmSurfaceMeasurementBinding } from '../uiConfirm.types';

export function sameSurfaceMeasurementBinding(
  left: UiConfirmSurfaceMeasurementBinding | undefined,
  right: UiConfirmSurfaceMeasurementBinding,
): boolean {
  if (!left || left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'disabled':
      return right.kind === 'disabled';
    case 'wallet_iframe':
      return (
        right.kind === 'wallet_iframe' &&
        left.requestId === right.requestId &&
        left.postMeasurement === right.postMeasurement &&
        left.hostSurfaceVariant === right.hostSurfaceVariant
      );
  }
}
