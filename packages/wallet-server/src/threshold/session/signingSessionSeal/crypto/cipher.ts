import {
  SIGNING_SESSION_SEAL_ALG,
  SIGNING_SESSION_SEAL_GROUP_ID,
  encodeSigningSessionHkdfTuple,
  type SigningSessionSealProtocol,
} from '@shared/utils/signingSessionSeal';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import {
  parseSigningSessionSealKeyVersion,
  type SigningSessionSealKeyVersion,
} from '../../../../core/keyMaterialBrands';
import type {
  SigningSessionSealCipherAdapter,
  SigningSessionSealCipherOperationInput,
  SigningSessionSealCipherOperationResult,
  SigningSessionSealOperation,
} from '../signingSessionSeal.types';
import {
  addSigningSessionSealLock,
  deriveSigningSessionSealLockKeyHandle,
  destroySigningSessionSealLockKeyHandle,
  removeSigningSessionSealLock,
} from './shamir3PassWasm';

type HandlerInput = Omit<SigningSessionSealCipherOperationInput, 'operation'>;
type HandlerResult = SigningSessionSealCipherOperationResult;

export interface CreateSigningSessionSealCipherAdapterOptions {
  applyServerSeal: (input: HandlerInput) => Promise<HandlerResult> | HandlerResult;
  removeServerSeal: (input: HandlerInput) => Promise<HandlerResult> | HandlerResult;
}

export type SigningSessionSealShamir3PassRootConfig = {
  readonly kind: 'shamir3pass_root_v2';
  readonly rootSecret32: Uint8Array;
  readonly currentKeyVersion: SigningSessionSealKeyVersion;
  readonly acceptedWarmKeyVersions: readonly SigningSessionSealKeyVersion[];
  readonly protocol: SigningSessionSealProtocol;
};

export interface SigningSessionSealShamir3PassRuntime {
  deriveLockKeyHandle(input: {
    readonly groupId: string;
    readonly rootSecret32: Uint8Array;
    readonly context: Uint8Array;
  }): Promise<number>;
  addLock(input: { readonly handle: number; readonly ciphertextB64u: string }): Promise<string>;
  removeLock(input: { readonly handle: number; readonly ciphertextB64u: string }): Promise<string>;
  destroyLockKeyHandle(handle: number): boolean;
}

export interface CreateSigningSessionSealShamir3PassCipherAdapterOptions {
  readonly config: SigningSessionSealShamir3PassRootConfig;
  readonly runtime?: SigningSessionSealShamir3PassRuntime;
}

function toErrorResult(error: unknown): { ok: false; code: string; message: string } {
  if (
    error &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    (error as { code?: unknown }).code
  ) {
    const code = String((error as { code?: unknown }).code || '').trim() || 'internal';
    const message =
      String((error as { message?: unknown }).message || '').trim() ||
      'Signing-session seal cipher failed';
    return failure(code, message);
  }
  const message =
    error instanceof Error ? error.message : String(error || 'Signing-session seal cipher failed');
  return failure('internal', message);
}

function normalizeResult(result: HandlerResult): HandlerResult {
  if (!result.ok) {
    return failure(
      String(result.code || 'internal').trim() || 'internal',
      String(result.message || 'Signing-session seal cipher failed').trim() ||
        'Signing-session seal cipher failed',
    );
  }
  const ciphertext = toOptionalTrimmedString(result.ciphertext);
  if (!ciphertext) {
    return failure('invalid_ciphertext', 'Signing-session seal cipher returned empty ciphertext');
  }
  return {
    ok: true,
    ciphertext,
    ...(String(result.keyVersion || '').trim()
      ? { keyVersion: String(result.keyVersion).trim() }
      : {}),
  };
}

export function createSigningSessionSealCipherAdapter(
  options: CreateSigningSessionSealCipherAdapterOptions,
): SigningSessionSealCipherAdapter {
  return {
    run: async (
      input: SigningSessionSealCipherOperationInput,
    ): Promise<SigningSessionSealCipherOperationResult> => {
      const handlerInput: HandlerInput = {
        thresholdSessionId: input.thresholdSessionId,
        ciphertext: input.ciphertext,
        ...(input.keyVersion ? { keyVersion: input.keyVersion } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        auth: input.auth,
      };
      try {
        const output =
          input.operation === 'apply-server-seal'
            ? await options.applyServerSeal(handlerInput)
            : await options.removeServerSeal(handlerInput);
        return normalizeResult(output);
      } catch (error: unknown) {
        return toErrorResult(error);
      }
    },
  };
}

export function createPassthroughSigningSessionSealCipherAdapter(): SigningSessionSealCipherAdapter {
  return createSigningSessionSealCipherAdapter({
    applyServerSeal: async (input) => ({
      ok: true,
      ciphertext: input.ciphertext,
      ...(input.keyVersion ? { keyVersion: input.keyVersion } : {}),
    }),
    removeServerSeal: async (input) => ({
      ok: true,
      ciphertext: input.ciphertext,
      ...(input.keyVersion ? { keyVersion: input.keyVersion } : {}),
    }),
  });
}

function normalizeKeyVersion(value: unknown, label: string): SigningSessionSealKeyVersion {
  const keyVersion = toOptionalTrimmedString(value);
  if (!keyVersion) throw new Error(`${label} is required`);
  return parseSigningSessionSealKeyVersion(keyVersion);
}

function normalizeConfig(
  config: SigningSessionSealShamir3PassRootConfig,
): SigningSessionSealShamir3PassRootConfig {
  if (config.kind !== 'shamir3pass_root_v2') {
    throw new Error('Signing-session seal root configuration kind is invalid');
  }
  if (!(config.rootSecret32 instanceof Uint8Array) || config.rootSecret32.length !== 32) {
    throw new Error('Signing-session seal root secret must be exactly 32 bytes');
  }
  if (
    config.protocol.algorithm !== SIGNING_SESSION_SEAL_ALG ||
    config.protocol.groupId !== SIGNING_SESSION_SEAL_GROUP_ID
  ) {
    throw new Error('Signing-session seal protocol is unsupported');
  }

  const currentKeyVersion = normalizeKeyVersion(
    config.currentKeyVersion,
    'currentKeyVersion',
  );
  const acceptedWarmKeyVersions = config.acceptedWarmKeyVersions.map((keyVersion, index) =>
    normalizeKeyVersion(keyVersion, `acceptedWarmKeyVersions[${index}]`),
  );
  if (!acceptedWarmKeyVersions.includes(currentKeyVersion)) {
    throw new Error('acceptedWarmKeyVersions must include currentKeyVersion');
  }
  if (new Set(acceptedWarmKeyVersions).size !== acceptedWarmKeyVersions.length) {
    throw new Error('acceptedWarmKeyVersions must not contain duplicates');
  }

  return {
    kind: 'shamir3pass_root_v2',
    rootSecret32: config.rootSecret32.slice(),
    currentKeyVersion,
    acceptedWarmKeyVersions,
    protocol: {
      algorithm: SIGNING_SESSION_SEAL_ALG,
      groupId: SIGNING_SESSION_SEAL_GROUP_ID,
    },
  };
}

export function encodeSigningSessionSealServerLockContext(input: {
  readonly protocol: SigningSessionSealProtocol;
  readonly keyVersion: string;
  readonly walletId: string;
  readonly thresholdSessionId: string;
}): Uint8Array {
  return encodeSigningSessionHkdfTuple([
    'seams/router-ab/signing-session-seal',
    input.protocol.algorithm,
    input.protocol.groupId,
    input.keyVersion,
    'server-lock/session/v1',
    input.walletId,
    input.thresholdSessionId,
  ]);
}

function encodeEmailOtpEnrollmentServerLockContext(input: {
  readonly protocol: SigningSessionSealProtocol;
  readonly keyVersion: string;
}): Uint8Array {
  return encodeSigningSessionHkdfTuple([
    'seams/router-ab/signing-session-seal',
    input.protocol.algorithm,
    input.protocol.groupId,
    input.keyVersion,
    'server-lock/v1',
  ]);
}

function defaultRuntime(): SigningSessionSealShamir3PassRuntime {
  return {
    deriveLockKeyHandle: deriveSigningSessionSealLockKeyHandle,
    addLock: addSigningSessionSealLock,
    removeLock: removeSigningSessionSealLock,
    destroyLockKeyHandle: destroySigningSessionSealLockKeyHandle,
  };
}

async function deriveEmailOtpEnrollmentKeyHandles(input: {
  readonly config: SigningSessionSealShamir3PassRootConfig;
  readonly runtime: SigningSessionSealShamir3PassRuntime;
}): Promise<ReadonlyMap<string, number>> {
  const handles = new Map<string, number>();
  try {
    for (const keyVersion of input.config.acceptedWarmKeyVersions) {
      const handle = await input.runtime.deriveLockKeyHandle({
        groupId: input.config.protocol.groupId,
        rootSecret32: input.config.rootSecret32,
        context: encodeEmailOtpEnrollmentServerLockContext({
          protocol: input.config.protocol,
          keyVersion,
        }),
      });
      handles.set(keyVersion, handle);
    }
    return handles;
  } catch (error: unknown) {
    for (const handle of handles.values()) input.runtime.destroyLockKeyHandle(handle);
    throw error;
  } finally {
    input.config.rootSecret32.fill(0);
  }
}

class EmailOtpEnrollmentKeyHandles {
  private initialization: Promise<ReadonlyMap<string, number>> | null = null;

  constructor(
    private readonly config: SigningSessionSealShamir3PassRootConfig,
    private readonly runtime: SigningSessionSealShamir3PassRuntime,
  ) {}

  get(): Promise<ReadonlyMap<string, number>> {
    if (!this.initialization) {
      this.initialization = deriveEmailOtpEnrollmentKeyHandles({
        config: this.config,
        runtime: this.runtime,
      });
    }
    return this.initialization;
  }
}

function mapCipherError(
  error: unknown,
  defaultMessage: string,
): SigningSessionSealCipherOperationResult {
  const message =
    toOptionalTrimmedString(error instanceof Error ? error.message : error) || defaultMessage;
  const lowered = message.toLowerCase();
  if (lowered.includes('keyversion')) return failure('invalid_key_version', message);
  if (lowered.includes('ciphertext') || lowered.includes('base64url') || lowered.includes('group')) {
    return failure('invalid_ciphertext', message);
  }
  return failure('internal', message);
}

type EmailOtpEnrollmentCipherState = {
  readonly kind: 'email_otp_enrollment';
  readonly config: SigningSessionSealShamir3PassRootConfig;
  readonly runtime: SigningSessionSealShamir3PassRuntime;
  readonly handles: EmailOtpEnrollmentKeyHandles;
};

type SigningSessionScopedCipherState = {
  readonly kind: 'signing_session';
  readonly config: SigningSessionSealShamir3PassRootConfig;
  readonly runtime: SigningSessionSealShamir3PassRuntime;
  readonly rootKey: Promise<CryptoKey>;
};

type Shamir3PassCipherState = EmailOtpEnrollmentCipherState | SigningSessionScopedCipherState;

type LockHandleLease =
  | { readonly kind: 'borrowed'; readonly handle: number }
  | { readonly kind: 'owned'; readonly handle: number };

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function importSigningSessionSealRootKey(rootSecret32: Uint8Array): Promise<CryptoKey> {
  const rootCopy = copyToArrayBuffer(rootSecret32);
  try {
    return await crypto.subtle.importKey(
      'raw',
      rootCopy,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } finally {
    rootSecret32.fill(0);
    new Uint8Array(rootCopy).fill(0);
  }
}

async function deriveScopedSigningSessionHandle(input: {
  readonly state: SigningSessionScopedCipherState;
  readonly keyVersion: SigningSessionSealKeyVersion;
  readonly walletId: string;
  readonly thresholdSessionId: string;
}): Promise<number> {
  const context = encodeSigningSessionSealServerLockContext({
    protocol: input.state.config.protocol,
    keyVersion: input.keyVersion,
    walletId: input.walletId,
    thresholdSessionId: input.thresholdSessionId,
  });
  let sessionRoot32: Uint8Array | null = null;
  try {
    const rootKey = await input.state.rootKey;
    sessionRoot32 = new Uint8Array(
      await crypto.subtle.sign('HMAC', rootKey, copyToArrayBuffer(context)),
    );
    return await input.state.runtime.deriveLockKeyHandle({
      groupId: input.state.config.protocol.groupId,
      rootSecret32: sessionRoot32,
      context,
    });
  } finally {
    sessionRoot32?.fill(0);
    context.fill(0);
  }
}

async function acquireLockHandle(
  state: Shamir3PassCipherState,
  input: HandlerInput,
  keyVersion: SigningSessionSealKeyVersion,
): Promise<LockHandleLease> {
  switch (state.kind) {
    case 'email_otp_enrollment': {
      const handle = (await state.handles.get()).get(keyVersion);
      if (handle === undefined) throw new Error('Email OTP enrollment lock key handle is unavailable');
      return { kind: 'borrowed', handle };
    }
    case 'signing_session': {
      const handle = await deriveScopedSigningSessionHandle({
        state,
        keyVersion,
        walletId: input.auth.userId,
        thresholdSessionId: input.thresholdSessionId,
      });
      return { kind: 'owned', handle };
    }
    default:
      return assertNeverShamir3PassCipherState(state);
  }
}

function assertNeverShamir3PassCipherState(value: never): never {
  throw new Error(`Unsupported Shamir 3-pass cipher state: ${String(value)}`);
}

function assertNeverSigningSessionSealOperation(value: never): never {
  throw new Error(`Unsupported signing-session seal operation: ${String(value)}`);
}

async function runShamir3PassCipher(
  state: Shamir3PassCipherState,
  operation: SigningSessionSealOperation,
  input: HandlerInput,
): Promise<HandlerResult> {
  if (state.kind === 'signing_session') {
    if (!toOptionalTrimmedString(input.auth.userId) || !toOptionalTrimmedString(input.thresholdSessionId)) {
      return failure('invalid_scope', 'Authenticated wallet and threshold session are required');
    }
  }

  let keyVersion: SigningSessionSealKeyVersion;
  switch (operation) {
    case 'apply-server-seal': {
      const requestedKeyVersion = toOptionalTrimmedString(input.keyVersion);
      if (requestedKeyVersion && requestedKeyVersion !== state.config.currentKeyVersion) {
        return failure(
          'invalid_key_version',
          `Requested keyVersion "${requestedKeyVersion}" does not match active keyVersion "${state.config.currentKeyVersion}"`,
        );
      }
      keyVersion = state.config.currentKeyVersion;
      break;
    }
    case 'remove-server-seal': {
      try {
        keyVersion = normalizeKeyVersion(input.keyVersion, 'keyVersion');
      } catch {
        return failure('invalid_key_version', 'keyVersion is invalid');
      }
      if (!state.config.acceptedWarmKeyVersions.includes(keyVersion)) {
        return failure('invalid_key_version', `Unknown keyVersion "${keyVersion}"`);
      }
      break;
    }
    default:
      return assertNeverSigningSessionSealOperation(operation);
  }

  try {
    const lease = await acquireLockHandle(state, input, keyVersion);
    try {
      let ciphertext: string;
      switch (operation) {
        case 'apply-server-seal':
          ciphertext = await state.runtime.addLock({
            handle: lease.handle,
            ciphertextB64u: input.ciphertext,
          });
          break;
        case 'remove-server-seal':
          ciphertext = await state.runtime.removeLock({
            handle: lease.handle,
            ciphertextB64u: input.ciphertext,
          });
          break;
        default:
          return assertNeverSigningSessionSealOperation(operation);
      }
      return { ok: true, ciphertext, keyVersion };
    } finally {
      if (lease.kind === 'owned') state.runtime.destroyLockKeyHandle(lease.handle);
    }
  } catch (error: unknown) {
    return mapCipherError(error, 'Failed to process server seal');
  }
}

function applyShamir3PassCipher(
  state: Shamir3PassCipherState,
  input: HandlerInput,
): Promise<HandlerResult> {
  return runShamir3PassCipher(state, 'apply-server-seal', input);
}

function removeShamir3PassCipher(
  state: Shamir3PassCipherState,
  input: HandlerInput,
): Promise<HandlerResult> {
  return runShamir3PassCipher(state, 'remove-server-seal', input);
}

function createShamir3PassCipherAdapter(state: Shamir3PassCipherState): SigningSessionSealCipherAdapter {
  return createSigningSessionSealCipherAdapter({
    applyServerSeal: applyShamir3PassCipher.bind(null, state),
    removeServerSeal: removeShamir3PassCipher.bind(null, state),
  });
}

export function createEmailOtpEnrollmentShamir3PassCipherAdapter(
  options: CreateSigningSessionSealShamir3PassCipherAdapterOptions,
): SigningSessionSealCipherAdapter {
  const config = normalizeConfig(options.config);
  options.config.rootSecret32.fill(0);
  const runtime = options.runtime ?? defaultRuntime();
  return createShamir3PassCipherAdapter({
    kind: 'email_otp_enrollment',
    config,
    runtime,
    handles: new EmailOtpEnrollmentKeyHandles(config, runtime),
  });
}

export function createSigningSessionSealShamir3PassCipherAdapter(
  options: CreateSigningSessionSealShamir3PassCipherAdapterOptions,
): SigningSessionSealCipherAdapter {
  const config = normalizeConfig(options.config);
  options.config.rootSecret32.fill(0);
  return createShamir3PassCipherAdapter({
    kind: 'signing_session',
    config,
    runtime: options.runtime ?? defaultRuntime(),
    rootKey: importSigningSessionSealRootKey(config.rootSecret32),
  });
}
