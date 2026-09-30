// The factor Device 2 is linked with: its target preparation, the Passkey and Email OTP
// activation states, and the factor secrets post-link activation needs.
import type { DeviceLinkingWebContext } from '@/SeamsWeb/signingSurface/types';
import type {
  LinkedDeviceTargetCredentialRegistrationResultV1,
  LinkSessionStateV1,
  LinkSessionTransportEventV1,
  LinkedDeviceTargetPreparationV1,
  LinkedDevicePasskeyCreationOptionsV1,
  LinkedDeviceEmailOtpChallengeResultV1,
  ActiveWalletSessionV1,
  OrdinarySignerMaterialRecipientRequestV1,
} from '@shared/device-linking';
import type { WalletEmailOtpEnrollmentMaterialV1 } from '@shared/utils/registrationAuthMethodInput';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { DeviceLinkingEd25519ExportRootRecipientHandleV1 } from './deviceLinkingEd25519ExportRoot';
import type { WebAuthnRpId } from '@shared/utils/domainIds';
import { parsePasskeyEnvelopeId, type PasskeyEnvelopeId } from '@shared/utils/domainIds';

export type AwaitingTargetFactorStateV1 = Extract<
  LinkSessionStateV1,
  { readonly state: 'awaiting_target_factor' }
>;
export type AwaitingTargetPasskeyStateV1 = Extract<
  AwaitingTargetFactorStateV1,
  { readonly state: 'awaiting_target_factor' }
>;
export type AwaitingTargetEmailOtpStateV1 = Extract<
  AwaitingTargetFactorStateV1,
  { readonly state: 'awaiting_target_factor' }
>;
export type PasskeyTargetPreparationV1 = Extract<
  LinkedDeviceTargetPreparationV1,
  {
    readonly targetFactor: { readonly kind: 'passkey_prf' };
    readonly passkeyCreationOptions: LinkedDevicePasskeyCreationOptionsV1;
  }
>;
type EmailOtpTargetPreparationV1 = Extract<
  LinkedDeviceTargetPreparationV1,
  { readonly targetFactor: { readonly kind: 'email_otp' } }
>;

export function isPasskeyTargetPreparation(
  preparation: LinkedDeviceTargetPreparationV1,
): preparation is PasskeyTargetPreparationV1 {
  return preparation.targetFactor.kind === 'passkey_prf';
}

export function isEmailOtpTargetPreparation(
  preparation: LinkedDeviceTargetPreparationV1,
): preparation is EmailOtpTargetPreparationV1 {
  return preparation.targetFactor.kind === 'email_otp';
}

export type TargetCredentialActivationState =
  | {
      readonly kind: 'idle';
    }
  | {
      readonly kind: 'in_progress';
      readonly runEpoch: number;
      readonly promise: Promise<void>;
    }
  | {
      readonly kind: 'factor_ready';
      readonly runEpoch: number;
      readonly factorSecret: Uint8Array;
    };

export type EmailOtpTargetActivationBaseContextV1 = {
  readonly event: LinkSessionTransportEventV1;
  readonly state: AwaitingTargetEmailOtpStateV1;
  readonly runEpoch: number;
  readonly deviceId: import('@shared/signing-lanes/ids').LinkedDeviceId;
  readonly preparation: EmailOtpTargetPreparationV1;
  readonly ordinarySignerMaterialRecipientRequests: readonly [
    OrdinarySignerMaterialRecipientRequestV1,
    ...OrdinarySignerMaterialRecipientRequestV1[],
  ];
  readonly exportRoot:
    | {
        readonly kind: 'required';
        readonly recipient: DeviceLinkingEd25519ExportRootRecipientHandleV1;
      }
    | {
        readonly kind: 'not_required';
        readonly recipient?: never;
      };
};

export type EmailOtpTargetActivationContextV1 = EmailOtpTargetActivationBaseContextV1 & {
  readonly challenge: LinkedDeviceEmailOtpChallengeResultV1;
};

export function emailOtpTargetActivationBaseContextV1(
  context: EmailOtpTargetActivationBaseContextV1,
): EmailOtpTargetActivationBaseContextV1 {
  return {
    event: context.event,
    state: context.state,
    runEpoch: context.runEpoch,
    deviceId: context.deviceId,
    preparation: context.preparation,
    ordinarySignerMaterialRecipientRequests: context.ordinarySignerMaterialRecipientRequests,
    exportRoot: context.exportRoot,
  };
}

export type EmailOtpTargetActivationStateV1 =
  | { readonly kind: 'idle' }
  | { readonly kind: 'available'; readonly context: EmailOtpTargetActivationBaseContextV1 }
  | {
      readonly kind: 'starting';
      readonly context: EmailOtpTargetActivationBaseContextV1;
      readonly promise: Promise<void>;
    }
  | { readonly kind: 'awaiting_code'; readonly context: EmailOtpTargetActivationContextV1 }
  | {
      readonly kind: 'resending';
      readonly context: EmailOtpTargetActivationContextV1;
      readonly promise: Promise<void>;
    }
  | {
      readonly kind: 'submitting';
      readonly context: EmailOtpTargetActivationContextV1;
      readonly promise: Promise<void>;
    }
  | { readonly kind: 'failed'; readonly runEpoch: number; readonly message: string }
  | {
      readonly kind: 'completed';
      readonly runEpoch: number;
      readonly enrollment:
        | { readonly kind: 'existing_enrollment' }
        | { readonly kind: 'new_enrollment' };
      readonly factorSecret: Uint8Array;
      readonly providerUserId: string;
      readonly exportRootRequirement?: never;
      readonly verificationGrant?: never;
      readonly factorRelease?: never;
    };

type CompletedEmailOtpTargetActivationStateV1 = Extract<
  EmailOtpTargetActivationStateV1,
  { readonly kind: 'completed' }
>;

export function requireCompletedEmailOtpTargetActivationStateV1(
  state: EmailOtpTargetActivationStateV1,
): CompletedEmailOtpTargetActivationStateV1 {
  if (
    state.kind !== 'completed' ||
    !state.factorSecret ||
    typeof state.providerUserId !== 'string'
  ) {
    throw new Error('linked-device Email OTP factor runtime is unavailable');
  }
  return {
    kind: 'completed',
    runEpoch: state.runEpoch,
    enrollment: state.enrollment,
    factorSecret: state.factorSecret,
    providerUserId: state.providerUserId,
  };
}

export function assertNeverEmailOtpTargetActivationState(value: never): never {
  throw new Error(`Unknown Email OTP target activation state: ${String(value)}`);
}

export function assertNeverTargetCredentialActivationState(value: never): never {
  throw new Error(`Unknown target credential activation state: ${String(value)}`);
}

type PostLinkActivationV1 =
  | {
      readonly factor: {
        readonly kind: 'passkey';
        readonly walletId: ActiveWalletSessionV1['walletId'];
      };
      readonly factorSecret32: Uint8Array;
    }
  | {
      readonly factor: {
        readonly kind: 'email_otp';
        readonly walletId: ActiveWalletSessionV1['walletId'];
        readonly walletAuthMethodId: LinkedDeviceTargetCredentialRegistrationResultV1['walletAuthMethodId'];
        readonly emailHashHex: string;
        readonly providerIdentity: {
          readonly provider: 'google' | 'email';
          readonly providerSubjectId: string;
        };
      };
      readonly factorSecret32: Uint8Array;
    };

export function resolvePostLinkActivationV1(input: {
  readonly targetFactor: LinkedDeviceTargetCredentialRegistrationResultV1['targetFactor'];
  readonly walletAuthMethodId: LinkedDeviceTargetCredentialRegistrationResultV1['walletAuthMethodId'];
  readonly targetCredentialActivationState: TargetCredentialActivationState;
  readonly emailOtpTargetActivationState: EmailOtpTargetActivationStateV1;
  readonly walletId: ActiveWalletSessionV1['walletId'];
  readonly runEpoch: number;
}): PostLinkActivationV1 {
  switch (input.targetFactor.kind) {
    case 'verified_passkey_target_v1': {
      const activation = input.targetCredentialActivationState;
      if (activation.kind !== 'factor_ready' || activation.runEpoch !== input.runEpoch) {
        throw new Error('linked-device Passkey factor runtime is unavailable');
      }
      return {
        factor: {
          kind: 'passkey',
          walletId: input.walletId,
        },
        factorSecret32: activation.factorSecret,
      };
    }
    case 'verified_email_otp_target_v1': {
      const activation = requireCompletedEmailOtpTargetActivationStateV1(
        input.emailOtpTargetActivationState,
      );
      if (activation.runEpoch !== input.runEpoch) {
        throw new Error('linked-device Email OTP factor runtime is unavailable');
      }
      return {
        factor: {
          kind: 'email_otp',
          walletId: input.walletId,
          walletAuthMethodId: input.walletAuthMethodId,
          emailHashHex: input.targetFactor.authMethod.emailHashHex,
          providerIdentity: {
            provider: emailOtpProviderForLinkedEnrollment(activation.enrollment),
            providerSubjectId: activation.providerUserId,
          },
        },
        factorSecret32: activation.factorSecret,
      };
    }
    default:
      return assertNeverVerifiedTargetFactor(input.targetFactor);
  }
}

function assertNeverVerifiedTargetFactor(value: never): never {
  throw new Error(`Unknown verified target factor kind: ${String(value)}`);
}

export function zeroizeLiveBytes(value: Uint8Array): void {
  if (value.byteLength > 0) value.fill(0);
}

function emailOtpProviderForLinkedEnrollment(
  enrollment: CompletedEmailOtpTargetActivationStateV1['enrollment'],
): 'google' | 'email' {
  return enrollment.kind === 'existing_enrollment' ? 'google' : 'email';
}

export function requireTargetRpIdV1(preparation: PasskeyTargetPreparationV1): WebAuthnRpId {
  return preparation.passkeyCreationOptions.rpId;
}

export function requireEmailOtpTargetPreparationV1(
  preparation: LinkedDeviceTargetPreparationV1,
): EmailOtpTargetPreparationV1 {
  if (!isEmailOtpTargetPreparation(preparation)) {
    throw new Error('linked-device Email OTP preparation is unavailable');
  }
  return preparation;
}

export function createExportRootEnvelopeIdV1(): PasskeyEnvelopeId {
  const parsed = parsePasskeyEnvelopeId(
    secureRandomId('linked-device-ed25519-export-root-envelope', 24, 'export-root envelope ids'),
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function createEmailOtpFactorSecretV1(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function prepareNewEmailOtpEnrollmentMaterialV1(input: {
  readonly context: DeviceLinkingWebContext;
  readonly walletId: EmailOtpTargetPreparationV1['walletId'];
  readonly targetEmail: EmailOtpTargetPreparationV1['targetEmail'];
  readonly factorSecret: Uint8Array;
}): Promise<{
  readonly enrollmentId: string;
  readonly enrollment: WalletEmailOtpEnrollmentMaterialV1;
}> {
  const disposableSecret = input.factorSecret.slice();
  try {
    const material =
      await input.context.signingEngine.prepareEmailOtpRegistrationEnrollmentMaterialInternal({
        relayUrl: String(input.context.configs.network.relayer.url || '').trim(),
        walletId: input.walletId,
        userId: input.targetEmail,
        clientSecret32: disposableSecret,
      });
    if (material.emailOtpSessionHandle.kind !== 'not_requested') {
      throw new Error('Strict linked-device Email OTP enrollment received obsolete ECDSA material');
    }
    return {
      enrollmentId: material.enrollmentId,
      enrollment: material.emailOtpEnrollment,
    };
  } finally {
    zeroizeLiveBytes(disposableSecret);
  }
}

export function requireNewEmailOtpEnrollmentMaterialV1(
  value: WalletEmailOtpEnrollmentMaterialV1 | null,
): WalletEmailOtpEnrollmentMaterialV1 {
  if (!value) {
    throw new Error('new linked-device Email OTP enrollment material is unavailable');
  }
  return value;
}
