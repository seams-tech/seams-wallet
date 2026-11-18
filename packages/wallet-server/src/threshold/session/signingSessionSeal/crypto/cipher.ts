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
  readonly walletId: string;
  readonly enrollmentId: string;
}): Uint8Array {
  return encodeSigningSessionHkdfTuple([
    'seams/router-ab/signing-session-seal',
    input.protocol.algorithm,
    input.protocol.groupId,
    input.keyVersion,
    'server-lock/email-otp-enrollment/v1',
    input.walletId,
    input.enrollmentId,
  ]);
}

/**
 * What a server lock key belongs to. Each scope derives its own key from the
 * root, so a seal removed for one wallet never opens a value sealed for another.
 */
type ServerLockScope =
  | {
      readonly kind: 'signing_session';
      readonly walletId: string;
      readonly thresholdSessionId: string;
    }
  | {
      readonly kind: 'email_otp_enrollment';
      readonly walletId: string;
      readonly enrollmentId: string;
    };

function encodeServerLockContext(
  protocol: SigningSessionSealProtocol,
  keyVersion: string,
  scope: ServerLockScope,
): Uint8Array {
  switch (scope.kind) {
    case 'signing_session':
      return encodeSigningSessionSealServerLockContext({
        protocol,
        keyVersion,
        walletId: scope.walletId,
        thresholdSessionId: scope.thresholdSessionId,
      });
    case 'email_otp_enrollment':
      return encodeEmailOtpEnrollmentServerLockContext({
        protocol,
        keyVersion,
        walletId: scope.walletId,
        enrollmentId: scope.enrollmentId,
      });
    default:
      return assertNeverServerLockScope(scope);
  }
}

function defaultRuntime(): SigningSessionSealShamir3PassRuntime {
  return {
    deriveLockKeyHandle: deriveSigningSessionSealLockKeyHandle,
    addLock: addSigningSessionSealLock,
    removeLock: removeSigningSessionSealLock,
    destroyLockKeyHandle: destroySigningSessionSealLockKeyHandle,
  };
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

type Shamir3PassCipherState = {
  readonly config: SigningSessionSealShamir3PassRootConfig;
  readonly runtime: SigningSessionSealShamir3PassRuntime;
  readonly rootKey: Promise<CryptoKey>;
};

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

async function deriveScopedLockHandle(input: {
  readonly state: Shamir3PassCipherState;
  readonly keyVersion: SigningSessionSealKeyVersion;
  readonly scope: ServerLockScope;
}): Promise<number> {
  const context = encodeServerLockContext(
    input.state.config.protocol,
    input.keyVersion,
    input.scope,
  );
  let scopeRoot32: Uint8Array | null = null;
  try {
    const rootKey = await input.state.rootKey;
    scopeRoot32 = new Uint8Array(
      await crypto.subtle.sign('HMAC', rootKey, copyToArrayBuffer(context)),
    );
    return await input.state.runtime.deriveLockKeyHandle({
      groupId: input.state.config.protocol.groupId,
      rootSecret32: scopeRoot32,
      context,
    });
  } finally {
    scopeRoot32?.fill(0);
    context.fill(0);
  }
}

function assertNeverServerLockScope(value: never): never {
  throw new Error(`Unsupported server lock scope: ${String(value)}`);
}

function assertNeverSigningSessionSealOperation(value: never): never {
  throw new Error(`Unsupported signing-session seal operation: ${String(value)}`);
}

async function runShamir3PassCipher(
  state: Shamir3PassCipherState,
  operation: SigningSessionSealOperation,
  input: {
    readonly scope: ServerLockScope;
    readonly keyVersion?: string;
    readonly ciphertext: string;
  },
): Promise<HandlerResult> {
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
    const handle = await deriveScopedLockHandle({ state, keyVersion, scope: input.scope });
    try {
      let ciphertext: string;
      switch (operation) {
        case 'apply-server-seal':
          ciphertext = await state.runtime.addLock({ handle, ciphertextB64u: input.ciphertext });
          break;
        case 'remove-server-seal':
          ciphertext = await state.runtime.removeLock({ handle, ciphertextB64u: input.ciphertext });
          break;
        default:
          return assertNeverSigningSessionSealOperation(operation);
      }
      return { ok: true, ciphertext, keyVersion };
    } finally {
      state.runtime.destroyLockKeyHandle(handle);
    }
  } catch (error: unknown) {
    return mapCipherError(error, 'Failed to process server seal');
  }
}

function createShamir3PassCipherState(
  options: CreateSigningSessionSealShamir3PassCipherAdapterOptions,
): Shamir3PassCipherState {
  const config = normalizeConfig(options.config);
  options.config.rootSecret32.fill(0);
  return {
    config,
    runtime: options.runtime ?? defaultRuntime(),
    rootKey: importSigningSessionSealRootKey(config.rootSecret32),
  };
}

/** Adds or removes the Email OTP server seal under the key of one wallet and enrollment. */
export type EmailOtpEnrollmentSealCipher = {
  readonly run: (input: {
    readonly operation: SigningSessionSealOperation;
    readonly walletId: string;
    readonly enrollmentId: string;
    readonly keyVersion: string;
    readonly ciphertext: string;
  }) => Promise<SigningSessionSealCipherOperationResult>;
};

export function createEmailOtpEnrollmentShamir3PassCipher(
  options: CreateSigningSessionSealShamir3PassCipherAdapterOptions,
): EmailOtpEnrollmentSealCipher {
  const state = createShamir3PassCipherState(options);
  return {
    run: async ({ operation, walletId, enrollmentId, keyVersion, ciphertext }) => {
      if (!toOptionalTrimmedString(walletId) || !toOptionalTrimmedString(enrollmentId)) {
        return failure('invalid_scope', 'Email OTP wallet and enrollment are required');
      }
      return normalizeResult(
        await runShamir3PassCipher(state, operation, {
          scope: { kind: 'email_otp_enrollment', walletId, enrollmentId },
          keyVersion,
          ciphertext,
        }),
      );
    },
  };
}

export function createSigningSessionSealShamir3PassCipherAdapter(
  options: CreateSigningSessionSealShamir3PassCipherAdapterOptions,
): SigningSessionSealCipherAdapter {
  const state = createShamir3PassCipherState(options);
  const run = async (
    operation: SigningSessionSealOperation,
    input: HandlerInput,
  ): Promise<HandlerResult> => {
    if (
      !toOptionalTrimmedString(input.auth.userId) ||
      !toOptionalTrimmedString(input.thresholdSessionId)
    ) {
      return failure('invalid_scope', 'Authenticated wallet and threshold session are required');
    }
    return await runShamir3PassCipher(state, operation, {
      scope: {
        kind: 'signing_session',
        walletId: input.auth.userId,
        thresholdSessionId: input.thresholdSessionId,
      },
      keyVersion: input.keyVersion,
      ciphertext: input.ciphertext,
    });
  };
  return createSigningSessionSealCipherAdapter({
    applyServerSeal: (input) => run('apply-server-seal', input),
    removeServerSeal: (input) => run('remove-server-seal', input),
  });
}
