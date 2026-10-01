import type { RecoveryCodeReservationId } from './recoveryCodeReservation';
import type { ExclusiveUnion } from '../utils/variant';

/**
 * Lifecycle of one recovery code.
 *
 * `reserved` is a transient hold taken while a recovery runs; consumption
 * commits only after the replacement credential activates. See
 * `recoveryCodeReservation.ts` for the transitions between these states.
 */
export type RecoveryCodeLifecycleState = ExclusiveUnion<
  | { state: 'active'; issuedAtMs: number }
  | {
      state: 'reserved';
      issuedAtMs: number;
      reservationId: RecoveryCodeReservationId;
      reservedAtMs: number;
      reservationExpiresAtMs: number;
    }
  | {
      state: 'consumed';
      issuedAtMs: number;
      reservationId: RecoveryCodeReservationId;
      consumedAtMs: number;
    }
  | { state: 'revoked'; issuedAtMs: number; revokedAtMs: number }
>;
