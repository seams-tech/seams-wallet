import {
  buildVoiceIdWalletSessionChallenge,
  voiceIdWalletSessionChallengeBytes,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { parseWalletSessionMintId } from '@shared/authorization/capabilityKinds';
import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseWalletAuthMethodId, parseWalletAuthorityId, parseWalletId } from '@shared/utils/domainIds';
import { requireRecord } from '@shared/utils/validation';
import {
  captureVoiceIdActivation,
  captureVoiceIdUnlock,
} from '@/plugins/voiceid/capture/deviceBridge';
import { listenForVoiceApproval } from '@/plugins/voiceid/capture/bridge';
import { showVoiceIdCaptureSurface } from '@/plugins/voiceid/capture/surface';

const BRIDGE_URL = 'http://127.0.0.1:4318/voiceid';
const originalFetch = window.fetch.bind(window);
const encoder = new TextEncoder();
let mode: 'approved' | 'wrong_key' | 'held' | 'rejected' | 'keychain_denied' = 'approved';
let requests = 0;
let keyPair: CryptoKeyPair | null = null;
let controller: AbortController | null = null;
let pending: Promise<unknown> | null = null;
let preparedChallenge: Awaited<ReturnType<typeof challenge>> | null = null;
let preparedWrongOriginChallenge: Awaited<ReturnType<typeof challenge>> | null = null;

function requireValue<T>(parsed: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!parsed.ok) throw new Error('VoiceID test identity is invalid');
  return parsed.value;
}

class NativeFixtureResponse {
  private stream: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(
    private readonly firstReply: unknown,
    private readonly outcome: unknown,
    private readonly signal: AbortSignal | null | undefined,
    private readonly held: boolean,
  ) {
    this.signal?.addEventListener('abort', this.abort, { once: true });
  }

  readonly start = (stream: ReadableStreamDefaultController<Uint8Array>): void => {
    this.stream = stream;
    if (this.firstReply !== null) this.send(this.firstReply);
    if (this.held) return;
    this.send(this.outcome);
    stream.close();
    this.stream = null;
  };

  private send(value: unknown): void {
    this.stream?.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
  }

  private readonly abort = (): void => {
    if (!this.stream) return;
    this.stream.error(new DOMException('Native capture cancelled', 'AbortError'));
    this.stream = null;
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (requestUrl(input) !== BRIDGE_URL) return await originalFetch(input, init);
  requests += 1;
  if (typeof init?.body !== 'string') throw new Error('VoiceID test request is missing');
  const request = requireRecord(JSON.parse(init.body), 'VoiceID test request');
  const binding = requireRecord(request.binding, 'VoiceID test binding');
  if (typeof binding.attemptId !== 'string') throw new Error('VoiceID test attempt is missing');
  let outcome: unknown;
  let firstReply: unknown = { kind: 'device_listening', id: binding.attemptId };
  if (mode === 'keychain_denied') {
    firstReply = null;
    outcome = { kind: 'service_failed', reason: 'keychain_access_required' };
  } else if (mode === 'rejected' && (request.kind === 'activate' || request.kind === 'unlock')) {
    outcome = { kind: 'device_rejected', id: binding.attemptId, outcome: 'rejected' };
  } else if (request.kind === 'listen') {
    firstReply = { kind: 'listening', binding };
    outcome = { kind: 'result', binding, outcome: 'approved' };
  } else if (request.kind === 'activate') {
    keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    const deviceKeyId = await sha256DigestB64u(publicKey);
    outcome = {
      kind: 'activation_approved',
      id: binding.attemptId,
      publicKeyB64u: base64UrlEncode(publicKey),
      deviceKeyId: mode === 'wrong_key' ? base64UrlEncode(new Uint8Array(32).fill(9)) : deviceKeyId,
      factorSecretB64u: base64UrlEncode(new Uint8Array(32).fill(11)),
    };
  } else if (request.kind === 'unlock') {
    if (!keyPair) throw new Error('VoiceID test activation did not create a key');
    const challenge = requireRecord(binding.challenge, 'VoiceID test challenge');
    const signature = await crypto.subtle.sign(
      'Ed25519',
      keyPair.privateKey,
      voiceIdWalletSessionChallengeBytes(buildVoiceIdWalletSessionChallenge({
        walletId: requireValue(parseWalletId(challenge.walletId)),
        walletAuthMethodId: requireValue(parseWalletAuthMethodId(challenge.walletAuthMethodId)),
        walletAuthorityId: requireValue(parseWalletAuthorityId(challenge.walletAuthorityId)),
        deviceKeyId: parseDigestB64u(challenge.deviceKeyId),
        challengeId: requireValue(parseWalletSessionMintId(challenge.challengeId)),
        nonce: parseDigestB64u(challenge.nonce),
        requestOrigin: String(challenge.requestOrigin),
        audience: String(challenge.audience),
        issuedAtMs: Number(challenge.issuedAtMs),
        expiresAtMs: Number(challenge.expiresAtMs),
      })),
    );
    outcome = {
      kind: 'unlock_approved',
      id: binding.attemptId,
      signatureB64u: base64UrlEncode(new Uint8Array(signature)),
      factorSecretB64u: base64UrlEncode(new Uint8Array(32).fill(11)),
    };
  } else {
    throw new Error('VoiceID test request kind is invalid');
  }
  const fixture = new NativeFixtureResponse(firstReply, outcome, init.signal, mode === 'held');
  return new Response(new ReadableStream({ start: fixture.start }), {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function challenge(requestOrigin: string) {
  if (!keyPair) throw new Error('VoiceID test device key is missing');
  return crypto.subtle.exportKey('raw', keyPair.publicKey).then(buildChallengeForPublicKey.bind(null, requestOrigin));
}

async function buildChallengeForPublicKey(requestOrigin: string, raw: ArrayBuffer) {
  return buildVoiceIdWalletSessionChallenge({
    walletId: requireValue(parseWalletId('wallet:voiceid-browser')),
    walletAuthMethodId: requireValue(parseWalletAuthMethodId('wallet-auth-method:voiceid-browser')),
    walletAuthorityId: requireValue(parseWalletAuthorityId('authority:voiceid-browser')),
    deviceKeyId: await sha256DigestB64u(new Uint8Array(raw)),
    challengeId: requireValue(parseWalletSessionMintId(`voiceid:${base64UrlEncode(new Uint8Array(32).fill(7))}`)),
    nonce: parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(8))),
    requestOrigin,
    audience: location.origin,
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 25_000,
  });
}

function listening(): void {
  document.body.dataset.listening = 'true';
}

async function activate(): Promise<unknown> {
  controller = new AbortController();
  const result = await captureVoiceIdActivation({
    walletId: requireValue(parseWalletId('wallet:voiceid-browser')),
    walletAuthMethodId: requireValue(parseWalletAuthMethodId('wallet-auth-method:voiceid-browser')),
    signal: controller.signal,
    onListening: listening,
  });
  try {
    return { kind: result.kind, publicKeyB64u: result.publicKeyB64u, deviceKeyId: result.deviceKeyId };
  } finally {
    result.factorSecret32.fill(0);
  }
}

async function unlock(deviceChallenge: Awaited<ReturnType<typeof challenge>>): Promise<unknown> {
  controller = new AbortController();
  const result = await captureVoiceIdUnlock({
    challenge: deviceChallenge,
    signal: controller.signal,
    onListening: listening,
  });
  try {
    return { kind: result.kind, assertion: result.assertion };
  } finally {
    result.factorSecret32.fill(0);
  }
}

async function approve(): Promise<unknown> {
  controller = new AbortController();
  return await listenForVoiceApproval({
    attemptId: crypto.randomUUID(),
    operationHash: 'a'.repeat(64),
    expiresAtMs: Date.now() + 10_000,
  }, 10_000, controller.signal, listening);
}

function startApproval(): void {
  pending = approve();
}

function startActivation(): void {
  pending = activate();
}

function startUnlock(): void {
  if (!preparedChallenge) throw new Error('VoiceID test challenge is missing');
  pending = unlock(preparedChallenge);
}

function startWrongOrigin(): void {
  if (!preparedWrongOriginChallenge) throw new Error('VoiceID test origin challenge is missing');
  pending = unlock(preparedWrongOriginChallenge);
}

async function prepareUnlock(): Promise<void> {
  preparedChallenge = await challenge(location.origin);
  preparedWrongOriginChallenge = await challenge('https://other.example.test');
}

function startHeld(): void {
  mode = 'held';
  pending = activate();
}

async function activateThroughWalletButton(
  signal: AbortSignal,
  onListening: () => void,
): Promise<{
  walletId: ReturnType<typeof requireWalletId>;
  walletAuthMethodId: ReturnType<typeof requireWalletAuthMethodId>;
}> {
  const walletId = requireWalletId();
  const walletAuthMethodId = requireWalletAuthMethodId();
  const capture = await captureVoiceIdActivation({
    walletId,
    walletAuthMethodId,
    signal,
    onListening,
  });
  capture.factorSecret32.fill(0);
  return { walletId, walletAuthMethodId };
}

function requireWalletId() {
  return requireValue(parseWalletId('wallet:voiceid-browser'));
}

function requireWalletAuthMethodId() {
  return requireValue(parseWalletAuthMethodId('wallet-auth-method:voiceid-browser'));
}

function startWalletActivation(): void {
  pending = showVoiceIdCaptureSurface({ action: activateThroughWalletButton, purpose: 'activation', expiresAtMs: null });
}

async function unlockThroughWalletButton(signal: AbortSignal, onListening: () => void): Promise<unknown> {
  if (!preparedChallenge) throw new Error('VoiceID test challenge is missing');
  const capture = await captureVoiceIdUnlock({ challenge: preparedChallenge, signal, onListening });
  try {
    return { kind: capture.kind, assertion: capture.assertion };
  } finally {
    capture.factorSecret32.fill(0);
  }
}

function startWalletUnlock(): void {
  if (!preparedChallenge) throw new Error('VoiceID test challenge is missing');
  pending = showVoiceIdCaptureSurface({
    action: unlockThroughWalletButton,
    purpose: 'unlock',
    expiresAtMs: preparedChallenge.expiresAtMs,
  });
}

function startExpiringWalletUnlock(): void {
  pending = showVoiceIdCaptureSurface({
    action: unlockThroughWalletButton,
    purpose: 'unlock',
    expiresAtMs: Date.now() + 100,
  });
}

function abort(): void {
  controller?.abort();
}

function setMode(next: typeof mode): void {
  mode = next;
}

function result(): Promise<unknown> {
  if (!pending) throw new Error('VoiceID test capture did not start');
  return pending;
}

function requestCount(): number {
  return requests;
}

function mount(): void {
  document.getElementById('approval')?.addEventListener('click', startApproval);
  document.getElementById('activate')?.addEventListener('click', startActivation);
  document.getElementById('unlock')?.addEventListener('click', startUnlock);
  document.getElementById('wrong-origin')?.addEventListener('click', startWrongOrigin);
  document.getElementById('held')?.addEventListener('click', startHeld);
}

declare global {
  interface Window {
    voiceIdDeviceCaptureProbe: {
      abort: typeof abort;
      result: typeof result;
      requestCount: typeof requestCount;
      setMode: typeof setMode;
      prepareUnlock: typeof prepareUnlock;
      startWalletActivation: typeof startWalletActivation;
      startWalletUnlock: typeof startWalletUnlock;
      startExpiringWalletUnlock: typeof startExpiringWalletUnlock;
    };
  }
}

window.fetch = bridgeFetch;
window.voiceIdDeviceCaptureProbe = {
  abort,
  result,
  requestCount,
  setMode,
  prepareUnlock,
  startWalletActivation,
  startWalletUnlock,
  startExpiringWalletUnlock,
};
window.addEventListener('DOMContentLoaded', mount, { once: true });
