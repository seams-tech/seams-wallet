import type { EcdsaCanonicalMaterialRead, EcdsaMaterialReadSource } from '../../packages/wallet-server/src/core/d1EcdsaSignerRead';
import type {
  EcdsaWalletSessionAdmissionVariant,
  EcdsaWalletSessionPhaseAdmission,
  EcdsaWalletSessionResolutionResult,
} from '../../packages/wallet-server/src/authorization/ecdsaWalletSessionAdmission';
import type {
  RouterApiWalletSessionExactOperationContext,
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
  RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext,
  RouterApiWalletSessionSigningCandidate,
} from '../../packages/wallet-server/src/router/framework/authServicePort';
import type {
  WalletSessionAdmissionSnapshotV2,
  WalletSessionAdmissionSnapshotV2Variant,
} from '../../packages/wallet-server/src/authorization/domain';

declare const exact: RouterApiWalletSessionExactOperationContext;

// Exact-operation identity carries no reusable allowance, including through a spread.
// @ts-expect-error Exact-operation context is not reusable-session admission.
const reusable: RouterApiWalletSessionAuthorizationV2AdmissionContext = exact;
// @ts-expect-error A spread cannot manufacture reusable-session authority.
const spread: RouterApiWalletSessionAuthorizationV2AdmissionContext = { ...exact };
// @ts-expect-error A reusable allowance is required for direct admission construction.
const direct: RouterApiWalletSessionAuthorizationV2AdmissionContext = {
  authority: exact.authority,
  authMethod: exact.authMethod,
  retiredAtMs: null,
};

void reusable;
void spread;
void direct;

declare const exhausted: RouterApiWalletSessionAuthorizationV2ExhaustedCandidateContext;
declare const active: RouterApiWalletSessionAuthorizationV2AdmissionContext;
declare const exhaustedSnapshot: WalletSessionAdmissionSnapshotV2Variant<'exhausted'>;

declare const canonicalMaterial: EcdsaCanonicalMaterialRead;
const candidate: RouterApiWalletSessionSigningCandidate = { canonicalMaterial, kind: 'exhausted', candidate: exhausted };
// @ts-expect-error An exhausted candidate cannot carry an active admission context.
const mixed: RouterApiWalletSessionSigningCandidate = { canonicalMaterial, kind: 'exhausted', candidate: exhausted, context: active };
// @ts-expect-error Changing the discriminant through a spread does not create active authority.
const relabeled: RouterApiWalletSessionSigningCandidate = { ...candidate, kind: 'active', context: active };
// @ts-expect-error A live snapshot with exhausted quota cannot carry a reusable allowance.
const widenedSnapshot: WalletSessionAdmissionSnapshotV2 = { ...exhaustedSnapshot, authorization: active.authorization };
// @ts-expect-error Exhausted identity and reusable authorization are distinct even under a direct cast.
const castAdmission = exhausted as RouterApiWalletSessionAuthorizationV2AdmissionContext;

void mixed;
void relabeled;
void widenedSnapshot;
void castAdmission;


declare const snapshot: import('../../packages/wallet-server/src/core/ecdsaMaterialReadSnapshot').EcdsaMaterialReadSnapshot;
declare const sessionOperation: import('../../packages/wallet-server/src/authorization/ecdsaWalletSessionAdmission').EcdsaWalletSessionAdmissionInput['operation'];
declare const materialScope: import('../../packages/wallet-server/src/authorization/service').EcdsaMaterialActivationScope;
// @ts-expect-error An admission requires the snapshot read with its verified material.
const missingMaterialSnapshot: import('../../packages/wallet-server/src/authorization/ecdsaWalletSessionAdmission').EcdsaWalletSessionAdmissionInput = { operation: sessionOperation, material: materialScope };
// @ts-expect-error A plain object cannot manufacture the private record-set evidence.
const fabricatedSnapshot: typeof snapshot = { walletId: snapshot.walletId, condition: snapshot.condition };
// @ts-expect-error Spreading a snapshot cannot carry its private evidence or prototype methods.
const spreadSnapshot: typeof snapshot = { ...snapshot };
// @ts-expect-error Raw serialized data cannot be cast directly to an in-process read snapshot.
const serializedSnapshot = 'untrusted' as typeof snapshot;
void [missingMaterialSnapshot, fabricatedSnapshot, spreadSnapshot, serializedSnapshot];

// @ts-expect-error Signing candidates require their joined material evidence.
const missingCanonicalRead: RouterApiWalletSessionSigningCandidate = { kind: 'exhausted', candidate: exhausted };
// @ts-expect-error Plain objects cannot construct a scoped canonical read.
const fabricatedCanonicalRead: EcdsaCanonicalMaterialRead = { walletId: canonicalMaterial.walletId, resolve: canonicalMaterial.resolve };
// @ts-expect-error Spreading a canonical read loses its private evidence.
const spreadCanonicalRead: EcdsaCanonicalMaterialRead = { ...canonicalMaterial };
// @ts-expect-error Serialized data cannot become canonical read evidence through a cast.
const castCanonicalRead = 'stored material' as EcdsaCanonicalMaterialRead;
// @ts-expect-error A database read cannot also consume a credential snapshot.
const mixedMaterialSource: EcdsaMaterialReadSource = { kind: 'database', canonicalMaterial };
void missingCanonicalRead;
void fabricatedCanonicalRead;
void spreadCanonicalRead;
void castCanonicalRead;
void mixedMaterialSource;

declare const newlyClaimed: EcdsaWalletSessionAdmissionVariant<'claimed'>;
// @ts-expect-error Finalize resolution cannot create a claim.
const claimedResolution: EcdsaWalletSessionResolutionResult = newlyClaimed;
// @ts-expect-error Direct construction cannot attach a new claim to finalize.
const claimedFinalize: EcdsaWalletSessionPhaseAdmission = { phase: 'finalize', admission: newlyClaimed };
const prepared: EcdsaWalletSessionPhaseAdmission = { phase: 'prepare', admission: newlyClaimed };
// @ts-expect-error Relabeling a prepare through a spread cannot produce a finalize.
const relabeledFinalize: EcdsaWalletSessionPhaseAdmission = { ...prepared, phase: 'finalize' };
// @ts-expect-error A new claim cannot be cast directly to an existing-operation result.
const castResolution = newlyClaimed as EcdsaWalletSessionResolutionResult;
// @ts-expect-error A route admission requires its phase.
const missingPhase: EcdsaWalletSessionPhaseAdmission = { admission: newlyClaimed };
void [claimedResolution, claimedFinalize, relabeledFinalize, castResolution, missingPhase];
