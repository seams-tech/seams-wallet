import { expect, test } from '@playwright/test';
import { hostPluginUrl } from '@/core/walletRuntimePaths/base';

test('a host plugin entry carries its host API version and the Wallet asset version', () => {
  expect(hostPluginUrl('/sdk/speak-to-sign/host.js', 6, '0.59.0')).toBe(
    '/sdk/speak-to-sign/host.js?api=6&v=0.59.0',
  );
  expect(hostPluginUrl('/sdk/voiceid/host.js', 10, undefined)).toBe('/sdk/voiceid/host.js?api=10');
  // A new host API version is a new URL, so a cached older entry is not reused.
  expect(hostPluginUrl('/sdk/speak-to-sign/host.js', 7, '0.59.0')).not.toBe(
    hostPluginUrl('/sdk/speak-to-sign/host.js', 6, '0.59.0'),
  );
});
