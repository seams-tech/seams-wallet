import { expect, test } from '@playwright/test';
import {
  parseHostedAuthMenuOutcome,
  type HostedAuthMenuFailureCode,
  type HostedAuthMenuOutcome,
} from '@/SeamsWeb/walletIframe/shared/messages';
import type { HostedAuthMenuOutcome as PublicHostedAuthMenuOutcome } from '@/react/components/HostedSeamsAuthMenu/public';

/**
 * The outcomes of the hosted auth menu (audit row 8.1): each kind and each failure code that an
 * app receives in onOutcome. The app page reads each outcome with parseHostedAuthMenuOutcome, so
 * an outcome that it refuses never reaches the app.
 */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The React export names the same type that crosses the iframe, so the two cannot drift.
const publicOutcomeIsWireOutcome: Equal<PublicHostedAuthMenuOutcome, HostedAuthMenuOutcome> = true;

const FAILURE_CODES = [
  'invalid_request',
  'unsupported_provider',
  'provider_error',
  'invalid_evidence',
  'webauthn_failed',
  'wallet_error',
  'timeout',
  'connection_closed',
  'internal_error',
] as const satisfies readonly HostedAuthMenuFailureCode[];

// The list above names every code of the type.
const everyFailureCodeListed: [
  Exclude<HostedAuthMenuFailureCode, (typeof FAILURE_CODES)[number]>,
] extends [never]
  ? true
  : false = true;

const SESSION = { authMenuSessionId: 'conformance-outcome-session' } as const;
const WALLET = { walletId: 'conformance-wallet.testnet' } as const;

const ACCEPTED_OUTCOMES: readonly Record<string, unknown>[] = [
  { kind: 'wallet_connected', ...SESSION, alternativeId: 'eip6963:io.metamask' },
  ...['passkey', 'google_email_otp', 'voiceid'].map((method) => ({
    kind: 'authenticated',
    ...SESSION,
    ...WALLET,
    method,
  })),
  ...['passkey', 'google_email_otp'].map((method) => ({
    kind: 'registered',
    ...SESSION,
    ...WALLET,
    method,
  })),
  { kind: 'account_synced', ...SESSION, ...WALLET },
  ...['close_button', 'component_unmounted', 'connection_closed'].map((reason) => ({
    kind: 'cancelled',
    ...SESSION,
    reason,
  })),
  ...FAILURE_CODES.map((code) => ({ kind: 'failed', ...SESSION, code, message: `fails: ${code}` })),
];

test('the app page accepts each outcome kind, method, reason and failure code', () => {
  expect(publicOutcomeIsWireOutcome && everyFailureCodeListed).toBe(true);
  for (const outcome of ACCEPTED_OUTCOMES) {
    expect(parseHostedAuthMenuOutcome(outcome), JSON.stringify(outcome)).toEqual(outcome);
  }
});

const REFUSED_OUTCOMES: readonly { readonly name: string; readonly outcome: unknown }[] = [
  { name: 'an unknown kind', outcome: { kind: 'signed_out', ...SESSION } },
  {
    name: 'an unknown failure code',
    outcome: { kind: 'failed', ...SESSION, code: 'user_cancelled', message: 'x' },
  },
  { name: 'a failure without a message', outcome: { kind: 'failed', ...SESSION, code: 'timeout' } },
  {
    name: 'a VoiceID registration',
    outcome: { kind: 'registered', ...SESSION, ...WALLET, method: 'voiceid' },
  },
  {
    name: 'an unknown cancel reason',
    outcome: { kind: 'cancelled', ...SESSION, reason: 'escape' },
  },
  {
    name: 'an extra field',
    outcome: { kind: 'account_synced', ...SESSION, ...WALLET, method: 'passkey' },
  },
  { name: 'no session id', outcome: { kind: 'account_synced', ...WALLET } },
];

for (const { name, outcome } of REFUSED_OUTCOMES) {
  test(`the app page refuses an outcome with ${name}`, () => {
    expect(parseHostedAuthMenuOutcome(outcome)).toBeNull();
  });
}
