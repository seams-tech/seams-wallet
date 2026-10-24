import {
  buildCapabilityOperationEnvelope,
  buildNearMlDsa65MpcOperationRef,
  parseTenantId,
  parsePrincipalId,
  parseCapabilityId,
  parseCapabilityOperationId,
} from '@shared/authorization';
import {
  MlDsaSigningTarget,
  MlDsaTransactionIntent,
  mlDsaOwnerOperationDigests,
} from '../../../domains/signingOperations/mlDsaOwnerAdmission';
import type { CapabilityOperationEnvelope } from '@shared/authorization';
import { parseAuthFactorId } from '@shared/authorization';
import type { MlDsaSigningAuthorization } from '@shared/near/mlDsaSigningSession';
import type { MlDsaSigningFailure } from '@shared/near/mlDsaSigning';
import { sha256Utf8DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import { requireParsed } from '@shared/passkey-custody/primitives';
import type { SessionOrigin } from '../../../../authorization/domain';
import {
  buildVerifiedWalletOperationPasskeyFactorResult,
  buildVerifiedWalletOperationEmailOtpFactorResult,
} from '../../../../authorization/factorEvidence';
import type { WebAuthnAuthenticationCredential } from '../../../../core/types';
import { verifyWebAuthnAuthenticationLiteWithStore } from '../../../../core/authService/webauthn';
import { normalizeLogger } from '../../../../core/logger';
import type { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import { D1MlDsaWebAuthnVerification } from './d1MlDsaWebAuthnVerification';
import { verifyMlDsaEmailOtpApproval, type MlDsaEmailOtpServices } from './mlDsaEmailOtpApproval';
import type { MlDsaSigningRecord } from './mlDsaSigningRecord';
import type { CloudflareD1EmailOtpChallengeVerifier } from '../emailOtp/d1EmailOtpChallengeVerifier';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';

type Factor =
  | ReturnType<typeof buildVerifiedWalletOperationPasskeyFactorResult>
  | ReturnType<typeof buildVerifiedWalletOperationEmailOtpFactorResult>;
type Approval = {
  readonly kind: 'approved';
  readonly record: MlDsaSigningRecord;
  readonly factor: Factor;
  readonly evidenceId: string;
  readonly proofDigest: DigestB64u;
  readonly counter: D1MlDsaWebAuthnVerification | null;
  readonly persistence:
    | { readonly kind: 'existing' }
    | { readonly kind: 'new'; readonly consumeInBatch: readonly D1PreparedStatementLike[] };
};

export async function verifyMlDsaSigningApproval(input: {
  readonly authorization: Extract<
    MlDsaSigningAuthorization<WebAuthnAuthenticationCredential>,
    { kind: 'passkey' | 'email_otp' }
  >;
  readonly record: MlDsaSigningRecord;
  readonly operation: CapabilityOperationEnvelope;
  readonly origin: SessionOrigin;
  readonly services: MlDsaEmailOtpServices;
  readonly webAuthnStore: CloudflareD1WebAuthnStore;
  readonly challenge: DigestB64u;
  readonly verifier: Pick<CloudflareD1EmailOtpChallengeVerifier, 'verifyExistingForBatch'>;
}): Promise<Approval | MlDsaSigningFailure> {
  const { record, authorization, operation } = input;
  const actor = record.preparation.request.actor;
  if (record.phase.kind === 'session_approved')
    return refusal('The operation already belongs to a signing session');
  let counter: D1MlDsaWebAuthnVerification | null = null;
  let phase: MlDsaSigningRecord['phase'];
  let factor: Factor;
  let consumeInBatch: readonly D1PreparedStatementLike[] = [];
  let proofDigest: DigestB64u;
  if (authorization.kind === 'passkey') {
    const credential = authorization.credential;
    if (
      actor.kind !== 'passkey' ||
      credential.id !== actor.credentialIdB64u ||
      credential.rawId !== credential.id
    )
      return refusal('The signing method or credential differs');
    proofDigest = await sha256Utf8DigestB64u(alphabetizeStringify(credential));
    if (record.phase.kind === 'awaiting_approval') {
      counter = new D1MlDsaWebAuthnVerification(input.webAuthnStore);
      const verified = await verifyWebAuthnAuthenticationLiteWithStore({
        userId: record.target.identity.walletId,
        rpId: actor.rpId,
        expectedOrigin: input.origin,
        expectedChallenge: input.challenge,
        webauthnAuthentication: credential,
        authenticatorStore: counter,
        logger: normalizeLogger(),
      });
      if (!verified.success || !verified.verified) return refusal('The signing approval failed');
      phase = { kind: 'approved', verifiedAtMs: Date.now(), assertionDigest: proofDigest };
    } else {
      if (record.phase.kind !== 'approved' || record.phase.assertionDigest !== proofDigest)
        return refusal('The approved assertion changed');
      phase = record.phase;
    }
    factor = buildVerifiedWalletOperationPasskeyFactorResult({
      tenantId: record.target.tenantId,
      principalId: operation.principalId,
      walletId: record.target.identity.walletId,
      authorityRef: record.target.authority,
      requestOrigin: input.origin,
      audience: input.origin,
      factorId: requireParsed(parseAuthFactorId(`ml-dsa:${proofDigest}`), 'factorId'),
      operation,
      credentialIdB64u: actor.credentialIdB64u,
      assertionDigest: proofDigest,
      verifiedAtMs: phase.verifiedAtMs,
      expiresAtMs: record.preparation.expiresAtMs,
    });
  } else {
    if (
      actor.kind !== 'email_otp' ||
      actor.walletAuthMethodId !== record.target.authority.walletAuthMethodId
    )
      return refusal('The signing method differs');
    proofDigest = await sha256Utf8DigestB64u(alphabetizeStringify(authorization.proof));
    if (record.phase.kind === 'awaiting_approval') {
      const verified = await verifyMlDsaEmailOtpApproval({
        services: input.services,
        verifier: input.verifier,
        record,
        proof: authorization.proof,
        operation,
        expectedChallenge: input.challenge,
        origin: input.origin,
      });
      if (verified.kind !== 'verified') return verified;
      factor = verified.factor;
      consumeInBatch = verified.consumeInBatch;
      phase = {
        kind: 'email_otp_approved',
        proofDigest,
        verifiedAtMs: factor.verifiedAtMs,
        expiresAtMs: factor.expiresAtMs,
        factorId: factor.factorId,
        challengeId: factor.challengeId,
        verificationReceiptDigest: factor.verificationReceiptDigest,
      };
    } else {
      if (
        record.phase.kind !== 'email_otp_approved' ||
        record.phase.proofDigest !== proofDigest ||
        record.phase.expiresAtMs <= Date.now()
      )
        return refusal('The Email OTP approval changed or expired');
      phase = record.phase;
      factor = buildVerifiedWalletOperationEmailOtpFactorResult({
        tenantId: record.target.tenantId,
        principalId: operation.principalId,
        walletId: record.target.identity.walletId,
        authorityRef: record.target.authority,
        requestOrigin: input.origin,
        audience: input.origin,
        factorId: phase.factorId,
        operation,
        challengeId: phase.challengeId,
        verificationReceiptDigest: phase.verificationReceiptDigest,
        verifiedAtMs: phase.verifiedAtMs,
        expiresAtMs: phase.expiresAtMs,
      });
    }
  }
  return {
    kind: 'approved',
    record: {
      preparation: record.preparation,
      target: record.target,
      owner: record.owner,
      publicationVersion: record.publicationVersion,
      origin: record.origin,
      phase,
    },
    factor,
    evidenceId: `ml-dsa:${proofDigest}:${factor.verifiedAtMs}`,
    proofDigest,
    counter,
    persistence:
      record.phase.kind === 'awaiting_approval'
        ? { kind: 'new', consumeInBatch }
        : { kind: 'existing' },
  };
}
function refusal(message: string): MlDsaSigningFailure {
  return { kind: 'refused', code: 'unauthorized', message };
}

export async function operationEnvelope(
  target: MlDsaSigningTarget,
  preparation: Pick<MlDsaSigningRecord['preparation'], 'request' | 'transaction'>,
) {
  return buildCapabilityOperationEnvelope({
    tenantId: requireParsed(parseTenantId(target.tenantId), 'tenantId'),
    principalId: requireParsed(parsePrincipalId(target.identity.walletId), 'principalId'),
    capabilityId: requireParsed(parseCapabilityId(target.capabilityId), 'capabilityId'),
    operationId: requireParsed(
      parseCapabilityOperationId(`ml-dsa:${preparation.request.operationIdB64u}`),
      'operationId',
    ),
    operation: buildNearMlDsa65MpcOperationRef('near.sign_transaction'),
    digests: await mlDsaOwnerOperationDigests(
      target,
      MlDsaTransactionIntent.parse({
        transactionHash: preparation.transaction.transactionHashB64u,
      }),
      await sha256Utf8DigestB64u(preparation.transaction.displayJson),
    ),
  });
}
