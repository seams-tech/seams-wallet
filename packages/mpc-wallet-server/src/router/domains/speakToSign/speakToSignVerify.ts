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
import { defineRoute, type RouteDefinition } from '../../framework/routeDefinitions';
import type {
  RouterApiFetchRouteExtensionInput,
  RouterApiRouteExtension,
} from '../../framework/routeExtensions';
import { resolveWalletSessionAuthorizationV2Admission } from '../signingOperations/walletExecutionAdmission';
import type { SpeakToSignBackend, SpeakToSignBackendCall } from './backend';
import {
  parseSummaryBody,
  SPEAK_TO_SIGN_SUMMARY_MAX_BODY_BYTES,
  SPEAK_TO_SIGN_SUMMARY_PATH,
  type SpeakToSignSummaryConfig,
  writeNoteSummary,
} from './speakToSignSummary';

export const SPEAK_TO_SIGN_VERIFY_PATH = '/speak-to-sign/v1/verify';
/**
 * An enrollment carries three clips. 8 s of 16 kHz PCM16 is 256,000 bytes, about 341 KB in
 * base64, so three clips are about 1,000 KB, with room for the fields.
 */
export const SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES = 1_100 * 1024;

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

/**
 * The verify route, and the summary route of a spoken community note when the server has a NEAR
 * AI key (`speakToSignSummary`). Without the verify route, a summary has no use.
 */
export function createSpeakToSignVerifyRouteExtensions(
  backend: SpeakToSignBackend | null,
  dependencies: SpeakToSignVerifyDependencies,
  summary: SpeakToSignSummaryConfig | null = null,
): readonly RouterApiRouteExtension[] {
  if (!backend) return [];
  return [new SpeakToSignVerifyRoutes(backend, dependencies, summary)];
}

/** The events of the verify stream, in order. */
type VerifyStreamEvent = 'verifier_running' | 'verdict' | 'failed';

type SessionSubject = Readonly<{
  walletId: WalletId;
  ed25519: MpcMaterialActivationRef;
  /** How the owner opened the session. An enrollment on SaySo needs a fresh passkey or Email OTP one. */
  session: SpeakToSignBackendCall['session'];
}>;

type SessionAuthentication =
  | { readonly kind: 'admitted'; readonly subject: SessionSubject }
  /** No credential, an unknown, expired or retired session, or one without Ed25519 signing. */
  | { readonly kind: 'unauthorized' }
  /** The session store failed or holds a row it cannot read. */
  | { readonly kind: 'unavailable' };

const SESSION_AUTH = {
  plane: 'public',
  rationale: 'The handler requires a live Wallet Session operation credential of the owner.',
} as const;
const VERIFY_ROUTE = defineRoute({
  id: 'speak_to_sign_verify',
  surface: 'relay',
  method: 'POST',
  path: SPEAK_TO_SIGN_VERIFY_PATH,
  auth: SESSION_AUTH,
  metering: { kind: 'none' },
  summary: 'Run the voice verifier of the lane for a spoken payment or an enrollment',
});
const SUMMARY_ROUTE = defineRoute({
  id: 'speak_to_sign_summary',
  surface: 'relay',
  method: 'POST',
  path: SPEAK_TO_SIGN_SUMMARY_PATH,
  auth: SESSION_AUTH,
  metering: { kind: 'none' },
  summary: 'Write the spoken summary of a community note with a chat model on NEAR AI',
});

class SpeakToSignVerifyRoutes implements RouterApiRouteExtension {
  readonly kind = 'fetch_route_extension' as const;
  readonly id = 'speak_to_sign_verify';
  readonly routes: readonly RouteDefinition[];
  private readonly now: () => number;

  constructor(
    private readonly backend: SpeakToSignBackend,
    private readonly dependencies: SpeakToSignVerifyDependencies,
    private readonly summary: SpeakToSignSummaryConfig | null,
  ) {
    this.now = dependencies.now ?? Date.now;
    this.routes = summary ? [VERIFY_ROUTE, SUMMARY_ROUTE] : [VERIFY_ROUTE];
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
    if (input.route.id === SUMMARY_ROUTE.id && this.summary) {
      return await this.writeSummary(input.request, this.summary, input.logger);
    }
    const body = await readBoundedText(input.request, SPEAK_TO_SIGN_VERIFY_MAX_BODY_BYTES);
    if (body === 'too_large') return failure(413, 'body_too_large');
    const verify = parseVerifyBody(body);
    if (verify === null) return failure(400, 'invalid_body');
    // Wallet core names the backend that it prepared the input for: sealed audio for OutLayer,
    // plain audio for SaySo. During a deploy the two can differ for a moment.
    if (verify.backend !== this.backend.id) return failure(409, 'backend_mismatch');
    const verifierInput = verify.input;
    // Each run costs the lane money. The backend names the operations that Wallet core needs.
    const { op } = verifierInput;
    if (typeof op !== 'string' || !this.backend.operations.has(op)) {
      return failure(400, 'unsupported_operation');
    }
    // The verifier compares the audio with the voice template of `owner`. Only that owner may ask.
    const owner = await this.sessionNearAccount(subject);
    if (owner === null) return failure(403, 'owner_unavailable');
    if (verifierInput.owner !== owner) return failure(403, 'owner_mismatch');
    return this.streamVerifier({
      input: verifierInput,
      session: subject.session,
      logger: input.logger,
      startedAtMs,
    });
  }

  /**
   * Any owner with a live session may ask: the summary is only a proposal. The card shows it
   * below the note, and the owner says it. SaySo does not check that it fits the note.
   */
  private async writeSummary(
    request: Request,
    config: SpeakToSignSummaryConfig,
    logger: NormalizedRouterLogger,
  ): Promise<Response> {
    const body = await readBoundedText(request, SPEAK_TO_SIGN_SUMMARY_MAX_BODY_BYTES);
    if (body === 'too_large') return failure(413, 'body_too_large');
    const note = parseSummaryBody(body);
    if (note === null) return failure(400, 'invalid_body');
    // A caller that went away (the Wallet ended a request for an older text) ends the model call.
    const result = await writeNoteSummary(config, note, this.dependencies.fetch, request.signal);
    if (!result.ok) {
      logger.warn('[speak-to-sign] summary failed', { code: result.code });
      return failure(502, result.code);
    }
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }

  /**
   * Answers with `text/event-stream`: `verifier_running` at once, then one `verdict` with the
   * verifier output or one `failed` with a code. Each backend sends its result only at the end,
   * so the stream has no event between them. A refusal before the call stays a JSON error.
   */
  private streamVerifier(call: SpeakToSignBackendCall): Response {
    const { logger } = call;
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const send = async (event: VerifyStreamEvent, data: unknown) =>
      await writer.write(
        new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    const run = async () => {
      try {
        await send('verifier_running', {});
        const result = await this.backend.run(call);
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
      subject: {
        walletId: session.walletId,
        ed25519: admission.materialActivation,
        session: { authMethodKind: context.authMethod.kind, issuedAtMs: session.createdAtMs },
      },
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
}

/**
 * Body: `{ backend, input }`, where `backend` names the backend that Wallet core prepared the
 * input for, and `input` is the verifier input object that the backend reads.
 */
function parseVerifyBody(
  text: string,
): Readonly<{ backend: string; input: Record<string, unknown> }> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!hasExactKeys(raw, ['backend', 'input']) || !isPlainObject(raw.input)) return null;
  if (typeof raw.backend !== 'string') return null;
  return { backend: raw.backend, input: raw.input };
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
