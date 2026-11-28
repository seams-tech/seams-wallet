import { expect, test } from '@playwright/test';
import { parseAuthMenuCopy } from '../../packages/auth/src/shared/copy';
import {
  parseFrameMessage,
  parseInitMessage,
  parsePageRequest,
} from '../../packages/auth/src/shared/protocol';

// The messages between the app page and the account frame. A request has only the fields of
// its type, so the app page cannot add one, such as a secret sink.

const INIT = {
  type: 'init',
  publishableKey: 'pk_test_1',
  environmentId: 'project-1:production',
  methods: ['passkey', 'email_code'],
  plugins: ['mpc-wallet'],
  locale: 'en',
  copy: {},
};

test('a request of the page is refused with a field that its type does not have', () => {
  const prove = {
    type: 'prove',
    requestId: 'auth-1',
    audience: 'checkout',
    challenge: 'order_1234567890:nonce',
  };
  expect(parsePageRequest(prove)).toEqual(prove);
  // The app page cannot pass a secret sink, a method or a purpose.
  for (const extra of [
    { secretSink: {} },
    { prfSalt: 'AAAA' },
    { methodId: 'm' },
    { purpose: 'x' },
  ]) {
    expect(parsePageRequest({ ...prove, ...extra })).toBeNull();
  }
  expect(parsePageRequest({ ...prove, audience: 'Wallet' })).toBeNull();
  expect(parsePageRequest({ ...prove, challenge: 'short' })).toBeNull();
  expect(parsePageRequest({ ...prove, challenge: 'two lines\n0123456789abcdef' })).toBeNull();
  expect(
    parsePageRequest({ type: 'sign_in', requestId: 'auth-2', accountId: 'acct_1' }),
  ).toBeNull();
  expect(parsePageRequest({ type: 'unlock', requestId: 'auth-3' })).toBeNull();
  expect(parsePageRequest({ type: 'channel', pluginId: '../other' })).toBeNull();
  expect(parsePageRequest({ type: 'channel', pluginId: 'mpc-wallet' })).toEqual({
    type: 'channel',
    pluginId: 'mpc-wallet',
  });
});

test('the first message names known methods, plugin IDs, a locale and copy keys', () => {
  expect(parseInitMessage(INIT)).toEqual(INIT);
  for (const change of [
    { methods: [] },
    { methods: ['passkey', 'passkey'] },
    { methods: ['password'] },
    { plugins: ['MPC Wallet'] },
    { locale: 'fr' },
    { copy: { headline: 'Welcome' } },
    { copy: { title: '' } },
    { accountOrigin: 'https://account.example.test' },
  ]) {
    expect(parseInitMessage({ ...INIT, ...change })).toBeNull();
  }
  expect(parseAuthMenuCopy({ title: 'Sign in to the shop' })).toEqual({
    title: 'Sign in to the shop',
  });
});

test('a message of the frame has a known type and bounded values', () => {
  expect(parseFrameMessage({ type: 'resize', requestId: 'auth-1', heightCssPx: 420 })).toEqual({
    type: 'resize',
    requestId: 'auth-1',
    heightCssPx: 420,
  });
  expect(parseFrameMessage({ type: 'resize', requestId: 'auth-1', heightCssPx: 0 })).toBeNull();
  expect(parseFrameMessage({ type: 'reply', requestId: 'auth-1', result: 'token' })).toBeNull();
  expect(parseFrameMessage({ type: 'navigate', url: 'https://example.test' })).toBeNull();
  expect(
    parseFrameMessage({
      type: 'error',
      code: 'email_code_invalid',
      message: 'raw',
      view: 'email_code',
    }),
  ).toEqual({
    type: 'error',
    kind: 'auth_error_v1',
    code: 'email_code_invalid',
    message: 'raw',
    view: 'email_code',
  });
});
