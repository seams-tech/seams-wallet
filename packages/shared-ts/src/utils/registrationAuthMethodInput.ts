// The auth methods a registration or add-auth-method request names, the Email OTP proof
// that backs one, and the verified registration authority; normalized from untrusted input.
import {
  type ChallengeSubjectId,
  type EmailOtpChallengeId,
  type OrgId,
  parseWebAuthnRpId,
  type ProviderSubject,
  type WalletId,
  type WebAuthnRpId,
} from './domainIds';
import type { WebAuthnAuthenticatorDeviceInfo } from './webauthnDeviceInfo';
import type { ExclusiveUnion } from './variant';

export type RegisterWalletInput =
  | {
      kind: 'server_allocated';
      walletId?: never;
    }
  | {
      kind: 'provided';
      walletId: WalletId;
    };

export type PasskeyRegistrationAuthMethodInput = {
  kind: 'passkey';
  rpId: WebAuthnRpId;
  authenticatorOptions?: unknown;
  email?: never;
  otpCode?: never;
  challengeId?: never;
};

export type EmailOtpRegistrationAuthMethodInput =
  | {
      kind: 'email_otp';
      proofKind: 'otp_challenge';
      email: string;
      providerSubject: string;
      otpCode: string;
      challengeId?: string;
      rpId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
      authenticatorOptions?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'google_sso_registration';
      email: string;
      providerSubject: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      rpId?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    };

export type RegistrationAuthMethodInput =
  | PasskeyRegistrationAuthMethodInput
  | EmailOtpRegistrationAuthMethodInput;

export type AddAuthMethodInput =
  | {
      kind: 'passkey';
      rpId: WebAuthnRpId;
      email?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    }
  | {
      kind: 'email_otp';
      email: string;
      rpId?: never;
      otpCode?: never;
      challengeId?: never;
      authenticatorOptions?: never;
    };

export type RegistrationAuthority =
  | {
      kind: 'passkey';
      walletId: WalletId;
      rpId: WebAuthnRpId;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
      counter: number;
      /** Device metadata captured at registration verification (UA + attestation). */
      device: WebAuthnAuthenticatorDeviceInfo;
      registrationIntentDigestB64u: string;
      providerSubject?: never;
      challengeSubjectId?: never;
      email?: never;
      emailHashHex?: never;
      registrationAuthorityId?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      originalWalletId?: never;
      finalWalletId?: never;
      orgId?: never;
      challengePurpose?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'otp_challenge';
      walletId: WalletId;
      /** OIDC provider subject verified for the OTP registration proof. */
      providerSubject: ProviderSubject;
      /** Challenge owner verified against the OTP challenge record. */
      challengeSubjectId: ChallengeSubjectId;
      /** Normalized email address that received and verified the OTP. */
      email: string;
      emailHashHex: string;
      challengeId: EmailOtpChallengeId;
      registrationAuthorityId: EmailOtpChallengeId;
      /** Wallet id attached to the original OTP challenge before any name reroll. */
      originalWalletId: WalletId;
      /** Final wallet id selected for registration. */
      finalWalletId: WalletId;
      /** Tenant scope verified against the OTP challenge record. */
      orgId: OrgId;
      /** Operation-bound owner proof digest verified against the OTP challenge record. */
      ownerProofBindingDigest: string;
      challengePurpose: 'registration' | 'registration_reroll';
      registrationIntentDigestB64u: string;
      credentialIdB64u?: never;
      credentialPublicKeyB64u?: never;
      counter?: never;
      device?: never;
      rpId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      proofKind: 'google_sso_registration';
      walletId: WalletId;
      providerSubject: ProviderSubject;
      email: string;
      emailHashHex: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      registrationAuthorityId: string;
      finalWalletId: WalletId;
      orgId: OrgId;
      ownerProofBindingDigest: string;
      registrationIntentDigestB64u: string;
      challengeSubjectId?: never;
      challengeId?: never;
      originalWalletId?: never;
      challengePurpose?: never;
      credentialIdB64u?: never;
      credentialPublicKeyB64u?: never;
      counter?: never;
      device?: never;
      rpId?: never;
    };

export type EmailOtpRegistrationProof = ExclusiveUnion<
  | {
      version: 'email_otp_registration_proof_v1';
      proofKind: 'otp_challenge';
      providerSubject: string;
      /** Normalized email address that received the OTP. */
      email: string;
      challengeId: string;
      otpCode: string;
      otpChannel: 'email_otp';
      /** Registration intent digest that binds the OTP proof to the wallet-registration request. */
      registrationIntentDigestB64u: string;
    }
  | {
      version: 'email_otp_registration_proof_v1';
      proofKind: 'google_sso_registration';
      providerSubject: string;
      email: string;
      googleEmailOtpRegistrationAttemptId: string;
      googleEmailOtpRegistrationOfferId: string;
      googleEmailOtpRegistrationCandidateId: string;
      registrationIntentDigestB64u: string;
    }
>;

export function inspectRawObject(value: unknown): object | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRegistrationAuthMethodInput(
  raw: unknown,
): RegistrationAuthMethodInput | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  if (kind === 'passkey') {
    const rpId = parseWebAuthnRpId('rpId' in record ? record.rpId : undefined);
    if (
      !rpId.ok ||
      Object.prototype.hasOwnProperty.call(record, 'email') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId')
    ) {
      return null;
    }
    return {
      kind: 'passkey',
      rpId: rpId.value,
      ...('authenticatorOptions' in record && record.authenticatorOptions !== undefined
        ? { authenticatorOptions: record.authenticatorOptions }
        : {}),
    };
  }
  if (kind === 'email_otp') {
    const proofKind = trimString('proofKind' in record ? record.proofKind : undefined);
    const email = trimString('email' in record ? record.email : undefined);
    const providerSubject = trimString(
      'providerSubject' in record ? record.providerSubject : undefined,
    );
    if (
      !email ||
      !providerSubject ||
      Object.prototype.hasOwnProperty.call(record, 'rpId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    if (proofKind === 'otp_challenge') {
      const otpCode = trimString('otpCode' in record ? record.otpCode : undefined);
      const challengeId = trimString('challengeId' in record ? record.challengeId : undefined);
      if (
        !otpCode ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationAttemptId') ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationOfferId') ||
        Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationCandidateId')
      ) {
        return null;
      }
      return {
        kind: 'email_otp',
        proofKind: 'otp_challenge',
        email,
        providerSubject,
        otpCode,
        ...(challengeId ? { challengeId } : {}),
      };
    }
    if (proofKind === 'google_sso_registration') {
      const googleEmailOtpRegistrationAttemptId = trimString(
        'googleEmailOtpRegistrationAttemptId' in record
          ? record.googleEmailOtpRegistrationAttemptId
          : undefined,
      );
      const googleEmailOtpRegistrationOfferId = trimString(
        'googleEmailOtpRegistrationOfferId' in record
          ? record.googleEmailOtpRegistrationOfferId
          : undefined,
      );
      const googleEmailOtpRegistrationCandidateId = trimString(
        'googleEmailOtpRegistrationCandidateId' in record
          ? record.googleEmailOtpRegistrationCandidateId
          : undefined,
      );
      if (
        !googleEmailOtpRegistrationAttemptId ||
        !googleEmailOtpRegistrationOfferId ||
        !googleEmailOtpRegistrationCandidateId ||
        Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
        Object.prototype.hasOwnProperty.call(record, 'challengeId')
      ) {
        return null;
      }
      return {
        kind: 'email_otp',
        proofKind: 'google_sso_registration',
        email,
        providerSubject,
        googleEmailOtpRegistrationAttemptId,
        googleEmailOtpRegistrationOfferId,
        googleEmailOtpRegistrationCandidateId,
      };
    }
    return null;
  }
  return null;
}

export function normalizeAddAuthMethodInput(raw: unknown): AddAuthMethodInput | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  if (kind === 'passkey') {
    const rpId = parseWebAuthnRpId('rpId' in record ? record.rpId : undefined);
    if (
      !rpId.ok ||
      Object.prototype.hasOwnProperty.call(record, 'email') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    return { kind: 'passkey', rpId: rpId.value };
  }
  if (kind === 'email_otp') {
    const email = trimString('email' in record ? record.email : undefined);
    if (
      !email ||
      Object.prototype.hasOwnProperty.call(record, 'rpId') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'authenticatorOptions')
    ) {
      return null;
    }
    return {
      kind: 'email_otp',
      email,
    };
  }
  return null;
}

export function normalizeEmailOtpRegistrationProof(raw: unknown): EmailOtpRegistrationProof | null {
  const record = inspectRawObject(raw);
  if (!record) return null;
  const version = trimString('version' in record ? record.version : undefined);
  const proofKind = trimString('proofKind' in record ? record.proofKind : undefined);
  const providerSubject = trimString(
    'providerSubject' in record ? record.providerSubject : undefined,
  );
  const email = trimString('email' in record ? record.email : undefined).toLowerCase();
  const registrationIntentDigestB64u = trimString(
    'registrationIntentDigestB64u' in record ? record.registrationIntentDigestB64u : undefined,
  );
  if (
    version !== 'email_otp_registration_proof_v1' ||
    !providerSubject ||
    !email ||
    !registrationIntentDigestB64u
  ) {
    return null;
  }
  if (proofKind === 'otp_challenge') {
    const challengeId = trimString('challengeId' in record ? record.challengeId : undefined);
    const otpCode = trimString('otpCode' in record ? record.otpCode : undefined);
    const otpChannel = trimString('otpChannel' in record ? record.otpChannel : undefined);
    if (
      !challengeId ||
      !otpCode ||
      otpChannel !== 'email_otp' ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationAttemptId') ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationOfferId') ||
      Object.prototype.hasOwnProperty.call(record, 'googleEmailOtpRegistrationCandidateId')
    ) {
      return null;
    }
    return {
      version: 'email_otp_registration_proof_v1',
      proofKind: 'otp_challenge',
      providerSubject,
      email,
      challengeId,
      otpCode,
      otpChannel: 'email_otp',
      registrationIntentDigestB64u,
    };
  }
  if (proofKind === 'google_sso_registration') {
    const googleEmailOtpRegistrationAttemptId = trimString(
      'googleEmailOtpRegistrationAttemptId' in record
        ? record.googleEmailOtpRegistrationAttemptId
        : undefined,
    );
    const googleEmailOtpRegistrationOfferId = trimString(
      'googleEmailOtpRegistrationOfferId' in record
        ? record.googleEmailOtpRegistrationOfferId
        : undefined,
    );
    const googleEmailOtpRegistrationCandidateId = trimString(
      'googleEmailOtpRegistrationCandidateId' in record
        ? record.googleEmailOtpRegistrationCandidateId
        : undefined,
    );
    if (
      !googleEmailOtpRegistrationAttemptId ||
      !googleEmailOtpRegistrationOfferId ||
      !googleEmailOtpRegistrationCandidateId ||
      Object.prototype.hasOwnProperty.call(record, 'challengeId') ||
      Object.prototype.hasOwnProperty.call(record, 'otpCode') ||
      Object.prototype.hasOwnProperty.call(record, 'otpChannel')
    ) {
      return null;
    }
    return {
      version: 'email_otp_registration_proof_v1',
      proofKind: 'google_sso_registration',
      providerSubject,
      email,
      googleEmailOtpRegistrationAttemptId,
      googleEmailOtpRegistrationOfferId,
      googleEmailOtpRegistrationCandidateId,
      registrationIntentDigestB64u,
    };
  }
  return null;
}

/** What a client sends to create a wallet's shared Email OTP enrollment. */
export type WalletEmailOtpEnrollmentMaterialV1 = {
  enrollmentSealKeyVersion: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
};

export type WalletAddAuthMethodEmailOtpTargetV1 =
  | { readonly kind: 'existing_enrollment'; readonly enrollment?: never }
  | {
      readonly kind: 'new_enrollment';
      readonly enrollment: WalletEmailOtpEnrollmentMaterialV1;
    };
