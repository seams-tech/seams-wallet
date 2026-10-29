import { parseDeviceId } from '@shared/authorization/capabilityKinds';
import {
  computeWalletOwnerAdminChallengeDigest,
  type WalletOwnerAdminOperation,
} from '@shared/authorization/walletOwnerOperation';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { parsePasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { base64UrlDecode } from '@shared/utils/base64';
import {
  parseEmailOtpChallengeId,
  parseOrgId,
  parseProviderSubject,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWalletRecoveryOperationId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type EmailOtpChallengeId,
  type WalletId,
  type WalletRecoveryOperationId,
} from '@shared/utils/domainIds';
import { EMAIL_OTP_CHANNEL, WALLET_EMAIL_OTP_UNLOCK_OPERATION } from '@shared/utils/emailOtpDomain';
import {
  isPlainObject,
  requireTrimmedString,
  toOptionalTrimmedString,
} from '@shared/utils/validation';
import {
  walletAuthAuthorityRef
} from '@shared/utils/walletAuthAuthority';
import { parseRecoveryCodeLocatorV1 } from '@shared/wallet-recovery/recoveryCodeLocator';
import {
  parseRecoveryCodeReservationId,
  type RecoveryCodeReservationId,
} from '@shared/wallet-recovery/recoveryCodeReservation';
import { parseDerivedWalletRecoveryKeyId } from '@shared/wallet-recovery/recoveryKeyId';
import {
  parseWalletRecoveryEcdsaPossessionProofV1,
  type WalletRecoveryEcdsaPossessionProofV1,
} from '@shared/wallet-recovery/walletRecoveryEcdsaPossession';
import { parseWalletRecoverySetRotationWireV1 } from '@shared/wallet-recovery/walletRecoveryEnvelopeSet';
import {
  parseWalletRecoveryTargetV1,
  type WalletRecoveryTargetV1,
} from '@shared/wallet-recovery/walletRecoveryTarget';
import {
  parseSessionOrigin
} from '../../../../authorization/domain';
import {
  isHostWithinRpId,
  originHostnameOrEmpty,
} from '../../../../core/authService/webauthnOidcHelpers';
import {
  extractBearerCredential,
  resolveSourceIpFromFetchHeaders,
} from '../../../auth/routerApiKeyAuth';
import {
  parseWebAuthnAuthenticationCredential,
  unredactedWebAuthnExtensionField,
} from '../../../auth/webAuthnCredentialCodecs';
import type { EmailOtpEnrollmentMaterialBoundaryInput } from '../../../cloudflare/d1/emailOtp/d1EmailOtpRecords';
import type {
  PasskeyCustodyEnvelopeRetrievalWireRequest,
  WalletRecoveryGoogleEmailOtpRouteFinalizationRequest,
  WalletRecoveryPasskeyRouteFinalizationRequest,
} from '../../../cloudflare/d1/passkeyCustody/d1PasskeyCustodyRouteService';
import type { WalletRecoveryCodeLocatorRecord } from '../../../cloudflare/d1/passkeyCustody/d1WalletCustodyCommitStore';
import {
  emailOtpStatusCode,
  hashEmailOtpOperationBinding,
} from '../../../domains/emailOtp/emailOtpSessionRouteHelpers';
import { readJson } from '../../../framework/http';
import {
  findRouteDefinitionById,
  matchesRouteDefinitionRequest,
  type RouteDefinition,
} from '../../../framework/routeDefinitions';
import { toFetchRouteResponse } from '../../../framework/routeResponses';
import type { FetchRouterApiContext } from '../createFetchRouter';
import { authorizeWalletOwnerOperation, completeWalletOwnerOperation } from '../walletOwnerOperationAuthorization';
import {
  parseRecoveryBackupAcknowledgementRequest,
  parseRecoveryStatusRequest,
  requireExactObjectFields
} from './walletCustodyRequestBoundary';

/**
 * The transport for custody envelope retrieval.
 *
 * Thin on purpose: it parses a body, hands it to the port, and returns what
 * the port decided. Every gate — assertion verification, credential match,
 * lifecycle, digest — lives below, and the status each failure earns is fixed
 * in one wire mapping. A transport that re-decided any of that would be a
 * second opinion on whether a wallet opens.
 */

const ROUTE_ID = 'passkey_custody_envelope_retrieve';
const CREDENTIALS_LIST_ROUTE_ID = 'wallet_custody_credentials_list';
const CREDENTIAL_LABEL_ROUTE_ID = 'wallet_custody_credential_label';
const RECOVERY_PREPARE_ROUTE_ID = 'wallet_recovery_prepare';
const RECOVERY_GOOGLE_VERIFY_ROUTE_ID = 'wallet_recovery_google_verify';
const RECOVERY_EMAIL_OTP_VERIFY_ROUTE_ID = 'wallet_recovery_email_otp_verify';
const RECOVERY_EMAIL_OTP_RELEASE_ROUTE_ID = 'wallet_recovery_email_otp_release';
const RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_ROUTE_ID = 'wallet_recovery_google_email_otp_finalize';
const RECOVERY_FINALIZE_ROUTE_ID = 'wallet_recovery_finalize';
const RECOVERY_ACK_ROUTE_ID = 'wallet_recovery_backup_acknowledge';
const RECOVERY_ROTATE_ROUTE_ID = 'wallet_recovery_codes_rotate';
const RECOVERY_READ_ROUTE_ID = 'wallet_recovery_codes_read';
const RECOVERY_STATUS_ROUTE_ID = 'wallet_recovery_status';
const EMAIL_OTP_CHALLENGE_ROUTE_ID = 'wallet_custody_email_otp_challenge';
const ENVELOPE_OWNERSHIP_UPGRADE_ROUTE_ID = 'wallet_custody_envelope_ownership_upgrade';

function routeErrorResponse(status: number, code: string, message: string): Response {
  return toFetchRouteResponse({ status, body: { ok: false, code, message } });
}

// The route this handler serves, or null when the request is for another route.
function matchRoute(ctx: FetchRouterApiContext, routeId: string): RouteDefinition | null {
  const route = findRouteDefinitionById(ctx.routeDefinitions, routeId);
  if (!route) throw new Error(`Missing route definition for ${routeId}`);
  return matchesRouteDefinitionRequest(route, ctx.method, ctx.pathname) ? route : null;
}


export async function handlePasskeyCustody(ctx: FetchRouterApiContext): Promise<Response | null> {
  const route = matchRoute(ctx, ROUTE_ID);
  if (!route) return null;

  const body = await readJsonObject(ctx.request);
  const extensionField = unredactedWebAuthnExtensionField(body?.webauthnAuthentication);
  if (extensionField) {
    return routeErrorResponse(
      400,
      'prf_disclosed',
      `webauthnAuthentication.${extensionField} must be redacted before retrieval`,
    );
  }
  const request = parseWireRequest(body, ctx.request.headers.get('origin'));
  if (!request) {
    return routeErrorResponse(
      400,
      'invalid_request',
      'custody retrieval needs a locator, a challenge id, and an assertion',
    );
  }

  const response = await ctx.service.passkeyCustody.retrieveEnvelope(request);
  return toFetchRouteResponse(response);
}

function parseWalletCustodyEmailOtpChallengeRequest(
  value: unknown,
  actualOrigin: string,
): {
  readonly walletId: string;
  readonly providerSubjectId: string;
  readonly operation: WalletOwnerAdminOperation;
  readonly payload: Record<string, unknown>;
  readonly requestOrigin: string;
} {
  if (!isPlainObject(value)) throw new Error('Email OTP custody challenge body must be an object');
  const keys = Object.keys(value).sort();
  const expected = ['operation', 'payload', 'providerSubjectId', 'requestOrigin', 'walletId'];
  const required = ['operation', 'payload', 'providerSubjectId', 'walletId'];
  const withoutOptional = keys.filter((key) => key !== 'requestOrigin');
  if (
    withoutOptional.length !== required.length ||
    withoutOptional.some((key, index) => key !== required.slice().sort()[index]) ||
    (keys.includes('requestOrigin') && keys.length !== expected.length)
  ) {
    throw new Error('Email OTP custody challenge body contains unsupported fields');
  }
  const walletId = requireParsed(parseWalletId(value.walletId), 'authorization');
  const providerSubjectId = requireParsed(
    parseProviderSubject(value.providerSubjectId),
    'authorization');
  const operation = value.operation;
  if (
    operation !== 'credentials_list' &&
    operation !== 'credential_label' &&
    operation !== 'recovery_rotate' &&
    operation !== 'recovery_read' &&
    operation !== 'recovery_status' &&
    operation !== 'recovery_backup_acknowledge'
  ) {
    throw new Error('Email OTP custody challenge operation is invalid');
  }
  if (!isPlainObject(value.payload))
    throw new Error('Email OTP custody challenge payload is invalid');
  if (value.requestOrigin !== undefined && value.requestOrigin !== actualOrigin) {
    throw new Error('Email OTP custody challenge requestOrigin does not match Origin');
  }
  return {
    walletId,
    providerSubjectId,
    operation,
    payload: value.payload,
    requestOrigin: actualOrigin,
  };
}

/** Issues one operation-bound Email OTP challenge without exposing authority metadata. */
export async function handleWalletCustodyEmailOtpChallenge(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, EMAIL_OTP_CHALLENGE_ROUTE_ID);
  if (!route) return null;
  const originHeader = toOptionalTrimmedString(ctx.request.headers.get('origin'));
  let request: ReturnType<typeof parseWalletCustodyEmailOtpChallengeRequest>;
  try {
    const origin = parseSessionOrigin(originHeader);
    request = parseWalletCustodyEmailOtpChallengeRequest(await readJson(ctx.request), origin);
  } catch (error: unknown) {
    return routeErrorResponse(
      400,
      'invalid_request',
      error instanceof Error ? error.message : 'Email OTP custody challenge is invalid',
    );
  }

  const active =
    await ctx.service.walletAuthMethods.resolveActiveEmailOtpAuthorityForVerifiedSubject({
      walletId: request.walletId,
      providerUserId: request.providerSubjectId,
    });
  if (!active.ok) {
    return routeErrorResponse(403, active.code, active.message);
  }
  const authoritativeOrgId = requireParsed(
    parseOrgId(ctx.service.authorizedOperations.tenantId),
    'authorization');
  const challengeDigest = await computeWalletOwnerAdminChallengeDigest(request);
  const ownerProofBindingDigest = await hashEmailOtpOperationBinding({
    walletId: request.walletId,
    providerUserId: request.providerSubjectId,
    orgId: authoritativeOrgId,
    operation: `wallet_custody:${request.operation}`,
    requestOrigin: request.requestOrigin,
    audience: request.requestOrigin,
    authorityRef: await walletAuthAuthorityRef({ authority: active.authority }),
    operationFingerprintDigest: challengeDigest,
  });
  const result = await ctx.service.emailOtp.createEmailOtpChallenge({
    userId: request.providerSubjectId,
    walletId: request.walletId,
    orgId: authoritativeOrgId,
    otpChannel: EMAIL_OTP_CHANNEL,
    ownerProofBindingDigest,
    reuseActiveChallenge: true,
    requestOrigin: request.requestOrigin,
    operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
  });
  if (!result.ok) {
    return toFetchRouteResponse({
      status: emailOtpStatusCode(result.code),
      body: {
        ok: false,
        code: result.code,
        message: result.message,
        ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
      },
    });
  }
  return toFetchRouteResponse({
    status: 200,
    body: {
      ok: true,
      challengeId: result.challenge.challengeId,
      challenge_digest: challengeDigest,
      expiresAtMs: result.challenge.expiresAtMs,
      otpChannel: result.challenge.otpChannel,
    },
  });
}

/** Lists public passkey envelope identities with their sibling activity rows. */
export async function handleWalletCustodyCredentialsList(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, CREDENTIALS_LIST_ROUTE_ID);
  if (!route) return null;
  const walletId = walletIdFromPath(route.path, ctx.pathname);
  if (!walletId) {
    return routeErrorResponse(400, 'invalid_request', 'credential list needs a wallet');
  }
  const body = await readJsonObject(ctx.request);
  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId,
    operation: 'credentials_list',
    payload: { walletId },
    factorProof: body?.factorProof,
  });
  if (!authorized.ok) return authorized.response;
  const parsedWalletId = parseWalletId(walletId);
  if (!parsedWalletId.ok) {
    return routeErrorResponse(400, 'invalid_request', 'wallet id is invalid');
  }
  const result = await ctx.service.passkeyCustody.listWalletCredentials({
    walletId: parsedWalletId.value,
  });
  return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
    ok: true,
    credentials: result,
  });
}

/**
 * Binds an unbound custody envelope to the method that opened it.
 *
 * The exact operation credential names the auth method that opened the
 * envelope. Unlock already proved that method, so finishing the ownership
 * upgrade requires no second user assertion.
 */
export async function handleWalletCustodyEnvelopeOwnershipUpgrade(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, ENVELOPE_OWNERSHIP_UPGRADE_ROUTE_ID);
  if (!route) return null;

  const parsedWalletId = parseWalletId(walletIdFromPath(route.path, ctx.pathname));
  if (!parsedWalletId.ok) {
    return routeErrorResponse(400, 'invalid_request', 'wallet id is invalid');
  }
  const token = extractBearerCredential(ctx.request.headers);
  if (!token) {
    return routeErrorResponse(401, 'unauthorized', 'No valid Wallet Session');
  }
  const exact =
    await ctx.service.authorizationSessions.readWalletSessionAuthorizationV2ByOperationCredential({
      tenantId: ctx.service.authorizationSessions.tenantId,
      token,
      nowMs: Date.now(),
    });
  if (!exact || String(exact.authorization.session.walletId) !== String(parsedWalletId.value)) {
    return routeErrorResponse(401, 'unauthorized', 'No valid Wallet Session');
  }
  const walletAuthMethodId = exact.authMethod.walletAuthMethodId;

  const body = await readJsonObject(ctx.request);
  let envelope: PasskeyCustodyEnvelopeRecord;
  try {
    envelope = parsePasskeyCustodyEnvelopeRecord(body?.envelope);
  } catch (error: unknown) {
    return routeErrorResponse(
      400,
      'invalid_request',
      error instanceof Error ? error.message : 'custody envelope is invalid',
    );
  }

  const result = await ctx.service.passkeyCustody.upgradeEnvelopeOwnership({
    walletId: parsedWalletId.value,
    walletAuthMethodId,
    envelope,
  });
  switch (result.kind) {
    case 'upgraded':
      return toFetchRouteResponse({
        status: 200,
        body: { ok: true, upgraded: true, envelopeRevision: result.envelopeRevision },
      });
    case 'already_owned':
      return toFetchRouteResponse({ status: 200, body: { ok: true, upgraded: false } });
    case 'not_found':
      return routeErrorResponse(404, 'not_found', 'no custody envelope to upgrade');
    case 'conflict':
      return routeErrorResponse(409, 'conflict', result.reason);
    case 'refused':
      return routeErrorResponse(403, 'forbidden', result.reason);
  }
}

/** Renames one passkey credential; the label is metadata and never AAD. */
export async function handleWalletCustodyCredentialLabel(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, CREDENTIAL_LABEL_ROUTE_ID);
  if (!route) return null;
  const walletId = walletIdFromPath(route.path, ctx.pathname);
  const body = await readJsonObject(ctx.request);
  const envelopeId = toOptionalTrimmedString(body?.envelopeId);
  const label = body?.label;
  if (!walletId || !envelopeId || (label !== undefined && typeof label !== 'string')) {
    return routeErrorResponse(
      400,
      'invalid_request',
      'credential rename needs a wallet, envelope, and optional label',
    );
  }
  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId,
    operation: 'credential_label',
    payload: { walletId, envelopeId, ...(label === undefined ? {} : { label }) },
    factorProof: body?.factorProof,
  });
  if (!authorized.ok) return authorized.response;
  const parsedWalletId = parseWalletId(walletId);
  if (!parsedWalletId.ok) {
    return routeErrorResponse(400, 'invalid_request', 'wallet id is invalid');
  }
  const result = await ctx.service.passkeyCustody.renameWalletCredential({
    walletId: parsedWalletId.value,
    envelopeId,
    ...(label === undefined ? {} : { label }),
  });
  switch (result.kind) {
    case 'updated':
      return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
        ok: true,
        credential: result.projection,
      });
    case 'missing':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        404,
        { ok: false, code: 'credential_not_found', message: 'credential not found' },
        'failed_before_side_effect',
      );
    case 'conflict':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        409,
        { ok: false, code: 'credential_activity_conflict', message: 'credential changed; retry' },
        'failed_before_side_effect',
      );
    case 'invalid_envelope_id':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        400,
        { ok: false, code: 'invalid_envelope_id', message: 'credential envelope id is invalid' },
        'failed_before_side_effect',
      );
    case 'invalid_label':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        400,
        { ok: false, code: 'invalid_label', message: result.reason },
        'failed_before_side_effect',
      );
  }
}

/**
 * Spending a recovery code.
 *
 * The refusal is one shape for every cause — unknown wallet, unknown code,
 * spent code. The domain deliberately makes them indistinguishable so the
 * route cannot be used to count how many of a user's ten codes remain, and
 * this must not helpfully re-separate them on the way out.
 */
export async function handleWalletRecoveryPrepare(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_PREPARE_ROUTE_ID);
  if (!route) return null;

  const body = await readJsonObject(ctx.request);
  let parsed:
    | {
      readonly target: WalletRecoveryTargetV1;
      readonly recoveryCodeB64u: string;
      readonly reservationId: RecoveryCodeReservationId;
    }
    | undefined;
  try {
    if (!body) throw new Error('wallet recovery preparation body is required');
    requireExactObjectFields(
      body,
      ['target', 'recoveryCodeB64u', 'reservationId'],
      'wallet recovery preparation',
    );
    const target = parseWalletRecoveryTargetV1(body.target);
    const recoveryCodeB64u = requireTrimmedString(body.recoveryCodeB64u, 'recoveryCodeB64u');
    if (!/^[A-Za-z0-9_-]+$/.test(recoveryCodeB64u)) {
      throw new Error('wallet recovery preparation is invalid');
    }
    parsed = {
      target,
      recoveryCodeB64u,
      reservationId: parseRecoveryCodeReservationId(body.reservationId),
    };
  } catch {
    return routeErrorResponse(400, 'invalid_request', 'wallet recovery preparation is invalid');
  }

  const origin = toOptionalTrimmedString(ctx.request.headers.get('origin'));
  if (
    !origin ||
    (parsed.target.kind === 'passkey' &&
      !isHostWithinRpId(originHostnameOrEmpty(origin), parsed.target.rpId))
  ) {
    return routeErrorResponse(
      400,
      'invalid_origin',
      'wallet recovery origin does not match the relying party',
    );
  }

  let recoveryCodeBytes: Uint8Array;
  try {
    recoveryCodeBytes = base64UrlDecode(parsed.recoveryCodeB64u);
    if (recoveryCodeBytes.length === 0) throw new Error('recovery code is empty');
  } catch {
    return toFetchRouteResponse(refusedSpend());
  }

  try {
    const result = await ctx.service.passkeyCustody.prepareRecovery({
      target: parsed.target,
      origin,
      recoveryCodeBytes,
      reservationId: parsed.reservationId,
    });
    switch (result.kind) {
      case 'prepared':
        return toFetchRouteResponse({
          status: 200,
          body: {
            ok: true,
            walletId: result.walletId,
            wrap: result.wrap,
            entries: result.entries,
            keyManifest: result.keyManifest,
            target: result.target,
            recoveryOperationId: result.recoveryOperationId,
            targetDeviceId: result.targetDeviceId,
            targetAuthorityId: result.targetAuthorityId,
            targetWalletAuthMethodId: result.targetWalletAuthMethodId,
            ...(result.target.kind === 'passkey' ? { registration: result.registration } : {}),
            reservationId: result.reservationId,
            reservationExpiresAtMs: result.reservationExpiresAtMs,
            storeVersion: result.storeVersion,
          },
        });
      case 'conflict':
        return routeErrorResponse(
          409,
          'recovery_set_conflict',
          'the recovery set changed during this attempt',
        );
      case 'refused':
        return toFetchRouteResponse(refusedSpend());
      case 'reserved':
      case 'consumed':
        return routeErrorResponse(
          401,
          'recovery_code_used',
          'that recovery code has already been used',
        );
      case 'routing_unavailable':
        return routeErrorResponse(
          503,
          'wallet_home_unavailable',
          'Wallet recovery routing is temporarily unavailable',
        );
      case 'manifest_unavailable':
      case 'registration_unavailable':
        return routeErrorResponse(
          409,
          'recovery_preparation_conflict',
          'wallet recovery could not be prepared',
        );
    }
  } finally {
    recoveryCodeBytes.fill(0);
  }
}

export async function handleWalletRecoveryGoogleVerify(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_GOOGLE_VERIFY_ROUTE_ID);
  if (!route) return null;

  let request: WalletRecoveryGoogleVerifyRequest;
  try {
    request = parseWalletRecoveryGoogleVerifyRequest(await readJsonObject(ctx.request));
  } catch {
    return walletRecoveryRequestError();
  }
  const requestOrigin = toOptionalTrimmedString(ctx.request.headers.get('origin'));
  if (!requestOrigin) {
    return routeErrorResponse(400, 'invalid_origin', 'wallet recovery origin is required');
  }
  try {
    const result = await ctx.service.passkeyCustody.verifyGoogleRecovery({
      recoveryOperationId: request.recoveryOperationId,
      reservationId: String(request.reservationId),
      idToken: request.idToken,
      requestOrigin,
      clientIp: resolveSourceIpFromFetchHeaders(ctx.request.headers) || undefined,
    });
    if (!result.ok) return walletRecoveryGoogleFailureResponse(result);
    return toFetchRouteResponse({
      status: 200,
      body: {
        ok: true,
        recoveryOperationId: result.recoveryOperationId,
        reservationId: result.reservationId,
        challengeId: result.challengeId,
        delivery: result.delivery,
        expiresAtMs: result.expiresAtMs,
      },
    });
  } catch {
    return walletRecoveryInternalError();
  }
}

export async function handleWalletRecoveryEmailOtpVerify(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_EMAIL_OTP_VERIFY_ROUTE_ID);
  if (!route) return null;

  let request: WalletRecoveryEmailOtpVerifyRequest;
  try {
    request = parseWalletRecoveryEmailOtpVerifyRequest(await readJsonObject(ctx.request));
  } catch {
    return walletRecoveryRequestError();
  }
  try {
    const result = await ctx.service.passkeyCustody.verifyRecoveryEmailOtp({
      recoveryOperationId: request.recoveryOperationId,
      reservationId: String(request.reservationId),
      challengeId: String(request.challengeId),
      otpCode: request.otpCode,
      clientIp: resolveSourceIpFromFetchHeaders(ctx.request.headers) || undefined,
    });
    if (!result.ok) return walletRecoveryGoogleFailureResponse(result);
    return toFetchRouteResponse({
      status: 200,
      body: {
        ok: true,
        recoveryOperationId: String(result.recovery.recoveryOperationId),
        reservationId: String(result.recovery.reservationId),
        challengeId: String(result.recovery.challengeId),
      },
    });
  } catch {
    return walletRecoveryInternalError();
  }
}

export async function handleWalletRecoveryEmailOtpRelease(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_EMAIL_OTP_RELEASE_ROUTE_ID);
  if (!route) return null;

  let request: WalletRecoveryEmailOtpReleaseRequest;
  try {
    request = parseWalletRecoveryEmailOtpReleaseRequest(await readJsonObject(ctx.request));
  } catch {
    return walletRecoveryRequestError();
  }
  try {
    const result = await ctx.service.passkeyCustody.releaseRecoveryEmailOtpFactor({
      recoveryOperationId: request.recoveryOperationId,
      reservationId: String(request.reservationId),
      workerEphemeralPublicKey65B64u: request.workerEphemeralPublicKey65B64u,
    });
    if (!result.ok) return walletRecoveryGoogleFailureResponse(result);
    switch (result.kind) {
      case 'email_otp_factor_release_v1':
        return toFetchRouteResponse({
          status: 200,
          body: {
            ok: true,
            kind: result.kind,
            recoveryOperationId: String(result.recovery.recoveryOperationId),
            reservationId: String(result.recovery.reservationId),
            challengeId: String(result.recovery.challengeId),
            providerSubject: result.recovery.providerSubject,
            verifiedEmail: result.recovery.verifiedEmail,
            enrollmentId: result.enrollment.enrollmentId,
            enrollmentSealKeyVersion: result.enrollment.enrollmentSealKeyVersion,
            serverEphemeralPublicKey65B64u: result.serverEphemeralPublicKey65B64u,
            nonce12B64u: result.nonce12B64u,
            ciphertextB64u: result.ciphertextB64u,
          },
        });
      case 'wallet_recovery_google_email_otp_new_enrollment_v1':
        return toFetchRouteResponse({
          status: 200,
          body: {
            ok: true,
            kind: result.kind,
            recoveryOperationId: String(result.recovery.recoveryOperationId),
            reservationId: String(result.recovery.reservationId),
            enrollment: {
              kind: 'create',
              providerSubject: result.enrollment.providerSubject,
              verifiedEmail: result.enrollment.verifiedEmail,
            },
          },
        });
    }
  } catch {
    return walletRecoveryInternalError();
  }
}

/**
 * Installs the Google/Email OTP recovery target selected by the persisted
 * `otp_verified` attempt. Recovery identity and enrollment identifiers stay
 * server-side; the body can add only a new-enrollment material bundle.
 */
export async function handleWalletRecoveryGoogleEmailOtpFinalize(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_ROUTE_ID);
  if (!route) return null;

  let request: WalletRecoveryGoogleEmailOtpRouteFinalizationRequest;
  try {
    request = parseWalletRecoveryGoogleEmailOtpFinalizeRequest(await readJson(ctx.request));
  } catch {
    return walletRecoveryRequestError();
  }

  const finalizer = ctx.service.passkeyCustody.finalizeGoogleEmailOtpRecovery;
  if (!finalizer) {
    return routeErrorResponse(503, 'not_configured', 'Google Email OTP recovery is not configured');
  }

  try {
    return walletRecoveryFinalizationResponse(await finalizer(request));
  } catch {
    return walletRecoveryInternalError();
  }
}

type WalletRecoveryOperationRequest = {
  readonly recoveryOperationId: WalletRecoveryOperationId;
  readonly reservationId: RecoveryCodeReservationId;
};

type WalletRecoveryGoogleVerifyRequest = WalletRecoveryOperationRequest & {
  readonly idToken: string;
};

type WalletRecoveryEmailOtpVerifyRequest = WalletRecoveryOperationRequest & {
  readonly challengeId: EmailOtpChallengeId;
  readonly otpCode: string;
};

type WalletRecoveryEmailOtpReleaseRequest = WalletRecoveryOperationRequest & {
  readonly workerEphemeralPublicKey65B64u: string;
};

function parseWalletRecoveryOperationRequest(
  body: Record<string, unknown> | null,
  fields: readonly string[],
  label: string,
): WalletRecoveryOperationRequest {
  if (!body) throw new Error(`${label} body is required`);
  requireExactObjectFields(body, fields, label);
  return {
    recoveryOperationId: requireParsed(
      parseWalletRecoveryOperationId(body.recoveryOperationId),
      'authorization'),
    reservationId: parseRecoveryCodeReservationId(body.reservationId),
  };
}

function parseWalletRecoveryGoogleVerifyRequest(
  body: Record<string, unknown> | null,
): WalletRecoveryGoogleVerifyRequest {
  return {
    ...parseWalletRecoveryOperationRequest(
      body,
      ['recoveryOperationId', 'reservationId', 'idToken'],
      'wallet recovery Google verification',
    ),
    idToken: requireTrimmedString(body?.idToken, 'idToken'),
  };
}

function parseWalletRecoveryEmailOtpVerifyRequest(
  body: Record<string, unknown> | null,
): WalletRecoveryEmailOtpVerifyRequest {
  const operation = parseWalletRecoveryOperationRequest(
    body,
    ['recoveryOperationId', 'reservationId', 'challengeId', 'otpCode'],
    'wallet recovery Email OTP verification',
  );
  return {
    ...operation,
    challengeId: requireParsed(parseEmailOtpChallengeId(body?.challengeId), 'authorization'),
    otpCode: requireTrimmedString(body?.otpCode, 'otpCode'),
  };
}

function parseWalletRecoveryEmailOtpReleaseRequest(
  body: Record<string, unknown> | null,
): WalletRecoveryEmailOtpReleaseRequest {
  return {
    ...parseWalletRecoveryOperationRequest(
      body,
      ['recoveryOperationId', 'reservationId', 'workerEphemeralPublicKey65B64u'],
      'wallet recovery Email OTP factor release',
    ),
    workerEphemeralPublicKey65B64u: requireTrimmedString(
      body?.workerEphemeralPublicKey65B64u,
      'workerEphemeralPublicKey65B64u',
    ),
  };
}

function parseWalletRecoveryGoogleEmailOtpFinalizeRequest(
  value: unknown,
): WalletRecoveryGoogleEmailOtpRouteFinalizationRequest {
  if (!isPlainObject(value)) {
    throw new Error('wallet recovery Google Email OTP finalization body must be an object');
  }
  const recoveryOperationId = parseWalletRecoveryOperationId(value.recoveryOperationId);
  if (!recoveryOperationId.ok) {
    throw new Error('wallet recovery Google Email OTP finalization operation is invalid');
  }
  const reservationId = parseRecoveryCodeReservationId(value.reservationId);
  const replacementEnvelope = parsePasskeyCustodyEnvelopeRecord(
    value.replacementEnvelope,
    'walletRecoveryGoogleEmailOtpFinalize.replacementEnvelope',
  );
  if (value.kind === 'replay') {
    requireExactObjectFields(
      value,
      ['kind', 'recoveryOperationId', 'reservationId', 'replacementEnvelope'],
      'wallet recovery Google Email OTP replay',
    );
    return {
      kind: 'replay',
      recoveryOperationId: recoveryOperationId.value,
      reservationId,
      replacementEnvelope,
    };
  }
  if (value.kind !== 'finalize') {
    throw new Error('wallet recovery Google Email OTP finalization kind is invalid');
  }
  requireExactObjectFields(
    value,
    [
      'kind',
      'recoveryOperationId',
      'reservationId',
      'replacementEnvelope',
      'ecdsaMaterialPossessionProofs',
      ...(value.emailOtpEnrollment === undefined ? [] : ['emailOtpEnrollment']),
    ],
    'wallet recovery Google Email OTP finalization',
  );
  const emailOtpEnrollment =
    value.emailOtpEnrollment === undefined
      ? null
      : parseWalletRecoveryGoogleEmailOtpCreateEnrollment(value.emailOtpEnrollment);
  return {
    kind: 'finalize',
    recoveryOperationId: recoveryOperationId.value,
    reservationId,
    replacementEnvelope,
    ecdsaMaterialPossessionProofs: parseEcdsaMaterialPossessionProofs(
      value.ecdsaMaterialPossessionProofs,
    ),
    emailOtpEnrollment,
  };
}

function parseWalletRecoveryGoogleEmailOtpCreateEnrollment(
  value: unknown,
): NonNullable<
  Extract<
    WalletRecoveryGoogleEmailOtpRouteFinalizationRequest,
    { readonly kind: 'finalize' }
  >['emailOtpEnrollment']
> {
  if (!isPlainObject(value)) {
    throw new Error('new recovery Email enrollment is invalid');
  }
  requireExactObjectFields(value, ['kind', 'material'], 'new recovery Email enrollment');
  if (value.kind !== 'create' || !isPlainObject(value.material)) {
    throw new Error('new recovery Email enrollment is invalid');
  }
  const material = value.material;
  requireExactObjectFields(
    material,
    [
      'enrollmentSealKeyVersion',
      'clientUnlockPublicKeyB64u',
      'unlockKeyVersion',
      'serverSealedFactorCiphertextB64u',
    ],
    'new recovery Email enrollment material',
  );
  const normalized: EmailOtpEnrollmentMaterialBoundaryInput = {
    enrollmentSealKeyVersion: requireTrimmedString(
      material.enrollmentSealKeyVersion,
      'enrollmentSealKeyVersion',
    ),
    clientUnlockPublicKeyB64u: requireTrimmedString(
      material.clientUnlockPublicKeyB64u,
      'clientUnlockPublicKeyB64u',
    ),
    unlockKeyVersion: requireTrimmedString(material.unlockKeyVersion, 'unlockKeyVersion'),
    serverSealedFactorCiphertextB64u: requireTrimmedString(
      material.serverSealedFactorCiphertextB64u,
      'serverSealedFactorCiphertextB64u',
    ),
  };
  return { kind: 'create', material: normalized };
}

function walletRecoveryFinalizationResponse(
  result:
    | { readonly kind: 'promoted'; readonly projection: unknown }
    | {
      readonly kind:
      | 'conflict'
      | 'refused'
      | 'envelope_rejected'
      | 'registration_rejected'
      | 'enrollment_rejected';
    },
): Response {
  switch (result.kind) {
    case 'promoted':
      return toFetchRouteResponse({
        status: 200,
        body: {
          ok: true,
          projection: result.projection,
        },
      });
    case 'conflict':
      return routeErrorResponse(409, 'recovery_conflict', 'wallet recovery conflicted');
    case 'refused':
    case 'envelope_rejected':
    case 'registration_rejected':
    case 'enrollment_rejected':
      return routeErrorResponse(400, 'recovery_rejected', 'wallet recovery was rejected');
  }
}

function walletRecoveryRequestError(): Response {
  return routeErrorResponse(400, 'invalid_body', 'wallet recovery request is invalid');
}

function walletRecoveryInternalError(): Response {
  return routeErrorResponse(500, 'internal', 'wallet recovery could not continue');
}

function walletRecoveryGoogleFailureResponse(result: {
  readonly ok: false;
  readonly code: string;
}): Response {
  return routeErrorResponse(
    walletRecoveryGoogleStatusCode(result.code),
    result.code,
    'wallet recovery could not continue',
  );
}

function walletRecoveryGoogleStatusCode(code: string): number {
  if (code === 'internal') return 500;
  if (code === 'not_configured') return 503;
  if (code === 'recovery_conflict') return 409;
  if (code === 'rate_limited' || code === 'otp_locked_out' || code === 'otp_attempts_exhausted') {
    return 429;
  }
  if (
    code === 'recovery_attempt_unavailable' ||
    code === 'provider_identity_mismatch' ||
    code === 'challenge_expired_or_invalid' ||
    code === 'invalid_otp'
  ) {
    return 401;
  }
  return emailOtpStatusCode(code);
}

function refusedSpend() {
  return {
    status: 401,
    body: {
      ok: false,
      code: 'recovery_code_rejected',
      message: 'that recovery code cannot be used',
    },
  };
}

function parseWireRequest(
  body: Record<string, unknown> | null,
  originHeader: string | null,
): PasskeyCustodyEnvelopeRetrievalWireRequest | null {
  if (!body || typeof body !== 'object') return null;

  const challengeId = toOptionalTrimmedString(body.challengeId);
  const locator = parseEnvelopeRetrievalLocator(body.locator);
  const webauthnAuthentication = parseWebAuthnAuthenticationCredential(body.webauthnAuthentication);
  if (!challengeId || !locator || !webauthnAuthentication) return null;

  /* Shape-checked here, content-checked below. This only establishes that an
     assertion was sent at all — whether it verifies is the retrieval's
     decision, and a transport that judged it would be a second gate. */
  /* The header, with no body fallback (frozen 2026-08-09). The sibling
     WebAuthn service takes `expected_origin` from its caller because it is
     called by an app server; on a browser-reachable route a value the
     requester supplies is not evidence of anything — it would let a caller
     name the origin its own assertion is checked against.

     A request with no Origin header is refused rather than read from the
     body: browsers set it on cross-origin POSTs, so its absence means the
     caller is not the browser this route exists for. */
  const expectedOrigin = toOptionalTrimmedString(originHeader);
  if (!expectedOrigin) return null;

  return {
    challengeId,
    expectedOrigin,
    locator,
    webauthnAuthentication,
  };
}

function parseEnvelopeRetrievalLocator(
  value: unknown,
): PasskeyCustodyEnvelopeRetrievalWireRequest['locator'] | null {
  if (!isPlainObject(value) || !isPlainObject(value.factor)) return null;
  try {
    requireExactObjectFields(value, ['walletId', 'factor'], 'custody locator');
    requireExactObjectFields(
      value.factor,
      ['kind', 'rpId', 'credentialIdB64u'],
      'custody locator.factor',
    );
  } catch {
    return null;
  }
  const walletId = parseWalletId(value.walletId);
  const rpId = parseWebAuthnRpId(value.factor.rpId);
  const credentialIdB64u = parseWebAuthnCredentialIdB64u(value.factor.credentialIdB64u);
  if (!walletId.ok || !rpId.ok || !credentialIdB64u.ok) return null;
  if (value.factor.kind !== 'passkey') return null;
  return {
    walletId: walletId.value,
    factor: {
      kind: 'passkey',
      rpId: rpId.value,
      credentialIdB64u: credentialIdB64u.value,
    },
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const value = await readJson(request);
  return isPlainObject(value) ? value : null;
}

function parseRecoveryCodeLocatorRecords(
  values: readonly Record<string, unknown>[],
  walletId: WalletId,
  recoveryKeyIds: readonly ReturnType<typeof parseDerivedWalletRecoveryKeyId>[],
): readonly WalletRecoveryCodeLocatorRecord[] {
  if (values.length !== recoveryKeyIds.length) {
    throw new Error('recovery code locators do not match the recovery wraps');
  }
  const locators = values.map((value, index) => {
    requireExactObjectFields(value, ['locatorB64u', 'recoveryKeyId'], 'recovery code locator');
    const locatorB64u = parseRecoveryCodeLocatorV1(value.locatorB64u);
    const recoveryKeyId = parseDerivedWalletRecoveryKeyId(value.recoveryKeyId);
    const expectedRecoveryKeyId = recoveryKeyIds[index];
    if (!expectedRecoveryKeyId || String(recoveryKeyId) !== String(expectedRecoveryKeyId)) {
      throw new Error('recovery code locator does not match its recovery wrap');
    }
    return { locatorB64u, walletId, recoveryKeyId };
  });
  const uniqueLocators = new Set(locators.map((locator) => String(locator.locatorB64u)));
  if (uniqueLocators.size !== locators.length) {
    throw new Error('recovery code locators must be unique');
  }
  return locators;
}

/**
 * Installing the credential a recovery enrolled.
 *
 * The envelope arrives sealed, but its complete wire shape is parsed here.
 * The server has no seed and cannot open the ciphertext. Exact key coverage
 * comes from its signer registry and durable activation receipts.
 */
export async function handleWalletRecoveryFinalize(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_FINALIZE_ROUTE_ID);
  if (!route) return null;

  let requestBody: WalletRecoveryFinalizeBody;
  try {
    requestBody = parseWalletRecoveryFinalizeBody(await readJson(ctx.request));
  } catch {
    return routeErrorResponse(400, 'invalid_request', 'wallet recovery finalization is invalid');
  }

  let serviceRequest: WalletRecoveryPasskeyRouteFinalizationRequest;
  if (requestBody.kind === 'finalize') {
    const expectedOrigin = toOptionalTrimmedString(ctx.request.headers.get('origin'));
    if (!expectedOrigin) {
      return routeErrorResponse(
        400,
        'invalid_origin',
        'wallet recovery finalization requires the request Origin header',
      );
    }
    serviceRequest = {
      kind: 'finalize',
      walletId: requestBody.walletId,
      reservationId: requestBody.reservationId,
      recoveryOperationId: requestBody.recoveryOperationId,
      targetDeviceId: requestBody.targetDeviceId,
      targetAuthorityId: requestBody.targetAuthorityId,
      targetWalletAuthMethodId: requestBody.targetWalletAuthMethodId,
      challengeId: requestBody.challengeId,
      replacementId: requestBody.replacementId,
      webauthnRegistration: requestBody.webauthnRegistration,
      expectedOrigin,
      replacementEnvelope: requestBody.replacementEnvelope,
      ecdsaMaterialPossessionProofs: requestBody.ecdsaMaterialPossessionProofs,
    };
  } else {
    serviceRequest = {
      kind: 'replay',
      walletId: requestBody.walletId,
      reservationId: requestBody.reservationId,
      recoveryOperationId: requestBody.recoveryOperationId,
      targetDeviceId: requestBody.targetDeviceId,
      targetAuthorityId: requestBody.targetAuthorityId,
      targetWalletAuthMethodId: requestBody.targetWalletAuthMethodId,
      replacementId: requestBody.replacementId,
      replacementEnvelope: requestBody.replacementEnvelope,
    };
  }

  const result = await ctx.service.passkeyCustody.finalizeRecovery(serviceRequest);

  return walletRecoveryFinalizationResponse(result);
}
type WalletRecoveryFinalizeBody =
  | Omit<
    Extract<WalletRecoveryPasskeyRouteFinalizationRequest, { readonly kind: 'finalize' }>,
    'expectedOrigin'
  >
  | Extract<WalletRecoveryPasskeyRouteFinalizationRequest, { readonly kind: 'replay' }>;

function parseWalletRecoveryFinalizeBody(value: unknown): WalletRecoveryFinalizeBody {
  if (!isPlainObject(value)) throw new Error('wallet recovery finalization body must be an object');
  const walletId = parseWalletId(value.walletId);
  const recoveryOperationId = parseWalletRecoveryOperationId(value.recoveryOperationId);
  const targetDeviceId = parseDeviceId(value.targetDeviceId);
  const targetAuthorityId = parseWalletAuthorityId(value.targetAuthorityId);
  const targetWalletAuthMethodId = parseWalletAuthMethodId(value.targetWalletAuthMethodId);
  if (
    !walletId.ok ||
    !recoveryOperationId.ok ||
    !targetDeviceId.ok ||
    !targetAuthorityId.ok ||
    !targetWalletAuthMethodId.ok
  ) {
    throw new Error('wallet recovery finalization identity is invalid');
  }
  const identity = {
    walletId: walletId.value,
    reservationId: parseRecoveryCodeReservationId(value.reservationId),
    recoveryOperationId: recoveryOperationId.value,
    targetDeviceId: targetDeviceId.value,
    targetAuthorityId: targetAuthorityId.value,
    targetWalletAuthMethodId: targetWalletAuthMethodId.value,
    replacementId: requireTrimmedString(value.replacementId, 'replacementId'),
    replacementEnvelope: parsePasskeyCustodyEnvelopeRecord(
      value.replacementEnvelope,
      'walletRecoveryFinalize.replacementEnvelope',
    ),
  };
  if (value.kind === 'replay') {
    requireExactObjectFields(
      value,
      [
        'kind',
        'walletId',
        'reservationId',
        'recoveryOperationId',
        'targetDeviceId',
        'targetAuthorityId',
        'targetWalletAuthMethodId',
        'replacementId',
        'replacementEnvelope',
      ],
      'wallet recovery replay',
    );
    return { kind: 'replay', ...identity };
  }
  if (value.kind !== 'finalize') {
    throw new Error('wallet recovery finalization kind is invalid');
  }
  requireExactObjectFields(
    value,
    [
      'kind',
      'walletId',
      'reservationId',
      'recoveryOperationId',
      'targetDeviceId',
      'targetAuthorityId',
      'targetWalletAuthMethodId',
      'challengeId',
      'replacementId',
      'webauthnRegistration',
      'replacementEnvelope',
      'ecdsaMaterialPossessionProofs',
    ],
    'wallet recovery finalization',
  );
  if (!isPlainObject(value.webauthnRegistration)) {
    throw new Error('wallet recovery finalization registration is invalid');
  }
  const extensionField = unredactedWebAuthnExtensionField(value.webauthnRegistration);
  if (extensionField) {
    throw new Error(`wallet recovery finalization registration ${extensionField} must be redacted`);
  }
  return {
    kind: 'finalize',
    ...identity,
    challengeId: requireTrimmedString(value.challengeId, 'challengeId'),
    webauthnRegistration: value.webauthnRegistration,
    ecdsaMaterialPossessionProofs: parseEcdsaMaterialPossessionProofs(
      value.ecdsaMaterialPossessionProofs,
    ),
  };
}

function parseEcdsaMaterialPossessionProofs(value: unknown): readonly {
  readonly keySetId: string;
  readonly proof: WalletRecoveryEcdsaPossessionProofV1;
}[] {
  if (!Array.isArray(value)) {
    throw new Error('wallet recovery finalization ECDSA proofs must be an array');
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(`wallet recovery finalization ECDSA proof ${index} is invalid`);
    }
    requireExactObjectFields(item, ['keySetId', 'proof'], `ECDSA proof ${index}`);
    const keySetId = toOptionalTrimmedString(item.keySetId);
    if (!/^evm_family_ecdsa:\S+$/.test(keySetId)) {
      throw new Error(`wallet recovery finalization ECDSA proof ${index} is invalid`);
    }
    if (seen.has(keySetId)) {
      throw new Error(`wallet recovery finalization ECDSA proof ${index} is duplicated`);
    }
    seen.add(keySetId);
    return {
      keySetId,
      proof: parseWalletRecoveryEcdsaPossessionProofV1(item.proof),
    };
  });
}

export async function handleWalletRecoveryBackupAcknowledge(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_ACK_ROUTE_ID);
  if (!route) return null;

  let request: ReturnType<typeof parseRecoveryBackupAcknowledgementRequest>;
  try {
    request = parseRecoveryBackupAcknowledgementRequest(await readJsonObject(ctx.request));
  } catch {
    return routeErrorResponse(400, 'invalid_request', 'acknowledgement body is invalid');
  }

  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId: request.walletId,
    operation: 'recovery_backup_acknowledge',
    payload: {
      walletId: request.walletId,
      requestId: request.requestId,
      expectedIssuedAtMs: request.expectedIssuedAtMs,
    },
    factorProof: request.factorProof,
  });
  if (!authorized.ok) return authorized.response;

  const result = await ctx.service.passkeyCustody.acknowledgeRecoveryBackup({
    walletId: request.walletId,
    expectedIssuedAtMs: request.expectedIssuedAtMs,
  });
  if (result.kind === 'conflict') {
    return await completeWalletOwnerOperation(
      ctx,
      authorized.operation,
      409,
      { ok: false, code: 'recovery_set_conflict', message: 'the recovery set changed' },
      'failed_before_side_effect',
    );
  }
  if (result.kind === 'no_recovery_set') {
    return await completeWalletOwnerOperation(
      ctx,
      authorized.operation,
      404,
      {
        ok: false,
        code: 'no_recovery_set',
        message: 'this wallet has no issued recovery codes to acknowledge',
      },
      'failed_before_side_effect',
    );
  }
  return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
    ok: true,
    issuedAtMs: result.issuedAtMs,
  });
}

/**
 * Rotating a wallet's recovery codes.
 *
 * The wraps pass through as opaque records — the server cannot check that
 * they wrap the right KEK, because it has neither. What it does check is the
 * set's shape, and it does so before writing: a set that reaches the store
 * with the wrong number of wraps leaves a wallet holding fewer codes than its
 * owner wrote down, and nothing surfaces that until someone counts.
 */
export async function handleWalletRecoveryRotate(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_ROTATE_ROUTE_ID);
  if (!route) return null;

  const body = await readJsonObject(ctx.request);
  const walletId = toOptionalTrimmedString(body?.walletId);
  const expectedStoreVersion = toOptionalTrimmedString(body?.expectedStoreVersion);
  const manifestKekWraps = Array.isArray(body?.manifestKekWraps)
    ? body.manifestKekWraps.filter(isPlainObject)
    : [];
  const entries = Array.isArray(body?.entries) ? body.entries.filter(isPlainObject) : [];
  const rawRecoveryCodeLocators = Array.isArray(body?.recoveryCodeLocators)
    ? body.recoveryCodeLocators
    : [];
  const recoveryCodeLocators = rawRecoveryCodeLocators.filter(isPlainObject);
  if (
    !walletId ||
    !expectedStoreVersion ||
    manifestKekWraps.length === 0 ||
    entries.length !== 1 ||
    recoveryCodeLocators.length !== rawRecoveryCodeLocators.length ||
    recoveryCodeLocators.length !== manifestKekWraps.length
  ) {
    return routeErrorResponse(
      400,
      'invalid_request',
      'a rotation needs a wallet and its complete replacement recovery set',
    );
  }
  const parsedWalletId = parseWalletId(walletId);
  if (!parsedWalletId.ok) {
    return routeErrorResponse(400, 'invalid_request', 'wallet id is invalid');
  }

  let replacement: ReturnType<typeof parseWalletRecoverySetRotationWireV1>;
  let parsedRecoveryCodeLocators: readonly WalletRecoveryCodeLocatorRecord[];
  try {
    replacement = parseWalletRecoverySetRotationWireV1(
      { walletId, manifestKekWraps, entries },
      { expectedWalletId: parsedWalletId.value },
    );
    parsedRecoveryCodeLocators = parseRecoveryCodeLocatorRecords(
      recoveryCodeLocators,
      parsedWalletId.value,
      replacement.manifestKekWraps.map((wrap) => wrap.recoveryKeyId),
    );
  } catch (error: unknown) {
    return routeErrorResponse(
      400,
      'invalid_request',
      error instanceof Error ? error.message : 'replacement recovery set is invalid',
    );
  }

  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId,
    operation: 'recovery_rotate',
    payload: {
      walletId,
      expectedStoreVersion,
      manifestKekWraps,
      entries,
      recoveryCodeLocators,
    },
    factorProof: body?.factorProof,
  });
  if (!authorized.ok) return authorized.response;

  const result = await ctx.service.passkeyCustody.rotateRecoveryCodes({
    walletId,
    replacement,
    recoveryCodeLocators: parsedRecoveryCodeLocators,
    expectedStoreVersion,
  });

  switch (result.kind) {
    case 'rotated':
      return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
        ok: true,
        issuedAtMs: result.issuedAtMs,
        storeVersion: result.storeVersion,
      });
    case 'no_recovery_set':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        404,
        { ok: false, code: 'no_recovery_set', message: 'this wallet has no codes to rotate' },
        'failed_before_side_effect',
      );
    case 'conflict':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        409,
        {
          ok: false,
          code: 'recovery_set_conflict',
          message: 'the recovery set changed during this rotation; try again',
        },
        'failed_before_side_effect',
      );
    case 'rejected':
      return await completeWalletOwnerOperation(
        ctx,
        authorized.operation,
        400,
        { ok: false, code: 'rotation_rejected', message: result.reason },
        'failed_before_side_effect',
      );
  }
}

export async function handleWalletRecoveryRead(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_READ_ROUTE_ID);
  if (!route) return null;
  const body = await readJsonObject(ctx.request);
  const walletId = toOptionalTrimmedString(body?.walletId);
  if (!walletId) {
    return routeErrorResponse(400, 'invalid_request', 'a read needs a wallet');
  }
  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId,
    operation: 'recovery_read',
    payload: { walletId },
    factorProof: body?.factorProof,
  });
  if (!authorized.ok) return authorized.response;
  const result = await ctx.service.passkeyCustody.readRecoverySet({ walletId });
  if (result.kind === 'no_recovery_set') {
    return await completeWalletOwnerOperation(
      ctx,
      authorized.operation,
      404,
      { ok: false, code: 'no_recovery_set', message: 'this wallet has no issued recovery codes' },
      'failed_before_side_effect',
    );
  }
  return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
    ok: true,
    recoverySet: result.record,
    storeVersion: result.storeVersion,
  });
}

/** Reports current recovery-code counts after fresh owner proof. */
export async function handleWalletRecoveryStatus(
  ctx: FetchRouterApiContext,
): Promise<Response | null> {
  const route = matchRoute(ctx, RECOVERY_STATUS_ROUTE_ID);
  if (!route) return null;

  const walletId = walletIdFromPath(route.path, ctx.pathname);
  if (!walletId) {
    return routeErrorResponse(400, 'invalid_request', 'status needs a wallet');
  }
  let request: ReturnType<typeof parseRecoveryStatusRequest>;
  try {
    request = parseRecoveryStatusRequest(await readJsonObject(ctx.request));
  } catch {
    return routeErrorResponse(400, 'invalid_request', 'status body is invalid');
  }

  const authorized = await authorizeWalletOwnerOperation({
    ctx,
    walletId,
    operation: 'recovery_status',
    payload: { walletId, requestId: request.requestId },
    factorProof: request.factorProof,
  });
  if (!authorized.ok) return authorized.response;

  const result = await ctx.service.passkeyCustody.readRecoveryStatus({ walletId });
  if (result.kind === 'no_recovery_set') {
    return await completeWalletOwnerOperation(
      ctx,
      authorized.operation,
      404,
      { ok: false, code: 'no_recovery_set', message: 'this wallet has no recovery codes' },
      'failed_before_side_effect',
    );
  }
  return await completeWalletOwnerOperation(ctx, authorized.operation, 200, {
    ok: true,
    activeCodeCount: result.activeCodeCount,
    totalCodeCount: result.totalCodeCount,
    issuedAtMs: result.issuedAtMs,
    storeVersion: result.storeVersion,
    backupOutstanding: result.backupOutstanding,
  });
}

function walletIdFromPath(routePath: string, pathname: string): string {
  const routeSegments = routePath.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  const index = routeSegments.indexOf(':walletId');
  if (index < 0) return '';
  const segment = pathSegments[index];
  return segment ? decodeURIComponent(segment).trim() : '';
}
