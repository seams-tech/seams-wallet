import {
  EMAIL_OTP_INITIAL_ENROLLMENT_VERSION,
  emailOtpDeviceEnrollmentId,
} from '@shared/utils/emailOtpDomain';
import type { WalletId } from '@shared/utils/registrationIntent';
import type { RegistrationAuthority } from '@shared/utils/registrationAuthMethodInput';
import { toOptionalTrimmedString } from '@shared/utils/validation';
import { failure } from '@shared/utils/failure';
import {
  EMAIL_OTP_ENROLLMENT_FACTOR_LIMIT,
  type EmailOtpAuthStateRecord,
  type EmailOtpEnrollmentFactorRecord,
  type EmailOtpWalletEnrollmentRecord,
} from '../../../../core/EmailOtpStores';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import { validateSecp256k1PublicKey33 } from '../../../../core/ThresholdService/evmCryptoWasm';
import type { CloudflareD1EmailOtpEnrollmentStore } from './d1EmailOtpEnrollmentStore';
import type { CloudflareD1GoogleEmailOtpSessionResolver } from './d1GoogleEmailOtpSessionResolver';
import {
  validateEmailOtpEnrollmentMaterial,
  type EmailOtpEnrollmentMaterialBoundaryInput,
} from './d1EmailOtpRecords';

type D1EmailOtpRegistrationEnrollmentPersistence = {
  readonly enrollment: EmailOtpWalletEnrollmentRecord;
  readonly existingAuthState: EmailOtpAuthStateRecord | null;
};

export type D1EmailOtpRegistrationCommitPlan = {
  readonly kind: 'd1_email_otp_registration_commit_plan_v1';
  readonly statements: readonly D1PreparedStatementLike[];
};

type EnrollmentResult =
  | { readonly ok: true; readonly persistence?: D1EmailOtpRegistrationEnrollmentPersistence }
  | { readonly ok: false; readonly code: string; readonly message: string };

type BuildResult =
  | { readonly ok: true; readonly persistence: D1EmailOtpRegistrationEnrollmentPersistence }
  | { readonly ok: false; readonly code: string; readonly message: string };

function parseEmailOtpEnrollmentMaterialBoundaryInput(
  value: unknown,
): EmailOtpEnrollmentMaterialBoundaryInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) =>
        key !== 'enrollmentSealKeyVersion' &&
        key !== 'clientUnlockPublicKeyB64u' &&
        key !== 'unlockKeyVersion' &&
        key !== 'factorNonceB64u' &&
        key !== 'wrappedFactorB64u',
    )
  ) {
    return null;
  }
  return {
    enrollmentSealKeyVersion: Reflect.get(value, 'enrollmentSealKeyVersion'),
    clientUnlockPublicKeyB64u: Reflect.get(value, 'clientUnlockPublicKeyB64u'),
    unlockKeyVersion: Reflect.get(value, 'unlockKeyVersion'),
    factorNonceB64u: Reflect.get(value, 'factorNonceB64u'),
    wrappedFactorB64u: Reflect.get(value, 'wrappedFactorB64u'),
  };
}

export class CloudflareD1EmailOtpRegistrationEnrollmentFinalizer {
  private readonly emailOtpEnrollments: CloudflareD1EmailOtpEnrollmentStore;
  private readonly googleEmailOtpSessions: CloudflareD1GoogleEmailOtpSessionResolver;

  constructor(input: {
    readonly emailOtpEnrollments: CloudflareD1EmailOtpEnrollmentStore;
    readonly googleEmailOtpSessions: CloudflareD1GoogleEmailOtpSessionResolver;
  }) {
    this.emailOtpEnrollments = input.emailOtpEnrollments;
    this.googleEmailOtpSessions = input.googleEmailOtpSessions;
  }

  async prepareRegistrationFinalize(input: {
    readonly authority: RegistrationAuthority;
    readonly request: { readonly emailOtpEnrollment?: unknown };
    readonly walletId: WalletId;
    /** The Email OTP method that this registration creates; it names the first factor. */
    readonly walletAuthMethodId: string;
    readonly orgId: string;
    readonly nowMs: number;
  }): Promise<EnrollmentResult> {
    if (input.authority.kind !== 'email_otp') {
      return input.request.emailOtpEnrollment
        ? failure(
            'invalid_body',
            'Email OTP enrollment material is only valid for Email OTP registration',
          )
        : { ok: true };
    }
    if (!input.request.emailOtpEnrollment) {
      return failure('invalid_body', 'Email OTP registration finalize requires emailOtpEnrollment');
    }
    if (
      input.authority.walletId !== input.walletId ||
      input.authority.finalWalletId !== input.walletId ||
      input.authority.orgId !== input.orgId
    ) {
      return failure(
        'authority_binding_mismatch',
        'Email OTP registration authority does not match finalize scope',
      );
    }
    const material = parseEmailOtpEnrollmentMaterialBoundaryInput(input.request.emailOtpEnrollment);
    if (!material) {
      return failure(
        'invalid_body',
        'Email OTP enrollment material must be an object with the expected fields',
      );
    }
    return await this.buildPersistence({
      walletId: input.walletId,
      walletAuthMethodId: input.walletAuthMethodId,
      orgId: input.orgId,
      authSubjectId: input.authority.providerSubject,
      verifiedEmail: input.authority.email,
      material,
      nowMs: input.nowMs,
    });
  }

  prepareRegistrationCommitPlan(
    persistence: D1EmailOtpRegistrationEnrollmentPersistence,
  ): D1EmailOtpRegistrationCommitPlan {
    const statements: D1PreparedStatementLike[] = [
      this.emailOtpEnrollments.preparePutEnrollmentStatement(persistence.enrollment),
      this.emailOtpEnrollments.prepareResetAuthStateForEnrollment({
        enrollment: persistence.enrollment,
        existingState: persistence.existingAuthState,
        updatedAtMs: persistence.enrollment.updatedAtMs,
      }).statement,
    ];
    return { kind: 'd1_email_otp_registration_commit_plan_v1', statements };
  }

  async completeRegistrationIdentity(input: {
    readonly authority: RegistrationAuthority;
    readonly walletId: WalletId;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }> {
    switch (input.authority.kind) {
      case 'passkey':
        return { ok: true };
      case 'email_otp':
        switch (input.authority.proofKind) {
          case 'otp_challenge':
            return { ok: true };
          case 'google_sso_registration':
            return await this.googleEmailOtpSessions.completeCommittedRegistrationAttempt({
              registrationAttemptId: input.authority.googleEmailOtpRegistrationAttemptId,
              intentDigest: input.authority.registrationIntentDigestB64u,
              walletId: input.walletId,
            });
        }
    }
  }

  /**
   * The enrollment statements for a wallet's first Email OTP method, to commit
   * in the batch that inserts that method.
   *
   * Same construction as registration's, deliberately — the shared enrollment
   * is one record whichever operation creates it, and a second builder would
   * be a second answer to what a wallet's verified email is. What differs is
   * only the batch it lands in: here it must commit or fail together with the
   * auth method and the envelope sealed against it.
   */
  async prepareAddedAuthMethodEnrollment(
    input: EnrollmentFactorInput,
  ): Promise<PreparedEnrollmentStatements> {
    const prepared = await this.buildPersistence(input);
    if (!prepared.ok) return prepared;
    return {
      ok: true,
      enrollment: prepared.persistence.enrollment,
      statements: this.prepareRegistrationCommitPlan(prepared.persistence).statements,
    };
  }

  /**
   * Prepares the first Email OTP enrollment of a wallet, for a linked or recovered device. The
   * insert is intentionally strict: a concurrent enrollment must abort the authority batch
   * instead of silently replacing material that another operation owns.
   */
  async prepareFirstEnrollment(
    input: EnrollmentFactorInput,
  ): Promise<PreparedEnrollmentStatements> {
    if (!(await this.emailOtpEnrollments.signerWalletExists(input.walletId))) {
      return failure(
        'wallet_registration_incomplete',
        'Email OTP enrollment requires a canonical wallet',
      );
    }
    if (await this.emailOtpEnrollments.readEnrollment(input.walletId)) {
      return {
        ok: false as const,
        code: 'enrollment_conflict',
        message: 'Email OTP wallet enrollment already exists',
      };
    }
    const prepared = await this.buildPersistence(input);
    if (!prepared.ok) return prepared;
    const reset = this.emailOtpEnrollments.prepareResetAuthStateForEnrollment({
      enrollment: prepared.persistence.enrollment,
      existingState: prepared.persistence.existingAuthState,
      updatedAtMs: prepared.persistence.enrollment.updatedAtMs,
    });
    return {
      ok: true,
      enrollment: prepared.persistence.enrollment,
      statements: [
        this.emailOtpEnrollments.prepareInsertEnrollmentStatement(prepared.persistence.enrollment),
        reset.statement,
      ],
    };
  }

  /**
   * Adds a factor for a new Email OTP method to the wallet's enrollment, for a device that
   * recovers the wallet or links to it. The enrollment keeps its email identity and key
   * versions, so the material must use them. The statement changes no row when the enrollment
   * changed after this read; commit it with a batch guard after it.
   */
  async prepareAddedFactor(input: EnrollmentFactorInput): Promise<PreparedEnrollmentStatements> {
    const validated = await validateEnrollmentFactorInput(input);
    if (!validated.ok) return validated;
    const existing = await this.emailOtpEnrollments.readEnrollment(validated.walletId);
    if (
      !existing ||
      existing.orgId !== validated.orgId ||
      existing.providerUserId !== validated.authSubjectId ||
      existing.verifiedEmail !== validated.verifiedEmail ||
      existing.enrollmentId !==
        emailOtpDeviceEnrollmentId(validated.walletId, validated.authSubjectId)
    ) {
      return failure(
        'enrollment_conflict',
        'The wallet has no Email OTP enrollment for this email',
      );
    }
    if (
      existing.enrollmentSealKeyVersion !== validated.material.enrollmentSealKeyVersion ||
      existing.unlockKeyVersion !== validated.material.unlockKeyVersion
    ) {
      return failure('enrollment_conflict', 'The Email OTP factor uses another key version');
    }
    if (existing.factors.length >= EMAIL_OTP_ENROLLMENT_FACTOR_LIMIT) {
      return failure(
        'enrollment_factor_limit',
        'The wallet has the maximum number of Email OTP devices. Remove one, then try again.',
      );
    }
    if (
      existing.factors.some(
        (factor) =>
          factor.walletAuthMethodId === validated.factor.walletAuthMethodId ||
          factor.factorNonceB64u === validated.factor.factorNonceB64u,
      )
    ) {
      return failure('enrollment_conflict', 'The Email OTP method already has a factor');
    }
    return {
      ok: true,
      enrollment: {
        ...existing,
        factors: [...existing.factors, validated.factor],
        updatedAtMs: Math.max(existing.updatedAtMs, input.nowMs),
      },
      statements: [
        this.emailOtpEnrollments.prepareAddMethodFactorStatement({
          expected: existing,
          factor: validated.factor,
          nowMs: input.nowMs,
        }),
      ],
    };
  }

  private async buildPersistence(input: EnrollmentFactorInput): Promise<BuildResult> {
    const validated = await validateEnrollmentFactorInput(input);
    if (!validated.ok) return validated;
    const existing = await this.emailOtpEnrollments.readEnrollment(validated.walletId);
    const existingAuthState = await this.emailOtpEnrollments.readAuthState(validated.walletId);
    const enrollment: EmailOtpWalletEnrollmentRecord = {
      version: 'email_otp_wallet_enrollment_v1',
      walletId: validated.walletId,
      providerUserId: validated.authSubjectId,
      orgId: validated.orgId,
      verifiedEmail: validated.verifiedEmail,
      enrollmentId: emailOtpDeviceEnrollmentId(validated.walletId, validated.authSubjectId),
      enrollmentVersion: EMAIL_OTP_INITIAL_ENROLLMENT_VERSION,
      enrollmentSealKeyVersion: validated.material.enrollmentSealKeyVersion,
      unlockKeyVersion: validated.material.unlockKeyVersion,
      factors: [validated.factor],
      createdAtMs: existing?.createdAtMs ?? input.nowMs,
      updatedAtMs: input.nowMs,
    };
    return {
      ok: true,
      persistence: { enrollment, existingAuthState },
    };
  }
}

type PreparedEnrollmentStatements =
  | {
      readonly ok: true;
      readonly enrollment: EmailOtpWalletEnrollmentRecord;
      readonly statements: readonly D1PreparedStatementLike[];
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

type EnrollmentFactorInput = {
  readonly walletId: string;
  /** The Email OTP method that the factor belongs to. */
  readonly walletAuthMethodId: string;
  readonly orgId: string;
  readonly authSubjectId: string;
  readonly verifiedEmail: string;
  readonly material: EmailOtpEnrollmentMaterialBoundaryInput;
  readonly nowMs: number;
};

async function validateEnrollmentFactorInput(input: EnrollmentFactorInput): Promise<
  | {
      readonly ok: true;
      readonly walletId: string;
      readonly orgId: string;
      readonly authSubjectId: string;
      readonly verifiedEmail: string;
      readonly material: {
        readonly enrollmentSealKeyVersion: string;
        readonly unlockKeyVersion: string;
      };
      readonly factor: EmailOtpEnrollmentFactorRecord;
    }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  const material = await validateEmailOtpEnrollmentMaterial({
    material: input.material,
    validateSecp256k1PublicKey33,
  });
  if (!material.ok) return material;
  const orgId = toOptionalTrimmedString(input.orgId) || '';
  const walletId = toOptionalTrimmedString(input.walletId) || '';
  const walletAuthMethodId = toOptionalTrimmedString(input.walletAuthMethodId) || '';
  const authSubjectId = toOptionalTrimmedString(input.authSubjectId) || '';
  const verifiedEmail = toOptionalTrimmedString(input.verifiedEmail)?.toLowerCase() || '';
  if (!orgId || !walletId || !walletAuthMethodId || !authSubjectId || !verifiedEmail) {
    return failure(
      'invalid_body',
      'Email OTP registration enrollment requires wallet, org, and email identity',
    );
  }
  return {
    ok: true,
    walletId,
    orgId,
    authSubjectId,
    verifiedEmail,
    material,
    factor: {
      walletAuthMethodId,
      factorNonceB64u: material.factorNonceB64u,
      wrappedFactorB64u: material.wrappedFactorB64u,
      clientUnlockPublicKeyB64u: material.clientUnlockPublicKeyB64u,
      createdAtMs: input.nowMs,
    },
  };
}
