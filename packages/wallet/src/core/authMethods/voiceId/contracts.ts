import type { WalletId, WalletAuthMethodId, WalletAuthorityId } from '@shared/utils/domainIds';
import type { WalletSessionId } from '@shared/authorization/capabilityKinds';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { Variant } from '@shared/utils/variant';
import type { ConfirmedVoiceChange } from './ownerConfirmation';
import type {
  VoiceIdDevicePublicKeyB64u,
  VoiceIdDeviceAssertion,
  VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
export type VoiceEnrollmentScope = Readonly<{
  walletId: WalletId;
  authorityId: WalletAuthorityId;
  walletAuthMethodId: WalletAuthMethodId;
  deviceKeyId: DigestB64u;
}>;

export type VoiceEnrollment = Readonly<{
  kind: 'browser_voiceid_enrollment_v2';
  scope: VoiceEnrollmentScope;
  model: string;
  generation: string;
  revision: number;
  baseline: readonly number[];
  adaptation:
    | {
        readonly kind: 'baseline';
        readonly samples?: never;
      }
    | {
        readonly kind: 'adapted';
        readonly samples: readonly (readonly number[])[];
      };
}>;

export type VoiceEnrollmentSnapshot =
  | { readonly kind: 'missing'; readonly enrollment?: never }
  | { readonly kind: 'present'; readonly enrollment: VoiceEnrollment };

export type VoiceOwnerGuard = Readonly<
  {
    sessionMethodId: WalletAuthMethodId;
    walletSessionId: WalletSessionId;
    lockGeneration: number;
    expiresAtMs: number;
    availabilityRevision: string;
  } & (
    | { target: 'activating'; confirmationMethodId?: never }
    | { target: 'enrolled'; confirmationMethodId: WalletAuthMethodId }
  )
>;

export type VoiceChangeGuard = Variant<VoiceOwnerGuard, 'target', 'enrolled'>;
export type VoiceActivationGuard = Variant<VoiceOwnerGuard, 'target', 'activating'>;

export type VoiceEnrollmentChangeIntent = Readonly<{ guard: VoiceChangeGuard }> &
  (
    | {
        readonly kind: 'import';
        readonly snapshot: Variant<VoiceEnrollmentSnapshot, 'kind', 'missing'>;
      }
    | { readonly kind: 'replace'; readonly snapshot: VoiceEnrollmentSnapshot }
    | {
        readonly kind: 'improve';
        readonly snapshot: Variant<VoiceEnrollmentSnapshot, 'kind', 'present'>;
      }
    | {
        readonly kind: 'reset';
        readonly snapshot: Variant<VoiceEnrollmentSnapshot, 'kind', 'present'>;
      }
  );

export type VoiceEnrollmentConfirmationRequest = VoiceEnrollmentChangeIntent &
  Readonly<{ signal: AbortSignal }>;

export type VoiceEnrollmentAuthorization =
  | {
      readonly kind: 'activate';
      readonly guard: VoiceActivationGuard;
      readonly snapshot: Variant<VoiceEnrollmentSnapshot, 'kind', 'missing'>;
      readonly confirmation?: never;
    }
  | (VoiceEnrollmentChangeIntent & Readonly<{ confirmation: ConfirmedVoiceChange }>);

export type VoiceEnrollmentChange = Readonly<{
  scope: VoiceEnrollmentScope;
  signal: AbortSignal;
  next?: never;
}> &
  (
    | (Variant<VoiceEnrollmentAuthorization, 'kind', 'activate' | 'replace' | 'import'> & {
        readonly baseline: readonly number[];
        readonly samples?: never;
      })
    | (Variant<VoiceEnrollmentAuthorization, 'kind', 'improve'> & {
        readonly samples: readonly (readonly number[])[];
        readonly baseline?: never;
      })
    | (Variant<VoiceEnrollmentAuthorization, 'kind', 'reset'> & {
        readonly baseline?: never;
        readonly samples?: never;
      })
  );

export type VoiceTemplateAccess =
  | { readonly kind: 'active'; readonly scope: VoiceEnrollmentScope; readonly owner?: never }
  | {
      readonly kind: 'activation';
      readonly scope: VoiceEnrollmentScope;
      readonly owner: VoiceActivationGuard;
    };

export type VoiceIdActivationCapture = (input: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly signal: AbortSignal;
}) => Promise<{
  kind: 'activated';
  publicKeyB64u: VoiceIdDevicePublicKeyB64u;
  deviceKeyId: DigestB64u;
  factorSecret32: Uint8Array;
}>;

export type VoiceIdUnlockCapture = (input: {
  readonly challenge: VoiceIdWalletSessionChallenge;
  readonly signal: AbortSignal;
}) => Promise<{ kind: 'unlocked'; assertion: VoiceIdDeviceAssertion; factorSecret32: Uint8Array }>;
