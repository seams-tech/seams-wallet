import type { ThresholdEcdsaDerivationRoleLocalClientRootProof } from './thresholdEcdsa';
import type {
  EcdsaClientRootPublicKey33B64u,
  DerivationClientSharePublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';

const clientRootProof = {
  version: 'ecdsa-derivation:role-local:first-bootstrap-root-proof:v2',
  clientRootPublicKey33B64u: 'public-key' as EcdsaClientRootPublicKey33B64u,
  digest32B64u: 'digest',
  signature65B64u: 'signature',
} satisfies ThresholdEcdsaDerivationRoleLocalClientRootProof;

declare const derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
void ({
  ...clientRootProof,
  // @ts-expect-error DERIVATION client-share keys cannot verify client-root proofs.
  clientRootPublicKey33B64u: derivationClientSharePublicKey33B64u,
} satisfies ThresholdEcdsaDerivationRoleLocalClientRootProof);
