import type { CapabilityOperationEnvelope } from '@shared/authorization/operationFingerprint';
import { parseAuthFactorId } from '@shared/authorization/capabilityKinds';
import {
  parseEmailOtpChallengeId,
  parseOrgId,
  parseProviderSubject,
  type WalletId,
} from '@shared/utils/domainIds';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type { RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire } from '@shared/utils/routerAbEcdsaDerivation';
import {
  EMAIL_OTP_CHANNEL,
  WALLET_EMAIL_OTP_EXPORT_OPERATION,
  WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
} from '@shared/utils/emailOtpDomain';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  buildVerifiedWalletOperationEmailOtpFactorResult,
  buildVerifiedWalletOperationPasskeyFactorResult,
  type VerifiedWalletOperationFactorResult,
} from '../../../../authorization/factorEvidence';
import type { SessionOrigin } from '../../../../authorization/domain';
import type { WalletExecutionLaneAuthSource } from '../../../../core/signingLanes/WalletExecutionLaneProjection';
import type {
  RouterApiEmailOtpRouteService,
  RouterApiWebAuthnService,
} from '../../../framework/authServicePort';
import { hashEmailOtpOperationBinding } from '../../../domains/emailOtp/emailOtpSessionRouteHelpers';
import { json } from '../../../framework/http';

type StepUpUnseal =
  | { readonly kind: 'not_requested' }
  | { readonly kind: 'email_otp_grant'; readonly grant: string; readonly challenge_id: string };

type VerifiedStepUpFactorResult =
  | {
      readonly ok: true;
      readonly factor: VerifiedWalletOperationFactorResult;
      readonly unseal: StepUpUnseal;
    }
  | { readonly ok: false; readonly response: Response };

export async function verifyEcdsaOperationStepUpFactor(input: {
  readonly proof: RouterAbEcdsaOperationStepUpAuthorizationRequestV1Wire['proof'];
  readonly operation: CapabilityOperationEnvelope;
  readonly walletId: WalletId;
  readonly authorityRef: WalletAuthAuthorityRef;
  readonly authSource: WalletExecutionLaneAuthSource;
  readonly requestOrigin: SessionOrigin;
  readonly expectedChallenge: string;
  readonly expiresAtMs: number;
  readonly webAuthn: Pick<RouterApiWebAuthnService, 'verifyWebAuthnAuthenticationLite'>;
  readonly emailOtp: Pick<
    RouterApiEmailOtpRouteService,
    'verifyEmailOtpChallenge' | 'consumeEmailOtpGrant'
  >;
}): Promise<VerifiedStepUpFactorResult> {
  const proof = input.proof;
  switch (proof.kind) {
    case 'passkey': {
      if (
        input.authSource.kind !== 'passkey' ||
        proof.authority.factor.credentialIdB64u !== input.authSource.credentialIdB64u
      ) {
        return {
          ok: false,
          response: json(
            { ok: false, code: 'scope_mismatch', message: 'Passkey authority changed' },
            { status: 403 },
          ),
        };
      }
      const credential = proof.webauthn_authentication;
      const credentialId = String(credential.rawId || credential.id).trim();
      if (credentialId !== input.authSource.credentialIdB64u) {
        return {
          ok: false,
          response: json(
            { ok: false, code: 'unauthorized', message: 'Passkey credential changed' },
            { status: 401 },
          ),
        };
      }
      const verified = await input.webAuthn.verifyWebAuthnAuthenticationLite({
        userId: input.walletId,
        rpId: proof.authority.verifier.rpId,
        expectedChallenge: input.expectedChallenge,
        expected_origin: input.requestOrigin,
        webauthn_authentication: credential,
      });
      if (!verified.success || !verified.verified) {
        return {
          ok: false,
          response: json(
            {
              ok: false,
              code: verified.code || 'not_verified',
              message: verified.message || 'WebAuthn authentication verification failed',
            },
            { status: 401 },
          ),
        };
      }
      const assertionDigest = parseDigestB64u(
        base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(credential))),
      );
      const verifiedAtMs = Date.now();
      if (input.expiresAtMs <= verifiedAtMs) return expiredStepUpFactor();
      const factorId = parseAuthFactorId(`passkey:${input.authSource.credentialIdB64u}`);
      if (!factorId.ok) throw new Error(factorId.error.message);
      return {
        ok: true,
        factor: buildVerifiedWalletOperationPasskeyFactorResult({
          tenantId: input.operation.tenantId,
          principalId: input.operation.principalId,
          walletId: input.walletId,
          requestOrigin: input.requestOrigin,
          audience: input.requestOrigin,
          factorId: factorId.value,
          authorityRef: input.authorityRef,
          operation: input.operation,
          credentialIdB64u: proof.authority.factor.credentialIdB64u,
          assertionDigest,
          verifiedAtMs,
          expiresAtMs: input.expiresAtMs,
        }),
        unseal: { kind: 'not_requested' },
      };
    }
    case 'email_otp': {
      const isExport = input.operation.operation.operationKind === 'evm.export_key';
      const operationBinding = await hashEmailOtpOperationBinding({
        walletId: input.walletId,
        providerUserId: proof.authority.factor.providerUserId,
        orgId: input.operation.tenantId,
        operation: isExport
          ? WALLET_EMAIL_OTP_EXPORT_OPERATION
          : WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
        requestOrigin: input.requestOrigin,
        audience: input.requestOrigin,
        authorityRef: input.authorityRef,
        ...(isExport ? {} : { operationFingerprintDigest: input.operation.digests.laneDigest }),
      });
      const verified = await input.emailOtp.verifyEmailOtpChallenge({
        userId: proof.authority.factor.providerUserId,
        walletId: input.walletId,
        orgId: input.operation.tenantId,
        challengeId: proof.challenge_id,
        otpCode: proof.otp_code,
        otpChannel: EMAIL_OTP_CHANNEL,
        ownerProofBindingDigest: operationBinding,
        operation: isExport
          ? WALLET_EMAIL_OTP_EXPORT_OPERATION
          : WALLET_EMAIL_OTP_TRANSACTION_SIGN_OPERATION,
      });
      if (!verified.ok)
        return {
          ok: false,
          response: json(verified, { status: verified.code === 'invalid_body' ? 400 : 401 }),
        };
      const orgId = parseOrgId(input.operation.tenantId);
      const providerSubject = parseProviderSubject(proof.authority.factor.providerUserId);
      if (!orgId.ok) throw new Error(orgId.error.message);
      if (!providerSubject.ok) throw new Error(providerSubject.error.message);
      const consumed = isExport
        ? null
        : await input.emailOtp.consumeEmailOtpGrant({
            subject: {
              kind: 'provider_identity',
              orgId: orgId.value,
              providerSubject: providerSubject.value,
              walletId: input.walletId,
            },
            loginGrant: verified.loginGrant,
            otpChannel: EMAIL_OTP_CHANNEL,
          });
      if (consumed && !consumed.ok)
        return {
          ok: false,
          response: json(consumed, { status: consumed.code === 'invalid_body' ? 400 : 401 }),
        };
      const verifiedChallengeId = consumed?.ok ? consumed.challengeId : verified.challengeId;
      const verificationReceiptDigest = parseDigestB64u(
        base64UrlEncode(
          await sha256BytesUtf8(
            alphabetizeStringify({
              challengeId: verifiedChallengeId,
              operationFingerprint: input.expectedChallenge,
            }),
          ),
        ),
      );
      const verifiedAtMs = Date.now();
      const expiresAtMs = Math.min(input.expiresAtMs, verified.grantExpiresAtMs);
      if (expiresAtMs <= verifiedAtMs) return expiredStepUpFactor();
      const factorId = parseAuthFactorId(
        `email_otp:${proof.authority.factor.provider}:${proof.authority.factor.providerUserId}`,
      );
      const challengeId = parseEmailOtpChallengeId(verifiedChallengeId);
      if (!factorId.ok) throw new Error(factorId.error.message);
      if (!challengeId.ok) throw new Error(challengeId.error.message);
      return {
        ok: true,
        factor: buildVerifiedWalletOperationEmailOtpFactorResult({
          tenantId: input.operation.tenantId,
          principalId: input.operation.principalId,
          walletId: input.walletId,
          requestOrigin: input.requestOrigin,
          audience: input.requestOrigin,
          factorId: factorId.value,
          authorityRef: input.authorityRef,
          operation: input.operation,
          challengeId: challengeId.value,
          verificationReceiptDigest,
          verifiedAtMs,
          expiresAtMs,
        }),
        unseal: isExport
          ? {
              kind: 'email_otp_grant',
              grant: verified.loginGrant,
              challenge_id: verified.challengeId,
            }
          : { kind: 'not_requested' },
      };
    }
    default:
      proof satisfies never;
      throw new Error('Unsupported ECDSA operation step-up proof');
  }
}

function expiredStepUpFactor(): VerifiedStepUpFactorResult {
  return {
    ok: false,
    response: json(
      {
        ok: false,
        code: 'verified_step_up_rejected',
        message: 'Operation step-up authorization expired',
      },
      { status: 403 },
    ),
  };
}
