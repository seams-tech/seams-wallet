import type {
  ActivateInstalledAuthorityResultV1,
  WalletSessionOperationCredentialV1,
} from '../../packages/shared-ts/src/device-linking/contracts';
import type { DeviceLinkingAuthorityInstallationPortV1 } from '../../packages/wallet/src/SeamsWeb/operations/devices/deviceLinkingAuthorityInstallation';
import type { DeviceLinkingOrdinaryMaterialSealerV1 } from '../../packages/wallet/src/core/signingEngine/workerManager/deviceLinkingPorts';
import type { DeviceLinkingOrdinaryMaterialStateV1 } from '../../packages/wallet/src/core/signingEngine/workerManager/workers/device-linking-key/ordinaryMaterialState';
import type {
  LinkedDeviceEd25519SourceContributionPreparationV1,
  LinkedDeviceEd25519SourceContributionV1,
} from '../../packages/shared-ts/src/device-linking/sourceContribution';
import type {
  RouterAbEd25519YaoActivationBindingV1,
  RouterAbEd25519YaoCeremonyBindingV1,
} from '../../packages/shared-ts/src/utils/routerAbEd25519Yao';

declare const installation: DeviceLinkingAuthorityInstallationPortV1;
declare const activation: ActivateInstalledAuthorityResultV1;
declare const operationCredential: WalletSessionOperationCredentialV1;
declare const sharedFactorSecret: Uint8Array<SharedArrayBuffer>;

type SealingInput = Parameters<
  DeviceLinkingOrdinaryMaterialSealerV1['sealCommittedAuthorityPackagesV1']
>[0];
// @ts-expect-error Web Crypto requires a factor secret backed by an ordinary ArrayBuffer.
const sharedSealingSecret: SealingInput['factorSecret'] = sharedFactorSecret;
// @ts-expect-error Worker state must retain the transferable ArrayBuffer backing type.
const sharedWorkerSecret: DeviceLinkingOrdinaryMaterialStateV1['factorSecret'] = sharedFactorSecret;
void [sharedSealingSecret, sharedWorkerSecret];

if (activation.kind === 'active') {
  void installation.finalizeLocalAuthorityActivationV1({
    active: activation,
    operationCredential,
    expectedLockGeneration: 0,
  });
  // @ts-expect-error Finalization must carry the generation captured before installation.
  void installation.finalizeLocalAuthorityActivationV1({ active: activation });
} else {
  // @ts-expect-error Pending and integrity results cannot finalize local authority state.
  void installation.finalizeLocalAuthorityActivationV1(activation);
}

declare const registrationSource: RouterAbEd25519YaoActivationBindingV1<'registration'>;
declare const recoverySource: RouterAbEd25519YaoActivationBindingV1<'recovery'>;
declare const preparation: LinkedDeviceEd25519SourceContributionPreparationV1;
declare const contribution: LinkedDeviceEd25519SourceContributionV1;
declare const rawBinding: RouterAbEd25519YaoCeremonyBindingV1;

const registration: typeof preparation.sourceBinding = registrationSource;
const recovery: typeof preparation.sourceBinding = recoverySource;
const recoveredContribution: typeof contribution.sourceBinding = recoverySource;
// @ts-expect-error A direct recovery literal cannot carry the registration lifecycle.
const mismatchedSource: typeof preparation.sourceBinding = {
  operation: 'recovery',
  lifecycle: registrationSource.lifecycle,
  session_id: recoverySource.session_id,
  stable_key_context_binding: recoverySource.stable_key_context_binding,
  material_activation: recoverySource.material_activation,
};
// @ts-expect-error A raw ceremony binding does not establish an activation operation and lifecycle.
const rawSource: typeof preparation.sourceBinding = rawBinding;
// @ts-expect-error A recovery source cannot become a target registration.
const recoveryTarget: typeof contribution.targetBinding = recoverySource;
const recoveryAdmission: typeof preparation.targetAdmission = {
  ...preparation.targetAdmission,
  // @ts-expect-error A recovery binding cannot satisfy the registration admission.
  binding: recoverySource,
};
// @ts-expect-error Relabeling a recovery through a spread retains invalid recovery lifecycle fields.
const relabeledSource: typeof preparation.sourceBinding = {
  ...recoverySource,
  operation: 'registration',
};
// @ts-expect-error Broadening a binding through a cast cannot supply precise source facts.
const castSource: typeof preparation.sourceBinding = recoverySource as Record<string, unknown>;

void [
  registration,
  recovery,
  recoveredContribution,
  mismatchedSource,
  rawSource,
  recoveryTarget,
  recoveryAdmission,
  relabeledSource,
  castSource,
];
