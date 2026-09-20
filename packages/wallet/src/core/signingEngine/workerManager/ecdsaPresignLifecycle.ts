export const ECDSA_CLIENT_PRESIGNATURE_CAPACITY = 5 as const;
export const MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS = 90 * 24 * 60 * 60_000;

export type EcdsaClientPresignAdmissionStorage =
  | { readonly kind: 'sealed_indexed_db'; readonly durableRecordId: string }
  | { readonly kind: 'resident'; readonly durableRecordId?: never }
  | { readonly kind: 'discarded_capacity'; readonly durableRecordId?: never }
  | { readonly kind: 'discarded_ambiguous'; readonly durableRecordId?: never };

export type EcdsaClientPresignUnavailableReason =
  | 'claimed_elsewhere'
  | 'expired'
  | 'not_found'
  | 'binding_rejected'
  | 'corrupt'
  | 'persistence_unavailable';

export type EcdsaClientPresignReservationResult =
  | { readonly kind: 'reserved' }
  | {
      readonly kind: 'unavailable';
      readonly reason: EcdsaClientPresignUnavailableReason;
    };

export type EcdsaClientPresignCleanupTarget =
  | { readonly kind: 'wallet'; readonly walletId: string }
  | { readonly kind: 'all'; readonly walletId?: never };

export type OpaqueEcdsaPresignMaterialState =
  | {
      readonly kind: 'pending_admission';
      readonly authorityMaterialHandle: string;
      readonly storage?: never;
      readonly requestBinding?: never;
      readonly reservationId?: never;
      readonly leaseExpiresAtMs?: never;
    }
  | {
      readonly kind: 'available';
      readonly authorityMaterialHandle?: never;
      readonly requestBinding?: never;
      readonly reservationId?: never;
      readonly leaseExpiresAtMs?: never;
      readonly storage:
        | {
            readonly kind: 'resident';
            readonly authorityMaterialHandle: string;
            readonly durableRecordId?: never;
          }
        | {
            readonly kind: 'sealed_indexed_db';
            readonly durableRecordId: string;
            readonly authorityMaterialHandle?: never;
          };
    }
  | {
      readonly kind: 'reserved';
      readonly requestBinding: string;
      readonly reservationId: string;
      readonly leaseExpiresAtMs: number;
      readonly authorityMaterialHandle: string;
      readonly storage?: never;
    }
  | {
      readonly kind: 'committed';
      readonly requestBinding: string;
      readonly reservationId: string;
      readonly leaseExpiresAtMs: number;
      readonly authorityMaterialHandle: string;
      readonly storage?: never;
    };
