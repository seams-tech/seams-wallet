import { parseVoiceIdDeviceAssertion } from '@shared/authorization/voiceIdDeviceAssertion';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import {
  parseOptionalWalletSessionBudget,
  type WalletSessionBudget,
} from '@shared/threshold/walletSessionBudget';
import { requireRecord } from '@shared/utils/validation';
import {
  parseSessionOrigin,
  projectActiveWalletSession,
  type SessionOrigin,
} from '../../../../authorization/domain';
import type { RouterApiWalletUnlockService } from '../../../framework/authServicePort';
import { json, readJson } from '../../../framework/http';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { hostedWalletOriginAllowed } from './walletVoiceIdActivation';
import { prepareVoiceIdNearInstallation, type VoiceIdNearInstallation } from './walletVoiceIdNear';
import type { VoiceIdVerifyResult } from '../../../domains/voiceId/voiceIdSessions';
import { isBillingCreditFailure } from '../../../../authorization/sessionRouting';

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
> & {
  prepareNear(verified: Extract<VoiceIdVerifyResult, { kind: 'issued' }>): Promise<VoiceIdNearInstallation>;
};

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
    prepareNear: prepareVoiceIdNearInstallation.bind(null, ctx),
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
  let walletSessionBudget: WalletSessionBudget | null;
  try {
    const body = requireRecord(await readJson(request), 'VoiceID verification');
    rejectUnknownFields(body, ['assertion', 'walletSessionBudget'], 'VoiceID verification');
    assertion = parseVoiceIdDeviceAssertion(body.assertion);
    walletSessionBudget = parseOptionalWalletSessionBudget(
      body.walletSessionBudget,
      'walletSessionBudget',
    );
  } catch (error: unknown) {
    return json({
      ok: false,
      code: 'invalid_body',
      message: error instanceof Error ? error.message : 'VoiceID assertion is invalid',
    }, { status: 400 });
  }
  let result: VoiceIdVerifyResult;
  try {
    result = await deps.verifyAndIssueVoiceId({
      assertion,
      requestOrigin,
      nowMs: Date.now(),
      walletSessionBudget,
    });
  } catch (error: unknown) {
    // The router answers a billing failure with 402.
    if (isBillingCreditFailure(error)) throw error;
    console.error('[voiceid] verification failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, code: 'verification_unavailable' }, { status: 503 });
  }
  if (result.kind === 'rejected') {
    const status = result.code === 'issuance_unavailable' ? 503 : 403;
    return json({ ok: false, code: result.code }, { status });
  }
  // The session is issued, and this response is the only delivery of its
  // one-time credential. A NEAR lookup failure must not lose it: the Wallet
  // gets the session without NEAR.
  let near: VoiceIdNearInstallation;
  try {
    near = await deps.prepareNear(result);
  } catch (error: unknown) {
    console.error('[voiceid] NEAR capability lookup failed after issuance', {
      message: error instanceof Error ? error.message : String(error),
    });
    near = { kind: 'unavailable' };
  }
  return json({
    ok: true,
    walletSession: projectActiveWalletSession(result.authorization),
    operationCredential: result.operationCredential,
    custodyEnvelope: result.custodyEnvelope,
    near,
  }, { status: 200 });
}
