import { expect, test } from '@playwright/test';
import { spokenRequestContext } from '@/core/transactionFeatures/spokenRequestContext';
import type { SpokenIntent } from '@/core/transactionFeatures/spokenIntent';
import {
  addKey,
  deleteAccount,
  functionCall,
  transfer,
} from '@/core/types/actionBuilders';
import type { ActionArgs } from '@/core/types/actions';

const SUMMARY = 'Sign the guest book.';
const TESTNET_USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';

function transaction(receiverId: string, actions: ActionArgs[]): SpokenIntent {
  return {
    kind: 'transaction',
    transaction: { receiverId, actions },
    actionsSha256: new Uint8Array(32),
    summary: SUMMARY,
    delivery: 'send',
  };
}

function lines(intent: SpokenIntent): string[] | undefined {
  return spokenRequestContext('testnet', intent)?.text.split('\n');
}

test('the card of a general transaction shows the receiver and each action', () => {
  const intent = transaction('guest-book.testnet', [
    functionCall({
      method: 'add_message',
      args: { text: 'hello' },
      gas: '30000000000000',
      deposit: '0',
    }),
  ]);
  expect(spokenRequestContext('testnet', intent)?.label).toBe('This request');
  expect(lines(intent)).toEqual([
    'To guest-book.testnet',
    'Calling add_message with 0 NEAR using 30 Tgas',
    'Arguments: {"text":"hello"}',
  ]);
});

test('the same words cannot hide a transfer, a new key or a deleted account', () => {
  const key = 'ed25519:8fQk3TqNfJ2vYw6sLm1ZcXa4RdUe7HgBpKnMtVx9WbPz';
  expect(
    lines(
      transaction('alice.testnet', [
        transfer('250 NEAR'),
        addKey({ publicKey: key, accessKey: { nonce: 0n, permission: 'FullAccess' } }),
        deleteAccount('mallory.testnet'),
      ]),
    ),
  ).toEqual([
    'To alice.testnet',
    'Transfer 250 NEAR',
    'Adding Key',
    'key: ed25519:8fQk...x9WbPz',
    'permissions: Full Access',
    'Deleting Account',
    'sending balance to: mallory.testnet',
  ]);
});

test('a token transfer shows its amount only for a token on the Wallet list', () => {
  const send = (contract: string) =>
    lines(
      transaction(contract, [
        functionCall({
          method: 'ft_transfer',
          args: { receiver_id: 'bob.testnet', amount: '12500000' },
          gas: '30000000000000',
          deposit: '1',
        }),
      ]),
    );
  expect(send(TESTNET_USDC)).toEqual([
    `To ${TESTNET_USDC}`,
    'Calling ft_transfer with 1 yoctoNEAR using 30 Tgas',
    'Token transfer: 12.5 USDC to bob.testnet',
    'Required security deposit: 1 yoctoNEAR',
    'Arguments: {"receiver_id":"bob.testnet","amount":"12500000"}',
  ]);
  // A contract that the Wallet does not list can claim any symbol: the card shows its arguments.
  expect(send('usdc.fake.testnet')).toEqual([
    'To usdc.fake.testnet',
    'Calling ft_transfer with 1 yoctoNEAR using 30 Tgas',
    'Required security deposit: 1 yoctoNEAR',
    'Arguments: {"receiver_id":"bob.testnet","amount":"12500000"}',
  ]);
});

test('long arguments are cut, and the card says how much is left', () => {
  const [, , args] =
    lines(
      transaction('guest-book.testnet', [
        functionCall({ method: 'add_message', args: { text: 'a'.repeat(1_000) } }),
      ]),
    ) ?? [];
  expect(args.startsWith('Arguments: {"text":"aaa')).toBe(true);
  expect(args.endsWith('… (411 more characters)')).toBe(true);
});

test('a message shows its recipient and its text, and a note shows the note', () => {
  expect(
    spokenRequestContext('testnet', {
      kind: 'signed_message',
      message: {
        message: 'Log in to example.app at 10:42',
        recipient: 'example.app',
        nonce: '',
        callbackUrl: null,
        state: null,
        payloadSha256: new Uint8Array(32),
        summary: 'Log in to the example app',
      },
    }),
  ).toEqual({
    label: 'This request',
    text: 'Message for example.app\nLog in to example.app at 10:42',
  });
  expect(
    spokenRequestContext('testnet', {
      kind: 'community_note',
      postId: 7n,
      text: 'The photo is from 2019.',
      summary: 'This photo is old',
    } as SpokenIntent),
  ).toEqual({ label: 'Your note', text: 'The photo is from 2019.' });
});

test('a transfer needs no context: the Wallet writes its sentence', () => {
  expect(
    spokenRequestContext('testnet', {
      kind: 'account_transfer',
      receiver: 'bob.testnet',
      amountYocto: 10n ** 24n,
    } as SpokenIntent),
  ).toBeUndefined();
});
