import { parseVoiceIdIntentAssertion } from '@shared/authorization/voiceIdDeviceAssertion';
import {
  voiceVaultTransferRequestBorsh,
  type SpokenIntentNetwork,
} from '@shared/authorization/spokenIntentRequest';
import {
  parseDigestB64u,
  sha256DigestB64u,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import { hasExactKeys } from '@shared/utils/exactKeys';
import {
  verifyVoiceIdIntentAssertion,
  type RegisteredVoiceIdDeviceKey,
  type SpokenIntentRendererV1,
} from '../../../authorization/voiceIdDeviceProof';
import { defineRoute } from '../../framework/routeDefinitions';
import type {
  RouterApiFetchRouteExtensionInput,
  RouterApiRouteExtension,
} from '../../framework/routeExtensions';

/** The relay keeps one ciphertext for at most 5 minutes (Speak-to-Sign vault). */
const MAXIMUM_BLOB_TTL_MS = 5 * 60_000;
/** 8 s of PCM16 16 kHz mono is 256,000 bytes; the rest covers the HPKE framing. */
const DEFAULT_MAXIMUM_BLOB_BYTES = 262_144;
const DEFAULT_MAXIMUM_STORED_BLOBS = 256;
const MAXIMUM_INTENT_CHECK_BODY_BYTES = 16_384;
const BLOB_PATH = '/voice-relay/v1/blob/:digest';
const INTENT_CHECK_PATH = '/voice-relay/v1/intent-check';

export type VoiceAudioBlobPutResult = 'stored' | 'exists' | 'full';

/** One ciphertext for each content digest, read once, gone after its expiry. */
export interface VoiceAudioBlobStore {
  put(input: {
    readonly digest: DigestB64u;
    readonly bytes: Uint8Array;
    readonly expiresAtMs: number;
    readonly nowMs: number;
  }): Promise<VoiceAudioBlobPutResult>;
  /** Returns the ciphertext and deletes it, or null when it is absent or expired. */
  take(digest: DigestB64u, nowMs: number): Promise<Uint8Array | null>;
}

/** Each request digest passes the intent check once. */
export interface VoiceIntentUseStore {
  consume(operationChallenge: DigestB64u, expiresAtMs: number, nowMs: number): Promise<boolean>;
}

/**
 * Process memory for staging. Each isolate has its own copy, so a GET that
 * reaches another isolate finds nothing, and a request digest can pass once in
 * each isolate.
 */
export class InMemoryVoiceIntentRelayStore implements VoiceAudioBlobStore, VoiceIntentUseStore {
  private readonly blobs = new Map<DigestB64u, { bytes: Uint8Array; expiresAtMs: number }>();
  private readonly uses = new Map<DigestB64u, number>();

  constructor(private readonly maximumStoredBlobs = DEFAULT_MAXIMUM_STORED_BLOBS) {}

  async put(input: {
    readonly digest: DigestB64u;
    readonly bytes: Uint8Array;
    readonly expiresAtMs: number;
    readonly nowMs: number;
  }): Promise<VoiceAudioBlobPutResult> {
    this.prune(input.nowMs);
    if (this.blobs.has(input.digest)) return 'exists';
    if (this.blobs.size >= this.maximumStoredBlobs) return 'full';
    this.blobs.set(input.digest, { bytes: input.bytes.slice(), expiresAtMs: input.expiresAtMs });
    return 'stored';
  }

  async take(digest: DigestB64u, nowMs: number): Promise<Uint8Array | null> {
    this.prune(nowMs);
    const entry = this.blobs.get(digest);
    if (!entry) return null;
    this.blobs.delete(digest);
    return entry.bytes;
  }

  async consume(operationChallenge: DigestB64u, expiresAtMs: number, nowMs: number): Promise<boolean> {
    this.prune(nowMs);
    if (this.uses.has(operationChallenge)) return false;
    this.uses.set(operationChallenge, expiresAtMs);
    return true;
  }

  private prune(nowMs: number): void {
    for (const [digest, entry] of this.blobs) {
      if (entry.expiresAtMs <= nowMs) this.blobs.delete(digest);
    }
    for (const [digest, expiresAtMs] of this.uses) {
      if (expiresAtMs <= nowMs) this.uses.delete(digest);
    }
  }
}

/** The relay routes exist only when the server configuration enables them. */
export type VoiceIntentRelayConfig =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'enabled';
      readonly network: SpokenIntentNetwork;
      /** The app origins that a statement's `requestOrigin` may name. */
      readonly allowedRequestOrigins: readonly string[];
      readonly maximumBlobBytes?: number;
      /** At most 5 minutes. */
      readonly blobTtlMs?: number;
    };

export type VoiceIntentRelayDependencies = Readonly<{
  blobs: VoiceAudioBlobStore;
  intentUses: VoiceIntentUseStore;
  renderer: SpokenIntentRendererV1;
  findDeviceKey(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly deviceKeyId: DigestB64u;
  }): Promise<RegisteredVoiceIdDeviceKey | null>;
  now?: () => number;
}>;

export function createVoiceIntentRelayRouteExtensions(
  config: VoiceIntentRelayConfig,
  dependencies: VoiceIntentRelayDependencies,
): readonly RouterApiRouteExtension[] {
  if (config.kind === 'disabled') return [];
  const maximumBlobBytes = config.maximumBlobBytes ?? DEFAULT_MAXIMUM_BLOB_BYTES;
  const blobTtlMs = config.blobTtlMs ?? MAXIMUM_BLOB_TTL_MS;
  if (!Number.isSafeInteger(maximumBlobBytes) || maximumBlobBytes <= 0) {
    throw new Error('Voice intent relay blob size cap must be a positive integer');
  }
  if (!Number.isSafeInteger(blobTtlMs) || blobTtlMs <= 0 || blobTtlMs > MAXIMUM_BLOB_TTL_MS) {
    throw new Error('Voice intent relay blob lifetime must be at most 5 minutes');
  }
  return [
    new VoiceIntentRelayRoutes(
      {
        network: config.network,
        allowedRequestOrigins: new Set(config.allowedRequestOrigins),
        maximumBlobBytes,
        blobTtlMs,
      },
      dependencies,
      dependencies.now ?? Date.now,
    ),
  ];
}

type ResolvedRelayConfig = Readonly<{
  network: SpokenIntentNetwork;
  allowedRequestOrigins: ReadonlySet<string>;
  maximumBlobBytes: number;
  blobTtlMs: number;
}>;

class VoiceIntentRelayRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension' as const;
  readonly id = 'voice_intent_relay';
  readonly routes = [
    defineRoute({
      id: 'voice_intent_relay_blob_put',
      surface: 'relay',
      method: 'PUT',
      path: BLOB_PATH,
      auth: {
        plane: 'public',
        rationale:
          'The path names the SHA-256 of an opaque ciphertext; the relay checks it and caps size, count and lifetime.',
      },
      metering: { kind: 'none' },
      summary: 'Keep one encrypted voice recording for the verifier',
    }),
    defineRoute({
      id: 'voice_intent_relay_blob_get',
      surface: 'relay',
      method: 'GET',
      path: BLOB_PATH,
      auth: {
        plane: 'public',
        rationale:
          'Only the verifier audio key opens the ciphertext; the verifier checks its digest, and the first read deletes it.',
      },
      metering: { kind: 'none' },
      summary: 'Release one encrypted voice recording to the verifier',
    }),
    defineRoute({
      id: 'voice_intent_relay_intent_check',
      surface: 'relay',
      method: 'POST',
      path: INTENT_CHECK_PATH,
      auth: {
        plane: 'public',
        proof: 'signed_payload',
        rationale: 'The registered VoiceID device key signs the intent statement.',
      },
      metering: { kind: 'none' },
      summary: 'Check a signed spoken intent against its request',
    }),
  ] as const;

  constructor(
    private readonly config: ResolvedRelayConfig,
    private readonly dependencies: VoiceIntentRelayDependencies,
    private readonly now: () => number,
  ) {}

  async handleFetchRoute(input: RouterApiFetchRouteExtensionInput): Promise<Response> {
    switch (input.route.id) {
      case 'voice_intent_relay_blob_put':
        return await this.putBlob(input.request, input.pathname);
      case 'voice_intent_relay_blob_get':
        return await this.getBlob(input.pathname);
      case 'voice_intent_relay_intent_check':
        return await this.checkIntent(input.request);
      default:
        return failure(404, 'not_found');
    }
  }

  private async putBlob(request: Request, pathname: string): Promise<Response> {
    const digest = blobDigestFromPath(pathname);
    if (!digest) return failure(400, 'invalid_digest');
    const bytes = await readBoundedBody(request, this.config.maximumBlobBytes);
    if (bytes === 'too_large') return failure(413, 'blob_too_large');
    if (bytes.length === 0) return failure(400, 'blob_empty');
    if ((await sha256DigestB64u(bytes)) !== digest) return failure(400, 'digest_mismatch');
    const nowMs = this.now();
    const expiresAtMs = nowMs + this.config.blobTtlMs;
    const result = await this.dependencies.blobs.put({ digest, bytes, expiresAtMs, nowMs });
    switch (result) {
      case 'stored':
        return Response.json({ ok: true, digest, bytes: bytes.length, expiresAtMs }, { status: 201 });
      case 'exists':
        return failure(409, 'blob_exists');
      case 'full':
        return failure(503, 'relay_full');
    }
  }

  private async getBlob(pathname: string): Promise<Response> {
    const digest = blobDigestFromPath(pathname);
    if (!digest) return failure(400, 'invalid_digest');
    const bytes = await this.dependencies.blobs.take(digest, this.now());
    if (!bytes) return failure(404, 'blob_unavailable');
    return new Response(bytes.slice().buffer, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    });
  }

  private async checkIntent(request: Request): Promise<Response> {
    let parsed: ParsedIntentCheck;
    try {
      parsed = parseIntentCheckBody(
        await readJson(request),
        this.config.network,
      );
    } catch {
      return failure(400, 'invalid_request');
    }
    const statement = parsed.statement;
    if (!this.config.allowedRequestOrigins.has(statement.requestOrigin)) {
      return failure(403, 'origin_not_allowed');
    }
    const registered = await this.dependencies.findDeviceKey({
      walletId: statement.walletId,
      walletAuthMethodId: statement.walletAuthMethodId,
      deviceKeyId: statement.deviceKeyId,
    });
    if (!registered || registered.status !== 'active') return failure(403, 'method_unavailable');
    try {
      const proof = await verifyVoiceIdIntentAssertion({
        registered,
        assertion: parsed.assertion,
        operationKind: 'near.voice_vault_transfer',
        requestBorsh: parsed.requestBorsh,
        audioDigest: parsed.audioDigest,
        requestOrigin: statement.requestOrigin,
        renderer: this.dependencies.renderer,
        nowMs: this.now(),
        consumeIntent: (challenge, expiresAtMs, nowMs) =>
          this.dependencies.intentUses.consume(challenge, expiresAtMs, nowMs),
      });
      return Response.json({
        ok: true,
        kind: 'voiceid_intent_verified',
        operationChallenge: proof.statement.operationChallenge,
        spokenTextDigest: proof.statement.spokenTextDigest,
        audioDigest: proof.statement.audioDigest,
      });
    } catch {
      return failure(403, 'intent_rejected');
    }
  }
}

type ParsedIntentCheck = Readonly<{
  assertion: unknown;
  statement: ReturnType<typeof parseVoiceIdIntentAssertion>['statement'];
  requestBorsh: Uint8Array;
  audioDigest: DigestB64u;
}>;

/**
 * Body: `{ assertion, audioDigest, request: { vault, owner, receiver,
 * amountYocto, nonce } }`. The network comes from the server configuration,
 * and amounts and nonces are decimal strings.
 */
function parseIntentCheckBody(raw: unknown, network: SpokenIntentNetwork): ParsedIntentCheck {
  if (!hasExactKeys(raw, ['assertion', 'audioDigest', 'request'])) {
    throw new Error('intent check body has invalid fields');
  }
  const request = raw.request;
  if (!hasExactKeys(request, ['vault', 'owner', 'receiver', 'amountYocto', 'nonce'])) {
    throw new Error('intent check request has invalid fields');
  }
  if (
    typeof request.vault !== 'string' ||
    typeof request.owner !== 'string' ||
    typeof request.receiver !== 'string'
  ) {
    throw new Error('intent check accounts must be strings');
  }
  return {
    assertion: raw.assertion,
    statement: parseVoiceIdIntentAssertion(raw.assertion).statement,
    audioDigest: parseDigestB64u(raw.audioDigest),
    requestBorsh: voiceVaultTransferRequestBorsh({
      kind: 'vault_transfer',
      network,
      vault: request.vault,
      owner: request.owner,
      receiver: request.receiver,
      amountYocto: parseDecimal(request.amountYocto),
      nonce: parseDecimal(request.nonce),
    }),
  };
}

function parseDecimal(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value)) {
    throw new Error('value must be a canonical decimal string');
  }
  return BigInt(value);
}

function blobDigestFromPath(pathname: string): DigestB64u | null {
  const segment = pathname.split('/').filter(Boolean).at(-1);
  try {
    return parseDigestB64u(segment);
  } catch {
    return null;
  }
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer> | 'too_large'> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maximumBytes) return 'too_large';
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximumBytes) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function readJson(request: Request): Promise<unknown> {
  const bytes = await readBoundedBody(request, MAXIMUM_INTENT_CHECK_BODY_BYTES);
  if (bytes === 'too_large') throw new Error('intent check body is too large');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function failure(status: number, code: string): Response {
  return Response.json({ ok: false, code }, { status });
}
