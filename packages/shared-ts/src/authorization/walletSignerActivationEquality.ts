import { mpcMaterialActivationRefsEqual } from '../utils/domainIds';
import type {
  WalletEcdsaSignerActivationV1,
  WalletEd25519SignerActivationV1,
} from './walletAuthority';

export function sameWalletEd25519SignerActivationV1(
  left: WalletEd25519SignerActivationV1,
  right: WalletEd25519SignerActivationV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.signer.kind === right.signer.kind &&
    left.signer.keyFamily === right.signer.keyFamily &&
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.registeredPublicKeyB64u === right.signer.registeredPublicKeyB64u &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
  );
}

export function sameWalletEcdsaSignerActivationV1(
  left: WalletEcdsaSignerActivationV1,
  right: WalletEcdsaSignerActivationV1,
): boolean {
  return (
    left.kind === right.kind &&
    left.signer.kind === right.signer.kind &&
    left.signer.keyFamily === right.signer.keyFamily &&
    left.signer.walletId === right.signer.walletId &&
    left.signer.walletKeyId === right.signer.walletKeyId &&
    left.signer.thresholdPublicKey33B64u === right.signer.thresholdPublicKey33B64u &&
    left.signer.evmAddress === right.signer.evmAddress &&
    mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
  );
}
