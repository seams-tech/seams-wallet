import type { NearEd25519MaterialIdentity } from '@/core/signingEngine/interfaces/operationDeps';
import type { ExactEd25519SigningLaneIdentity } from '../identity/exactSigningLaneIdentity';
import type { NearEd25519CapabilityRehydrationSubject } from './nearEd25519CapabilityRehydration';

declare const laneIdentity: ExactEd25519SigningLaneIdentity;
declare const materialIdentity: NearEd25519MaterialIdentity;

const exactLaneSubject: NearEd25519CapabilityRehydrationSubject = {
  kind: 'exact_lane',
  laneIdentity,
};

const materialSubject: NearEd25519CapabilityRehydrationSubject = {
  kind: 'material_identity',
  materialIdentity,
};

const invalidCoarseMaterialSubject: NearEd25519CapabilityRehydrationSubject = {
  kind: 'material_identity',
  materialIdentity,
  // @ts-expect-error Rehydration subjects derive wallet identity from exact material identity.
  walletId: materialIdentity.signer.account.wallet.walletId,
};

const invalidMixedSubject: NearEd25519CapabilityRehydrationSubject = {
  kind: 'exact_lane',
  laneIdentity,
  // @ts-expect-error Exact lane and deferred material identity are separate branches.
  materialIdentity,
};

void exactLaneSubject;
void materialSubject;
void invalidCoarseMaterialSubject;
void invalidMixedSubject;
