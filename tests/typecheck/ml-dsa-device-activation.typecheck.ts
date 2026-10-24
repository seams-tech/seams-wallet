import type {
  WalletMlDsa65SignerActivationV1,
  WalletEd25519SignerActivationV1,
  WalletSignerActivationSetV1,
} from '../../packages/shared-ts/src/authorization/walletAuthority';
import type { MpcMaterialActivationRef } from '../../packages/shared-ts/src/utils/domainIds';
import type { CommittedMlDsaSignerPackageV1 } from '../../packages/shared-ts/src/device-linking/committedSignerPackages';
import type { MlDsaSeedExportWorkerPayload } from '../../packages/wallet/src/core/types/secure-confirm-worker';

declare const mlDsa: WalletMlDsa65SignerActivationV1;
declare const ed25519: WalletEd25519SignerActivationV1;
declare const materialActivation: MpcMaterialActivationRef;
declare const mlDsaPackage: CommittedMlDsaSignerPackageV1;
declare const passkeyAuth: Extract<MlDsaSeedExportWorkerPayload['auth'], { kind: 'passkey' }>;
declare const emailAuth: Extract<MlDsaSeedExportWorkerPayload['auth'], { kind: 'email_otp' }>;

const mlOnly: WalletSignerActivationSetV1 = {
  kind: 'wallet_signer_activation_set_v1',
  keyFamilies: ['ml_dsa_65'],
  mlDsa: [mlDsa],
};
const mixed: WalletSignerActivationSetV1 = {
  kind: 'wallet_signer_activation_set_v1',
  keyFamilies: ['ed25519', 'ml_dsa_65'],
  ed25519,
  mlDsa: [mlDsa],
};
// @ts-expect-error ML-DSA activation never fabricates client-share material.
const fabricatedShare: WalletMlDsa65SignerActivationV1 = { ...mlDsa, materialActivation };
// @ts-expect-error Participant material epochs do not define device signing rights.
const epochBoundRights: WalletMlDsa65SignerActivationV1 = { ...mlDsa, materialEpoch: 2 };
// @ts-expect-error The family list must describe every activation.
const omittedFamily: WalletSignerActivationSetV1 = {
  kind: 'wallet_signer_activation_set_v1',
  keyFamilies: ['ed25519'],
  ed25519,
  mlDsa: [mlDsa],
};
const emptyMlDsa: WalletSignerActivationSetV1 = {
  kind: 'wallet_signer_activation_set_v1',
  keyFamilies: ['ml_dsa_65'],
  // @ts-expect-error An activated ML-DSA family must contain a key.
  mlDsa: [],
};
// @ts-expect-error A committed ML-DSA package requires its own encrypted export root.
const missingRoot: CommittedMlDsaSignerPackageV1 = {
  kind: mlDsaPackage.kind,
  signer: mlDsaPackage.signer,
};
// @ts-expect-error Passkey and Email OTP export credentials cannot be combined by spreading.
const crossedExport: MlDsaSeedExportWorkerPayload['auth'] = {
  ...passkeyAuth,
  sessionAuth: emailAuth.sessionAuth,
};
void [
  mlOnly,
  mixed,
  fabricatedShare,
  epochBoundRights,
  omittedFamily,
  emptyMlDsa,
  missingRoot,
  crossedExport,
];
