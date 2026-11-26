import {
  parseVoiceIdDevicePublicKeyB64u,
  type VoiceIdDevicePublicKeyB64u,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { parseWalletAuthMethodId, type WalletAuthMethodId } from '@shared/utils/domainIds';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import {
  parsePrimaryWalletSessionOperationCredentialToken,
  parseSessionOrigin,
} from '../../../../authorization/domain';
import {
  parseVoiceIdActivationEnvelope,
  type VoiceIdActivationEnvelope,
  type VoiceIdActivationResult,
} from '../../../domains/voiceId/voiceIdActivation';
import { json, readJson } from '../../../framework/http';
import type {
  RouterApiAuthorizationSessionService,
  RouterApiWalletAuthMethodService,
} from '../../../framework/authServicePort';
import type { FetchRouterApiContext } from '../createFetchRouter';

const ACTIVATION_FIELDS = [
  'targetWalletAuthMethodId',
  'devicePublicKeyB64u',
  'custodyEnvelope',
] as const;

export function hostedWalletOriginAllowed(
  request: Request,
  allowedOrigins: readonly (string | undefined)[],
): boolean {
  const rawOrigin = request.headers.get('origin');
  let requestOrigin: string;
  try {
    requestOrigin = parseSessionOrigin(rawOrigin);
  } catch {
    return false;
  }
  for (const allowed of allowedOrigins) {
    try {
      if (parseSessionOrigin(allowed) === requestOrigin) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function parseActivationBody(raw: unknown): {
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly devicePublicKeyB64u: VoiceIdDevicePublicKeyB64u;
  readonly envelope: VoiceIdActivationEnvelope;
} {
  const body = requireRecord(raw, 'VoiceID activation');
  rejectUnknownFields(body, ACTIVATION_FIELDS, 'VoiceID activation');
  const target = parseWalletAuthMethodId(body.targetWalletAuthMethodId);
  if (!target.ok) throw new Error(target.error.message);
  return {
    targetWalletAuthMethodId: target.value,
    devicePublicKeyB64u: parseVoiceIdDevicePublicKeyB64u(body.devicePublicKeyB64u),
    envelope: parseVoiceIdActivationEnvelope(body.custodyEnvelope),
  };
}

function rejectionStatus(
  code: Extract<VoiceIdActivationResult, { readonly kind: 'rejected' }>['code'],
): number {
  switch (code) {
    case 'invalid_source':
      return 403;
    case 'invalid_target':
      return 400;
    case 'conflict':
      return 409;
    default: {
      const unexpected: never = code;
      throw new Error(`Unsupported VoiceID activation rejection: ${unexpected}`);
    }
  }
}

export type VoiceIdActivationRouteDependencies = Readonly<{
  tenantId: RouterApiAuthorizationSessionService['tenantId'];
  readWalletSessionAuthorizationV2ByOperationCredential:
    RouterApiAuthorizationSessionService['readWalletSessionAuthorizationV2ByOperationCredential'];
  activateVoiceId: RouterApiWalletAuthMethodService['activateVoiceId'];
  hostedWalletOrigins: readonly (string | undefined)[];
}>;

export async function handleWalletVoiceIdActivation(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  if (ctx.method !== 'POST' || ctx.pathname !== '/wallet/voiceid/activate') return null;
  return await handleVoiceIdActivationRequest(ctx.request, {
    tenantId: ctx.service.authorizationSessions.tenantId,
    readWalletSessionAuthorizationV2ByOperationCredential:
      ctx.service.authorizationSessions.readWalletSessionAuthorizationV2ByOperationCredential,
    activateVoiceId: ctx.service.walletAuthMethods.activateVoiceId,
    hostedWalletOrigins: ctx.opts.hostedWalletOrigins ?? [],
  });
}

export async function handleVoiceIdActivationRequest(
  request: Request,
  deps: VoiceIdActivationRouteDependencies,
): Promise<Response> {
  if (!hostedWalletOriginAllowed(request, deps.hostedWalletOrigins)) {
    return json({ ok: false, code: 'origin_mismatch' }, { status: 403 });
  }
  const credential = extractBearerCredential(request.headers);
  if (!credential) {
    return json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  let token: string;
  try {
    token = parsePrimaryWalletSessionOperationCredentialToken(credential);
  } catch {
    return json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  const nowMs = Date.now();
  let source: Awaited<
    ReturnType<VoiceIdActivationRouteDependencies['readWalletSessionAuthorizationV2ByOperationCredential']>
  >;
  try {
    source = await deps.readWalletSessionAuthorizationV2ByOperationCredential({
      tenantId: deps.tenantId,
      token,
      nowMs,
    });
  } catch {
    return json({ ok: false, code: 'wallet_session_unavailable' }, { status: 503 });
  }
  if (
    !source ||
    source.retiredAtMs !== null ||
    source.authMethod.status !== 'active' ||
    (source.authMethod.kind !== 'passkey' && source.authMethod.kind !== 'email_otp')
  ) {
    return json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  let parsedBody: ReturnType<typeof parseActivationBody>;
  try {
    parsedBody = parseActivationBody(await readJson(request));
  } catch (error: unknown) {
    return json({
      ok: false,
      code: 'invalid_body',
      message: error instanceof Error ? error.message : 'VoiceID activation body is invalid',
    }, { status: 400 });
  }
  let result: Awaited<ReturnType<VoiceIdActivationRouteDependencies['activateVoiceId']>>;
  try {
    result = await deps.activateVoiceId({
      source: {
        authorization: source.authorization,
        authority: source.authority,
        authMethod: source.authMethod,
      },
      targetWalletAuthMethodId: parsedBody.targetWalletAuthMethodId,
      devicePublicKeyB64u: parsedBody.devicePublicKeyB64u,
      envelope: parsedBody.envelope,
      nowMs,
    });
  } catch {
    return json({ ok: false, code: 'activation_unavailable' }, { status: 503 });
  }
  if (result.kind === 'rejected') {
    return json({ ok: false, code: result.code }, { status: rejectionStatus(result.code) });
  }
  return json({ ok: true, authMethod: result.authMethod }, { status: 200 });
}
