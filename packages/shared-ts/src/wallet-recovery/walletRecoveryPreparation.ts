import type { RuntimePolicyScope } from '../threshold/signingRootScope';
import type {
  RouterAbEd25519YaoApplicationBindingFactsV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoLifecycleScopeV1,
} from '../utils/routerAbEd25519Yao';

export type WalletRecoveryPreparationNearRecoveryBasisV1 = {
  readonly capabilityKind: 'registration' | 'recovery';
  readonly activeCapabilityBinding: RouterAbEd25519YaoBytes32V1;
  readonly scope: RouterAbEd25519YaoLifecycleScopeV1;
  readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
  readonly participantIds: readonly [number, number];
  readonly registeredPublicKey: RouterAbEd25519YaoBytes32V1;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly activationTranscript: RouterAbEd25519YaoBytes32V1;
  readonly activationStateEpoch: number;
  readonly signingWorkerVerifyingShare: RouterAbEd25519YaoBytes32V1;
};
