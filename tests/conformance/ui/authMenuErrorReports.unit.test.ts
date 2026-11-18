import { expect, test } from '@playwright/test';
import { AuthMenuSession } from '@/SeamsWeb/walletIframe/host/auth-menu/session';
import type { AuthMenuIntent } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuSessionIdFromBoundary,
  type ChildToParentEnvelope,
  type HostedAuthMenuExternalAuthEvidence,
} from '@/SeamsWeb/walletIframe/shared/messages';
import type { GoogleEmailOtpWalletAuthLoginFlow } from '@/SeamsWeb/publicApi/types';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { expectKnownFault } from '../knownFault';

/**
 * The views of the hosted auth menu that the browser check cannot reach without a server: the
 * Google code view and the Google step of recovery. Each check drives today's AuthMenuSession
 * with fake ports and reads the AUTH_MENU_ERROR messages it sends to the app page. The client
 * router turns each one into the host event unchanged (see the browser check of the passkey
 * view).
 */

type SessionArgs = ConstructorParameters<typeof AuthMenuSession>[0];

const RECOVERY_CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function requireWalletId(value: string): WalletId {
  const parsed = parseWalletId(value);
  if (!parsed.ok) throw new Error(`Invalid wallet id fixture: ${value}`);
  return parsed.value;
}

const WALLET_ID = requireWalletId('conformance-wallet.testnet');
const SESSION_ID = hostedAuthMenuSessionIdFromBoundary('conformance-error-session');
const REQUEST_ID = walletIframeRequestIdFromBoundary('conformance-error-request');

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by this check`);
  };
}

/** A session with fake ports that records what it sends to the app page. */
function openSession(ports: Partial<SessionArgs> = {}) {
  if (!SESSION_ID) throw new Error('Invalid session id fixture');
  const sent: ChildToParentEnvelope[] = [];
  const session = new AuthMenuSession({
    request: buildHostedAuthMenuOpenRequest({
      authMenuSessionId: SESSION_ID,
      initialMode: 'login',
      enabledExternalProviders: ['google'],
    }),
    requestId: REQUEST_ID,
    appearance: { theme: { id: 'default', mode: 'light', colors: {} }, palette: 'default' },
    hostname: 'app.example.test',
    beginGoogleEmailOtp: unused('beginGoogleEmailOtp'),
    startDeviceLinking: unused('startDeviceLinking'),
    cancelDeviceLinking: async () => {},
    recoveryPort: {
      targetFor: unused('targetFor'),
      prepare: unused('prepare'),
      createPasskey: unused('createPasskey'),
      verifyGoogle: unused('verifyGoogle'),
      verifyEmailOtp: unused('verifyEmailOtp'),
      finalize: unused('finalize'),
      cancel: async () => {},
    },
    prepareRecoveredLogin: unused('prepareRecoveredLogin'),
    sendToParent: (message) => sent.push(message),
    ...ports,
  });
  // The surface calls this handler for each user action; without a DOM the check calls it.
  const press = Reflect.get(session, 'onIntent') as (intent: AuthMenuIntent) => void;
  const reportedMessages = () =>
    sent.flatMap((message) => (message.type === 'AUTH_MENU_ERROR' ? [message.payload] : []));
  const externalAuthRequests = () =>
    sent.flatMap((message) =>
      message.type === 'AUTH_MENU_EXTERNAL_AUTH_REQUEST' ? [message.payload] : [],
    );
  /** Answers the latest Google request the way the app page's broker does. */
  const resolveGoogle = (evidence: HostedAuthMenuExternalAuthEvidence) => {
    const request = externalAuthRequests().at(-1);
    if (!request) throw new Error('The session asked for no Google sign-in');
    return session.acceptExternalAuthResolution({
      kind: 'hosted_auth_menu_external_auth_resolution_v1',
      authMenuSessionId: request.authMenuSessionId,
      externalAuthRequestId: request.externalAuthRequestId,
      requestId: REQUEST_ID,
      evidence,
    });
  };
  return { session, press, reportedMessages, resolveGoogle };
}

function googleLoginFlow(submitFailure: string): GoogleEmailOtpWalletAuthLoginFlow {
  return {
    kind: 'google_email_otp_wallet_auth_flow_v1',
    flowId: `google-email-otp-login:${WALLET_ID}:conformance-challenge`,
    requestedMode: 'login',
    mode: 'login',
    state: 'challenge_sent',
    walletId: WALLET_ID,
    emailHint: 'a***@example.test',
    prompt: { title: 'Check your email', description: '', submitLabel: 'Verify', helperText: '' },
    expiresAtMs: Date.now() + 600_000,
    delivery: { kind: 'provider', status: 'sent', emailHint: 'a***@example.test' },
    cancel: async () => {},
    resend: unused('resend'),
    submit: async () => ({
      ok: false,
      error: { code: 'email_otp_invalid_code', message: submitFailure },
    }),
  };
}

test('a Google sign-in that fails before the code view sends the raw text', async () => {
  const raw = 'auth/google/verify failed (HTTP 503)';
  const menu = openSession({ beginGoogleEmailOtp: () => Promise.reject(new Error(raw)) });
  expect(menu.session.requestExternalAuth('google')).not.toBeNull();
  expect(menu.resolveGoogle({ kind: 'google_id_token', idToken: 'conformance-id-token' })).toBe(
    true,
  );
  await expect.poll(menu.reportedMessages).toEqual([
    {
      kind: 'hosted_auth_menu_error_v1',
      authMenuSessionId: SESSION_ID,
      mode: 'login',
      message: raw,
    },
  ]);
});

test('a refused code in the Google code view sends the raw text once', async () => {
  const raw = 'email-otp/verify failed (HTTP 400): invalid_code';
  const menu = openSession({ beginGoogleEmailOtp: async () => googleLoginFlow(raw) });
  menu.session.requestExternalAuth('google');
  menu.resolveGoogle({ kind: 'google_id_token', idToken: 'conformance-id-token' });
  await expect.poll(() => menu.session.state.kind).toBe('google_login');
  menu.press({ kind: 'google_otp_code_changed', code: '123456' });
  await expect.poll(menu.reportedMessages).toEqual([
    {
      kind: 'hosted_auth_menu_error_v1',
      authMenuSessionId: SESSION_ID,
      mode: 'login',
      message: raw,
    },
  ]);
});

test("a failed Google step in recovery sends the broker's raw text", async () => {
  expectKnownFault(
    '8.2',
    'a recovery view reports a host event only at the sign_in_ready stage ' +
      '(presentedAuthMenuError, auth-menu/session.ts:546-548); the raw text stays in the status',
  );
  const raw = 'Google popup was blocked by the browser';
  const target = { kind: 'google_email_otp', googleProvider: 'google' } as const;
  const menu = openSession({
    recoveryPort: {
      targetFor: () => target,
      prepare: async () => ({
        kind: 'hosted_recovery_prepared',
        recoveryOperationId: 'conformance-recovery-operation',
        walletId: WALLET_ID,
        target,
      }),
      createPasskey: unused('createPasskey'),
      verifyGoogle: unused('verifyGoogle'),
      verifyEmailOtp: unused('verifyEmailOtp'),
      finalize: unused('finalize'),
      cancel: async () => {},
    },
  });
  menu.press({ kind: 'recovery_open' });
  menu.press({ kind: 'recovery_code_changed', recoveryCode: RECOVERY_CODE });
  menu.press({ kind: 'recovery_code_submit' });
  menu.press({ kind: 'recovery_google_selected' });
  await expect.poll(() => Reflect.get(menu.session.state, 'stage')).toBe('google_external_auth');
  menu.resolveGoogle({ kind: 'failed', code: 'provider_error', message: raw });
  // The view keeps the raw text as its status detail and shows a plain sentence.
  expect(menu.session.state).toMatchObject({
    stage: 'google_ready',
    viewModel: { status: { kind: 'recoverable', detail: raw } },
  });
  expect(menu.reportedMessages()).toContainEqual(expect.objectContaining({ message: raw }));
});
