import { NEAR_ED25519_MPC_OPERATION_KINDS } from '@shared/authorization/capabilityKinds';
import type { MpcMaterialActivationRef, WalletId } from '@shared/utils/domainIds';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { isPlainObject } from '@shared/utils/validation';
import { extractBearerCredential } from '../../auth/routerApiKeyAuth';
import type {
  RouterApiAuthorizationSessionService,
  RouterApiWalletRegistrationService,
  RouterApiWalletSessionExactOperationContext as WalletSessionExactOperationContext,
} from '../../framework/authServicePort';
import type { NormalizedRouterLogger } from '../../framework/logger';
import { defineRoute } from '../../framework/routeDefinitions';
import type {
  RouterApiFetchRouteExtensionInput,
  RouterApiRouteExtension,
} from '../../framework/routeExtensions';
import { resolveWalletSessionAuthorizationV2Admission } from '../signingOperations/walletExecutionAdmission';

export const SPEAK_TO_SIGN_VERIFY_PATH = '/speak-to-sign/v1/verify';
/**
 * An enrollment carries three clips. 8 s of 16 kHz PCM16 is 256,000 bytes, about 341 KB in
 * base64, so three clips are about 1,000 KB, with room for the fields.
 */
export const SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES = 1_100 * 1024;
/** The verifier calls two remote models; the whole flow has a 10 s budget. */
const OUTLAYER_TIMEOUT_MS = 20_000;
const OUTLAYER_RESOURCE_LIMITS = Object.freeze({
  max_instructions: 10_000_000_000,
  max_memory_mb: 128,
  max_execution_seconds: 15,
});

/** The route exists only when the server configuration holds every field. */
export type SpeakToSignVerifyConfig = Readonly<{
  /** For example `https://api.outlayer.fastnear.com`. */
  outlayerBaseUrl: string;
  /** `owner/project`, for example `seams-v1.testnet/voice-verifier`. */
  project: string;
  /** The WASM hash of the pinned verifier version. */
  versionKey: string;
  /** The OutLayer payment key. It goes only into the X-Payment-Key header. */
  paymentKey: string;
  secretsRef: Readonly<{ profile: string; accountId: string }>;
}>;

export type SpeakToSignVerifyRateLimit = (input: {
  readonly walletId: WalletId;
}) => Promise<{ readonly allowed: boolean }>;

export type SpeakToSignVerifyDependencies = Readonly<{
  /** The identity read: it admits an exhausted session, because the route spends no quota. */
  authorizationSessions: Pick<
    RouterApiAuthorizationSessionService,
    'tenantId' | 'readWalletSessionExactOperationContextByCredential'
  >;
  /** Resolves the NEAR account of the session's Ed25519 signer for the owner check. */
  walletRegistration: Pick<RouterApiWalletRegistrationService, 'resolveEd25519MaterialActivation'>;
  fetch: typeof fetch;
  rateLimit?: SpeakToSignVerifyRateLimit;
  now?: () => number;
}>;

const ENV_NAMES = [
  'SPEAK_TO_SIGN_OUTLAYER_BASE_URL',
  'SPEAK_TO_SIGN_OUTLAYER_PROJECT',
  'SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY',
  'SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY',
  'SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE',
  'SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID',
] as const;

/** Null when no Speak-to-Sign variable is set. A partial set is a deployment error. */
export function readSpeakToSignVerifyConfig(
  read: (name: (typeof ENV_NAMES)[number]) => string | undefined,
): SpeakToSignVerifyConfig | null {
  const values = ENV_NAMES.map((name) => read(name)?.trim() || '');
  if (values.every((value) => value === '')) return null;
  const missing = ENV_NAMES.filter((_, index) => values[index] === '');
  if (missing.length > 0) {
    throw new Error(`Speak-to-Sign verify needs ${missing.join(', ')}`);
  }
  const [outlayerBaseUrl, project, versionKey, paymentKey, profile, accountId] = values;
  return { outlayerBaseUrl, project, versionKey, paymentKey, secretsRef: { profile, accountId } };
}

export function createSpeakToSignVerifyRouteExtensions(
  config: SpeakToSignVerifyConfig | null,
  dependencies: SpeakToSignVerifyDependencies,
): readonly RouterApiRouteExtension[] {
  if (!config) return [];
  return [new SpeakToSignVerifyRoutes(resolveConfig(config), dependencies)];
}

type ResolvedConfig = Readonly<{
  callUrl: string;
  versionKey: string;
  paymentKey: string;
  secretsRef: Readonly<{ profile: string; account_id: string }>;
}>;

function resolveConfig(config: SpeakToSignVerifyConfig): ResolvedConfig {
  let base: URL;
  try {
    base = new URL(config.outlayerBaseUrl);
  } catch {
    throw new Error('Speak-to-Sign OutLayer base URL is invalid');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Speak-to-Sign OutLayer base URL must be a plain HTTPS URL');
  }
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(config.project)) {
    throw new Error('Speak-to-Sign OutLayer project must be owner/project');
  }
  for (const [label, value] of [
    ['version key', config.versionKey],
    ['payment key', config.paymentKey],
    ['secrets profile', config.secretsRef.profile],
    ['secrets account', config.secretsRef.accountId],
  ] as const) {
    if (!value || value.trim() !== value) {
      throw new Error(`Speak-to-Sign OutLayer ${label} is required`);
    }
  }
  return {
    callUrl: `${base.origin}${base.pathname.replace(/\/+$/, '')}/call/${config.project}`,
    versionKey: config.versionKey,
    paymentKey: config.paymentKey,
    secretsRef: { profile: config.secretsRef.profile, account_id: config.secretsRef.accountId },
  };
}

/** The events of the verify stream, in order. */
type VerifyStreamEvent = 'verifier_running' | 'verdict' | 'failed';

/** The data of the last event: the verifier output, or a fixed code without upstream text. */
type VerifierResult =
  | Readonly<{
      ok: true;
      output: unknown;
      timing: Readonly<{ outlayerMs: number; serverMs: number }>;
    }>
  | Readonly<{ ok: false; code: string }>;

type SessionSubject = Readonly<{
  walletId: WalletId;
  ed25519: MpcMaterialActivationRef;
}>;

type SessionAuthentication =
  | { readonly kind: 'admitted'; readonly subject: SessionSubject }
  /** No credential, an unknown, expired or retired session, or one without Ed25519 signing. */
  | { readonly kind: 'unauthorized' }
  /** The session store failed or holds a row it cannot read. */
  | { readonly kind: 'unavailable' };

class SpeakToSignVerifyRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension' as const;
  readonly id = 'speak_to_sign_verify';
  readonly routes = [
    defineRoute({
      id: 'speak_to_sign_verify',
      surface: 'relay',
      method: 'POST',
      path: SPEAK_TO_SIGN_VERIFY_PATH,
      auth: {
        plane: 'public',
        rationale: 'The handler requires a live Wallet Session operation credential of the owner.',
      },
      metering: { kind: 'none' },
      summary: 'Run the pinned OutLayer voice verifier for a spoken payment or an enrollment',
    }),
  ] as const;
  private readonly now: () => number;

  constructor(
    private readonly config: ResolvedConfig,
    private readonly dependencies: SpeakToSignVerifyDependencies,
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async handleFetchRoute(input: RouterApiFetchRouteExtensionInput): Promise<Response> {
    const startedAtMs = this.now();
    const authentication = await this.authenticate(input.request, startedAtMs, input.logger);
    if (authentication.kind === 'unauthorized') return failure(401, 'unauthorized');
    if (authentication.kind === 'unavailable') return failure(503, 'session_unavailable');
    const { subject } = authentication;
    const { walletId } = subject;
    if (this.dependencies.rateLimit) {
      const limit = await this.dependencies.rateLimit({ walletId });
      if (!limit.allowed) return failure(429, 'rate_limited');
    }
    const body = await readBoundedText(input.request, SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES);
    if (body === 'too_large') return failure(413, 'body_too_large');
    const verifierInput = parseVerifyBody(body);
    if (verifierInput === null) return failure(400, 'invalid_body');
    // The verifier compares the audio with the voice template of `owner`. Only that owner may ask.
    const owner = await this.sessionNearAccount(subject);
    if (owner === null) return failure(403, 'owner_unavailable');
    if (verifierInput.owner !== owner) return failure(403, 'owner_mismatch');
    return this.streamVerifier(verifierInput, input.logger, startedAtMs);
  }

  /**
   * Answers with `text/event-stream`: `verifier_running` at once, then one `verdict` with the
   * verifier output or one `failed` with a code. OutLayer sends its result only at the end, so
   * the stream has no event between them. A refusal before the call stays a JSON error.
   */
  private streamVerifier(
    verifierInput: Record<string, unknown>,
    logger: NormalizedRouterLogger,
    startedAtMs: number,
  ): Response {
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const send = async (event: VerifyStreamEvent, data: unknown) =>
      await writer.write(
        new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    const run = async () => {
      try {
        await send('verifier_running', {});
        const result = await this.callVerifier(verifierInput, logger, startedAtMs);
        await send(result.ok ? 'verdict' : 'failed', result);
      } catch (error: unknown) {
        logger.warn('[speak-to-sign] verify stream failed', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      } finally {
        await writer.close().catch(() => {});
      }
    };
    void run();
    return new Response(stream.readable, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
    });
  }

  /**
   * The route needs the owner's identity, not a signing allowance: the transaction is signed
   * later through the Wallet's own signing path, which spends the quota. An exhausted session
   * still names its owner, so the identity read admits it.
   */
  private async authenticate(
    request: Request,
    nowMs: number,
    logger: NormalizedRouterLogger,
  ): Promise<SessionAuthentication> {
    const token = extractBearerCredential(request.headers);
    if (!token) return { kind: 'unauthorized' };
    const sessions = this.dependencies.authorizationSessions;
    let context: WalletSessionExactOperationContext | null;
    try {
      context = await sessions.readWalletSessionExactOperationContextByCredential({
        tenantId: sessions.tenantId,
        token,
        nowMs,
      });
    } catch (error: unknown) {
      logger.warn('[speak-to-sign] Wallet Session read failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { kind: 'unavailable' };
    }
    if (!context) return { kind: 'unauthorized' };
    const { session } = context;
    const admission = resolveWalletSessionAuthorizationV2Admission({
      authorization: session,
      authority: context.authority,
      authMethod: context.authMethod,
      retiredAtMs: context.retiredAtMs,
      nowMs,
      operation: {
        tenantId: session.tenantId,
        principalId: session.principalId,
        walletId: session.walletId,
        keyFamily: 'ed25519',
        operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.signTransaction,
      },
    });
    if (!admission.ok || admission.keyFamily !== 'ed25519') return { kind: 'unauthorized' };
    return {
      kind: 'admitted',
      subject: { walletId: session.walletId, ed25519: admission.materialActivation },
    };
  }

  /** The NEAR account of the session's Ed25519 signer, or null when it has none. */
  private async sessionNearAccount(subject: SessionSubject): Promise<string | null> {
    const resolved = await this.dependencies.walletRegistration.resolveEd25519MaterialActivation({
      walletId: String(subject.walletId),
      materialActivation: routerAbMpcMaterialActivationRefToWire(subject.ed25519),
    });
    return resolved.ok ? resolved.nearAccountId : null;
  }

  private async callVerifier(
    verifierInput: Record<string, unknown>,
    logger: NormalizedRouterLogger,
    startedAtMs: number,
  ): Promise<VerifierResult> {
    const outlayerStartedAtMs = this.now();
    let response: Response;
    try {
      response = await this.dependencies.fetch(this.config.callUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-payment-key': this.config.paymentKey,
        },
        body: JSON.stringify({
          input: verifierInput,
          async: false,
          version_key: this.config.versionKey,
          secrets_ref: this.config.secretsRef,
          resource_limits: OUTLAYER_RESOURCE_LIMITS,
        }),
        signal: AbortSignal.timeout(OUTLAYER_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      logger.warn('[speak-to-sign] OutLayer call failed', { timedOut });
      return { ok: false, code: timedOut ? 'verifier_timeout' : 'verifier_unreachable' };
    }
    const outlayerMs = this.now() - outlayerStartedAtMs;
    if (!response.ok) {
      logger.warn('[speak-to-sign] OutLayer refused the call', { status: response.status });
      return { ok: false, code: outlayerStatusFailure(response.status) };
    }
    const output = readOutlayerOutput(await response.text());
    if (output === null) {
      logger.warn('[speak-to-sign] OutLayer returned no verifier output');
      return { ok: false, code: 'verifier_failed' };
    }
    return { ok: true, output, timing: { outlayerMs, serverMs: this.now() - startedAtMs } };
  }
}

/** Body: `{ input }`, where `input` is the verifier input object. The server does not read it. */
function parseVerifyBody(text: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!hasExactKeys(raw, ['input']) || !isPlainObject(raw.input)) return null;
  return raw.input;
}

/** The verifier's own output, unchanged, or null when the run did not complete. */
function readOutlayerOutput(text: string): unknown {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(raw) || raw.error != null) return null;
  if (typeof raw.status === 'string' && raw.status !== 'completed') return null;
  return raw.output ?? null;
}

function outlayerStatusFailure(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'verifier_payment_unavailable';
  if (status === 429) return 'verifier_busy';
  if (status >= 400 && status < 500) return 'verifier_rejected_request';
  return 'verifier_failed';
}

async function readBoundedText(request: Request, maximumBytes: number): Promise<string | 'too_large'> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maximumBytes) return 'too_large';
  if (!request.body) return '';
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
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function failure(status: number, code: string): Response {
  return Response.json({ ok: false, code }, { status, headers: { 'cache-control': 'no-store' } });
}
