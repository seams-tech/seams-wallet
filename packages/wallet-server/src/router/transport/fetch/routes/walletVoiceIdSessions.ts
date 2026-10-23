import { parseVoiceIdDeviceAssertion } from '@shared/authorization/voiceIdDeviceAssertion';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { parseSessionOrigin, type SessionOrigin } from '../../../../authorization/domain';
import type { RouterApiWalletUnlockService } from '../../../framework/authServicePort';
import { json, readJson } from '../../../framework/http';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { hostedWalletOriginAllowed } from './walletVoiceIdActivation';

type HostedVoiceIdRoute = Readonly<{
  hostedWalletOrigins: readonly (string | undefined)[];
}>;

export type VoiceIdChallengeRouteDependencies = HostedVoiceIdRoute & Pick<
  RouterApiWalletUnlockService,
  'issueVoiceIdChallenge'
>;

export type VoiceIdVerifyRouteDependencies = HostedVoiceIdRoute & Pick<
  RouterApiWalletUnlockService,
  'verifyAndIssueVoiceId'
>;

function hostedOrigin(
  request: Request,
  allowedOrigins: readonly (string | undefined)[],
): SessionOrigin | null {
  if (!hostedWalletOriginAllowed(request, allowedOrigins)) return null;
  return parseSessionOrigin(request.headers.get('origin'));
}

function parseChallengeBody(raw: unknown): {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
} {
  const body = requireRecord(raw, 'VoiceID challenge');
  rejectUnknownFields(body, ['walletId', 'walletAuthMethodId'], 'VoiceID challenge');
  const walletId = parseWalletId(body.walletId);
  if (!walletId.ok) throw new Error(walletId.error.message);
  const walletAuthMethodId = parseWalletAuthMethodId(body.walletAuthMethodId);
  if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
  return { walletId: walletId.value, walletAuthMethodId: walletAuthMethodId.value };
}

export async function handleWalletVoiceIdChallenge(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  if (ctx.method !== 'POST' || ctx.pathname !== '/wallet/voiceid/challenge') return null;
  return await handleVoiceIdChallengeRequest(ctx.request, {
    issueVoiceIdChallenge: ctx.service.walletUnlock.issueVoiceIdChallenge,
    hostedWalletOrigins: ctx.opts.hostedWalletOrigins ?? [],
  });
}

export async function handleWalletVoiceIdVerify(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  if (ctx.method !== 'POST' || ctx.pathname !== '/wallet/voiceid/verify') return null;
  return await handleVoiceIdVerifyRequest(ctx.request, {
    verifyAndIssueVoiceId: ctx.service.walletUnlock.verifyAndIssueVoiceId,
    hostedWalletOrigins: ctx.opts.hostedWalletOrigins ?? [],
  });
}

export async function handleVoiceIdChallengeRequest(
  request: Request,
  deps: VoiceIdChallengeRouteDependencies,
): Promise<Response> {
  const requestOrigin = hostedOrigin(request, deps.hostedWalletOrigins);
  if (!requestOrigin) return json({ ok: false, code: 'origin_mismatch' }, { status: 403 });
  let body: ReturnType<typeof parseChallengeBody>;
  try {
    body = parseChallengeBody(await readJson(request));
  } catch (error: unknown) {
    return json({
      ok: false,
      code: 'invalid_body',
      message: error instanceof Error ? error.message : 'VoiceID challenge body is invalid',
    }, { status: 400 });
  }
  try {
    const result = await deps.issueVoiceIdChallenge({
      walletId: body.walletId,
      walletAuthMethodId: body.walletAuthMethodId,
      requestOrigin,
      nowMs: Date.now(),
    });
    if (result.kind === 'rejected') {
      return json({ ok: false, code: result.code }, { status: 403 });
    }
    return json({ ok: true, challenge: result.challenge }, { status: 200 });
  } catch {
    return json({ ok: false, code: 'challenge_unavailable' }, { status: 503 });
  }
}

export async function handleVoiceIdVerifyRequest(
  request: Request,
  deps: VoiceIdVerifyRouteDependencies,
): Promise<Response> {
  const requestOrigin = hostedOrigin(request, deps.hostedWalletOrigins);
  if (!requestOrigin) return json({ ok: false, code: 'origin_mismatch' }, { status: 403 });
  let assertion: ReturnType<typeof parseVoiceIdDeviceAssertion>;
  try {
    const body = requireRecord(await readJson(request), 'VoiceID verification');
    rejectUnknownFields(body, ['assertion'], 'VoiceID verification');
    assertion = parseVoiceIdDeviceAssertion(body.assertion);
  } catch (error: unknown) {
    return json({
      ok: false,
      code: 'invalid_body',
      message: error instanceof Error ? error.message : 'VoiceID assertion is invalid',
    }, { status: 400 });
  }
  try {
    const result = await deps.verifyAndIssueVoiceId({
      assertion,
      requestOrigin,
      nowMs: Date.now(),
    });
    if (result.kind === 'rejected') {
      const status = result.code === 'issuance_unavailable' ? 503 : 403;
      return json({ ok: false, code: result.code }, { status });
    }
    return json({
      ok: true,
      authorization: result.authorization,
      operationCredential: result.operationCredential,
      custodyEnvelope: result.custodyEnvelope,
    }, { status: 200 });
  } catch {
    return json({ ok: false, code: 'verification_unavailable' }, { status: 503 });
  }
}
