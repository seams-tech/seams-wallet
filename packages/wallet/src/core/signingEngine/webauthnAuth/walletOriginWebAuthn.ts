type Kind = 'create' | 'get';
type AnyPublicKeyOptions = PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions;

interface WebAuthnOptions {
  abortSignal?: AbortSignal;
}

class WalletOriginWebAuthnUnavailableError extends Error {
  readonly code = 'wallet_origin_webauthn_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'WalletOriginWebAuthnUnavailableError';
  }
}

/** Execute WebAuthn once on the wallet origin. */
export function executeWalletOriginWebAuthn(
  kind: 'create',
  publicKey: PublicKeyCredentialCreationOptions,
  deps: WebAuthnOptions,
): Promise<Credential | null>;
export function executeWalletOriginWebAuthn(
  kind: 'get',
  publicKey: PublicKeyCredentialRequestOptions,
  deps: WebAuthnOptions,
): Promise<Credential | null>;
export async function executeWalletOriginWebAuthn(
  kind: Kind,
  publicKey: AnyPublicKeyOptions,
  deps: WebAuthnOptions,
): Promise<Credential | null> {
  const publicKeyForAttempt = clonePublicKeyOptions(kind, publicKey);
  try {
    if (kind === 'create') {
      return await navigator.credentials.create({
        publicKey: publicKeyForAttempt as PublicKeyCredentialCreationOptions,
        ...(deps.abortSignal ? { signal: deps.abortSignal } : {}),
      });
    }
    return await navigator.credentials.get({
      publicKey: publicKeyForAttempt,
      ...(deps.abortSignal ? { signal: deps.abortSignal } : {}),
    });
  } catch (error: unknown) {
    if (kind === 'create' && (isAncestorOriginError(error) || isDocumentNotFocusedError(error))) {
      throw new WalletOriginWebAuthnUnavailableError(
        `Wallet-origin WebAuthn registration is unavailable: ${safeMessage(error)}`,
      );
    }
    throw error;
  }
}

function clonePublicKeyOptions(kind: Kind, publicKey: AnyPublicKeyOptions): AnyPublicKeyOptions {
  return kind === 'create'
    ? cloneCreationOptions(publicKey as PublicKeyCredentialCreationOptions)
    : cloneRequestOptions(publicKey);
}

function cloneCreationOptions(
  publicKey: PublicKeyCredentialCreationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    ...publicKey,
    challenge: cloneBufferSource(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: cloneBufferSource(publicKey.user.id),
    },
    excludeCredentials: publicKey.excludeCredentials?.map(cloneCredentialDescriptor),
    extensions: cloneCredentialExtensions(publicKey.extensions),
  };
}

function cloneRequestOptions(
  publicKey: PublicKeyCredentialRequestOptions,
): PublicKeyCredentialRequestOptions {
  return {
    ...publicKey,
    challenge: cloneBufferSource(publicKey.challenge),
    allowCredentials: publicKey.allowCredentials?.map(cloneCredentialDescriptor),
    extensions: cloneCredentialExtensions(publicKey.extensions),
  };
}

function cloneCredentialDescriptor(
  descriptor: PublicKeyCredentialDescriptor,
): PublicKeyCredentialDescriptor {
  return {
    ...descriptor,
    id: cloneBufferSource(descriptor.id),
  };
}

function cloneCredentialExtensions<T extends AuthenticationExtensionsClientInputs | undefined>(
  extensions: T,
): T {
  if (!extensions) return extensions;
  const cloned = { ...extensions };
  const prf = cloned.prf;
  if (prf && typeof prf === 'object') {
    const prfRecord = { ...(prf as Record<string, unknown>) };
    if (prfRecord.eval && typeof prfRecord.eval === 'object') {
      prfRecord.eval = clonePrfEval(prfRecord.eval as Record<string, unknown>);
    }
    if (prfRecord.evalByCredential && typeof prfRecord.evalByCredential === 'object') {
      const evalByCredential: Record<string, unknown> = {};
      for (const [credentialId, evalValue] of Object.entries(
        prfRecord.evalByCredential as Record<string, unknown>,
      )) {
        evalByCredential[credentialId] =
          evalValue && typeof evalValue === 'object'
            ? clonePrfEval(evalValue as Record<string, unknown>)
            : evalValue;
      }
      prfRecord.evalByCredential = evalByCredential;
    }
    cloned.prf = prfRecord;
  }
  return cloned;
}

function clonePrfEval(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    ...(isBufferSource(input.first) ? { first: cloneBufferSource(input.first) } : {}),
    ...(isBufferSource(input.second) ? { second: cloneBufferSource(input.second) } : {}),
  };
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function cloneBufferSource<T extends BufferSource>(value: T): T {
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  const view = value as ArrayBufferView;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const clonedBytes = bytes.slice();
  if (value instanceof DataView) {
    return new DataView(clonedBytes.buffer) as unknown as T;
  }
  const ViewCtor = Object.getPrototypeOf(value).constructor as new (
    buffer: ArrayBuffer,
  ) => ArrayBufferView;
  return new ViewCtor(clonedBytes.buffer) as unknown as T;
}

// Private: error classification helpers
function isAncestorOriginError(err: unknown): boolean {
  const msg = safeMessage(err);
  return /origin of the document is not the same as its ancestors/i.test(msg);
}

function isDocumentNotFocusedError(err: unknown): boolean {
  const name = safeName(err);
  const msg = safeMessage(err);
  const isNotAllowed = name === 'NotAllowedError';
  const mentionsFocus = /document is not focused|not focused|focus/i.test(msg);
  return Boolean(isNotAllowed && mentionsFocus);
}

function safeMessage(err: unknown): string {
  return String((err as { message?: unknown })?.message || '');
}

function safeName(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  return typeof name === 'string' ? name : '';
}
