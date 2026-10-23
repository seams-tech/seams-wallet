import {
  parseVoiceIdDeviceAssertion,
  parseVoiceIdDevicePublicKeyB64u,
  type VoiceIdDeviceAssertion,
  type VoiceIdDevicePublicKeyB64u,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { streamVoiceIdNative } from './nativeTransport';

type ActivationBinding = Readonly<{
  attemptId: string;
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  expiresAtMs: number;
}>;

type UnlockBinding = Readonly<{
  attemptId: string;
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  challenge: VoiceIdWalletSessionChallenge;
}>;

type DeviceRequest =
  | { readonly kind: 'activate'; readonly binding: ActivationBinding }
  | { readonly kind: 'unlock'; readonly binding: UnlockBinding };

type DeviceReply =
  | { readonly kind: 'device_listening'; readonly id: string }
  | {
      readonly kind: 'activation_approved';
      readonly id: string;
      readonly publicKeyB64u: VoiceIdDevicePublicKeyB64u;
      readonly deviceKeyId: DigestB64u;
      readonly factorSecret32: Uint8Array;
    }
  | {
      readonly kind: 'unlock_approved';
      readonly id: string;
      readonly signatureB64u: string;
      readonly factorSecret32: Uint8Array;
    }
  | {
      readonly kind: 'device_rejected';
      readonly id: string;
      readonly outcome: 'cancelled' | 'rejected';
    };

type DeviceCaptureResult =
  | {
      readonly kind: 'activated';
      readonly publicKeyB64u: VoiceIdDevicePublicKeyB64u;
      readonly deviceKeyId: DigestB64u;
      readonly factorSecret32: Uint8Array;
    }
  | {
      readonly kind: 'unlocked';
      readonly assertion: VoiceIdDeviceAssertion;
      readonly factorSecret32: Uint8Array;
    };

type CaptureState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'listening' }
  | { readonly kind: 'settled' };

function assertNever(value: never): never {
  throw new Error(`Unhandled VoiceID device result: ${String(value)}`);
}

function parseFactorSecret(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length !== 43) {
    throw new Error('VoiceID returned an invalid factor secret.');
  }
  const bytes = base64UrlDecode(value);
  if (bytes.length !== 32 || base64UrlEncode(bytes) !== value) {
    bytes.fill(0);
    throw new Error('VoiceID returned an invalid factor secret.');
  }
  return bytes;
}

function parseDeviceReply(value: unknown): DeviceReply {
  const record = requireRecord(value, 'VoiceID device reply');
  if (typeof record.id !== 'string') throw new Error('VoiceID device reply has no attempt ID.');
  switch (record.kind) {
    case 'device_listening':
      rejectUnknownFields(record, ['kind', 'id'], 'VoiceID listening reply');
      return { kind: 'device_listening', id: record.id };
    case 'activation_approved':
      rejectUnknownFields(
        record,
        ['kind', 'id', 'publicKeyB64u', 'deviceKeyId', 'factorSecretB64u'],
        'VoiceID activation reply',
      );
      return {
        kind: 'activation_approved',
        id: record.id,
        publicKeyB64u: parseVoiceIdDevicePublicKeyB64u(record.publicKeyB64u),
        deviceKeyId: parseDigestB64u(record.deviceKeyId),
        factorSecret32: parseFactorSecret(record.factorSecretB64u),
      };
    case 'unlock_approved':
      rejectUnknownFields(
        record,
        ['kind', 'id', 'signatureB64u', 'factorSecretB64u'],
        'VoiceID unlock reply',
      );
      if (typeof record.signatureB64u !== 'string') {
        throw new Error('VoiceID returned an invalid device signature.');
      }
      return {
        kind: 'unlock_approved',
        id: record.id,
        signatureB64u: record.signatureB64u,
        factorSecret32: parseFactorSecret(record.factorSecretB64u),
      };
    case 'device_rejected':
      rejectUnknownFields(record, ['kind', 'id', 'outcome'], 'VoiceID rejection reply');
      if (record.outcome !== 'cancelled' && record.outcome !== 'rejected') {
        throw new Error('VoiceID returned an invalid rejection.');
      }
      return { kind: 'device_rejected', id: record.id, outcome: record.outcome };
    default:
      throw new Error('VoiceID returned an invalid device message.');
  }
}

function requireVisibleUserAction(): void {
  if (
    !navigator.userActivation.isActive ||
    document.visibilityState !== 'visible' ||
    !document.hasFocus()
  ) {
    throw new Error('Open the Wallet and select VoiceID to start capture.');
  }
}

function requestDeadline(request: DeviceRequest): number {
  switch (request.kind) {
    case 'activate':
      return request.binding.expiresAtMs;
    case 'unlock':
      return request.binding.challenge.expiresAtMs;
    default:
      return assertNever(request);
  }
}

class DeviceExchange {
  private readonly controller = new AbortController();
  private readonly completion = new WorkerDeferred<DeviceCaptureResult>();
  private readonly timer: ReturnType<typeof setTimeout>;
  private state: CaptureState = { kind: 'starting' };
  readonly result = this.completion.promise;

  constructor(
    private readonly request: DeviceRequest,
    private readonly signal: AbortSignal,
    private readonly onListening: () => void,
  ) {
    const remainingMs = requestDeadline(request) - Date.now();
    if (remainingMs < 250 || remainingMs > 60_000) {
      throw new Error('VoiceID capture deadline is invalid.');
    }
    this.timer = setTimeout(this.expired, remainingMs);
    signal.addEventListener('abort', this.aborted, { once: true });
    if (signal.aborted) this.aborted();
    else void this.exchange();
  }

  private async exchange(): Promise<void> {
    try {
      await streamVoiceIdNative(this.request, this.controller.signal, this.receive.bind(this));
    } catch (error: unknown) {
      if (this.state.kind === 'settled') return;
      const message = error instanceof Error && error.message.startsWith('VoiceID ')
        ? error.message
        : 'Start the local VoiceID service on this device.';
      this.fail(new Error(message));
    }
  }

  private receive(value: unknown): boolean {
    if (this.state.kind === 'settled') return true;
    let reply: DeviceReply | null = null;
    try {
      reply = parseDeviceReply(value);
      if (reply.id !== this.request.binding.attemptId) {
        throw new Error('VoiceID returned a different capture attempt.');
      }
      if (reply.kind === 'device_listening') {
        if (this.state.kind !== 'starting') throw new Error('VoiceID capture state changed.');
        this.state = { kind: 'listening' };
        this.onListening();
        return false;
      }
      if (reply.kind === 'device_rejected') {
        this.fail(new Error(reply.outcome === 'cancelled'
          ? 'VoiceID capture was cancelled.'
          : 'VoiceID did not recognize this speaker.'));
        return true;
      }
      if (this.state.kind !== 'listening' || Date.now() >= requestDeadline(this.request)) {
        throw new Error('VoiceID capture expired or finished before listening.');
      }
      switch (this.request.kind) {
        case 'activate':
          if (reply.kind !== 'activation_approved') {
            throw new Error('VoiceID returned an unlock for activation.');
          }
          this.complete({
            kind: 'activated',
            publicKeyB64u: reply.publicKeyB64u,
            deviceKeyId: reply.deviceKeyId,
            factorSecret32: reply.factorSecret32,
          });
          return true;
        case 'unlock':
          if (reply.kind !== 'unlock_approved') {
            throw new Error('VoiceID returned an activation for unlock.');
          }
          this.complete({
            kind: 'unlocked',
            assertion: parseVoiceIdDeviceAssertion({
              kind: 'voiceid_device_assertion_v1',
              challenge: this.request.binding.challenge,
              signatureB64u: reply.signatureB64u,
            }),
            factorSecret32: reply.factorSecret32,
          });
          return true;
        default:
          return assertNever(this.request);
      }
    } catch {
      if (reply?.kind === 'activation_approved' || reply?.kind === 'unlock_approved') {
        reply.factorSecret32.fill(0);
      }
      this.fail(new Error('VoiceID returned an invalid device message.'));
      return true;
    }
  }

  private complete(result: DeviceCaptureResult): void {
    this.close();
    this.completion.resolve(result);
  }

  private readonly aborted = (): void => {
    this.fail(new Error('VoiceID capture was cancelled.'));
  };

  private readonly expired = (): void => {
    this.fail(new Error('VoiceID capture expired.'));
  };

  private fail(error: Error): void {
    if (this.state.kind === 'settled') return;
    this.close();
    this.completion.reject(error);
  }

  private close(): void {
    this.state = { kind: 'settled' };
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.aborted);
    this.controller.abort();
  }
}

export async function captureVoiceIdActivation(input: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly signal: AbortSignal;
  readonly onListening: () => void;
}): Promise<Extract<DeviceCaptureResult, { readonly kind: 'activated' }>> {
  requireVisibleUserAction();
  const exchange = new DeviceExchange({
    kind: 'activate',
    binding: {
      attemptId: crypto.randomUUID(),
      walletId: input.walletId,
      walletAuthMethodId: input.walletAuthMethodId,
      expiresAtMs: Date.now() + 25_000,
    },
  }, input.signal, input.onListening);
  const result = await exchange.result;
  if (result.kind !== 'activated') {
    result.factorSecret32.fill(0);
    throw new Error('VoiceID returned an unlock for activation.');
  }
  const actualKeyId = await sha256DigestB64u(base64UrlDecode(result.publicKeyB64u));
  if (actualKeyId !== result.deviceKeyId) {
    result.factorSecret32.fill(0);
    throw new Error('VoiceID device public key does not match its key ID.');
  }
  return result;
}

export async function captureVoiceIdUnlock(input: {
  readonly challenge: VoiceIdWalletSessionChallenge;
  readonly signal: AbortSignal;
  readonly onListening: () => void;
}): Promise<Extract<DeviceCaptureResult, { readonly kind: 'unlocked' }>> {
  requireVisibleUserAction();
  if (input.challenge.requestOrigin !== location.origin) {
    throw new Error('VoiceID challenge belongs to a different Wallet origin.');
  }
  const exchange = new DeviceExchange({
    kind: 'unlock',
    binding: {
      attemptId: crypto.randomUUID(),
      walletId: input.challenge.walletId,
      walletAuthMethodId: input.challenge.walletAuthMethodId,
      challenge: input.challenge,
    },
  }, input.signal, input.onListening);
  const result = await exchange.result;
  if (result.kind !== 'unlocked') {
    result.factorSecret32.fill(0);
    throw new Error('VoiceID returned an activation for unlock.');
  }
  return result;
}
