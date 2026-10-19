import type {
  Ed25519WalletKeyRecord,
  MlDsa65WalletKeyRecord,
} from '../../packages/shared-ts/src/signing-lanes';
import type { MlDsa65PublicKeyB64u } from '../../packages/shared-ts/src/passkey-custody/primitives';
import type { discoverMlDsaRecipientKeys } from '../../packages/wallet-server/src/router/transport/fetch/routes/mlDsaRegistration';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import { buildNearMlDsa65MpcOperationRef } from '../../packages/shared-ts/src/authorization/capabilityKinds';
import type {
  MlDsaOwnerAdmission,
  PreparedMlDsaOwnerOperation,
} from '../../packages/wallet-server/src/router/domains/signingOperations/mlDsaOwnerAdmission';

declare const ml: MlDsa65WalletKeyRecord;
declare const ed: Ed25519WalletKeyRecord;
declare const prepared: PreparedMlDsaOwnerOperation;
type Discovery = Awaited<ReturnType<typeof discoverMlDsaRecipientKeys>>;
declare const discovered: Variant<Discovery, 'kind', 'ready'>;
// @ts-expect-error A refused discovery cannot carry usable recipient keys through a spread.
const mixedDiscovery: Discovery = { ...discovered, kind: 'unavailable', reason: 'refused' };
void mixedDiscovery;
// @ts-expect-error A ready result must contain both participant keys.
const partialDiscovery: Discovery = { kind: 'ready', a: discovered.a };
void partialDiscovery;
// @ts-expect-error A public field copy cannot recreate the nominal admission proof.
const spreadProof: PreparedMlDsaOwnerOperation = { ...prepared };
void spreadProof;
// @ts-expect-error A wire encoder and expiry do not establish admission.
const forged: PreparedMlDsaOwnerOperation = { encode: JSON.stringify, expiresAtMs: 1 };
void forged;
// @ts-expect-error An Ed25519 key cannot be relabeled as ML-DSA through a spread.
const mixedKey: MlDsa65WalletKeyRecord = { ...ml, ...ed, keyFamily: 'ml_dsa_65' };
void mixedKey;
const wrongEpoch: MlDsa65WalletKeyRecord = {
  ...ml,
  // @ts-expect-error Material epochs must pass their boundary parser.
  materialEpoch: 0,
};
void wrongEpoch;
// @ts-expect-error These fixed-size public key brands cannot be directly cast across algorithms.
const wrongKeyCast = ed.registeredPublicKeyB64u as MlDsa65PublicKeyB64u;
void wrongKeyCast;
// @ts-expect-error A refused operation cannot retain signing authority.
const refusedWithAuthority: MlDsaOwnerAdmission = {
  kind: 'refused',
  reason: 'inactive_key',
  operation: prepared,
};
void refusedWithAuthority;
// @ts-expect-error ML-DSA delegate-action authorization is not implemented.
buildNearMlDsa65MpcOperationRef('near.sign_delegate_action');
// @ts-expect-error EVM operations cannot use the ML-DSA capability.
buildNearMlDsa65MpcOperationRef('evm.sign_transaction');
