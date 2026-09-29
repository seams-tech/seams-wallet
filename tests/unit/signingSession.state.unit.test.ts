import { expect, test } from '@playwright/test';
import { generateSessionId } from '@/core/signingEngine/session/passkey/prfCache';
import { parseClearVolatileWarmMaterialCommand } from '@/core/signingEngine/session/warmCapabilities/volatileWarmMaterialCommands';

test.describe('signing session PRF cache utilities', () => {
  test('generateSessionId fails closed when WebCrypto randomness is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    let message: string | null = null;
    try {
      generateSessionId('threshold-ed25519');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }

    expect(message).toBe('WebCrypto getRandomValues is required for passkey PRF cache session IDs');
  });

  test('volatile clear command parser rejects durable-delete payloads', () => {
    const clearAll = { kind: 'clear_volatile_warm_material', scope: { kind: 'all' } };

    expect(parseClearVolatileWarmMaterialCommand(clearAll)).toEqual(clearAll);
    expect(
      parseClearVolatileWarmMaterialCommand({ ...clearAll, kind: 'delete_durable_sealed_session' }),
    ).toBeNull();
    for (const durableField of ['durableRecord', 'resolvedIdentity', 'deleteReason']) {
      expect(
        parseClearVolatileWarmMaterialCommand({ ...clearAll, [durableField]: 'expired' }),
      ).toBeNull();
    }
  });
});
