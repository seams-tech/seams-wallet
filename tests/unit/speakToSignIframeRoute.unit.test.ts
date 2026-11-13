import { createApplicationPublicApi } from '@/SeamsWeb/publicApi/createPublicApi';
import { getTransactionReviewBridge } from '@/SeamsWeb/publicApi/transactionReview';
import { createSpeakToSignCapability } from '@/SeamsWeb/publicApi/speakToSign';
import { withSpokenApprovals } from '@/SeamsWeb/publicApi/spoken';
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
import { ENROLLMENT_PHRASES } from '@/core/transactionFeatures/hostApproval';
import { forgetNoteSummaries } from '@/core/transactionFeatures/hostOperations';
import type { WalletApprovalPlugin } from '@/core/transactionFeatures/plugins';
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
  parseSpeakToSignMessageResult,
  parseSpeakToSignNotePayload,
  parseSpeakToSignNoteResult,
  parseSpeakToSignPreparePayload,
  parseSpeakToSignPrepareResult,
  parseSpeakToSignProgressV1,
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
} from '@/SeamsWeb/walletIframe/shared/speakToSign';

const WALLET_ID = 'wallet:speak-to-sign';
const PAYLOAD = {
  walletId: WALLET_ID,
  receiver: 'bob.testnet',
  amount: '2.5',
  autoStart: true,
} as const;
const FEATURE: WalletApprovalPlugin = { kind: 'spoken', network: 'testnet' };
const NOTE_TEXT = 'The bridge is not closed. One lane closes for two weeks in March, says the city.';
const NOTE_SUMMARY = 'One lane of the bridge closes in March';
const NOTE_PAYLOAD = {
  walletId: WALLET_ID,
  autoStart: true,
  action: { kind: 'community_note', contract: 'community-notes.testnet', postId: 7, text: NOTE_TEXT },
} as const;
const ENROLLED: SpeakToSignEnrollmentResult = {
  kind: 'enrolled',
  templateEpoch: 2,
  agreementMilli: 790,
};
/** The OutLayer record of the verifier call, as the result card links it. */
const QUOTE =
  'https://testnet-api.outlayer.ai/attestations/by-call/357b87bb-c366-4327-8f09-eff79a722877';
const SENT: SpeakToSignTransferResult = {
  kind: 'sent',
  transactionHash: 'tx-1',
  approval: 'voice',
  times: { speechMs: 1, verifyMs: 2, transactionMs: 4, endOfSpeechToReceiptMs: 5 },
  attestationUrl: QUOTE,
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
  // A Wallet iframe before 0.70.4 sends no `attestationUrl`, and OutLayer can give none.
  const { attestationUrl: _url, ...older } = SENT as Extract<typeof SENT, { kind: 'sent' }>;
  expect(parseSpeakToSignTransferResult(older)).toEqual({ ...older, attestationUrl: null });
  expect(parseSpeakToSignTransferResult({ ...older, attestationUrl: null })).toEqual({
    ...older,
    attestationUrl: null,
  });
  // The link is the record of an OutLayer call over HTTPS, and nothing else.
  for (const attestationUrl of ['http://testnet-api.outlayer.ai/attestations/by-call/1', 'https://evil.example/x', 'javascript:alert(1)', 7]) {
    expect(() => parseSpeakToSignTransferResult({ ...older, attestationUrl })).toThrow(
      'Speak-to-Sign transfer result is invalid.',
    );
  }
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
  }, (result) => result);
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
  }, (result) => result);
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
  readonly features?: readonly WalletApprovalPlugin[];
  readonly voiceId?: AuthMethodAvailability['kind'];
  readonly relayerUrl?: string;
  readonly nearReady?: boolean;
  readonly cancelled?: () => boolean;
  readonly plugin?: SpeakToSignHostPlugin['approve'];
  readonly enroll?: SpeakToSignHostPlugin['enroll'];
  /** What VoiceID activation does: keep three samples, check an existing enrollment, or close. */
  readonly activation?: 'new_enrollment' | 'existing_enrollment' | 'cancelled';
  /** The answer of the Seams server's summary route. Default: a summary of the note. */
  readonly summaryReply?: () => Response;
  /** The frame of the harness before it: its kept summaries stay. */
  readonly keepSummaries?: boolean;
};

function buildHandler(options: HandlerHarnessOptions = {}) {
  // Each harness is a new Wallet frame: it has no kept summary.
  if (!options.keepSummaries) forgetNoteSummaries();
  const posted: ChildToParentEnvelope[] = [];
  const pluginCalls: Parameters<SpeakToSignHostPlugin['approve']>[0][] = [];
  const enrollCalls: Parameters<SpeakToSignHostPlugin['enroll']>[0][] = [];
  const loads: (readonly WalletApprovalPlugin[])[] = [];
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
      approvals: features,
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
    getContext: () => ({ nearClient: { view: async () => ({}), viewAccount: async () => ({}) } }),
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
    async approve(input) {
      pluginCalls.push(input);
      return options.plugin ? await options.plugin(input) : SENT;
    },
    async enroll(input) {
      enrollCalls.push(input);
      return options.enroll ? await options.enroll(input) : ENROLLED;
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
    async nearActionsBorsh() {
      throw new Error('This route test runs no transaction.');
    },
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
      if (url.pathname === '/speak-to-sign/v1/summary') {
        return options.summaryReply?.() ?? Response.json({ ok: true, summary: NOTE_SUMMARY });
      }
      return Response.json({ ok: true, output: { verdict_json: '{}' } });
    }) as typeof fetch,
  };
  const handlers = createSpeakToSignWalletIframeHandlers(deps, ports);
  const handler = handlers.PM_SPEAK_TO_SIGN_TRANSFER;
  const noteHandler = handlers.PM_SPEAK_TO_SIGN_NOTE;
  const enrollHandler = handlers.PM_SPEAK_TO_SIGN_ENROLL;
  const prepareHandler = handlers.PM_SPEAK_TO_SIGN_PREPARE;
  if (!handler || !noteHandler || !enrollHandler || !prepareHandler) {
    throw new Error('The handler map has no Speak-to-Sign handler');
  }
  const request = {
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    requestId: 'request-1',
    payload: PAYLOAD,
  } as Req<'PM_SPEAK_TO_SIGN_TRANSFER'>;
  const enrollRequest = {
    type: 'PM_SPEAK_TO_SIGN_ENROLL',
    requestId: 'request-enroll',
    payload: { walletId: WALLET_ID, autoStart: false },
  } as Req<'PM_SPEAK_TO_SIGN_ENROLL'>;
  return {
    run: (payload: typeof PAYLOAD | Record<string, unknown> = PAYLOAD) =>
      handler({ ...request, payload } as Req<'PM_SPEAK_TO_SIGN_TRANSFER'>),
    runNote: (payload: Record<string, unknown>) =>
      noteHandler({
        type: 'PM_SPEAK_TO_SIGN_NOTE',
        requestId: 'request-note',
        payload,
      } as Req<'PM_SPEAK_TO_SIGN_NOTE'>),
    runPrepare: (noteText?: string) =>
      prepareHandler({
        type: 'PM_SPEAK_TO_SIGN_PREPARE',
        requestId: 'request-prepare',
        payload: { walletId: WALLET_ID, ...(noteText === undefined ? {} : { noteText }) },
      } as Req<'PM_SPEAK_TO_SIGN_PREPARE'>),
    runEnroll: (autoStart = false) =>
      enrollHandler({ ...enrollRequest, payload: { walletId: WALLET_ID, autoStart } }),
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

const HOOKS = {
  accepted: () => undefined,
  approveStepUp: async () => true,
  broadcasting: () => undefined,
  included: () => undefined,
};
/** A verifier output that the pinned testnet key did not sign. */
const FOREIGN_OUTPUT = {
  kind: 'seams_voice_verify_output_v2',
  verdict_json: '{}',
  signature_b64: 'c2ln',
  public_key: 'ed25519:other',
  policy_text: null,
  ms: {},
};

test('the handler gives the plugin the owner, the request texts and bound operations', async () => {
  const seen: Record<string, unknown> = {};
  const harness = buildHandler({
    async plugin(input) {
      expect(harness.recorderLoads).toEqual([harness.authMethods]);
      const clip = await input.operations.record();
      if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
      seen.clip = clip;
      // Core wipes the samples once the WAV holds them.
      seen.samples = [...harness.recorded];
      await input.operations.verify(clip);
      // A handle verifies once, and a copy of a handle names no recording.
      seen.again = await input.operations.verify(clip);
      seen.forged = await input.operations.verify({ ...clip });
      // A verdict that the pinned testnet key did not sign pays nothing.
      seen.signing = await input.operations.sign(FOREIGN_OUTPUT, HOOKS);
      return SENT;
    },
  });
  await harness.run();
  expect(harness.loads).toEqual([[FEATURE]]);
  expect(harness.pluginCalls).toHaveLength(1);
  const [input] = harness.pluginCalls;
  expect(input).toMatchObject({
    walletId: WALLET_ID,
    network: 'testnet',
    ownerAccountId: 'owner.testnet',
    request: {
      kind: 'account_transfer',
      form: 'send',
      displayText: 'Send 2.5 NEAR to bob.testnet',
      spokenText: 'send two point five near to bob dot testnet',
      counterparty: 'bob.testnet',
      amount: '2.5',
      summary: null,
    },
  });
  // The plugin gets no intent, no core operations and no audio.
  expect(Object.keys(input).sort()).toEqual([
    'network',
    'operations',
    'ownerAccountId',
    'request',
    'signal',
    'surface',
    'walletId',
  ]);
  expect(Object.keys(input.operations).sort()).toEqual(['record', 'sign', 'verify']);
  expect(input.signal.aborted).toBe(false);
  // Core opened the card with the sentence of the request.
  expect(harness.phrases.map((phrase) => phrase.sentence)).toEqual(['Send 2.5 NEAR to bob.testnet']);
  expect(harness.phrases[0].surfaceMeasurementBinding).toBe(harness.binding);
  // By default, the card of a spoken request records at once, with no press on Record.
  expect(harness.phrases[0].autoStart).toBe(true);
  expect(seen.clip).toEqual({ kind: 'captured', speechMs: 0, endOfSpeechAt: 7 });
  expect(seen.samples).toEqual([0, 0, 0]);
  // Core built the verifier input: the owner of the session, the request and the sealed clip.
  expect(harness.fetched.map(({ url }) => url)).toEqual([
    'https://relay.example.test/speak-to-sign/v1/verify',
  ]);
  expect(new Headers(harness.fetched[0].init.headers).get('authorization')).toBe(
    'Bearer wst_credential',
  );
  const sent = JSON.parse(String(harness.fetched[0].init.body)).input;
  expect(sent).toMatchObject({
    op: 'verify',
    owner: 'owner.testnet',
    request: { kind: 'transfer', receiver: 'bob.testnet', amount_yocto: '2500000000000000000000000' },
    contacts: [],
  });
  expect(typeof sent.audio_sealed_b64).toBe('string');
  expect('audio_wav_b64' in sent).toBe(false);
  expect(seen.again).toEqual({ kind: 'failed', code: 'unknown_recording' });
  expect(seen.forged).toEqual({ kind: 'failed', code: 'unknown_recording' });
  expect(seen.signing).toEqual({
    kind: 'refused',
    reason: 'verdict_mismatch',
    detail: 'verdict fields are invalid',
  });
  // The operations stop when the plugin's call settled.
  await expect(input.operations.record()).rejects.toThrow('flow has ended');
  await expect(input.operations.sign(FOREIGN_OUTPUT, HOOKS)).rejects.toThrow('flow has ended');
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-1', payload: { ok: true, result: SENT } },
  ]);
});

test('a signature that the plugin does not wait for ends before the application gets its answer', async () => {
  const seen: { signing?: unknown; answersBefore?: number } = {};
  const harness = buildHandler({
    async plugin(input) {
      void input.operations.sign(FOREIGN_OUTPUT, HOOKS).then((signing) => {
        seen.signing = signing;
        seen.answersBefore = harness.posted.length;
      });
      return { kind: 'cancelled' };
    },
  });
  await harness.run();
  expect(seen.signing).toMatchObject({ kind: 'refused', reason: 'verdict_mismatch' });
  expect(seen.answersBefore).toBe(0);
  expect(harness.posted[0].payload).toEqual({ ok: true, result: { kind: 'cancelled' } });
});

test('core refuses a request that it cannot sign before it loads a card or calls the plugin', async () => {
  for (const [payload, reason] of [
    [{ ...PAYLOAD, amount: '0.005' }, 'amount_not_speakable'],
    [{ ...PAYLOAD, receiver: 'ab'.repeat(32) }, 'receiver_not_speakable'],
  ] as const) {
    const harness = buildHandler();
    await harness.run(payload);
    expect(harness.pluginCalls).toHaveLength(0);
    expect(harness.phrases).toHaveLength(0);
    expect(harness.posted[0].payload).toEqual({ ok: true, result: { kind: 'refused', reason } });
  }
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

test('the enrollment message carries only the wallet and autoStart, and its result parser is exact', async () => {
  const enroll = { walletId: WALLET_ID, autoStart: false };
  expect(parseSpeakToSignEnrollPayload({ ...enroll })).toEqual(enroll);
  for (const bad of [{ ...enroll, owner: 'victim.testnet' }, { ...enroll, walletId: '' }, null]) {
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
  }, (result) => result);
  expect(await commands.enroll({ walletId: WALLET_ID })).toEqual(ENROLLED);
  expect(posted).toEqual([
    [
      { type: 'PM_SPEAK_TO_SIGN_ENROLL', payload: { walletId: WALLET_ID, autoStart: false } },
      { timeout: 'interactive' },
    ],
  ]);
  expect(
    routeWalletHostRequest({
      type: 'PM_SPEAK_TO_SIGN_ENROLL',
      requestId: 'request-3',
      payload: { walletId: WALLET_ID, autoStart: false },
    }),
  ).toMatchObject({ signingPolicy: 'none', kind: 'near', type: 'PM_SPEAK_TO_SIGN_ENROLL' });
});

test('the app side fills the default of autoStart, and the host accepts only a boolean', async () => {
  const posted: { type: string; payload: Readonly<Record<string, unknown>> }[] = [];
  const commands = createIframeSpeakToSignCommands(async (request) => {
    posted.push(request);
    return { result: request.type === 'PM_SPEAK_TO_SIGN_ENROLL' ? ENROLLED : SENT };
  }, (result) => result);
  const transfer = { walletId: WALLET_ID, receiver: 'bob.testnet', amount: '2.5' };
  const rating = { walletId: WALLET_ID, contract: 'notes.testnet', noteId: 4, rating: 'helpful' } as const;
  await commands.requestTransfer(transfer);
  await commands.requestTransfer({ ...transfer, autoStart: false });
  await commands.requestRating(rating);
  await commands.requestRating({ ...rating, autoStart: false });
  await commands.enroll({ walletId: WALLET_ID });
  await commands.enroll({ walletId: WALLET_ID, autoStart: true });
  // A spoken request records at once by default; an enrollment waits for Record by default.
  expect(posted.map(({ payload }) => payload.autoStart)).toEqual([true, false, true, false, false, true]);

  for (const autoStart of [undefined, 'yes', 1, null]) {
    const { autoStart: _omitted, ...withoutAutoStart } = PAYLOAD;
    const payload = autoStart === undefined ? withoutAutoStart : { ...PAYLOAD, autoStart };
    expect(() => parseSpeakToSignTransferPayload(payload), String(autoStart)).toThrow(
      'request is invalid',
    );
    const note = { ...posted[2].payload };
    if (autoStart === undefined) delete note.autoStart;
    else note.autoStart = autoStart;
    expect(() => parseSpeakToSignNotePayload(note), String(autoStart)).toThrow('request is invalid');
    const enroll = autoStart === undefined ? { walletId: WALLET_ID } : { walletId: WALLET_ID, autoStart };
    expect(() => parseSpeakToSignEnrollPayload(enroll), String(autoStart)).toThrow(
      'request is invalid',
    );
  }
});

test('each card of a flow records when it opens only as the app chose', async () => {
  const request = buildHandler({
    async plugin(input) {
      await input.operations.record();
      return { kind: 'cancelled' };
    },
  });
  await request.run({ ...PAYLOAD, autoStart: false });
  expect(request.phrases.map((phrase) => phrase.autoStart)).toEqual([false]);

  const enrollment = buildHandler({
    async enroll(input) {
      for (let index = 0; index < input.phraseCount; index += 1) {
        const clip = await input.operations.record(index);
        if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
      }
      return { kind: 'cancelled' };
    },
  });
  await enrollment.runEnroll(true);
  expect(enrollment.phrases.map((phrase) => phrase.autoStart)).toEqual([true, true, true]);
});

test('the enrollment handler records the phrases of core and enrolls only clips of the flow', async () => {
  const seen: Record<string, unknown> = {};
  const harness = buildHandler({
    async enroll(input) {
      const clips = [];
      for (let index = 0; index < input.phraseCount; index += 1) {
        harness.recorded.set([0.5, -0.5, index / 10]);
        const clip = await input.operations.record(index);
        if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
        clips.push(clip);
      }
      // A clip that this flow did not record is refused, and the owner signs nothing.
      seen.foreign = await input.operations.enrollClips([clips[0], clips[1], { ...clips[2] }], () => {
        throw new Error('not authorized');
      });
      seen.messagesBefore = harness.messages.length;
      let authorized = false;
      await input.operations.enrollClips(clips, () => {
        authorized = true;
      });
      seen.authorized = authorized;
      return ENROLLED;
    },
  });
  await harness.runEnroll();
  expect(harness.pluginCalls).toHaveLength(0);
  expect(harness.enrollCalls).toHaveLength(1);
  const [input] = harness.enrollCalls;
  expect(input).toMatchObject({
    walletId: WALLET_ID,
    network: 'testnet',
    ownerAccountId: 'owner.testnet',
    phraseCount: 3,
    clips: null,
  });
  expect(Object.keys(input.operations).sort()).toEqual(['enrollClips', 'record', 'show']);
  expect(harness.phrases.map((phrase) => phrase.sentence)).toEqual([...ENROLLMENT_PHRASES]);
  // By default, each phrase of an enrollment waits for Record.
  expect(harness.phrases.some((phrase) => phrase.autoStart)).toBe(false);
  expect(harness.phrases[0].surfaceMeasurementBinding).toBe(harness.binding);
  expect(seen.foreign).toEqual({
    kind: 'not_signed',
    error: 'Only recordings of this enrollment can be enrolled.',
  });
  expect(seen.messagesBefore).toBe(0);
  expect(seen.authorized).toBe(true);
  expect(harness.messages).toMatchObject([
    {
      walletSession: { walletId: WALLET_ID },
      nearAccount: { accountId: 'owner.testnet' },
      params: { recipient: 'seams-v1.testnet/voice-verifier' },
    },
  ]);
  // Core sent the three clips, sealed, with the owner's authorization.
  expect(harness.fetched).toHaveLength(1);
  const sent = JSON.parse(String(harness.fetched[0].init.body)).input;
  expect(sent).toMatchObject({
    op: 'enroll',
    owner: 'owner.testnet',
    authorization: { public_key: 'ed25519:owner', signature_b64: 'c2ln', nonce_b64: 'bm9uY2U=' },
  });
  expect(sent.audio_sealed_b64).toHaveLength(3);
  expect('audio_wav_b64' in sent).toBe(false);
  await expect(input.operations.record(0)).rejects.toThrow('flow has ended');
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-enroll', payload: { ok: true, result: ENROLLED } },
  ]);

  expect(harness.activations).toHaveLength(0);

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
  const seen: Record<string, unknown> = {};
  const harness = buildHandler({
    voiceId: 'not_enrolled',
    async enroll(input) {
      if (!input.clips) throw new Error('The enrollment has no VoiceID recordings');
      seen.clips = input.clips.length;
      await input.operations.enrollClips(input.clips, () => undefined);
      return ENROLLED;
    },
  });
  await harness.runEnroll();
  expect(harness.activations).toHaveLength(1);
  expect(harness.activations[0]).toMatchObject({ walletId: WALLET_ID });
  expect(harness.activations[0].surfaceMeasurementBinding).toBe(harness.binding);
  expect(harness.enrollCalls).toHaveLength(1);
  expect(seen.clips).toBe(3);
  // The card opens on the last sentence that the owner read for VoiceID, and records nothing.
  expect(harness.phrases.map((phrase) => phrase.sentence)).toEqual(['Phrase 3.']);
  // The Wallet keeps only the WAV clips; the samples are cleared.
  for (const samples of harness.enrollmentSamples) expect([...samples]).toEqual([0, 0]);
  expect(harness.messages).toHaveLength(1);
  expect(JSON.parse(String(harness.fetched[0].init.body)).input.audio_sealed_b64).toHaveLength(3);
  expect(harness.posted).toEqual([
    { type: 'PM_RESULT', requestId: 'request-enroll', payload: { ok: true, result: ENROLLED } },
  ]);

  const existing = buildHandler({ voiceId: 'not_enrolled', activation: 'existing_enrollment' });
  await existing.runEnroll();
  expect(existing.enrollCalls).toHaveLength(1);
  expect(existing.enrollCalls[0].clips).toBeNull();

  const closed = buildHandler({ voiceId: 'not_enrolled', activation: 'cancelled' });
  await closed.runEnroll();
  expect(closed.enrollCalls).toHaveLength(0);
  expect(closed.posted[0].payload).toEqual({ ok: true, result: { kind: 'cancelled' } });
});

test('the note message carries only the wallet, autoStart and one note or rating, and its result is exact', async () => {
  const note = {
    walletId: WALLET_ID,
    autoStart: true,
    action: {
      kind: 'community_note',
      contract: 'community-notes.testnet',
      postId: 7,
      text: 'The bridge stays open.',
    },
  } as const;
  const rating = {
    walletId: WALLET_ID,
    autoStart: true,
    action: { kind: 'note_rating', contract: 'community-notes.testnet', noteId: 3, rating: 'helpful' },
  } as const;
  expect(parseSpeakToSignNotePayload(structuredClone(note))).toEqual(note);
  expect(parseSpeakToSignNotePayload(structuredClone(rating))).toEqual(rating);
  for (const bad of [
    { ...note, owner: 'victim.testnet' },
    { ...note, action: { ...note.action, deposit: '1' } },
    // The Seams server writes the summary: an app cannot send one.
    { ...note, action: { ...note.action, summary: 'The bridge stays open' } },
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
  for (const result of [
    { kind: 'refused', reason: 'summary_mismatch' },
    { kind: 'refused', reason: 'summary_check_unavailable' },
    { kind: 'refused', reason: 'transcriber_not_attested' },
    { kind: 'unavailable', reason: 'summary_unavailable', detail: 'summary_failed' },
  ]) {
    expect(parseSpeakToSignNoteResult(structuredClone(result))).toEqual(result);
  }
  expect(
    parseSpeakToSignTransferResult({ kind: 'refused', reason: 'transcriber_not_attested' }),
  ).toEqual({ kind: 'refused', reason: 'transcriber_not_attested' });
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
  }, (result) => result);
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

test('the bet message carries exact base units, and an amount that cannot be said stops in the app', async () => {
  const usdc = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
  const bet = {
    walletId: WALLET_ID,
    autoStart: true,
    action: {
      kind: 'market_bet',
      contract: 'pm-notes.testnet',
      token: usdc,
      marketId: 9,
      outcome: 'yes',
      amountUnits: '500000',
    },
  } as const;
  expect(parseSpeakToSignNotePayload(structuredClone(bet))).toEqual(bet);
  for (const bad of [
    { ...bet, action: { ...bet.action, owner: 'victim.testnet' } },
    { ...bet, action: { ...bet.action, outcome: 'maybe' } },
    { ...bet, action: { ...bet.action, marketId: 1.5 } },
    { ...bet, action: { ...bet.action, amountUnits: 500000 } },
    { ...bet, action: { ...bet.action, amountUnits: '0.5' } },
    { ...bet, action: { ...bet.action, amountUnits: '0500000' } },
    { ...bet, action: { ...bet.action, token: 'Not A Token' } },
  ]) {
    expect(() => parseSpeakToSignNotePayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign note request is invalid.',
    );
  }
  expect(parseSpeakToSignNoteResult({ kind: 'refused', reason: 'bet_not_valid' })).toEqual({
    kind: 'refused',
    reason: 'bet_not_valid',
  });

  const posted: unknown[] = [];
  const commands = createIframeSpeakToSignCommands(async (request, options) => {
    posted.push({ request, options });
    return { result: SENT };
  }, (result) => result);
  const request = {
    walletId: WALLET_ID,
    contract: 'pm-notes.testnet',
    token: usdc,
    marketId: 9,
    outcome: 'yes',
    amount: '0.5',
  } as const;
  expect(await commands.requestBet(request)).toEqual(SENT);
  expect(posted).toEqual([
    { request: { type: 'PM_SPEAK_TO_SIGN_NOTE', payload: bet }, options: { timeout: 'interactive' } },
  ]);
  for (const amount of ['0.005', '0', '1000000.01', 'ten']) {
    expect(await commands.requestBet({ ...request, amount }), amount).toEqual({
      kind: 'refused',
      reason: 'bet_not_valid',
      detail: 'amount',
    });
  }
  expect(posted.length).toBe(1);
});

test('the transaction message carries the receiver, checked actions and the summary', async () => {
  const call = {
    action_type: 'FunctionCall',
    method_name: 'add_message',
    args: '{"text":"hello"}',
    gas: '30000000000000',
    deposit: '0',
  };
  const payload = {
    walletId: WALLET_ID,
    autoStart: true,
    action: {
      kind: 'transaction',
      transaction: {
        receiverId: 'guest-book.testnet',
        actions: [call, { action_type: 'Transfer', deposit: '1' }],
      },
      summary: 'Sign the guest book.',
      delivery: 'send',
    },
  } as const;
  expect(parseSpeakToSignNotePayload(structuredClone(payload))).toEqual(payload);
  const withTransaction = (transaction: unknown) => ({
    ...payload,
    action: { ...payload.action, transaction },
  });
  for (const bad of [
    { ...payload, action: { ...payload.action, owner: 'victim.testnet' } },
    { ...payload, action: { ...payload.action, summary: 7 } },
    { ...payload, action: { ...payload.action, delivery: 'later' } },
    { ...payload, action: { ...payload.action, delivery: { nonce: '1', maxBlockHeight: '2' } } },
    { ...payload, action: { ...payload.action, delivery: { nonce: 1, maxBlockHeight: '2', publicKey: 'ed25519:k' } } },
    withTransaction({ receiverId: 'Not An Account', actions: [call] }),
    withTransaction({ receiverId: 'guest-book.testnet', actions: [] }),
    withTransaction({ receiverId: 'guest-book.testnet', actions: [call], signerId: 'x.testnet' }),
    withTransaction({ receiverId: 'guest-book.testnet', actions: [{ ...call, gas: '' }] }),
    withTransaction({ receiverId: 'guest-book.testnet', actions: [{ action_type: 'Mint' }] }),
    withTransaction({ receiverId: 'guest-book.testnet', actions: ['transfer'] }),
  ]) {
    expect(() => parseSpeakToSignNotePayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign note request is invalid.',
    );
  }
  expect(parseSpeakToSignNoteResult({ kind: 'refused', reason: 'transaction_not_valid' })).toEqual({
    kind: 'refused',
    reason: 'transaction_not_valid',
  });

  const posted: unknown[] = [];
  let answer: unknown = SENT;
  const commands = createIframeSpeakToSignCommands(
    async (request, options) => {
      posted.push({ request, options });
      return { result: answer };
    },
    (result) => ({ ...result, nearAccountId: 'normalized' }),
  );
  const transaction = {
    receiverId: 'guest-book.testnet',
    actions: [
      {
        type: 'FunctionCall' as never,
        methodName: 'add_message',
        args: { text: 'hello' },
        gas: '30000000000000',
        deposit: '0',
      },
      { type: 'Transfer' as never, amount: '1' },
    ],
  };
  // Sign only: the same action with delivery `sign`; the SDK rebuilds the signed transaction.
  answer = { kind: 'signed_transaction', signed: { nearAccountId: 'raw' }, approval: 'voice', times: SENT.times, attestationUrl: QUOTE };
  expect(
    await commands.requestSignedTransaction({
      walletId: WALLET_ID,
      transaction,
      summary: 'Sign the guest book.',
    }),
  ).toEqual({
    kind: 'signed_transaction',
    signed: { nearAccountId: 'normalized' },
    approval: 'voice',
    times: SENT.times,
    attestationUrl: QUOTE,
  });
  // A delegate action: its fields travel as text, and the sender never crosses the channel.
  answer = { kind: 'signed_delegate', signed: { hash: 'h' }, approval: 'voice', times: SENT.times, attestationUrl: QUOTE };
  expect(
    await commands.requestDelegateAction({
      walletId: WALLET_ID,
      delegate: { ...transaction, nonce: 77n, maxBlockHeight: 1_234_567, publicKey: 'ed25519:k' },
      summary: 'Sign the guest book.',
    }),
  ).toEqual(answer);
  expect(posted.map((entry) => (entry as { request: { payload: { action: { delivery: unknown } } } }).request.payload.action.delivery)).toEqual([
    'sign',
    { nonce: '77', maxBlockHeight: '1234567', publicKey: 'ed25519:k' },
  ]);
  // A result of another kind is a protocol error.
  answer = SENT;
  await expect(
    commands.requestSignedTransaction({ walletId: WALLET_ID, transaction, summary: 'Sign the guest book.' }),
  ).rejects.toThrow('Speak-to-Sign signed transaction result is invalid.');
  answer = { kind: 'refused', reason: 'words' };
  expect(
    await commands.requestDelegateAction({
      walletId: WALLET_ID,
      delegate: { ...transaction, nonce: 1, maxBlockHeight: 2, publicKey: 'ed25519:k' },
      summary: 'Sign the guest book.',
    }),
  ).toEqual(answer);
  posted.length = 0;
  answer = SENT;
  expect(
    await commands.requestTransaction({
      walletId: WALLET_ID,
      transaction: {
        receiverId: 'guest-book.testnet',
        actions: [
          {
            type: 'FunctionCall' as never,
            methodName: 'add_message',
            args: { text: 'hello' },
            gas: '30000000000000',
            deposit: '0',
          },
          { type: 'Transfer' as never, amount: '1' },
        ],
      },
      summary: 'Sign the guest book.',
    }),
  ).toEqual(SENT);
  expect(posted).toEqual([
    {
      request: { type: 'PM_SPEAK_TO_SIGN_NOTE', payload },
      options: { timeout: 'interactive' },
    },
  ]);
});

test('the message request carries the NEP-413 fields and the summary, and its result is exact', async () => {
  const payload = {
    walletId: WALLET_ID,
    autoStart: true,
    action: {
      kind: 'signed_message',
      message: 'Log in to example.app',
      recipient: 'example.app',
      state: 'login-1',
      summary: 'Log in to the example app',
    },
  } as const;
  expect(parseSpeakToSignNotePayload(structuredClone(payload))).toEqual(payload);
  for (const bad of [
    { ...payload, action: { ...payload.action, nonce: 'AAAA' } },
    { ...payload, action: { ...payload.action, message: '' } },
    { ...payload, action: { ...payload.action, recipient: 7 } },
    { ...payload, action: { ...payload.action, callbackUrl: '' } },
    { ...payload, action: { ...payload.action, state: 1 } },
    { ...payload, action: { ...payload.action, summary: undefined } },
  ]) {
    expect(() => parseSpeakToSignNotePayload(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign note request is invalid.',
    );
  }

  const signed = {
    kind: 'signed',
    accountId: 'owner.testnet',
    publicKey: 'ed25519:owner',
    signature: 'c2lnbmF0dXJl',
    nonce: 'bm9uY2U=',
    state: 'login-1',
    approval: 'voice',
    times: SENT.times,
    attestationUrl: QUOTE,
  } as const;
  expect(parseSpeakToSignMessageResult({ ...signed })).toEqual(signed);
  const { state: _state, ...withoutState } = signed;
  expect(parseSpeakToSignMessageResult({ ...withoutState })).toEqual(withoutState);
  expect(parseSpeakToSignMessageResult({ kind: 'refused', reason: 'message_not_valid' })).toEqual({
    kind: 'refused',
    reason: 'message_not_valid',
  });
  for (const bad of [
    { ...signed, transactionHash: 'tx' },
    { ...signed, signature: '' },
    { ...signed, approval: 'click' },
    { kind: 'refused', reason: 'transaction_failed' },
    SENT,
  ]) {
    expect(() => parseSpeakToSignMessageResult(bad), JSON.stringify(bad)).toThrow(
      'Speak-to-Sign message result is invalid.',
    );
  }

  const posted: unknown[] = [];
  const commands = createIframeSpeakToSignCommands(async (request, options) => {
    posted.push({ request, options });
    return { result: signed };
  }, (result) => result);
  expect(
    await commands.requestMessage({
      walletId: WALLET_ID,
      message: 'Log in to example.app',
      recipient: 'example.app',
      state: 'login-1',
      summary: 'Log in to the example app',
    }),
  ).toEqual(signed);
  expect(posted).toEqual([
    { request: { type: 'PM_SPEAK_TO_SIGN_NOTE', payload }, options: { timeout: 'interactive' } },
  ]);
});

test('the voice capability has the names of the normal signer, and approved holds the normal result', async () => {
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    requestTransaction: SENT,
    requestTransfer: SENT,
    requestNote: { kind: 'refused', reason: 'words', detail: 'heard: no' },
    requestSignedTransaction: {
      kind: 'signed_transaction',
      signed: { nearAccountId: 'owner.testnet' },
      approval: 'voice',
      times: SENT.times,
      attestationUrl: QUOTE,
    },
    requestDelegateAction: {
      kind: 'signed_delegate',
      signed: { hash: 'delegate-hash' },
      approval: 'voice',
      times: SENT.times,
      attestationUrl: QUOTE,
    },
    requestMessage: {
      kind: 'signed',
      accountId: 'owner.testnet',
      publicKey: 'ed25519:owner',
      signature: 'c2lnbmF0dXJl',
      nonce: 'bm9uY2U=',
      approval: 'voice',
      times: SENT.times,
      attestationUrl: QUOTE,
    },
    enroll: ENROLLED,
  };
  const commands = new Proxy(
    {},
    {
      get: (_, name: string) => async () => {
        calls.push(name);
        return answers[name] ?? { kind: 'cancelled' };
      },
    },
  ) as never;
  const feature = { kind: 'spoken', network: 'testnet' } as const;
  expect(createSpeakToSignCapability([], commands, {} as never)).toBeNull();
  const voice = createSpeakToSignCapability([feature], commands, {} as never);
  if (!voice) throw new Error('no capability');
  expect(Object.keys(voice).sort()).toEqual([
    'enroll',
    'network',
    'prepare',
    'signAndSendTransaction',
    'signDelegateAction',
    'signMessage',
    'signTransaction',
    'typed',
  ]);
  expect(Object.keys(voice.typed).sort()).toEqual(['bet', 'mergeApproval', 'note', 'rating', 'transfer']);

  const approved = { kind: 'approved', approval: 'voice', times: SENT.times, attestationUrl: QUOTE };
  const request = { walletId: WALLET_ID } as never;
  expect(await voice.signAndSendTransaction(request)).toEqual({
    ...approved,
    result: { transactionHash: 'tx-1' },
  });
  expect(await voice.typed.transfer(request)).toEqual({
    ...approved,
    result: { transactionHash: 'tx-1' },
  });
  expect(await voice.signTransaction(request)).toEqual({
    ...approved,
    result: { nearAccountId: 'owner.testnet' },
  });
  expect(await voice.signDelegateAction(request)).toEqual({
    ...approved,
    result: { hash: 'delegate-hash' },
  });
  expect(await voice.signMessage(request)).toEqual({
    ...approved,
    result: {
      accountId: 'owner.testnet',
      publicKey: 'ed25519:owner',
      signature: 'c2lnbmF0dXJl',
      nonce: 'bm9uY2U=',
    },
  });
  // A failure passes through unchanged, and an enrollment keeps its own result.
  expect(await voice.typed.note(request)).toEqual(answers.requestNote);
  expect(await voice.typed.bet(request)).toEqual({ kind: 'cancelled' });
  expect(await voice.enroll(request)).toEqual(ENROLLED);
  expect(calls).toEqual([
    'requestTransaction',
    'requestTransfer',
    'requestSignedTransaction',
    'requestDelegateAction',
    'requestMessage',
    'requestNote',
    'requestBet',
    'enroll',
  ]);
});

test('the review bridge is registered for the near object that holds spoken', () => {
  // Any dependency: a callable object whose properties are the same kind of object.
  const anything = (): unknown =>
    new Proxy(() => anything(), { get: (_, name) => (name === 'then' ? undefined : anything()) });
  const voice = { network: 'testnet' } as never;
  const build = (speakToSign: never | null) =>
    createApplicationPublicApi(
      new Proxy(
        { createSpeakToSign: () => speakToSign },
        { get: (own, name) => (name === 'createSpeakToSign' ? own.createSpeakToSign : anything()) },
      ) as Parameters<typeof createApplicationPublicApi>[0],
    );
  const withVoice = build(voice);
  expect(withVoice.near.spoken?.network).toBe('testnet');
  expect('speakToSign' in withVoice.near).toBe(false);
  // A reviewed transaction (`steps`) finds its bridge by the `near` object that the app holds.
  expect(getTransactionReviewBridge(withVoice.near)).toBeTruthy();
  const plain = build(null);
  expect('spoken' in plain.near).toBe(false);
  expect(getTransactionReviewBridge(plain.near)).toBeTruthy();
});

test('a normal sign call with approval goes to the voice flow, with the wallet of the session', async () => {
  const calls: Array<[string, unknown]> = [];
  const record =
    (name: string) =>
    async (request: unknown): Promise<unknown> => {
      calls.push([name, request]);
      return { kind: 'cancelled' };
    };
  const plain = {
    signAndSendTransaction: record('plain send'),
    signTransaction: record('plain sign'),
    signDelegateAction: record('plain delegate'),
    signMessage: record('plain message'),
  };
  const voice = {
    network: 'testnet',
    signAndSendTransaction: record('send'),
    signTransaction: record('sign'),
    signDelegateAction: record('delegate'),
    signMessage: record('message'),
    typed: { transfer: record('transfer'), note: record('note') },
    enroll: record('enroll'),
    prepare: record('prepare'),
  };
  const currentWallet = {
    walletSession: async (explicit?: unknown) =>
      ({ walletId: typeof explicit === 'string' ? explicit : 'current.testnet' }) as never,
  };
  const near = withSpokenApprovals(plain as never, voice as never, currentWallet);
  const approval = { kind: 'spoken', summary: 'Sign the guest book.' } as const;
  const transaction = { receiverId: 'guest-book.testnet', actions: [] };
  const onProgress = () => undefined;
  const presentation = { kind: 'anchored' } as never;

  await near.signAndSendTransaction({ ...transaction, approval: { ...approval, onProgress }, presentation });
  await near.signTransaction({
    transaction,
    approval: { ...approval, autoStart: false },
    walletSession: 'other.testnet',
  });
  await near.signDelegateAction({
    delegate: { ...transaction, senderId: 'ignored.testnet', nonce: 1n, maxBlockHeight: 2n, publicKey: 'ed25519:key' },
    approval,
  });
  await near.signMessage({
    params: { message: 'Log in', recipient: 'example.app', state: 's-1' },
    approval,
  });
  // Without `approval` the call is the normal call, unchanged.
  await near.signAndSendTransaction(transaction);
  await near.spoken?.transfer({ receiver: 'bob.testnet', amount: '2.5', walletSession: 'other.testnet' });
  await near.spoken?.enroll();
  // `autoStart` reaches the Wallet from `approval`, a typed request and an enrollment.
  await near.spoken?.transfer({ receiver: 'bob.testnet', amount: '1', autoStart: false });
  await near.spoken?.enroll({ autoStart: true });
  // A warm-up names the wallet and the note, and nothing else.
  await near.spoken?.prepare();
  await near.spoken?.prepare({ note: { text: 'One lane closes.' }, walletSession: 'other.testnet' });
  expect(calls).toEqual([
    [
      'send',
      { walletId: 'current.testnet', transaction, summary: approval.summary, onProgress, presentation },
    ],
    ['sign', { walletId: 'other.testnet', transaction, summary: approval.summary, autoStart: false }],
    [
      'delegate',
      {
        walletId: 'current.testnet',
        delegate: { ...transaction, nonce: 1n, maxBlockHeight: 2n, publicKey: 'ed25519:key' },
        summary: approval.summary,
      },
    ],
    [
      'message',
      { walletId: 'current.testnet', message: 'Log in', recipient: 'example.app', state: 's-1', summary: approval.summary },
    ],
    ['plain send', transaction],
    ['transfer', { walletId: 'other.testnet', receiver: 'bob.testnet', amount: '2.5' }],
    ['enroll', { walletId: 'current.testnet' }],
    ['transfer', { walletId: 'current.testnet', receiver: 'bob.testnet', amount: '1', autoStart: false }],
    ['enroll', { walletId: 'current.testnet', autoStart: true }],
    ['prepare', { walletId: 'current.testnet' }],
    ['prepare', { walletId: 'other.testnet', note: { text: 'One lane closes.' } }],
  ]);

  // Without the descriptor there is no `spoken`, and a call with `approval` says what is missing.
  const disabled = withSpokenApprovals(plain as never, null, currentWallet);
  expect('spoken' in disabled).toBe(false);
  await expect(disabled.signAndSendTransaction({ ...transaction, approval })).rejects.toThrow(
    'add spoken({ network }) to `approvals`',
  );
});

test('a note gets its summary from the Seams server, and the card shows the note above it', async () => {
  const seen: Record<string, unknown> = {};
  const harness = buildHandler({
    async plugin(input) {
      const clip = await input.operations.record();
      if (clip.kind !== 'captured') throw new Error(`The clip was ${clip.kind}`);
      await input.operations.verify(clip);
      seen.request = input.request;
      return SENT;
    },
  });
  await harness.runNote(NOTE_PAYLOAD);
  expect(harness.fetched.map(({ url }) => url)).toEqual([
    'https://relay.example.test/speak-to-sign/v1/summary',
    'https://relay.example.test/speak-to-sign/v1/verify',
  ]);
  const [summaryCall, verifyCall] = harness.fetched;
  expect(new Headers(summaryCall.init.headers).get('authorization')).toBe('Bearer wst_credential');
  expect(JSON.parse(String(summaryCall.init.body))).toEqual({ text: NOTE_TEXT });
  // The card says the server's summary, with the note above it.
  expect(harness.phrases.map(({ sentence, context }) => ({ sentence, context }))).toEqual([
    { sentence: NOTE_SUMMARY, context: { label: 'Your note', text: NOTE_TEXT } },
  ]);
  expect(seen.request).toMatchObject({ kind: 'community_note', summary: NOTE_SUMMARY });
  // The verifier gets the note text: it hashes the note and checks that the summary fits it.
  expect(JSON.parse(String(verifyCall.init.body)).input.request).toEqual({
    kind: 'community_note',
    contract: 'community-notes.testnet',
    post_id: 7,
    note_text: NOTE_TEXT,
    summary: NOTE_SUMMARY,
  });
});

test('prepare loads the flow and asks for the summary early; the note request then asks nothing', async () => {
  const frame = buildHandler();
  await frame.runPrepare(NOTE_TEXT);
  // It answers `ready`, with no card and no plugin call.
  expect(frame.posted[0].payload).toEqual({ ok: true, result: { kind: 'ready' } });
  expect(frame.loads).toHaveLength(1);
  expect(frame.phrases).toEqual([]);
  expect(frame.pluginCalls).toEqual([]);
  const summaryCalls = () => frame.fetched.filter((call) => call.url.endsWith('/speak-to-sign/v1/summary'));
  expect(summaryCalls()).toHaveLength(1);
  expect(JSON.parse(String(summaryCalls()[0].init.body))).toEqual({ text: NOTE_TEXT });

  // The note request of the same text finds the kept summary.
  await frame.runNote(NOTE_PAYLOAD);
  expect(summaryCalls()).toHaveLength(1);
  expect(frame.pluginCalls).toHaveLength(1);
  // Another text has its own summary.
  await frame.runNote({ ...NOTE_PAYLOAD, action: { ...NOTE_PAYLOAD.action, text: 'Another note.' } });
  expect(summaryCalls()).toHaveLength(2);

  // A warm-up with no note asks for no summary, and one without VoiceID says why.
  const plain = buildHandler();
  await plain.runPrepare();
  expect(plain.posted[0].payload).toEqual({ ok: true, result: { kind: 'ready' } });
  expect(plain.fetched.filter((call) => call.url.endsWith('/speak-to-sign/v1/summary'))).toHaveLength(0);
});

test('the prepare command posts one warm-up message with the usual deadline', async () => {
  const posted: Array<{ request: unknown; options: unknown }> = [];
  const commands = createIframeSpeakToSignCommands(async (request, options) => {
    posted.push({ request, options });
    return { result: { kind: 'ready' } };
  }, (result) => result);
  expect(await commands.prepare({ walletId: WALLET_ID, note: { text: NOTE_TEXT } })).toEqual({ kind: 'ready' });
  expect(await commands.prepare({ walletId: WALLET_ID })).toEqual({ kind: 'ready' });
  expect(posted).toEqual([
    { request: { type: 'PM_SPEAK_TO_SIGN_PREPARE', payload: { walletId: WALLET_ID, noteText: NOTE_TEXT } }, options: {} },
    { request: { type: 'PM_SPEAK_TO_SIGN_PREPARE', payload: { walletId: WALLET_ID } }, options: {} },
  ]);
});

test('the prepare payload and result have exact shapes', () => {
  expect(parseSpeakToSignPreparePayload({ walletId: WALLET_ID })).toEqual({ walletId: WALLET_ID });
  expect(parseSpeakToSignPreparePayload({ walletId: WALLET_ID, noteText: NOTE_TEXT })).toEqual({
    walletId: WALLET_ID,
    noteText: NOTE_TEXT,
  });
  for (const bad of [
    {},
    { walletId: '' },
    { walletId: WALLET_ID, noteText: '' },
    { walletId: WALLET_ID, noteText: '   ' },
    { walletId: WALLET_ID, noteText: 'é'.repeat(281) },
    { walletId: WALLET_ID, noteText: 7 },
    { walletId: WALLET_ID, summary: 'x' },
  ]) {
    expect(() => parseSpeakToSignPreparePayload(bad), JSON.stringify(bad)).toThrow('Speak-to-Sign prepare request is invalid.');
  }
  expect(parseSpeakToSignPrepareResult({ kind: 'ready' })).toEqual({ kind: 'ready' });
  expect(parseSpeakToSignPrepareResult({ kind: 'unavailable', reason: 'voiceid_unavailable', detail: 'missing' })).toEqual({
    kind: 'unavailable',
    reason: 'voiceid_unavailable',
    detail: 'missing',
  });
  for (const bad of [null, { kind: 'ready', summary: 'x' }, { kind: 'sent' }, { kind: 'unavailable', reason: 'words' }]) {
    expect(() => parseSpeakToSignPrepareResult(bad), JSON.stringify(bad)).toThrow('Speak-to-Sign prepare result is invalid.');
  }
});

test('a note with no summary from the server, or one that cannot be said, opens no card', async () => {
  const failed = buildHandler({
    summaryReply: () => Response.json({ ok: false, code: 'summary_failed' }, { status: 502 }),
  });
  await failed.runNote(NOTE_PAYLOAD);
  expect(failed.posted[0].payload).toEqual({
    ok: true,
    result: { kind: 'unavailable', reason: 'summary_unavailable', detail: 'summary_failed' },
  });
  const malformed = buildHandler({ summaryReply: () => Response.json({ ok: true }) });
  await malformed.runNote(NOTE_PAYLOAD);
  expect(malformed.posted[0].payload).toEqual({
    ok: true,
    result: { kind: 'unavailable', reason: 'summary_unavailable', detail: 'summary_reply' },
  });
  // Core checks the server's words as any summary.
  const unspeakable = buildHandler({
    summaryReply: () => Response.json({ ok: true, summary: 'Send 5 NEAR to bob' }),
  });
  await unspeakable.runNote(NOTE_PAYLOAD);
  expect(unspeakable.posted[0].payload).toEqual({
    ok: true,
    result: { kind: 'refused', reason: 'summary_not_speakable' },
  });
  for (const harness of [failed, malformed, unspeakable]) {
    expect(harness.phrases).toEqual([]);
    expect(harness.pluginCalls).toEqual([]);
  }
});
