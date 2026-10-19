import { expect, test } from '@playwright/test';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';

const iframeWallet = { walletOrigin: 'https://wallet.example.test' } as const;

test.describe('buildConfigsFromEnv Email OTP auth policy', () => {
  test('defaults Email OTP auth policy to session', async () => {
    const cfg = buildConfigsFromEnv({
      relayer: { url: 'https://relay.example' },
      iframeWallet,
    });
    expect(cfg.signing.emailOtp.authPolicy).toBe('session');
  });

  test('rejects invalid Email OTP auth policy values', async () => {
    expect(() =>
      buildConfigsFromEnv({
        relayer: { url: 'https://relay.example' },
        iframeWallet,
        emailOtpAuthPolicy: 'invalid' as any,
      }),
    ).toThrow(
      '[configPresets] Invalid config: emailOtpAuthPolicy (invalid); expected "session" or "per_operation"',
    );
  });
});
