import type { WarmSessionSealTransportState } from '@/core/types/secure-confirm-worker';
import type {
  WarmSessionMaterialWriter,
  WarmSessionMaterialWriteDiagnostics,
} from '@/core/signingEngine/session/passkey/warmSessionMaterialWriter';
import { cacheCredentialBoundarySetupExportPrfFirst } from '@/core/signingEngine/session/passkey/prfCache';

export type HydrateWarmSigningSessionInput = {
  readonly thresholdSessionId: string;
  readonly prfFirstB64u: string;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly diagnostics?: WarmSessionMaterialWriteDiagnostics;
} & WarmSessionSealTransportState;

export type WarmSessionHydrationService = {
  hydrateSigningSession(input: HydrateWarmSigningSessionInput): Promise<void>;
};

export function createWarmSessionHydrationService(deps: {
  getWarmSessionMaterialWriter: () => WarmSessionMaterialWriter;
}): WarmSessionHydrationService {
  return {
    hydrateSigningSession: (input) =>
      cacheCredentialBoundarySetupExportPrfFirst(deps.getWarmSessionMaterialWriter(), input),
  };
}
