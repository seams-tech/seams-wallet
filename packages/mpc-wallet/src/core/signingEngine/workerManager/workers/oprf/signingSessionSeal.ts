import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  joinNormalizedUrl,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
} from '@shared/utils/normalize';
import {
  SIGNING_SESSION_SEAL_EVALUATION_FIELDS,
  WALLET_SESSION_SEAL_BASE_PATH,
  encodeSigningSessionHkdfTuple,
  readSigningSessionSealEvaluation,
  signingSessionSealOprfInfo,
  type SigningSessionSealEvaluation,
} from '@shared/utils/signingSessionSeal';
import { decryptUnderOprfOutput, encryptUnderOprfOutput } from './outputCipher';
import { blindOprfInput, discardOprfBlind, finalizeOprf, type OprfBlindedInput } from './runtime';

/**
 * The signing-session seal on the device (RFC 9497 POPRF, ristretto255-SHA512). It keeps a
 * 32-byte warm secret across page reloads. The sealed value holds a random OPRF input x, an
 * AES-GCM nonce and the secret encrypted under a key from F(k, x, info). `info` names the
 * wallet and the threshold session, and the server builds it from the admitted Wallet Session.
 * The server sees only blinded elements, so it cannot open a sealed value without the device.
 */

const SEAL_LABEL = 'seams/signing-session-seal/aead/v1';
const INPUT_BYTES = 32;
const NONCE_BYTES = 12;
// The input, the nonce, the 32-byte secret and the 16-byte AES-GCM tag.
const SEALED_BYTES = INPUT_BYTES + NONCE_BYTES + 32 + 16;
const ROUTE_TIMEOUT_MS = 15_000;

export type SigningSessionSealScope = {
  readonly walletId: string;
  readonly thresholdSessionId: string;
};

/** A blinded OPRF input. The blind stays in the WASM module until a seal, an open or a discard. */
export type SigningSessionSealBlind = {
  readonly oprfInput: Uint8Array;
  readonly blind: OprfBlindedInput;
  readonly blindedElementB64u: string;
};

/** A sealed value whose input is blinded again for one restore. */
export type SigningSessionSealOpening = {
  readonly blind: SigningSessionSealBlind;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
};

export type SigningSessionSealRouteResult =
  | (SigningSessionSealEvaluation & {
      readonly ok: true;
      readonly expiresAtMs?: number;
      readonly remainingUses?: number;
    })
  | { readonly ok: false; readonly code: string; readonly message: string };

async function blindInput(oprfInput: Uint8Array): Promise<SigningSessionSealBlind> {
  const blind = await blindOprfInput(oprfInput);
  return { oprfInput, blind, blindedElementB64u: base64UrlEncode(blind.blindedElement) };
}

/** Blinds a new random input for a seal. */
export function blindNewSigningSessionSealInput(): Promise<SigningSessionSealBlind> {
  return blindInput(crypto.getRandomValues(new Uint8Array(INPUT_BYTES)));
}

/** Drops the blind and zeroes the input. Safe to call more than once. */
export function discardSigningSessionSealBlind(blind: SigningSessionSealBlind): void {
  discardOprfBlind(blind.blind);
  blind.oprfInput.fill(0);
}

function associatedData(
  scope: SigningSessionSealScope,
  keyVersion: string,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    encodeSigningSessionHkdfTuple([
      SEAL_LABEL,
      scope.walletId,
      scope.thresholdSessionId,
      keyVersion,
    ]),
  );
}

/** Checks the server's proof and returns the POPRF output for the blinded input. */
function sealOutput(args: {
  readonly blind: SigningSessionSealBlind;
  readonly scope: SigningSessionSealScope;
  readonly evaluation: SigningSessionSealEvaluation;
}): Promise<Uint8Array> {
  return finalizeOprf({
    blind: args.blind.blind,
    input: args.blind.oprfInput,
    evaluatedElement: base64UrlDecode(args.evaluation.evaluatedElementB64u),
    proof: base64UrlDecode(args.evaluation.proofB64u),
    publicKey: base64UrlDecode(args.evaluation.publicKeyB64u),
    info: signingSessionSealOprfInfo(args.scope),
  });
}

/**
 * Encrypts the secret under the key from the server's evaluation of `blind`, and returns the
 * sealed value: the input, the AES-GCM nonce and the ciphertext. The proof check fails when the
 * server used another key or another `info`. The blind is gone afterwards, even on failure.
 */
export async function sealSigningSessionSecret(args: {
  readonly blind: SigningSessionSealBlind;
  readonly scope: SigningSessionSealScope;
  readonly evaluation: SigningSessionSealEvaluation;
  readonly secret32: Uint8Array;
}): Promise<string> {
  const sealed = new Uint8Array(SEALED_BYTES);
  try {
    const { nonce, ciphertext } = await encryptUnderOprfOutput({
      output: await sealOutput(args),
      label: SEAL_LABEL,
      associatedData: associatedData(args.scope, args.evaluation.keyVersion),
      secret32: args.secret32,
    });
    sealed.set(args.blind.oprfInput, 0);
    sealed.set(nonce, INPUT_BYTES);
    sealed.set(ciphertext, INPUT_BYTES + NONCE_BYTES);
    return base64UrlEncode(sealed);
  } finally {
    sealed.fill(0);
    discardSigningSessionSealBlind(args.blind);
  }
}

/** Splits a sealed value and blinds its input for one restore. */
export async function blindSealedSigningSessionSecret(
  sealedSecretB64u: string,
): Promise<SigningSessionSealOpening> {
  const sealed = base64UrlDecode(sealedSecretB64u);
  try {
    if (sealed.length !== SEALED_BYTES) {
      throw new Error('Sealed signing-session secret has an invalid length');
    }
    return {
      blind: await blindInput(sealed.slice(0, INPUT_BYTES)),
      nonce: sealed.slice(INPUT_BYTES, INPUT_BYTES + NONCE_BYTES),
      ciphertext: sealed.slice(INPUT_BYTES + NONCE_BYTES),
    };
  } finally {
    sealed.fill(0);
  }
}

/**
 * Opens a sealed value with the server's evaluation of its blinded input. A wrong key, `info` or
 * key version fails the proof or the AES-GCM tag. The blind is gone afterwards, even on failure.
 */
export async function openSigningSessionSecret(args: {
  readonly opening: SigningSessionSealOpening;
  readonly scope: SigningSessionSealScope;
  readonly evaluation: SigningSessionSealEvaluation;
}): Promise<Uint8Array> {
  try {
    return await decryptUnderOprfOutput({
      output: await sealOutput({
        blind: args.opening.blind,
        scope: args.scope,
        evaluation: args.evaluation,
      }),
      label: SEAL_LABEL,
      associatedData: associatedData(args.scope, args.evaluation.keyVersion),
      nonce: args.opening.nonce,
      ciphertext: args.opening.ciphertext,
    });
  } finally {
    discardSigningSessionSealBlind(args.opening.blind);
  }
}

const PREPARATION_TTL_MS = 30_000;
const MAX_PREPARATIONS = 32;

type Preparation = {
  readonly id: string;
  readonly blind: Promise<SigningSessionSealBlind>;
  readonly expiry: ReturnType<typeof setTimeout>;
};

function discardWhenReady(blind: Promise<SigningSessionSealBlind>): void {
  void blind.then(discardSigningSessionSealBlind, () => undefined);
}

/**
 * Blinds prepared ahead of a registration, so its request can carry the blinded element. Each
 * blind belongs to one threshold session and one preparation. One seal takes it, or cleanup and
 * a 30-second expiry discard it.
 */
export class SigningSessionSealPreparations {
  private readonly entries = new Map<string, Preparation>();

  async prepare(sessionId: string, preparationId: string): Promise<void> {
    if (this.entries.has(sessionId)) throw new Error('Seal preparation already exists');
    if (this.entries.size >= MAX_PREPARATIONS) throw new Error('Too many seal preparations');
    const entry: Preparation = {
      id: preparationId,
      blind: blindNewSigningSessionSealInput(),
      expiry: setTimeout(() => this.drop(sessionId, preparationId), PREPARATION_TTL_MS),
    };
    this.entries.set(sessionId, entry);
    try {
      await entry.blind;
    } catch (error: unknown) {
      this.drop(sessionId, preparationId);
      throw error;
    }
  }

  async readBlindedElement(sessionId: string, preparationId: string): Promise<string> {
    return (await this.current(sessionId, preparationId).blind).blindedElementB64u;
  }

  /** Removes the preparation and hands its blind to the caller, who must seal or discard it. */
  async takeExact(sessionId: string, preparationId: string): Promise<SigningSessionSealBlind> {
    const entry = this.current(sessionId, preparationId);
    this.entries.delete(sessionId);
    clearTimeout(entry.expiry);
    return await entry.blind;
  }

  discard(sessionId: string, preparationId: string): void {
    this.drop(sessionId, preparationId);
  }

  clearSession(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.drop(sessionId, entry.id);
  }

  clear(): void {
    for (const [sessionId, entry] of this.entries) this.drop(sessionId, entry.id);
  }

  private current(sessionId: string, preparationId: string): Preparation {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.id !== preparationId) {
      throw new Error('Seal preparation is unavailable');
    }
    return entry;
  }

  private drop(sessionId: string, preparationId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.id !== preparationId) return;
    this.entries.delete(sessionId);
    clearTimeout(entry.expiry);
    discardWhenReady(entry.blind);
  }
}

const ROUTE_SUCCESS_FIELDS: readonly string[] = [
  'ok',
  ...SIGNING_SESSION_SEAL_EVALUATION_FIELDS,
  'expiresAtMs',
  'remainingUses',
];

function invalidRouteResponse(message: string): SigningSessionSealRouteResult {
  return { ok: false, code: 'invalid_response', message };
}

export function parseSigningSessionSealRouteResult(value: unknown): SigningSessionSealRouteResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidRouteResponse('Invalid signing-session seal response');
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return {
      ok: false,
      code: typeof record.code === 'string' ? record.code : 'request_failed',
      message:
        typeof record.message === 'string' ? record.message : 'Signing-session seal request failed',
    };
  }
  if (record.ok !== true || Object.keys(record).some((f) => !ROUTE_SUCCESS_FIELDS.includes(f))) {
    return invalidRouteResponse('Invalid signing-session seal response');
  }
  const evaluation = readSigningSessionSealEvaluation(record);
  if (!evaluation) {
    return invalidRouteResponse('Signing-session seal response is missing its evaluation');
  }
  const expiresAtMs = normalizePositiveInteger(record.expiresAtMs);
  const remainingUses = normalizeNonNegativeInteger(record.remainingUses);
  return {
    ok: true,
    ...evaluation,
    ...(expiresAtMs != null ? { expiresAtMs } : {}),
    ...(remainingUses != null ? { remainingUses } : {}),
  };
}

/** Posts one blinded element to the Gateway's seal route under the Wallet Session bearer. */
export async function callSigningSessionSealEvaluateRoute(args: {
  readonly relayerUrl: string;
  readonly bearerToken: string;
  readonly thresholdSessionId: string;
  readonly blindedElementB64u: string;
  readonly keyVersion?: string;
}): Promise<SigningSessionSealRouteResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), ROUTE_TIMEOUT_MS);
  try {
    const response = await fetch(
      joinNormalizedUrl(args.relayerUrl, `${WALLET_SESSION_SEAL_BASE_PATH}/evaluate`),
      {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.bearerToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          thresholdSessionId: args.thresholdSessionId,
          blindedElementB64u: args.blindedElementB64u,
          ...(args.keyVersion ? { keyVersion: args.keyVersion } : {}),
        }),
      },
    );
    const parsed = parseSigningSessionSealRouteResult(await response.json().catch(() => null));
    if (!response.ok && parsed.ok) {
      return {
        ok: false,
        code: 'http_error',
        message: `Signing-session seal route returned HTTP ${response.status}`,
      };
    }
    return parsed;
  } catch (error: unknown) {
    return {
      ok: false,
      code: controller.signal.aborted ? 'timeout' : 'network_error',
      message: controller.signal.aborted
        ? `Signing-session seal request timed out after ${ROUTE_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error || 'Signing-session seal request failed'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
