import type { AddSignerSelection } from '../../packages/shared-ts/src/utils/registrationSignerPlan';
import type {
  MlDsaCreateProtocolInputs,
  MlDsaRegistrationFailure,
} from '../../packages/shared-ts/src/passkey-custody/mlDsaCustody';
import type { D1WalletMlDsaRegistration } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaRegistration';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';

declare const ed25519: Variant<AddSignerSelection, 'mode', 'ed25519'>;
declare const protocol: MlDsaCreateProtocolInputs;
declare const unavailable: Variant<MlDsaRegistrationFailure, 'code', 'pool_unavailable'>;
declare const registry: D1WalletMlDsaRegistration;

// @ts-expect-error An Ed25519 request cannot retain its parameters when relabeled as ML-DSA.
const mixedSelection: AddSignerSelection = {
  ...ed25519,
  mode: 'ml_dsa_65',
  mlDsa: { signerSlot: 1 },
};
void mixedSelection;
const recoveryAsCreation: MlDsaCreateProtocolInputs = {
  ...protocol,
  // @ts-expect-error Adding a new signer cannot claim recovery continuity.
  continuity: { kind: 'recover' },
};
void recoveryAsCreation;
const seedInPreparation: MlDsaCreateProtocolInputs = {
  ...protocol,
  // @ts-expect-error Plaintext custody material cannot enter a public preparation through a spread.
  walletCustodySeed: new Uint8Array(32),
};
void seedInPreparation;
// @ts-expect-error An empty-pool reply requires an explicit retry time.
const missingRetry: MlDsaRegistrationFailure = {
  ok: false,
  code: 'pool_unavailable',
  message: 'Wait',
};
void missingRetry;
// @ts-expect-error A refusal cannot retain a pool retry time through a broad spread.
const mixedFailure: MlDsaRegistrationFailure = { ...unavailable, code: 'unauthorized' };
void mixedFailure;
// @ts-expect-error Callers cannot bypass guarded lifecycle transitions with a direct commit.
registry.commit({}, null);
