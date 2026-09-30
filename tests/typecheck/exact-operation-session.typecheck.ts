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

const candidate: RouterApiWalletSessionSigningCandidate = { kind: 'exhausted', candidate: exhausted };
// @ts-expect-error An exhausted candidate cannot carry an active admission context.
const mixed: RouterApiWalletSessionSigningCandidate = { kind: 'exhausted', candidate: exhausted, context: active };
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
