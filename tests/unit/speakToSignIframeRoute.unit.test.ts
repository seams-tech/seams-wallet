import { expect, test } from '@playwright/test';
import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import type {
  AuthMethodPhraseRequest,
  AuthMethodPhraseSurface,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import type { WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import type {
  SpeakToSignEnrollmentResult,
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WalletTransactionFeaturePlugin } from '@/core/transactionFeatures/plugins';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import { createIframeSpeakToSignCommands } from '@/SeamsWeb/walletIframe/client/speakToSignCommands';
import { routeWalletHostRequest } from '@/SeamsWeb/walletIframe/host/requestRouter';
import {
  createSpeakToSignWalletIframeHandlers,
  type SpeakToSignWalletPorts,
} from '@/SeamsWeb/walletIframe/host/handlers/speakToSign';
import type {
  HandlerDeps,
  Req,
} from '@/SeamsWeb/walletIframe/host/handlers/walletIframeHandler.types';
import type { ChildToParentEnvelope, ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import {
  parseSpeakToSignEnrollmentResult,
  parseSpeakToSignEnrollPayload,
  parseSpeakToSignNotePayload,
  parseSpeakToSignNoteResult,
  parseSpeakToSignProgressV1,
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
} from '@/SeamsWeb/walletIframe/shared/speakToSign';

const WALLET_ID = 'wallet:speak-to-sign';
const PAYLOAD = { walletId: WALLET_ID, receiver: 'bob.testnet', amount: '2.5' } as const;
const FEATURE: WalletTransactionFeaturePlugin = { kind: 'speak_to_sign', network: 'testnet' };
const ENROLLED: SpeakToSignEnrollmentResult = {
  kind: 'enrolled',
  templateEpoch: 2,
  agreementMilli: 790,
};
const SENT: SpeakToSignTransferResult = {
  kind: 'sent',
  transactionHash: 'tx-1',
  approval: 'voice',
  times: { speechMs: 1, verifyMs: 2, transactionMs: 4, endOfSpeechToReceiptMs: 5 },
};

test('the transfer message carries only the wallet, a NEAR receiver and a decimal amount', () => {
  expect(parseSpeakToSignTransferPayload({ ...PAYLOAD })).toEqual(PAYLOAD);
  for (const bad of [
    { ...PAYLOAD, vault: 'other.testnet' },
    { ...PAYLOAD, owner: 'victim.testnet' },
    { walletId: WALLET_ID, receiver: 'bob.testnet' },
    { ...PAYLOAD, receiver: 'Bob!' },
    { ...PAYLOAD, amount: 2.5 },
    { ...PAYLOAD, amount: '-1' },
    { ...PAYLOAD, amount: '1e3' },
    { ...PAYLOAD, walletId: '' },
    null,
  ]) {
    expect(() => parseSpeakToSignTransferPayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign transfer request is invalid.',
    );
  }
});

test('the result parser accepts each result kind and refuses anything else', () => {
  const valid: SpeakToSignTransferResult[] = [
    SENT,
    { kind: 'cancelled' },
    { kind: 'refused', reason: 'speaker' },
    { kind: 'refused', reason: 'transaction_failed', detail: 'NotEnoughBalance' },
    { ...SENT, approval: 'voice_and_passkey' },
    { kind: 'unavailable', reason: 'voiceid_unavailable', detail: 'not_enrolled' },
    { kind: 'unavailable', reason: 'flow_not_available' },
  ];
  for (const result of valid) expect(parseSpeakToSignTransferResult(result)).toEqual(result);
  for (const bad of [
    undefined,
    { kind: 'sent', transactionHash: 'tx' },
    { ...SENT, approval: 'passkey' },
    { ...SENT, times: { ...SENT.times, speechMs: -1 } },
    { kind: 'refused', reason: 'not_a_reason' },
    { kind: 'unavailable', reason: 'speaker' },
    { kind: 'unavailable', reason: 'verifier_unavailable', detail: 7 },
    { kind: 'unavailable', reason: 'vault_missing' },
    { kind: 'cancelled', extra: true },
    { kind: 'paid' },
  ]) {
    expect(() => parseSpeakToSignTransferResult(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign transfer result is invalid.',
    );
  }
});

test('the app posts one interactive PM_SPEAK_TO_SIGN_TRANSFER and returns the typed result', async () => {
  const posted: unknown[][] = [];
  let reply: unknown = SENT;
  const commands = createIframeSpeakToSignCommands(async (...args) => {
    posted.push(args);
    return { result: reply };
  });
  expect(await commands.requestTransfer({ ...PAYLOAD })).toEqual(SENT);
  expect(posted).toEqual([
    [{ type: 'PM_SPEAK_TO_SIGN_TRANSFER', payload: PAYLOAD }, { timeout: 'interactive' }],
  ]);

  await expect(commands.requestTransfer({ ...PAYLOAD, amount: 'all' })).rejects.toThrow(
    'request is invalid',
  );
  expect(posted).toHaveLength(1);
  reply = { kind: 'sent' };
  await expect(commands.requestTransfer(PAYLOAD)).rejects.toThrow('result is invalid');
});

test('a progress listener gets the Speak-to-Sign progress of its request, parsed exactly', async () => {
  const heard: unknown[] = [];
  const commands = createIframeSpeakToSignCommands(async (_request, options) => {
    options.onProgress?.({
      event: 'speak_to_sign_progress_v1',
      progress: { stage: 'verifier_running' },
    });
    options.onProgress?.({ event: 'owner_near_submitting' } as never);
    return { result: SENT };
  });
  expect(
    await commands.requestTransfer({ ...PAYLOAD, onProgress: (progress) => heard.push(progress) }),
  ).toEqual(SENT);
  expect(heard).toEqual([{ stage: 'verifier_running' }]);
  // A listener that throws does not end the request.
  const throwing = () => {
    throw new Error('app bug');
  };
  expect(await commands.requestTransfer({ ...PAYLOAD, onProgress: throwing })).toEqual(SENT);

  const event = 'speak_to_sign_progress_v1';
  for (const progress of [
    { stage: 'recording_sent' },
    { stage: 'verifier_running' },
    { stage: 'verdict', ms: { speaker: 1400, transcribe: 750 } },
    { stage: 'step_up', policyText: 'A voice payment above 10 NEAR needs a passkey.' },
    { stage: 'step_up', policyText: null },
    { stage: 'transaction_sent' },
    { stage: 'settled', transactionHash: 'tx-hash' },
  ]) {
    expect(parseSpeakToSignProgressV1({ event, progress }), progress.stage).toEqual({
      event,
      progress,
    });
  }
  for (const progress of [
    { stage: 'vault_accepted' },
    { stage: 'recording_sent', extra: 1 },
    { stage: 'verdict', ms: { speaker: 'slow' } },
    { stage: 'step_up' },
    { stage: 'settled', transactionHash: '' },
  ]) {
    expect(parseSpeakToSignProgressV1({ event, progress }), JSON.stringify(progress)).toBeNull();
  }
  expect(parseSpeakToSignProgressV1({ event: 'other', progress: { stage: 'settled' } })).toBeNull();
});

test('the Wallet host routes the message to its NEAR runtime with a parsed payload', () => {
  const route = routeWalletHostRequest({
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    requestId: 'request-1',
    payload: { ...PAYLOAD },
  });
  expect(route).toMatchObject({
    signingPolicy: 'none',
    kind: 'near',
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    request: { requestId: 'request-1', payload: PAYLOAD },
  });
  const forged = {
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    requestId: 'request-2',
    payload: { ...PAYLOAD, vault: 'other.testnet' },
  } as unknown as ParentToChildEnvelope;
  expect(() => routeWalletHostRequest(forged)).toThrow('request is invalid');
});

type HandlerHarnessOptions = {
  readonly features?: readonly WalletTransactionFeaturePlugin[];
  readonly voiceId?: AuthMethodAvailability['kind'];
  readonly relayerUrl?: string;
  readonly nearReady?: boolean;
  readonly cancelled?: () => boolean;
  readonly plugin?: SpeakToSignHostPlugin['requestTransfer'];
  /** What VoiceID activation does: keep three samples, check an existing enrollment, or close. */
  readonly activation?: 'new_enrollment' | 'existing_enrollment' | 'cancelled';
};

function buildHandler(options: HandlerHarnessOptions = {}) {
  const posted: ChildToParentEnvelope[] = [];
  const pluginCalls: Parameters<SpeakToSignHostPlugin['requestTransfer']>[0][] = [];
  const enrollCalls: Parameters<SpeakToSignHostPlugin['enroll']>[0][] = [];
  const loads: (readonly WalletTransactionFeaturePlugin[])[] = [];
  const messages: unknown[] = [];
  const fetched: { url: string; init: RequestInit }[] = [];
  const binding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' };
  const features = options.features ?? [FEATURE];
  const authMethods: readonly WalletAuthMethodPlugin[] = [{ kind: 'voiceid' }];
  const recorderLoads: (readonly WalletAuthMethodPlugin[])[] = [];
  const phrases: AuthMethodPhraseRequest[] = [];
  const recorded = new Float32Array([0.5, -0.5, 0.25]);
  let voiceIdKind = options.voiceId ?? 'enabled';
  const enrollmentSamples = [0.1, 0.2, 0.3].map((value) => new Float32Array([value, -value]));
  const activations: Parameters<WalletAuthMethodHostPlugin['activate']>[0][] = [];
  const voiceId = {
    async activate(input) {
      activations.push(input);
      const activation = options.activation ?? 'new_enrollment';
      if (activation === 'cancelled') return { kind: 'cancelled' };
      if (activation === 'new_enrollment') {
        input.keepRecordings?.(
          enrollmentSamples.map((samples, index) => ({
            samples,
            sentence: `Phrase ${index + 1}.`,
          })),
        );
      }
      voiceIdKind = 'enabled';
      return {
        kind: 'activated',
        walletId: WALLET_ID,
        walletAuthMethodId: 'wallet-auth-method:voice',
      } as Awaited<ReturnType<WalletAuthMethodHostPlugin['activate']>>;
    },
    async openPhrase(request: AuthMethodPhraseRequest): Promise<AuthMethodPhraseSurface> {
      phrases.push(request);
      return {
        record: async () => ({ kind: 'recorded', samples: recorded, endOfSpeechAt: 7 }),
        show: async () => 'closed',
        close: () => undefined,
      };
    },
  } as WalletAuthMethodHostPlugin;
  const runtime = {
    configs: {
      authMethods,
      transactionFeatures: features,
      network: { relayer: { url: options.relayerUrl ?? 'https://relay.example.test' } },
    },
    auth: {
      async getSession() {
        return {
          appIdentity: {
            kind: 'resolved',
            nearAccountId: options.nearReady === false ? null : 'owner.testnet',
          },
        };
      },
    },
    getContext: () => ({ nearClient: { view: async () => ({}) } }),
    near: {
      async signMessage(args: unknown) {
        messages.push(args);
        return {
          success: true,
          accountId: 'owner.testnet',
          publicKey: 'ed25519:owner',
          signature: 'c2ln',
          nonce: 'bm9uY2U=',
        };
      },
    },
  };
  const deps = {
    getWalletRuntime: () => runtime,
    post: (message: ChildToParentEnvelope) => void posted.push(message),
    postProgress: () => {},
    isCancelled: () => options.cancelled?.() ?? false,
    respondIfCancelled: () => false,
    surfaceMeasurementBinding: () => binding,
  } as unknown as HandlerDeps;
  const plugin: SpeakToSignHostPlugin = {
    async requestTransfer(input) {
      pluginCalls.push(input);
      return options.plugin ? await options.plugin(input) : SENT;
    },
    async requestNoteAction() {
      throw new Error('This route test runs no note.');
    },
    async enroll(input) {
      enrollCalls.push(input);
      return ENROLLED;
    },
  };
  const ports: SpeakToSignWalletPorts = {
    async readVoiceIdAvailability() {
      const kind = voiceIdKind;
      return kind === 'not_enrolled'
        ? { kind }
        : ({ kind, walletAuthMethodId: 'wallet-auth-method:voice' } as AuthMethodAvailability);
    },
    readOperationCredential: async () => 'wst_credential',
    async loadHost(enabled) {
      loads.push(enabled);
      return plugin;
    },
    async loadVoiceIdHost(methods) {
      recorderLoads.push(methods);
      return voiceId;
    },
    fetch: (async (url: URL, init: RequestInit) => {
      fetched.push({ url: String(url), init });
      return Response.json({ ok: true, output: { verdict_json: '{}' } });
    }) as typeof fetch,
  };
  const handlers = createSpeakToSignWalletIframeHandlers(deps, ports);
  const handler = handlers.PM_SPEAK_TO_SIGN_TRANSFER;
  const enrollHandler = handlers.PM_SPEAK_TO_SIGN_ENROLL;
  if (!handler || !enrollHandler) throw new Error('The handler map has no Speak-to-Sign handler');
  const request = {
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    requestId: 'request-1',
    payload: PAYLOAD,
  } as Req<'PM_SPEAK_TO_SIGN_TRANSFER'>;
  const enrollRequest = {
    type: 'PM_SPEAK_TO_SIGN_ENROLL',
    requestId: 'request-enroll',
    payload: { walletId: WALLET_ID },
  } as Req<'PM_SPEAK_TO_SIGN_ENROLL'>;
  return {
    run: () => handler(request),
    runEnroll: () => enrollHandler(enrollRequest),
    posted,
    pluginCalls,
    enrollCalls,
    loads,
    messages,
    fetched,
    binding,
    authMethods,
    recorderLoads,
    phrases,
    recorded,
    activations,
    enrollmentSamples,
  };
}

test('the handler gives the plugin the owner, the network and scoped operations', async () => {
  const harness = buildHandler();
  await harness.run();
  expect(harness.loads).toEqual([[FEATURE]]);
  expect(harness.pluginCalls).toHaveLength(1);
  const [input] = harness.pluginCalls;
  expect(input).toMatchObject({ walletId: WALLET_ID, network: 'testnet' });
  expect('vault' in input).toBe(false);
  expect(input.signal.aborted).toBe(false);
  const transfer = input.transfer;
  if (!transfer) throw new Error('The handler sent no transfer');
  expect(transfer.ownerAccountId).toBe('owner.testnet');
  expect(transfer.receiver).toBe('bob.testnet');
  expect(transfer.amount).toBe('2.5');
  expect(transfer.surfaceMeasurementBinding).toBe(harness.binding);

  const signal = new AbortController().signal;
  expect(harness.recorderLoads).toEqual([]);
  const opened = await transfer.operations.openPrompt({
    sentence: 'Send two NEAR to bob',
    signal,
    surfaceMeasurementBinding: harness.binding,
  });
  if (opened.kind !== 'opened') throw new Error('VoiceID did not open');
  const clip = await opened.prompt.record();
  expect(harness.recorderLoads).toEqual([harness.authMethods]);
  expect(harness.phrases).toEqual([
    { sentence: 'Send two NEAR to bob', signal, surfaceMeasurementBinding: harness.binding },
  ]);
  if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
  expect(clip.wav.length).toBe(44 + 3 * 2);
  expect(clip.endOfSpeechAt).toBe(7);
  // Core wipes the samples once the WAV holds them.
  expect([...harness.recorded]).toEqual([0, 0, 0]);
  await transfer.operations.verify({ op: 'verify', owner: 'owner.testnet' }, signal);
  expect(harness.fetched.map(({ url }) => url)).toEqual([
    'https://relay.example.test/speak-to-sign/v1/verify',
  ]);
  expect(new Headers(harness.fetched[0].init.headers).get('authorization')).toBe(
    'Bearer wst_credential',
  );
  // A verdict that the pinned testnet key did not sign pays nothing.
  expect(
    await transfer.operations.payWithVerdict(
      { receiver: 'bob.testnet', amountYocto: 25n * 10n ** 23n },
      {
        kind: 'seams_voice_verify_output_v2',
        verdict_json: '{}',
        signature_b64: 'c2ln',
        public_key: 'ed25519:other',
        policy_text: null,
        ms: {},
      },
      signal,
      {
        accepted: () => undefined,
        approveStepUp: async () => true,
        broadcasting: () => undefined,
        included: () => undefined,
      },
    ),
  ).toEqual({ kind: 'refused', reason: 'verdict_mismatch', detail: 'unknown verdict kind' });
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-1', payload: { ok: true, result: SENT } },
  ]);
});

test('missing VoiceID or a missing Seams server ends as unavailable without loading the plugin', async () => {
  for (const [options, detail] of [
    [{ voiceId: 'not_enrolled' }, 'not_enrolled'],
    [{ voiceId: 'disabled' }, 'disabled'],
  ] as const) {
    const harness = buildHandler(options);
    await harness.run();
    expect(harness.loads).toHaveLength(0);
    expect(harness.posted[0].payload).toEqual({
      ok: true,
      result: { kind: 'unavailable', reason: 'voiceid_unavailable', detail },
    });
  }
  const noServer = buildHandler({ relayerUrl: '' });
  await noServer.run();
  expect(noServer.loads).toHaveLength(0);
  expect(noServer.posted[0].payload).toEqual({
    ok: true,
    result: { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'no Seams server' },
  });
});

test('a Wallet without the descriptor or a ready NEAR account refuses the request', async () => {
  await expect(buildHandler({ features: [] }).run()).rejects.toThrow('Enable Speak-to-Sign');
  const pending = buildHandler({ nearReady: false });
  await expect(pending.run()).rejects.toThrow('NEAR account of this wallet is not ready');
  expect(pending.loads).toHaveLength(0);
});

test('a host cancellation aborts the signal the plugin listens to', async () => {
  let cancelled = false;
  const harness = buildHandler({
    cancelled: () => cancelled,
    async plugin(input) {
      cancelled = true;
      await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve()));
      return { kind: 'cancelled' };
    },
  });
  await harness.run();
  expect(harness.pluginCalls[0].signal.aborted).toBe(true);
  expect(harness.posted[0].payload).toEqual({ ok: true, result: { kind: 'cancelled' } });
});

test('the enrollment message carries only the wallet and its result parser is exact', async () => {
  expect(parseSpeakToSignEnrollPayload({ walletId: WALLET_ID })).toEqual({ walletId: WALLET_ID });
  for (const bad of [{ walletId: WALLET_ID, owner: 'victim.testnet' }, { walletId: '' }, null]) {
    expect(() => parseSpeakToSignEnrollPayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign enrollment request is invalid.',
    );
  }
  for (const result of [
    ENROLLED,
    { kind: 'cancelled' },
    { kind: 'refused', reason: 'not_authorized' },
    { kind: 'refused', reason: 'speaker', detail: 'agreement 410' },
    { kind: 'unavailable', reason: 'verifier_unavailable' },
  ] as const) {
    expect(parseSpeakToSignEnrollmentResult(result)).toEqual(result);
  }
  for (const bad of [
    { ...ENROLLED, templateEpoch: 0 },
    { ...ENROLLED, extra: 1 },
    { ...ENROLLED, transactionHash: 'tx-auth' },
    { kind: 'refused', reason: 'words' },
    { kind: 'sent', transactionHash: 'tx', times: SENT.kind === 'sent' ? SENT.times : null },
  ]) {
    expect(() => parseSpeakToSignEnrollmentResult(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign enrollment result is invalid.',
    );
  }

  const posted: unknown[][] = [];
  const commands = createIframeSpeakToSignCommands(async (...args) => {
    posted.push(args);
    return { result: ENROLLED };
  });
  expect(await commands.enroll({ walletId: WALLET_ID })).toEqual(ENROLLED);
  expect(posted).toEqual([
    [{ type: 'PM_SPEAK_TO_SIGN_ENROLL', payload: { walletId: WALLET_ID } }, { timeout: 'interactive' }],
  ]);
  expect(
    routeWalletHostRequest({
      type: 'PM_SPEAK_TO_SIGN_ENROLL',
      requestId: 'request-3',
      payload: { walletId: WALLET_ID },
    }),
  ).toMatchObject({ signingPolicy: 'none', kind: 'near', type: 'PM_SPEAK_TO_SIGN_ENROLL' });
});

test('the enrollment handler gives the plugin the owner and signs through the NEP-413 path', async () => {
  const harness = buildHandler();
  await harness.runEnroll();
  expect(harness.pluginCalls).toHaveLength(0);
  expect(harness.enrollCalls).toHaveLength(1);
  const [input] = harness.enrollCalls;
  expect(input).toMatchObject({
    walletId: WALLET_ID,
    network: 'testnet',
    ownerAccountId: 'owner.testnet',
  });
  expect(input.surfaceMeasurementBinding).toBe(harness.binding);
  const signal = new AbortController().signal;
  const clips: Uint8Array<ArrayBuffer>[] = [];
  for (const sentence of ['one', 'two', 'three']) {
    harness.recorded.set([0.5, -0.5, clips.length / 10]);
    const opened = await input.operations.openPrompt({
      sentence,
      signal,
      surfaceMeasurementBinding: harness.binding,
    });
    if (opened.kind !== 'opened') throw new Error('VoiceID did not open');
    const clip = await opened.prompt.record();
    if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
    clips.push(clip.wav);
  }
  expect(await input.operations.authorizeEnrollment(clips, signal)).toEqual({
    kind: 'signed',
    authorization: { public_key: 'ed25519:owner', signature_b64: 'c2ln', nonce_b64: 'bm9uY2U=' },
  });
  expect(harness.messages).toMatchObject([
    {
      walletSession: { walletId: WALLET_ID },
      nearAccount: { accountId: 'owner.testnet' },
      params: { recipient: 'seams-v1.testnet/voice-verifier' },
    },
  ]);
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-enroll', payload: { ok: true, result: ENROLLED } },
  ]);

  expect(harness.activations).toHaveLength(0);
  expect(input.recordings).toBeNull();

  const disabled = buildHandler({ voiceId: 'disabled' });
  await disabled.runEnroll();
  expect(disabled.activations).toHaveLength(0);
  expect(disabled.enrollCalls).toHaveLength(0);
  expect(disabled.posted[0].payload).toEqual({
    ok: true,
    result: { kind: 'unavailable', reason: 'voiceid_unavailable', detail: 'disabled' },
  });
});

test('a wallet without VoiceID activates it, and its three samples are the enrollment clips', async () => {
  const harness = buildHandler({ voiceId: 'not_enrolled' });
  await harness.runEnroll();
  expect(harness.activations).toHaveLength(1);
  expect(harness.activations[0]).toMatchObject({ walletId: WALLET_ID });
  expect(harness.activations[0].surfaceMeasurementBinding).toBe(harness.binding);
  expect(harness.enrollCalls).toHaveLength(1);
  const [input] = harness.enrollCalls;
  const recordings = input.recordings;
  if (!recordings) throw new Error('The enrollment has no VoiceID recordings');
  expect(recordings.map((recording) => recording.sentence)).toEqual([
    'Phrase 1.',
    'Phrase 2.',
    'Phrase 3.',
  ]);
  // The Wallet keeps only the WAV clips; the samples are cleared.
  for (const samples of harness.enrollmentSamples) expect([...samples]).toEqual([0, 0]);
  const signal = new AbortController().signal;
  const clips = recordings.map((recording) => recording.wav);
  expect(await input.operations.authorizeEnrollment(clips, signal)).toMatchObject({
    kind: 'signed',
  });
  // A clip that neither VoiceID nor this flow recorded stays refused.
  const foreign = [clips[0], clips[1], new Uint8Array(clips[2].length)];
  expect(await input.operations.authorizeEnrollment(foreign, signal)).toEqual({
    kind: 'not_signed',
    error: 'Only recordings of this enrollment can be authorized.',
  });
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-enroll', payload: { ok: true, result: ENROLLED } },
  ]);

  const existing = buildHandler({ voiceId: 'not_enrolled', activation: 'existing_enrollment' });
  await existing.runEnroll();
  expect(existing.enrollCalls).toHaveLength(1);
  expect(existing.enrollCalls[0].recordings).toBeNull();

  const closed = buildHandler({ voiceId: 'not_enrolled', activation: 'cancelled' });
  await closed.runEnroll();
  expect(closed.enrollCalls).toHaveLength(0);
  expect(closed.posted[0].payload).toEqual({ ok: true, result: { kind: 'cancelled' } });
});

test('the note message carries only the wallet and one note or rating, and its result is exact', async () => {
  const note = {
    walletId: WALLET_ID,
    action: {
      kind: 'community_note',
      contract: 'community-notes.testnet',
      postId: 7,
      text: 'The bridge stays open.',
      summary: 'The bridge stays open',
    },
  } as const;
  const rating = {
    walletId: WALLET_ID,
    action: { kind: 'note_rating', contract: 'community-notes.testnet', noteId: 3, rating: 'helpful' },
  } as const;
  expect(parseSpeakToSignNotePayload(structuredClone(note))).toEqual(note);
  expect(parseSpeakToSignNotePayload(structuredClone(rating))).toEqual(rating);
  for (const bad of [
    { ...note, owner: 'victim.testnet' },
    { ...note, action: { ...note.action, deposit: '1' } },
    { ...note, action: { ...note.action, postId: -1 } },
    { ...note, action: { ...note.action, postId: 2 ** 53 } },
    { ...note, action: { ...note.action, contract: 'Not An Account' } },
    { ...rating, action: { ...rating.action, rating: 'great' } },
    { ...rating, action: { ...rating.action, kind: 'transfer' } },
    { walletId: WALLET_ID },
    null,
  ]) {
    expect(() => parseSpeakToSignNotePayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign note request is invalid.',
    );
  }
  expect(parseSpeakToSignNoteResult({ ...SENT })).toEqual(SENT);
  expect(parseSpeakToSignNoteResult({ kind: 'refused', reason: 'summary_not_speakable' })).toEqual({
    kind: 'refused',
    reason: 'summary_not_speakable',
  });
  expect(() => parseSpeakToSignNoteResult({ kind: 'refused', reason: 'receiver_missing' })).toThrow(
    'Speak-to-Sign note result is invalid.',
  );
  expect(() =>
    parseSpeakToSignTransferResult({ kind: 'refused', reason: 'summary_not_speakable' }),
  ).toThrow('Speak-to-Sign transfer result is invalid.');

  const posted: unknown[] = [];
  const commands = createIframeSpeakToSignCommands(async (request, options) => {
    posted.push({ request, options });
    return { result: SENT };
  });
  expect(
    await commands.requestRating({
      walletId: WALLET_ID,
      contract: 'community-notes.testnet',
      noteId: 3,
      rating: 'helpful',
    }),
  ).toEqual(SENT);
  expect(posted).toEqual([
    { request: { type: 'PM_SPEAK_TO_SIGN_NOTE', payload: rating }, options: { timeout: 'interactive' } },
  ]);
});
