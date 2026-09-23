import type {
  WarmSessionMaterialWriter,
  WarmSessionMaterialWriteDiagnostics,
} from './warmSessionMaterialWriter';
import type { WarmSessionSealTransportState } from '@/core/types/secure-confirm-worker';
import { secureRandomId } from '@shared/utils/secureRandomId';

export type SigningSessionCacheEntry = {
  readonly thresholdSessionId: string;
  readonly prfFirstB64u: string;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly diagnostics?: WarmSessionMaterialWriteDiagnostics;
} & WarmSessionSealTransportState;

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

export function generateSessionId(prefix: string): string {
  return secureRandomId(prefix, 32, 'passkey PRF cache session IDs');
}

function normalizeSigningSessionCacheEntry(
  args: SigningSessionCacheEntry,
): SigningSessionCacheEntry {
  const thresholdSessionId = String(args.thresholdSessionId || '').trim();
  const prfFirstB64u = String(args.prfFirstB64u || '').trim();
  const expiresAtMsRaw = Number(args.expiresAtMs);
  const remainingUses = toNonNegativeInt(args.remainingUses);
  if (!thresholdSessionId || !prfFirstB64u) {
    throw new Error('Missing thresholdSessionId or prfFirstB64u for signing session hydration');
  }
  if (!Number.isFinite(expiresAtMsRaw) || expiresAtMsRaw <= 0) {
    throw new Error('Invalid expiresAtMs for signing session hydration');
  }
  if (remainingUses == null) {
    throw new Error('Invalid remainingUses for signing session hydration');
  }
  const normalized = {
    thresholdSessionId,
    prfFirstB64u,
    expiresAtMs: Math.floor(expiresAtMsRaw),
    remainingUses,
    ...(args.diagnostics ? { diagnostics: args.diagnostics } : {}),
  };
  if (args.preparedServerSeal) {
    return {
      ...normalized,
      transport: args.transport,
      preparedServerSeal: args.preparedServerSeal,
    };
  }
  return {
    ...normalized,
    ...(args.transport ? { transport: args.transport } : {}),
  };
}

export async function cacheCredentialBoundarySetupExportPrfFirst(
  writer: WarmSessionMaterialWriter,
  args: SigningSessionCacheEntry,
): Promise<void> {
  const normalized = normalizeSigningSessionCacheEntry(args);
  const material = {
    thresholdSessionId: normalized.thresholdSessionId,
    prfFirstB64u: normalized.prfFirstB64u,
    expiresAtMs: normalized.expiresAtMs,
    remainingUses: normalized.remainingUses,
    ...(normalized.diagnostics ? { diagnostics: normalized.diagnostics } : {}),
  };
  if (normalized.preparedServerSeal) {
    await writer.putWarmSessionMaterial({
      ...material,
      transport: normalized.transport,
      preparedServerSeal: normalized.preparedServerSeal,
    });
    return;
  }
  await writer.putWarmSessionMaterial({
    ...material,
    ...(normalized.transport ? { transport: normalized.transport } : {}),
  });
}
