import { expect, test } from '@playwright/test';
import {
  isCanonicalSignerSessionBoundaryCode,
  resolveWalletBoundaryErrorCode,
  resolveWalletBoundaryErrorMessage,
  resolveWalletBoundarySignerKind,
} from '../../../packages/wallet/src/SeamsWeb/walletIframe/host/canonicalSignerErrorCode';

/**
 * The 14 codes that the wallet iframe gives the app when a signing request fails. The app
 * branches on them: the two step-up codes ask the user for a fresh proof, the session codes
 * refresh the signing session, and `cancelled` ends the flow quietly.
 */
const SIGNER_CODES = [
  'commit_queue_overflow',
  'commit_queue_timeout',
  'threshold_ed25519_session_not_ready',
  'threshold_ecdsa_session_not_ready',
  'stale_ecdsa_key_identity',
  'threshold_session_kind_mismatch',
  'session_not_ready',
  'fresh_email_otp_required',
  'passkey_step_up_required',
  'operation_blocked_by_policy',
  'nonce_conflict_retryable',
  'nonce_lane_blocked',
  'rpc_request_failed',
  'cancelled',
] as const;

const ECDSA_REQUEST = 'PM_SIGN_TEMPO';
const ED25519_REQUEST = 'PM_SIGN_NEP413';

function codeFor(input: { rawCode?: string; message?: string; requestType?: string }): string {
  return resolveWalletBoundaryErrorCode({ requestType: ECDSA_REQUEST, ...input });
}

test('each signer code passes through, and the other spellings of a code map to it', () => {
  for (const code of SIGNER_CODES) expect(codeFor({ rawCode: code })).toBe(code);

  // Codes are compared in lower case, with spaces and dashes read as underscores.
  const spellings: readonly (readonly [string, string])[] = [
    ['Commit-Queue Overflow', 'commit_queue_overflow'],
    ['4001', 'cancelled'],
    ['user_rejected_request', 'cancelled'],
    ['email_otp_reauth_required', 'fresh_email_otp_required'],
    ['stronger_auth_required', 'passkey_step_up_required'],
    ['policy_blocked', 'operation_blocked_by_policy'],
    ['stale_ecdsa_key', 'stale_ecdsa_key_identity'],
    ['nonce_too_low', 'nonce_conflict_retryable'],
    ['already_known', 'nonce_conflict_retryable'],
    ['request_timeout', 'rpc_request_failed'],
  ];
  for (const [rawCode, code] of spellings) expect(codeFor({ rawCode }), rawCode).toBe(code);
});

test('a signing request with no known code gets one from its message', () => {
  const messages: readonly (readonly [string, string])[] = [
    ['The user rejected the request', 'cancelled'],
    ['This operation requires fresh Email OTP verification', 'fresh_email_otp_required'],
    ['Passkey authentication is required to export', 'passkey_step_up_required'],
    ['Operation blocked by policy', 'operation_blocked_by_policy'],
    ['Nonce lane blocked by a pending transaction', 'nonce_lane_blocked'],
    ['replacement transaction underpriced', 'nonce_conflict_retryable'],
    ['[NearClient] RPC call failed', 'rpc_request_failed'],
  ];
  for (const [message, code] of messages) {
    expect(codeFor({ rawCode: 'worker_error', message }), message).toBe(code);
  }
  // A request that is not a signing request keeps its own code, or HOST_ERROR.
  expect(
    resolveWalletBoundaryErrorCode({
      requestType: 'PM_UNLOCK',
      rawCode: 'worker_error',
      message: 'Passkey authentication is required',
    }),
  ).toBe('worker_error');
  expect(resolveWalletBoundaryErrorCode({ requestType: 'PM_UNLOCK' })).toBe('HOST_ERROR');
  expect(resolveWalletBoundaryErrorCode({ defaultCode: 'UNLOCK_FAILED' })).toBe('UNLOCK_FAILED');
});

test('the two step-up codes and the policy code from a message win over the raw code', () => {
  expect(
    codeFor({ rawCode: 'rpc_error', message: 'Operation requires fresh passkey authentication' }),
  ).toBe('passkey_step_up_required');
  expect(codeFor({ rawCode: 'timeout', message: 'Verify Email OTP again to continue' })).toBe(
    'fresh_email_otp_required',
  );
  expect(codeFor({ rawCode: 'timeout', message: 'Blocked by wallet policy' })).toBe(
    'operation_blocked_by_policy',
  );
  // Any other message loses to a known raw code.
  expect(codeFor({ rawCode: 'timeout', message: 'nonce too low' })).toBe('rpc_request_failed');
});

test('each signer code has its own message, and the session codes are the boundary codes', () => {
  const messages = SIGNER_CODES.map((code) =>
    resolveWalletBoundaryErrorMessage({ requestType: ED25519_REQUEST, rawCode: code }),
  );
  expect(new Set(messages).size).toBe(SIGNER_CODES.length);
  expect(resolveWalletBoundaryErrorMessage({ rawCode: 'passkey_step_up_required' })).toBe(
    'Passkey authentication is required before this operation can continue.',
  );
  expect(resolveWalletBoundaryErrorMessage({ rawCode: 'fresh_email_otp_required' })).toBe(
    'Fresh Email OTP verification is required before this operation can continue.',
  );
  expect(resolveWalletBoundaryErrorMessage({ code: 'deployment_failed' })).toBe(
    'Wallet deployment failed. Retry the request.',
  );
  expect(resolveWalletBoundaryErrorMessage({ rawCode: 'other', message: ' Raw text ' })).toBe(
    'Raw text',
  );
  expect(resolveWalletBoundaryErrorMessage({})).toBe('Wallet operation failed');

  expect(SIGNER_CODES.filter(isCanonicalSignerSessionBoundaryCode)).toEqual([
    'threshold_ed25519_session_not_ready',
    'threshold_ecdsa_session_not_ready',
    'threshold_session_kind_mismatch',
    'session_not_ready',
  ]);
  expect(resolveWalletBoundarySignerKind(ECDSA_REQUEST)).toBe('threshold-ecdsa');
  expect(resolveWalletBoundarySignerKind(ED25519_REQUEST)).toBe('threshold-ed25519');
  expect(resolveWalletBoundarySignerKind('PM_UNLOCK')).toBeNull();
});
