import type { WalletOperationEvidenceLookup } from '../../../authorization/service';
import type { D1PreparedStatementLike } from '../../../storage/tenantRoute';
import {
  buildVaultOperationRef,
  parseAuthFactorId,
  parseAuthorizationAuditEventId,
  parseAuthorizationEvidenceId,
  parseAuthorizationEvidenceSetId,
  parseAuthorizedOperationId,
  parseCapabilityId,
  parseCapabilityOperationId,
  parsePrincipalId,
  parseTenantId,
} from '@shared/authorization/capabilityKinds';
import {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';
import {
  buildCapabilityOperationEnvelope,
  computeCapabilityOperationFingerprintDigest,
} from '@shared/authorization/operationFingerprint';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import {
  computeWalletOwnerAdminChallengeDigest,
  type WalletOwnerAdminOperation,
} from '@shared/authorization/walletOwnerOperation';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { sha256Utf8DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import {
  parseEmailOtpChallengeId,
  parseOrgId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  type WalletId,
} from '@shared/utils/domainIds';
import { EMAIL_OTP_CHANNEL, WALLET_EMAIL_OTP_UNLOCK_OPERATION } from '@shared/utils/emailOtpDomain';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import {
  buildPasskeyWalletAuthAuthority,
  walletAuthAuthorityRef,
  type PasskeyWalletAuthAuthority,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import {
  parseSessionOrigin,
  parseVerifiedOwnerProofId,
  type AuthorizedOperation,
  type AuthorizedOperationInput,
} from '../../../authorization/domain';
import {
  buildVerifiedWalletOperationFactorEvidenceSet,
  buildVerifiedWalletOperationEmailOtpFactorResult,
  buildVerifiedWalletOperationPasskeyFactorResult,
  type VerifiedWalletOperationFactorResult,
} from '../../../authorization/factorEvidence';
import { parseWebAuthnAuthenticationCredential } from '../../auth/webAuthnCredentialCodecs';
import { hashEmailOtpOperationBinding } from '../../domains/emailOtp/emailOtpSessionRouteHelpers';
import { toFetchRouteResponse } from '../../framework/routeResponses';
import type { FetchRouterApiContext } from './fetchRouter.types';
import {
  parseCustodyOwnerProof,
  type WalletCustodyOwnerProofWire,
} from './routes/walletCustodyRequestBoundary';

export type WalletOwnerAuthorizationResult =
  | {
      readonly ok: true;
      readonly operation: AuthorizedOperation;
      readonly ownerAuthority: ActiveWalletAuthorityV1;
    }
  | { readonly ok: false; readonly response: Response };

const CUSTODY_OPERATION_CAPABILITY_ID = 'wallet-custody-admin';
const CUSTODY_PROOF_TTL_MS = 60_000;

export function walletOwnerOperationAuthorizationId(
  operation: WalletOwnerAdminOperation,
  challenge: DigestB64u,
) {
  return requireParsed(
    parseAuthorizedOperationId(
      `wallet-custody:authorized:wallet-custody:${operation}:${challenge}`,
    ),
    'owner operation',
  );
}

function hasFullOwnerAuthority(authority: ActiveWalletAuthorityV1): boolean {
  return sameDelegatedWalletAuthorityV1(
    buildDelegatedWalletAuthorityV1({ permissions: authority.permissions }),
    buildDelegatedWalletAuthorityV1({ permissions: buildFullOwnerPermissionsV1() }),
  );
}

async function custodyDigest(domain: string, value: Record<string, unknown>): Promise<DigestB64u> {
  return sha256Utf8DigestB64u(`${domain}|${alphabetizeStringify(value)}`);
}

async function buildWalletCustodyOperation(input: {
  readonly tenantId: string;
  readonly principalId: string;
  readonly walletId: string;
  readonly operation: WalletOwnerAdminOperation;
  readonly payload: Record<string, unknown>;
  readonly requestOrigin: string;
}): Promise<{
  readonly operation: Awaited<ReturnType<typeof buildCapabilityOperationEnvelope>>;
  readonly challengeDigest: DigestB64u;
}> {
  const tenantId = requireParsed(parseTenantId(input.tenantId), 'authorization');
  const principalId = requireParsed(parsePrincipalId(input.principalId), 'authorization');
  const capabilityId = requireParsed(
    parseCapabilityId(CUSTODY_OPERATION_CAPABILITY_ID),
    'authorization',
  );
  const operationRef = buildVaultOperationRef('vault.reveal');
  const laneDigest = await custodyDigest('seams:wallet-custody:lane:v1', {
    capabilityId,
    operation: input.operation,
    operationRef,
  });
  const challengeDigest = await computeWalletOwnerAdminChallengeDigest({
    walletId: input.walletId,
    operation: input.operation,
    payload: input.payload,
    requestOrigin: input.requestOrigin,
  });
  const intentDigest = challengeDigest;
  const displayDigest = await custodyDigest('seams:wallet-custody:display:v1', {
    walletId: input.walletId,
    operation: input.operation,
  });
  const operationId = requireParsed(
    parseCapabilityOperationId(`wallet-custody:${input.operation}:${intentDigest}`),
    'authorization',
  );
  return {
    operation: buildCapabilityOperationEnvelope({
      tenantId,
      principalId,
      capabilityId,
      operationId,
      operation: operationRef,
      digests: { laneDigest, intentDigest, displayDigest },
    }),
    challengeDigest,
  };
}

type WalletOwnerOperationRequest = {
  readonly ctx: FetchRouterApiContext;
  readonly walletId: string;
  readonly operation: WalletOwnerAdminOperation;
  readonly payload: Record<string, unknown>;
  readonly factorProof: unknown;
};

type PreparedWalletOwnerAuthorization =
  | {
      readonly ok: true;
      readonly operation: AuthorizedOperationInput;
      readonly ownerAuthority: ActiveWalletAuthorityV1;
    }
  | { readonly ok: false; readonly response: Response };

export async function prepareWalletOwnerOperation(
  input: WalletOwnerOperationRequest,
): Promise<PreparedWalletOwnerAuthorization> {
  const requestOrigin = toOptionalTrimmedString(input.ctx.request.headers.get('origin'));
  if (!requestOrigin) {
    return toCustodyAuthorizationFailure(400, 'invalid_origin', 'request Origin is required');
  }
  let origin: ReturnType<typeof parseSessionOrigin>;
  let proof: WalletCustodyOwnerProofWire;
  let walletId: WalletId;
  try {
    origin = parseSessionOrigin(requestOrigin);
    walletId = requireParsed(parseWalletId(input.walletId), 'authorization');
    proof = parseCustodyOwnerProof(input.factorProof);
  } catch (error: unknown) {
    return toCustodyAuthorizationFailure(
      400,
      'invalid_owner_proof',
      error instanceof Error ? error.message : 'owner proof is invalid',
    );
  }
  if (proof.kind === 'passkey' && proof.walletId !== input.walletId) {
    return toCustodyAuthorizationFailure(403, 'scope_mismatch', 'owner proof wallet differs');
  }

  let principalId: string;
  let factor: VerifiedWalletOperationFactorResult;
  let persistence:
    | { readonly kind: 'recorded' }
    | { readonly kind: 'prepared'; readonly consumeInBatch: readonly D1PreparedStatementLike[] };
  let ownerAuthorityRef: WalletAuthAuthorityRef;
  let ownerAuthority: ActiveWalletAuthorityV1;
  let operation: Awaited<ReturnType<typeof buildCapabilityOperationEnvelope>>;
  let challengeDigest: DigestB64u;
  try {
    principalId = proof.kind === 'passkey' ? input.walletId : proof.provider_subject_id;
    const built = await buildWalletCustodyOperation({
      tenantId: input.ctx.service.authorizedOperations.tenantId,
      principalId,
      walletId: input.walletId,
      operation: input.operation,
      payload: input.payload,
      requestOrigin,
    });
    operation = built.operation;
    challengeDigest = built.challengeDigest;
  } catch (error: unknown) {
    return toCustodyAuthorizationFailure(
      400,
      'invalid_owner_proof',
      error instanceof Error ? error.message : 'owner proof binding is invalid',
    );
  }
  const operationFingerprintDigest = await computeCapabilityOperationFingerprintDigest(operation);
  const nowMs = Date.now();
  if (proof.challenge_digest !== String(challengeDigest)) {
    return toCustodyAuthorizationFailure(
      403,
      'scope_mismatch',
      'factor proof challenge does not match the requested operation',
    );
  }

  const evidenceSetId = requireParsed(
    parseAuthorizationEvidenceSetId(`wallet-custody:evidence-set:${operation.operationId}`),
    'authorization',
  );
  const evidenceLookup = { tenantId: operation.tenantId, evidenceSetId };
  const recorded =
    input.operation === 'external_identity_associate' ||
    input.operation === 'external_identity_unlink'
      ? await input.ctx.service.authorizedOperations.readWalletOperationEvidence({
          tenantId: operation.tenantId,
          evidenceSetId,
        })
      : null;
  if (recorded && recorded.expiresAtMs <= nowMs) {
    return toCustodyAuthorizationFailure(403, 'owner_proof_rejected', 'Owner evidence expired');
  }

  if (proof.kind === 'passkey') {
    let authority: PasskeyWalletAuthAuthority;
    try {
      authority = buildPasskeyWalletAuthAuthority({
        walletId,
        rpId: proof.rpId,
        credentialIdB64u: proof.credentialIdB64u,
      });
    } catch (error: unknown) {
      return toCustodyAuthorizationFailure(
        400,
        'invalid_owner_proof',
        error instanceof Error ? error.message : 'passkey authority is invalid',
      );
    }
    const active =
      await input.ctx.service.walletAuthMethods.resolveActivePasskeyAuthorityForVerifiedCredential({
        walletId,
        rpId: authority.verifier.rpId,
        credentialIdB64u: authority.factor.credentialIdB64u,
      });
    if (!active.ok) return toCustodyAuthorizationFailure(403, active.code, active.message);
    if (!hasFullOwnerAuthority(active.walletAuthority)) {
      return toCustodyAuthorizationFailure(403, 'forbidden', 'Full owner authority is required');
    }
    ownerAuthority = active.walletAuthority;
    const credential = parseWebAuthnAuthenticationCredential(proof.webauthn_authentication);
    if (!credential) {
      return toCustodyAuthorizationFailure(
        400,
        'invalid_owner_proof',
        'passkey assertion is invalid',
      );
    }
    const credentialId = String(credential.rawId || credential.id).trim();
    if (credentialId !== authority.factor.credentialIdB64u) {
      return toCustodyAuthorizationFailure(401, 'unauthorized', 'passkey credential changed');
    }
    if (!recorded) {
      const verified = await input.ctx.service.webAuthn.prepareWebAuthnAuthenticationLite({
        userId: input.walletId,
        rpId: authority.verifier.rpId,
        expectedChallenge: challengeDigest,
        expected_origin: requestOrigin,
        webauthn_authentication: credential,
      });
      if (!verified.success) {
        const retry = await retryRecordedWalletOwnerOperation(input, evidenceLookup);
        if (retry) return retry;
        return toCustodyAuthorizationFailure(
          401,
          verified.code || 'not_verified',
          verified.message || 'WebAuthn authentication verification failed',
        );
      }
      persistence = { kind: 'prepared', consumeInBatch: verified.consumeInBatch };
    } else {
      persistence = { kind: 'recorded' };
    }
    ownerAuthorityRef = await walletAuthAuthorityRef({ authority: active.authority });
    factor = buildVerifiedWalletOperationPasskeyFactorResult({
      tenantId: operation.tenantId,
      principalId: operation.principalId,
      walletId,
      authorityRef: ownerAuthorityRef,
      requestOrigin: origin,
      audience: origin,
      factorId: requireParsed(
        parseAuthFactorId(`passkey:${authority.factor.credentialIdB64u}`),
        'authorization',
      ),
      credentialIdB64u: requireParsed(
        parseWebAuthnCredentialIdB64u(authority.factor.credentialIdB64u),
        'authorization',
      ),
      assertionDigest: await custodyDigest('seams:wallet-custody:assertion:v1', { credential }),
      operation,
      verifiedAtMs: recorded?.verifiedAtMs ?? nowMs,
      expiresAtMs: recorded?.expiresAtMs ?? nowMs + CUSTODY_PROOF_TTL_MS,
    });
  } else {
    const orgId = requireParsed(
      parseOrgId(input.ctx.service.authorizedOperations.tenantId),
      'authorization',
    );
    const active =
      await input.ctx.service.walletAuthMethods.resolveActiveEmailOtpAuthorityForVerifiedSubject({
        walletId: input.walletId,
        providerUserId: proof.provider_subject_id,
      });
    if (!active.ok) return toCustodyAuthorizationFailure(403, active.code, active.message);
    const activeAuthorityRef = await walletAuthAuthorityRef({ authority: active.authority });
    ownerAuthorityRef = activeAuthorityRef;
    ownerAuthority = active.walletAuthority;
    const ownerProofBindingDigest = await hashEmailOtpOperationBinding({
      walletId: input.walletId,
      providerUserId: proof.provider_subject_id,
      orgId,
      operation: `wallet_custody:${input.operation}`,
      requestOrigin,
      audience: requestOrigin,
      authorityRef: activeAuthorityRef,
      operationFingerprintDigest: challengeDigest,
    });
    let challengeId = proof.challenge_id;
    let expiresAtMs = recorded?.expiresAtMs ?? nowMs + CUSTODY_PROOF_TTL_MS;
    if (!recorded) {
      const verified = await input.ctx.service.emailOtp.prepareEmailOtpOwnerProof({
        userId: proof.provider_subject_id,
        walletId: input.walletId,
        orgId,
        challengeId: proof.challenge_id,
        otpCode: proof.otp_code,
        otpChannel: EMAIL_OTP_CHANNEL,
        ownerProofBindingDigest,
        operation: WALLET_EMAIL_OTP_UNLOCK_OPERATION,
      });
      if (!verified.ok) {
        const retry = await retryRecordedWalletOwnerOperation(input, evidenceLookup);
        if (retry) return retry;
        return toCustodyAuthorizationFailure(
          verified.code === 'invalid_body' ? 400 : 401,
          verified.code,
          verified.message,
        );
      }
      persistence = { kind: 'prepared', consumeInBatch: verified.consumeInBatch };
      challengeId = verified.challengeId;
      expiresAtMs = Math.min(nowMs + CUSTODY_PROOF_TTL_MS, verified.expiresAtMs);
    } else {
      persistence = { kind: 'recorded' };
    }
    factor = buildVerifiedWalletOperationEmailOtpFactorResult({
      tenantId: operation.tenantId,
      principalId: operation.principalId,
      walletId,
      authorityRef: activeAuthorityRef,
      requestOrigin: origin,
      audience: origin,
      factorId: requireParsed(
        parseAuthFactorId(
          `email_otp:${active.authority.factor.provider}:${proof.provider_subject_id}`,
        ),
        'authorization',
      ),
      operation,
      challengeId: requireParsed(parseEmailOtpChallengeId(challengeId), 'authorization'),
      verificationReceiptDigest: await custodyDigest('seams:wallet-custody:otp-receipt:v1', {
        challengeId,
        operationFingerprintDigest,
      }),
      verifiedAtMs: recorded?.verifiedAtMs ?? nowMs,
      expiresAtMs,
    });
  }

  const ownerProof = await input.ctx.service.authorizedOperations.buildVerifiedOwnerProof({
    purpose: 'operation',
    proofId: parseVerifiedOwnerProofId(`wallet-custody:${operation.operationId}`),
    factor,
  });
  if (
    ownerProof.purpose !== 'operation' ||
    ownerProof.operation.operationFingerprintDigest !== operationFingerprintDigest
  ) {
    return toCustodyAuthorizationFailure(
      403,
      'owner_proof_rejected',
      'owner proof binding is invalid',
    );
  }
  const existing = await input.ctx.service.authorizedOperations.readAuthorizedOperation({
    tenantId: operation.tenantId,
    operationFingerprintDigest,
  });
  if (existing) {
    if (
      existing.authorization.kind !== 'verified_step_up' ||
      existing.quota.kind !== 'quota_neutral'
    ) {
      return toCustodyAuthorizationFailure(
        403,
        'owner_proof_rejected',
        'Owner operation authorization differs',
      );
    }
    return { ok: false, response: authorizedOperationReplay(existing) };
  }
  const evidenceInput = {
    operation,
    evidenceId: requireParsed(
      parseAuthorizationEvidenceId(`wallet-custody:evidence:${operation.operationId}`),
      'authorization',
    ),
    evidenceSetId,
    factor,
  };
  const evidenceSet = await buildVerifiedWalletOperationFactorEvidenceSet(evidenceInput);
  if (persistence.kind === 'prepared') {
    try {
      await input.ctx.service.authorizedOperations.commitWalletOperationEvidence({
        evidenceSet,
        consumeInBatch: persistence.consumeInBatch,
      });
    } catch (error) {
      const retry = await retryRecordedWalletOwnerOperation(input, evidenceLookup);
      if (retry) return retry;
      throw error;
    }
  }
  if (recorded) {
    if (
      recorded.evidenceSetDigest !== evidenceSet.evidenceSetDigest ||
      ownerAuthority.updatedAtMs > recorded.verifiedAtMs
    ) {
      return toCustodyAuthorizationFailure(
        403,
        'owner_proof_rejected',
        'Recorded owner proof differs',
      );
    }
  }
  return {
    ok: true,
    ownerAuthority,
    operation: {
      tenantId: operation.tenantId,
      authorizedOperationId: walletOwnerOperationAuthorizationId(input.operation, challengeDigest),
      auditEventId: requireParsed(
        parseAuthorizationAuditEventId(`wallet-custody:audit:${operation.operationId}`),
        'authorization',
      ),
      operation,
      authorization: { kind: 'verified_step_up', evidenceSetDigest: evidenceSet.evidenceSetDigest },
      quota: { kind: 'quota_neutral' },
      claimedAtMs: nowMs,
    },
  };
}

// A competing request can consume the factor after our evidence read, or lose its commit response.
// Retrying through the recorded path checks the proof digest, authority, and original deadline.
async function retryRecordedWalletOwnerOperation(
  input: WalletOwnerOperationRequest,
  lookup: WalletOperationEvidenceLookup,
): Promise<PreparedWalletOwnerAuthorization | null> {
  if (
    input.operation !== 'external_identity_associate' &&
    input.operation !== 'external_identity_unlink'
  )
    return null;
  const recorded = await input.ctx.service.authorizedOperations.readWalletOperationEvidence(lookup);
  return recorded ? prepareWalletOwnerOperation(input) : null;
}

export async function authorizeWalletOwnerOperation(
  input: WalletOwnerOperationRequest,
): Promise<WalletOwnerAuthorizationResult> {
  const prepared = await prepareWalletOwnerOperation(input);
  if (!prepared.ok) return prepared;
  const admission = await input.ctx.service.authorizedOperations.admitAuthorizedOperation({
    operation: prepared.operation,
  });
  switch (admission.kind) {
    case 'claimed':
      return { ok: true, operation: admission.operation, ownerAuthority: prepared.ownerAuthority };
    case 'replayed':
    case 'operation_in_progress':
      return { ok: false, response: authorizedOperationReplay(admission.operation) };
    case 'billing_credit_exhausted':
      return toCustodyAuthorizationFailure(
        402,
        'billing_credit_exhausted',
        'The application has no available signing credit',
      );
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
    case 'wallet_session_quota_exhausted':
    case 'material_mismatch':
      return toCustodyAuthorizationFailure(403, 'owner_proof_rejected', 'owner proof was rejected');
  }
}

function toCustodyAuthorizationFailure(
  status: number,
  code: string,
  message: string,
): { readonly ok: false; readonly response: Response } {
  return { ok: false, response: routeErrorResponse(status, code, message) };
}

function routeErrorResponse(status: number, code: string, message: string): Response {
  return toFetchRouteResponse({ status, body: { ok: false, code, message } });
}

function authorizedOperationReplay(operation: AuthorizedOperation): Response {
  if (operation.lifecycle !== 'completed') {
    return routeErrorResponse(409, 'recovery_in_progress', 'wallet recovery is still in progress');
  }
  return new Response(operation.response.bodyText, {
    status: operation.response.status,
    headers: { 'content-type': operation.response.contentType },
  });
}

export async function completeWalletOwnerOperation(
  ctx: FetchRouterApiContext,
  operation: AuthorizedOperation,
  status: number,
  body: Record<string, unknown>,
  result: 'succeeded' | 'failed_before_side_effect' = 'succeeded',
): Promise<Response> {
  const bodyText = JSON.stringify(body);
  await ctx.service.authorizedOperations.completeAuthorizedOperation({
    operation,
    result,
    response: { status, contentType: 'application/json', bodyText },
    completedAtMs: Date.now(),
  });
  return toFetchRouteResponse({ status, body });
}
