import { expect, test } from '@playwright/test';
import { generateSessionId } from '@/core/signingEngine/session/passkey/prfCache';

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
});
