import { expect, test } from '@playwright/test';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { thresholdEd25519Nep413OperationFingerprint } from '@shared/threshold/ed25519OperationFingerprint';
import { routerAbEd25519Nep413CanonicalMessageB64uV2 } from '../../packages/wallet/src/core/rpcClients/relayer/routerAbNormalSigning';

const NONCE = base64UrlEncode(new Uint8Array(32).fill(7));

function borshString(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  const length = bytes.length;
  return [length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, length >>> 24, ...bytes];
}

function includesBytes(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

test('the NEP-413 bytes hold the exact message, recipient and callback URL', () => {
  const canonical = base64UrlDecode(
    routerAbEd25519Nep413CanonicalMessageB64uV2({
      message: '  Sign in\n',
      recipient: ' app.example ',
      nonce: NONCE,
      callbackUrl: 'https://app.example/cb ',
    }),
  );
  expect(includesBytes(canonical, borshString('  Sign in\n'))).toBe(true);
  expect(includesBytes(canonical, borshString(' app.example '))).toBe(true);
  expect(includesBytes(canonical, borshString('https://app.example/cb '))).toBe(true);
});

test('a NEP-413 field that is not a non-empty string is refused, not converted', () => {
  for (const message of ['', 42, null]) {
    expect(() =>
      routerAbEd25519Nep413CanonicalMessageB64uV2({
        message: message as string,
        recipient: 'app.example',
        nonce: NONCE,
      }),
    ).toThrow(/nep413\.message must be a non-empty string/);
  }
});

test('two messages that differ only in whitespace are two operations', async () => {
  const scope = {
    nearAccountId: 'alice.testnet',
    nearNetworkId: 'testnet',
    relayerKeyId: 'relayer-key',
    signerPublicKey: 'ed25519:11111111111111111111111111111111',
    recipient: 'app.example',
    nonce: NONCE,
    callbackUrl: null,
  };
  const plain = await thresholdEd25519Nep413OperationFingerprint({ ...scope, message: 'hello' });
  const padded = await thresholdEd25519Nep413OperationFingerprint({ ...scope, message: 'hello ' });
  expect(padded).not.toBe(plain);
});
