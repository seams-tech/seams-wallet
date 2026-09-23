import type {
  WarmSessionSealTransportState,
} from '@/core/types/secure-confirm-worker';
import type { WarmSessionMaterialWriteDiagnostics } from '../warmCapabilities/types';
export type {
  WarmSessionMaterialWriteDiagnosticBucket,
  WarmSessionMaterialWriteDiagnostics,
} from '../warmCapabilities/types';

export type WarmSessionMaterialWriteInput = {
  readonly thresholdSessionId: string;
  readonly prfFirstB64u: string;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly diagnostics?: WarmSessionMaterialWriteDiagnostics;
} & WarmSessionSealTransportState;

export interface WarmSessionMaterialWriter {
  putWarmSessionMaterial(args: WarmSessionMaterialWriteInput): Promise<void>;
}
