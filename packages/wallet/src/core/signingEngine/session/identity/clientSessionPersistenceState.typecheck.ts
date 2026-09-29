import { ClientWalletSessionExpiryInvalidator } from '../availability/clientSessionExpiryInvalidator';
import type { WalletSessionId } from '@shared/authorization/capabilityKinds';
import {
  parseWalletSessionAuthorizationBoundary,
  type ActiveWalletSessionAuthorizationState,
  type ExpiredWalletSessionAuthorizationState,
  type WalletSessionAuthorizationObservation,
} from './clientSessionPersistenceState';

declare const active: ActiveWalletSessionAuthorizationState;
declare const expired: ExpiredWalletSessionAuthorizationState;
declare const invalidator: ClientWalletSessionExpiryInvalidator;
declare const observation: WalletSessionAuthorizationObservation;
declare const walletSessionId: WalletSessionId;

parseWalletSessionAuthorizationBoundary({ observation, nowMs: Date.now() });

// @ts-expect-error Boundary parsing requires an explicit observation time.
parseWalletSessionAuthorizationBoundary({ observation });

void invalidator.invalidate({ state: expired, walletSessionId });

// @ts-expect-error The canonical invalidator accepts expired authorization only.
void invalidator.invalidate({ state: active, walletSessionId });
