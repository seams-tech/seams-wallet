import { expect, test } from '@playwright/test';
import { sha256HexUtf8 } from '../../packages/shared-ts/src/utils/digests';

test('Email OTP email hash uses unprefixed SHA-256 hex', async () => {
  const hash = await sha256HexUtf8('test@example.com');

  expect(hash).toBe('973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b');
});
