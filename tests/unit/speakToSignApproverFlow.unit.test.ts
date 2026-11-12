// The spoken request flow of the approver (core/transactionFeatures/approver), against a fake
// Wallet core (helpers/speakToSignFakeCore.ts).

import { expect, test } from '@playwright/test';
import type {
  SpeakToSignRequestView,
  SpeakToSignSigning,
} from '@/core/transactionFeatures/hostPlugin';
import { runApproval } from '@/core/transactionFeatures/approver/flow';
import { heardCaption } from '@/core/transactionFeatures/approver/heardWords';
import {
  fakeHost,
  routeFailure,
  TRANSFER_VIEW,
  verifierOutput,
} from './helpers/speakToSignFakeCore';

function view(overrides: Partial<SpeakToSignRequestView>): SpeakToSignRequestView {
  return { ...TRANSFER_VIEW, counterparty: null, amount: null, summary: null, ...overrides };
}

test('a spoken payment sends each recording to core and lets core sign with the output', async () => {
  const host = fakeHost();
  const input = host.approval();
  const result = await runApproval(input);
  expect(result).toMatchObject({ kind: 'sent', transactionHash: 'tx-hash', approval: 'voice' });
  expect(host.events).toEqual([
    'record',
    'show: Checking what you said',
    'verify',
    'sign',
    'show: Sending from your account',
    'show: Sent 25 NEAR',
  ]);
  // The plugin gives core the handle of the recording and the verifier output, and nothing else.
  expect(host.verified).toHaveLength(1);
  expect(host.signed).toEqual([{ verdict: 'opaque' }]);
  expect(host.views).toEqual([
    'check:Checking what you said',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
});

test('a step-up asks for the passkey on the card, then pays', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'executed', transactionHash: 'tx-2', approval: 'voice_and_passkey' }],
    choices: ['action'],
  });
  expect(await runApproval(host.approval())).toMatchObject({
    kind: 'sent',
    approval: 'voice_and_passkey',
  });
  expect(host.views).toEqual([
    'check:Checking what you said',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'result:Not sent yet:Confirm with your passkey:Confirm with passkey',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
});

test('closing the step-up question signs nothing', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'executed', transactionHash: 'tx-3', approval: 'voice_and_passkey' }],
  });
  expect(await runApproval(host.approval())).toEqual({ kind: 'cancelled' });
});

test('a refusal shows on the card, and "Try again" records the sentence again', async () => {
  const host = fakeHost({
    outcomes: [
      { kind: 'refused', reason: 'words', detail: 'heard: send 0.1 near to alice.testnet' },
      { kind: 'executed', transactionHash: 'tx-4', approval: 'voice' },
    ],
    choices: ['action'],
  });
  expect(await runApproval(host.approval())).toMatchObject({
    kind: 'sent',
    transactionHash: 'tx-4',
  });
  expect(host.views).toEqual([
    'check:Checking what you said',
    'result:Nothing was sent:The words did not match:Try again',
    'check:Checking what you said',
    'check:Sending from your account',
    'result::Sent 25 NEAR:Done',
  ]);
  // Each recording is a new handle.
  expect(host.verified).toHaveLength(2);
  expect(host.verified[0]).not.toBe(host.verified[1]);
});

test('a request records at most five times, then the refusal offers only Close', async () => {
  const host = fakeHost({
    outcomes: Array.from({ length: 5 }, () => ({ kind: 'refused', reason: 'speaker' }) as const),
    choices: ['action', 'action', 'action', 'action', 'action', 'action'],
  });
  expect(await runApproval(host.approval())).toEqual({ kind: 'refused', reason: 'speaker' });
  expect(host.verified).toHaveLength(5);
  expect(host.views.filter((name) => name.startsWith('result:'))).toEqual([
    ...Array.from(
      { length: 4 },
      () => 'result:Nothing was sent:Your voice did not match:Try again',
    ),
    'result:Nothing was sent:Your voice did not match:Close',
  ]);
});

test('the words that the verifier heard are aligned with the sentence and marked', () => {
  const caption = heardCaption(
    'send twenty five near to alice dot testnet',
    'heard: send twenty year to alice dot testnet <b>',
  );
  expect(caption).toEqual([
    'We heard “',
    'send',
    ' ',
    'twenty',
    ' ',
    { mark: 'year' },
    ' ',
    'to',
    ' ',
    'alice',
    ' ',
    'dot',
    ' ',
    'testnet',
    ' ',
    { mark: '<b>' },
    '”',
  ]);
});

test('a words refusal shows the words that the verifier heard on the result card', async () => {
  const detail = 'heard: send twenty year to alice dot testnet <b>';
  const host = fakeHost({ outcomes: [{ kind: 'refused', reason: 'words', detail }] });
  await runApproval(host.approval());
  expect(host.captions).toEqual([
    heardCaption('send twenty five near to alice dot testnet', detail),
  ]);
});

test('a failure of the verify route signs nothing', async () => {
  const host = fakeHost({ reply: routeFailure('verifier_timeout') });
  expect(await runApproval(host.approval())).toEqual({
    kind: 'unavailable',
    reason: 'verifier_unavailable',
    detail: 'verifier_timeout',
  });
  expect(host.signed).toEqual([]);
});

test('an OutLayer timeout names OutLayer, and another route failure does not', async () => {
  const timedOut = fakeHost({ reply: routeFailure('verifier_timeout') });
  await runApproval(timedOut.approval());
  expect(timedOut.events).toContain('show: OutLayer timed out');
  expect(timedOut.captions).toEqual(['The OutLayer verifier did not answer in time.']);

  const unreachable = fakeHost({ reply: routeFailure('verifier_unreachable') });
  await runApproval(unreachable.approval());
  expect(unreachable.events).toContain('show: The check is not available');
});

const CORE_OUTCOMES: Array<[string, SpeakToSignSigning, object]> = [
  [
    'a verdict mismatch',
    { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
    { kind: 'refused', reason: 'verdict_mismatch', detail: 'request_digest differs' },
  ],
  [
    'a verifier refusal',
    { kind: 'refused', reason: 'speaker' },
    { kind: 'refused', reason: 'speaker' },
  ],
  [
    'a failed transfer',
    { kind: 'reverted', transactionHash: 'tx', error: 'NotEnoughBalance' },
    { kind: 'refused', reason: 'transaction_failed', detail: 'NotEnoughBalance' },
  ],
  [
    'a transfer that was not sent',
    { kind: 'not_submitted', error: 'closed' },
    { kind: 'unavailable', reason: 'not_submitted', detail: 'closed' },
  ],
  [
    'a message that was not signed',
    { kind: 'not_signed', error: 'closed' },
    { kind: 'unavailable', reason: 'not_submitted', detail: 'closed' },
  ],
  [
    'a co-signer refusal',
    { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
    { kind: 'refused', reason: 'cosigner_refused', detail: 'reused' },
  ],
  [
    'a network with no verifier',
    { kind: 'unavailable', detail: 'This network has no verifier.' },
    {
      kind: 'unavailable',
      reason: 'verifier_unavailable',
      detail: 'This network has no verifier.',
    },
  ],
];

for (const [name, outcome, expected] of CORE_OUTCOMES) {
  test(`${name} from core maps to its result`, async () => {
    const host = fakeHost({ outcomes: [outcome] });
    expect(await runApproval(host.approval())).toEqual(expected);
  });
}

test('the card names a refusal of the co-signer', async () => {
  const host = fakeHost({
    outcomes: [{ kind: 'refused', reason: 'cosigner_refused', detail: 'reused' }],
  });
  await runApproval(host.approval());
  expect(host.views.at(-1)).toBe('result:Nothing was sent:Seams refused the verdict:Try again');
});

test('a cancelled recording goes to no verifier', async () => {
  const host = fakeHost({ clips: [{ kind: 'cancelled' }] });
  expect(await runApproval(host.approval())).toEqual({ kind: 'cancelled' });
  expect(host.verified).toEqual([]);
});

test('a recording that VoiceID cannot make is unavailable', async () => {
  const host = fakeHost({
    clips: [{ kind: 'unavailable', detail: 'VoiceID is missing from this Wallet host.' }],
  });
  expect(await runApproval(host.approval())).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'VoiceID is missing from this Wallet host.',
  });
});

const DONE_CARDS: Array<[string, Partial<SpeakToSignRequestView>, string]> = [
  ['a note', { kind: 'community_note', summary: 'Only one lane closes.' }, 'Note posted'],
  ['a rating', { kind: 'note_rating' }, 'Rating saved'],
  ['a merge approval', { kind: 'merge_approval' }, 'Merge approved'],
  ['a bet', { kind: 'market_bet' }, 'Bet placed'],
  ['a sent transaction', { kind: 'transaction', counterparty: 'guest-book.testnet' }, 'Transaction sent'],
];

for (const [name, overrides, headline] of DONE_CARDS) {
  test(`${name} that core sent ends with its card`, async () => {
    const host = fakeHost();
    expect(await runApproval(host.approval(view(overrides)))).toMatchObject({ kind: 'sent' });
    expect(host.views.at(-1)).toBe(`result::${headline}:Done`);
  });
}

test('a message that core signed ends with the signature and its card', async () => {
  const signed = {
    kind: 'signed',
    approval: 'voice',
    accountId: 'owner.testnet',
    publicKey: 'ed25519:owner',
    signature: 'c2lnbmF0dXJl',
    nonce: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=',
  } as const;
  const host = fakeHost({ outcomes: [signed] });
  const request = view({ kind: 'signed_message', form: 'message', counterparty: 'example.app' });
  const result = await runApproval(host.approval(request));
  expect(result).toMatchObject(signed);
  expect(result).toHaveProperty('times');
  expect(host.views.at(-1)).toBe('result::Message signed:Done');
});

test('a general transaction that core signs and does not send ends with the signature', async () => {
  const signed = { signedTransaction: {}, nearAccountId: 'owner.testnet' } as never;
  for (const [form, kind, headline] of [
    ['sign', 'signed_transaction', 'Transaction signed'],
    ['delegate', 'signed_delegate', 'Delegate action signed'],
  ] as const) {
    const host = fakeHost({ outcomes: [{ kind, signed, approval: 'voice' }] });
    const request = view({ kind: 'transaction', form, counterparty: 'guest-book.testnet' });
    expect(await runApproval(host.approval(request))).toMatchObject({ kind, signed, approval: 'voice' });
    expect(host.views.at(-1)).toBe(`result::${headline}:Done`);
  }
});

/** A verify output whose signed verdict names verifier `version`. Core checks it, not the card. */
function signedOutput(version: string): unknown {
  return {
    kind: 'seams_voice_verify_output_v2',
    verdict_json: JSON.stringify({ verifier: version, outcome: 'accept' }),
    signature_b64: 'c2ln',
    public_key: 'ed25519:key',
    policy_text: null,
    ms: {},
    detail: null,
  };
}

const ATTESTATION =
  'https://testnet-api.outlayer.ai/attestations/by-call/357b87bb-c366-4327-8f09-eff79a722877';

test('the paid card has the TEE receipt: the voice, the words, the verdict and the TDX quote', async () => {
  const host = fakeHost({ reply: verifierOutput(signedOutput('0.13.0'), ATTESTATION) });
  await runApproval(host.approval());
  expect(host.receipts.at(-1)).toEqual({
    title: 'TEE receipt',
    source: 'Intel TDX · OutLayer',
    rows: [
      { label: 'Voice', value: 'matched owner.testnet' },
      { label: 'Words', value: 'matched the sentence' },
      { label: 'Verdict', value: 'signed by the OutLayer verifier 0.13.0' },
    ],
    link: { text: 'View TDX quote', href: ATTESTATION },
  });
});

test('the receipt of a note has the summary check from verifier 0.13.0, and no link without a quote', async () => {
  const note = view({ kind: 'community_note', summary: 'Only one lane closes.' });
  const host = fakeHost({ reply: verifierOutput(signedOutput('0.13.0')) });
  await runApproval(host.approval(note));
  expect(host.receipts.at(-1)).toEqual({
    title: 'TEE receipt',
    source: 'Intel TDX · OutLayer',
    rows: [
      { label: 'Voice', value: 'matched owner.testnet' },
      { label: 'Words', value: 'matched the summary' },
      { label: 'Summary', value: 'fits the note (JEV)' },
      { label: 'Verdict', value: 'signed by the OutLayer verifier 0.13.0' },
    ],
  });
  // An older verifier did not check the summary, and an output with no version names none.
  const older = fakeHost({ reply: verifierOutput(signedOutput('0.12.0')) });
  await runApproval(older.approval(note));
  expect((older.receipts.at(-1) as { rows: { label: string }[] }).rows.map((row) => row.label)).toEqual([
    'Voice',
    'Words',
    'Verdict',
  ]);
  const opaque = fakeHost();
  await runApproval(opaque.approval());
  expect((opaque.receipts.at(-1) as { rows: { value: string }[] }).rows.at(-1)?.value).toBe(
    'signed by the OutLayer verifier',
  );
});
