import { useSyncExternalStore } from 'react';
import type {
  OwnerNearOperation,
  OwnerNearOperationState,
} from '@/SeamsWeb/publicApi/ownerNearOperation';

/** Observe one operation. Readable wallet access remains separate from this approval. */
export function useOwnerNearOperation(operation: OwnerNearOperation): OwnerNearOperationState {
  return useSyncExternalStore(
    operation.subscribe.bind(operation),
    operation.getState.bind(operation),
    operation.getState.bind(operation),
  );
}
