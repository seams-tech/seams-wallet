import { expect, test } from '@playwright/test';
import { authMenuFailureStatus } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import { PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE } from '@shared/utils/passkeyUserVerification';

const SENTENCES: readonly (readonly [detail: string, message: string])[] = [
  ['sync-account/options failed (HTTP 502)', 'Can’t reach Seams right now.'],
  ['HTTP 502', 'Can’t reach Seams right now.'],
  ['Failed to fetch', 'Can’t reach Seams right now.'],
  ['Load failed', 'Can’t reach Seams right now.'],
  ['NetworkError when attempting to fetch resource.', 'Can’t reach Seams right now.'],
  ['wallet/unlock/challenge failed (HTTP 429)', 'Too many attempts. Wait a moment.'],
  ['Passkey preparation timed out', 'That took too long.'],
  ['Wallet has no registered passkey credential', 'Something went wrong.'],
  ['wallet/unlock/challenge failed (HTTP 400)', 'Something went wrong.'],
  // The server refused a passkey without user verification; the menu tells the user what to change.
  [PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE, PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE],
  [
    `[threshold-ed25519] operation step-up failed: ${PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE}`,
    PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE,
  ],
];

test('says a thrown failure in plain words and keeps its text as detail', () => {
  for (const [detail, message] of SENTENCES) {
    expect(authMenuFailureStatus(detail)).toEqual({
      kind: 'recoverable',
      reason: 'error',
      message,
      detail,
    });
  }
});
