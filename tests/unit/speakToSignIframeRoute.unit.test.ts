import { expect, test } from '@playwright/test';
import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import type {
  AuthMethodPhraseRecording,
  AuthMethodPhraseRequest,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import type { WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import type {
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WalletTransactionFeaturePlugin } from '@/core/transactionFeatures/plugins';
import type { ActionResult } from '@/core/types/seams';
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
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
} from '@/SeamsWeb/walletIframe/shared/speakToSign';

const WALLET_ID = 'wallet:speak-to-sign';
const PAYLOAD = { walletId: WALLET_ID, receiver: 'bob.testnet', amount: '2.5' } as const;
const FEATURE: WalletTransactionFeaturePlugin = {
  kind: 'speak_to_sign',
  vault: 'voicevault.testnet',
  network: 'testnet',
};
const SENT: SpeakToSignTransferResult = {
  kind: 'sent',
  transactionHash: 'tx-1',
  times: { speechMs: 1, verifyMs: 2, checkMs: 3, transactionMs: 4, endOfSpeechToReceiptMs: 5 },
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
    { kind: 'refused', reason: 'vault_rejected', detail: 'AudioReused' },
    { kind: 'unavailable', reason: 'voiceid_unavailable', detail: 'not_enrolled' },
    { kind: 'unavailable', reason: 'flow_not_available' },
  ];
  for (const result of valid) expect(parseSpeakToSignTransferResult(result)).toEqual(result);
  for (const bad of [
    undefined,
    { kind: 'sent', transactionHash: 'tx' },
    { ...SENT, times: { ...SENT.times, speechMs: -1 } },
    { kind: 'refused', reason: 'not_a_reason' },
    { kind: 'unavailable', reason: 'speaker' },
    { kind: 'unavailable', reason: 'vault_missing', detail: 7 },
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
};

function buildHandler(options: HandlerHarnessOptions = {}) {
  const posted: ChildToParentEnvelope[] = [];
  const pluginCalls: Parameters<SpeakToSignHostPlugin['requestTransfer']>[0][] = [];
  const loads: (readonly WalletTransactionFeaturePlugin[])[] = [];
  const signed: unknown[] = [];
  const fetched: { url: string; init: RequestInit }[] = [];
  const binding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' };
  const features = options.features ?? [FEATURE];
  const authMethods: readonly WalletAuthMethodPlugin[] = [{ kind: 'voiceid' }];
  const recorderLoads: (readonly WalletAuthMethodPlugin[])[] = [];
  const phrases: AuthMethodPhraseRequest[] = [];
  const recorded = new Float32Array([0.5, -0.5, 0.25]);
  const voiceId = {
    async recordPhrase(request: AuthMethodPhraseRequest): Promise<AuthMethodPhraseRecording> {
      phrases.push(request);
      return { kind: 'recorded', samples: recorded, endOfSpeechAt: 7 };
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
      async signAndSendTransaction(args: unknown): Promise<ActionResult> {
        signed.push(args);
        return { success: true, transactionId: 'tx-1', result: { status: {} } as never };
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
  };
  const ports: SpeakToSignWalletPorts = {
    async readVoiceIdAvailability() {
      const kind = options.voiceId ?? 'enabled';
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
  const handler = createSpeakToSignWalletIframeHandlers(deps, ports).PM_SPEAK_TO_SIGN_TRANSFER;
  if (!handler) throw new Error('The handler map has no Speak-to-Sign handler');
  const request = {
    type: 'PM_SPEAK_TO_SIGN_TRANSFER',
    requestId: 'request-1',
    payload: PAYLOAD,
  } as Req<'PM_SPEAK_TO_SIGN_TRANSFER'>;
  return {
    run: () => handler(request),
    posted,
    pluginCalls,
    loads,
    signed,
    fetched,
    binding,
    authMethods,
    recorderLoads,
    phrases,
    recorded,
  };
}

test('the handler gives the plugin the owner, the configured vault and scoped operations', async () => {
  const harness = buildHandler();
  await harness.run();
  expect(harness.loads).toEqual([[FEATURE]]);
  expect(harness.pluginCalls).toHaveLength(1);
  const [input] = harness.pluginCalls;
  expect(input).toMatchObject({ walletId: WALLET_ID, vault: 'voicevault.testnet', network: 'testnet' });
  expect(input.signal.aborted).toBe(false);
  const transfer = input.transfer;
  if (!transfer) throw new Error('The handler sent no transfer');
  expect(transfer.ownerAccountId).toBe('owner.testnet');
  expect(transfer.receiver).toBe('bob.testnet');
  expect(transfer.amount).toBe('2.5');
  expect(transfer.surfaceMeasurementBinding).toBe(harness.binding);

  const signal = new AbortController().signal;
  expect(harness.recorderLoads).toEqual([]);
  const clip = await transfer.operations.captureClip({
    sentence: 'Send two NEAR to bob',
    signal,
    surfaceMeasurementBinding: harness.binding,
  });
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
  await transfer.operations.submitTransfer(
    { receiver_id: 'bob.testnet', amount: '1', nonce: '0', verdict_json: '{}', signature_b64: 'c2ln' },
    signal,
  );
  expect(harness.signed).toMatchObject([
    {
      walletSession: { walletId: WALLET_ID },
      nearAccount: { accountId: 'owner.testnet' },
      receiverId: 'voicevault.testnet',
    },
  ]);
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
