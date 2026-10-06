import type { Variant } from '@shared/utils/variant';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletMoveRequest,
  parseWalletMoveStatus,
  type WalletMoveRequest,
  type WalletMoveStatusResult,
} from '@/SeamsWeb/publicApi/placement';
import { IndexedDBManager } from '@/core/indexedDB';
import type { WalletAuthenticationState } from '@/core/types/seams';
import type { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import {
  WalletHostOwnerRequestTransportError,
  type WalletHostManagementRequestV1,
} from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';

const PATH = '/wallet/placement/v1/relocations';
type Context = {
  readonly managementRequest: WalletHostManagementRequestV1;
  readonly readAuthentication: () => WalletAuthenticationState;
  readonly signingEngine: Pick<
    BrowserSigningSurface,
    'getAuthenticationCredentialsSerialized' | 'requestEmailOtpEnrollmentConfirmation'
  >;
};
type Challenge = {
  readonly challengeB64u: string;
  readonly expiresAtMs: number;
  readonly factor:
    | { readonly kind: 'passkey' }
    | { readonly kind: 'email_otp'; readonly challengeId: string; readonly emailHint: string };
};
type MoveContext = {
  readonly host: Context;
  readonly request: WalletMoveRequest;
  readonly authentication: Variant<WalletAuthenticationState, 'kind', 'authenticated'>;
};

function assertAuthentication(context: MoveContext): void {
  if (context.host.readAuthentication() !== context.authentication)
    throw new Error('Wallet authentication changed during relocation approval');
}

function parseChallenge(raw: unknown, request: WalletMoveRequest): Challenge {
  const value = requireRecord(raw, 'Wallet relocation challenge');
  if (
    value.kind !== 'challenge' ||
    value.walletId !== request.walletId ||
    value.moveId !== request.moveId ||
    value.destinationRegion !== request.destinationRegion ||
    value.expectedGeneration !== request.expectedGeneration ||
    typeof value.requestDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.requestDigest) ||
    typeof value.expiresAtMs !== 'number' ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs <= Date.now()
  )
    throw new Error('Wallet relocation challenge does not match the requested move');
  const challengeB64u = parseDigestB64u(value.challengeB64u);
  const factor = requireRecord(value.factor, 'Wallet relocation factor');
  if (factor.kind === 'passkey')
    return { challengeB64u, expiresAtMs: value.expiresAtMs, factor: { kind: 'passkey' } };
  if (factor.kind !== 'email_otp') throw new Error('Wallet relocation factor is unsupported');
  const delivery = requireRecord(factor.delivery, 'Wallet relocation email delivery');
  return {
    challengeB64u,
    expiresAtMs: value.expiresAtMs,
    factor: {
      kind: 'email_otp',
      challengeId: requireCanonicalString(factor.challengeId, 'OTP challenge'),
      emailHint: requireCanonicalString(delivery.emailHint, 'Email hint'),
    },
  };
}

async function requestChallenge(context: MoveContext): Promise<Challenge> {
  assertAuthentication(context);
  const response = await context.host.managementRequest.request({
    walletId: context.request.walletId,
    method: 'POST',
    canonicalPath: `${PATH}/challenge`,
    body: context.request,
  });
  assertAuthentication(context);
  if (response.status !== 200)
    throw new Error(`Wallet relocation challenge failed (${response.status})`);
  return parseChallenge(response.body, context.request);
}

async function resend(context: MoveContext): Promise<{ challengeId: string; emailHint: string }> {
  const challenge = await requestChallenge(context);
  if (challenge.factor.kind !== 'email_otp') throw new Error('Wallet relocation factor changed');
  return { challengeId: challenge.factor.challengeId, emailHint: challenge.factor.emailHint };
}

async function collectProof(context: MoveContext, challenge: Challenge) {
  switch (challenge.factor.kind) {
    case 'passkey': {
      const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
        context.request.walletId,
      );
      assertAuthentication(context);
      if (selected.kind !== 'resolved' || selected.authMethod.kind !== 'passkey')
        throw new Error('Wallet relocation requires the selected owner passkey');
      const credential = await context.host.signingEngine.getAuthenticationCredentialsSerialized({
        subjectId: context.request.walletId,
        challengeB64u: challenge.challengeB64u,
        allowCredentials: [
          { id: selected.authMethod.credentialIdB64u, type: 'public-key', transports: [] },
        ],
        includeSecondPrfOutput: false,
      });
      return { kind: 'passkey' as const, credential: redactCredentialExtensionOutputs(credential) };
    }
    case 'email_otp': {
      const confirmed = await context.host.signingEngine.requestEmailOtpEnrollmentConfirmation({
        walletId: context.request.walletId,
        emailAddress: challenge.factor.emailHint,
        emailHint: challenge.factor.emailHint,
        challengeId: challenge.factor.challengeId,
        confirmerText: {
          title: 'Move wallet region',
          body: `Enter the code to move this wallet to ${context.request.destinationRegion}.`,
        },
        onResend: resend.bind(null, context),
      });
      return {
        kind: 'email_otp' as const,
        challengeId: confirmed.challengeId,
        otpCode: confirmed.otpCode,
      };
    }
    default:
      return assertNever(challenge.factor);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported wallet relocation factor: ${String(value)}`);
}

async function submit(
  context: MoveContext,
  body: WalletMoveRequest & {
    readonly sourceProof: Awaited<ReturnType<typeof collectProof>> | null;
  },
) {
  assertAuthentication(context);
  return context.host.managementRequest.request({
    walletId: context.request.walletId,
    method: 'POST',
    canonicalPath: PATH,
    body,
  });
}

export async function requestWalletMove(
  host: Context,
  raw: WalletMoveRequest,
): Promise<WalletMoveStatusResult> {
  const request = parseWalletMoveRequest(raw);
  const authentication = host.readAuthentication();
  if (authentication.kind !== 'authenticated' || authentication.walletId !== request.walletId)
    return { ok: false, code: 'wallet_unlock_required' };
  const context: MoveContext = { host, request, authentication };
  const existing = await host.managementRequest.request({
    walletId: request.walletId,
    method: 'GET',
    canonicalPath: `${PATH}/${encodeURIComponent(request.moveId)}?walletId=${encodeURIComponent(request.walletId)}`,
  });
  assertAuthentication(context);
  if (existing.status === 200) return matchingMove(existing.body, request);
  if (existing.status === 401 || existing.status === 403)
    return { ok: false, code: 'unauthorized' };
  if (existing.status !== 404) return { ok: false, code: 'transport_unavailable' };
  const resumed = await submit(context, {
    walletId: request.walletId,
    moveId: request.moveId,
    destinationRegion: request.destinationRegion,
    expectedGeneration: request.expectedGeneration,
    sourceProof: null,
  });
  assertAuthentication(context);
  if (resumed.status === 200) return matchingMove(resumed.body, request);
  if (resumed.status === 401 || resumed.status === 403) return { ok: false, code: 'unauthorized' };
  if (!requiresOwnerApproval(resumed)) return { ok: false, code: 'transport_unavailable' };
  const challenge = await requestChallenge(context);
  const sourceProof = await collectProof(context, challenge);
  assertAuthentication(context);
  if (challenge.expiresAtMs <= Date.now()) throw new Error('Wallet relocation approval expired');
  const body = {
    walletId: request.walletId,
    moveId: request.moveId,
    destinationRegion: request.destinationRegion,
    expectedGeneration: request.expectedGeneration,
    sourceProof,
  };
  let response: Awaited<ReturnType<typeof submit>>;
  try {
    response = await submit(context, body);
  } catch (error) {
    if (!(error instanceof WalletHostOwnerRequestTransportError) || error.code !== 'network_error')
      throw error;
    response = await submit(context, body);
  }
  assertAuthentication(context);
  if (response.status === 401 || response.status === 403)
    return { ok: false, code: 'unauthorized' };
  if (response.status !== 200) return { ok: false, code: 'transport_unavailable' };
  return matchingMove(response.body, request);
}

function matchingMove(raw: unknown, request: WalletMoveRequest): WalletMoveStatusResult {
  try {
    const status = parseWalletMoveStatus(raw, request.moveId);
    const identity = status.state === 'moving' ? status.move : status;
    if (
      identity.destinationRegion !== request.destinationRegion ||
      identity.sourceGeneration !== request.expectedGeneration
    )
      throw new Error('Wallet relocation conflicts with the request');
    return { ok: true, status };
  } catch {
    return { ok: false, code: 'invalid_response' };
  }
}

function requiresOwnerApproval(response: {
  readonly status: number;
  readonly body: unknown;
}): boolean {
  if (response.status !== 409) return false;
  try {
    const body = requireRecord(response.body, 'Wallet relocation approval result');
    return body.ok === false && body.code === 'owner_approval_required';
  } catch {
    return false;
  }
}
