import { expect, test } from '@playwright/test';
import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuSessionIdFromBoundary,
  parseHostedAuthMenuOpenRequest,
  type HostedAuthMenuCopyInput,
} from '@/SeamsWeb/walletIframe/shared/messages';

/**
 * The app copy of the hosted auth menu (audit row 7.8) as it crosses the iframe boundary: the
 * defaults, how a partial override merges, and the refusal of a key the menu does not know. The
 * browser check shows that the copy renders.
 */

const SESSION_ID = hostedAuthMenuSessionIdFromBoundary('conformance-copy-session');

function copyOf(copy: HostedAuthMenuCopyInput | undefined) {
  if (!SESSION_ID) throw new Error('Invalid session id fixture');
  return buildHostedAuthMenuOpenRequest({
    authMenuSessionId: SESSION_ID,
    ...(copy ? { copy } : {}),
  }).copy;
}

test('without app copy the menu uses its default copy', () => {
  expect(copyOf(undefined)).toEqual({
    login: { title: 'Welcome back', subtitle: '', passkeyCta: 'Unlock with passkey' },
    register: {
      title: 'Create a wallet',
      subtitle: '',
      passkeyCta: 'Create wallet with passkey',
      passkeyNameLabel: 'Wallet name',
    },
    common: { closeLabel: 'Close' },
  });
});

test('app copy replaces only the keys it names, trimmed; a blank value keeps the default', () => {
  expect(
    copyOf({
      login: { title: '  Sign in to Example  ', subtitle: '   ' },
      register: { passkeyNameLabel: 'Example name' },
      common: { closeLabel: 'Dismiss' },
    }),
  ).toEqual({
    login: { title: 'Sign in to Example', subtitle: '', passkeyCta: 'Unlock with passkey' },
    register: {
      title: 'Create a wallet',
      subtitle: '',
      passkeyCta: 'Create wallet with passkey',
      passkeyNameLabel: 'Example name',
    },
    common: { closeLabel: 'Dismiss' },
  });
});

const UNKNOWN_KEY_COPIES: readonly { readonly name: string; readonly copy: unknown }[] = [
  { name: 'a top-level key', copy: { footer: { text: 'x' } } },
  { name: 'a login key', copy: { login: { heading: 'x' } } },
  { name: 'a register key', copy: { register: { walletNameLabel: 'x' } } },
  { name: 'a common key', copy: { common: { backLabel: 'x' } } },
];

for (const { name, copy } of UNKNOWN_KEY_COPIES) {
  test(`copy with ${name} the menu does not know is refused on both sides of the iframe`, () => {
    // The app page refuses it before it sends the request.
    expect(() => copyOf(copy as HostedAuthMenuCopyInput)).toThrow(
      'Hosted auth-menu open configuration contains unsupported fields',
    );
    // The wallet host refuses a request that carries it.
    const request = {
      ...buildHostedAuthMenuOpenRequest({ authMenuSessionId: SESSION_ID! }),
      copy,
    };
    expect(parseHostedAuthMenuOpenRequest(request)).toBeNull();
  });
}
