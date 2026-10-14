import type {
  MlDsaCustodyProtocolInputs,
  MlDsaCustodyCommit,
} from '@shared/passkey-custody/mlDsaCustody';
import type { Variant } from '@shared/utils/variant';
import type { WalletCustodyCeremonyWorkerOperationMap } from './workerTypes';

declare const publicInputs: MlDsaCustodyProtocolInputs;
declare const secret: Uint8Array;
declare const createInputs: Omit<MlDsaCustodyProtocolInputs, 'continuity'> & {
  continuity: { kind: 'create' };
};
declare function prepare(input: MlDsaCustodyProtocolInputs): void;
declare function begin(
  input: Variant<
    WalletCustodyCeremonyWorkerOperationMap['beginWalletCustodyKeySetRun']['payload'],
    'keySet',
    'near_ml_dsa_65_v1'
  >,
): void;
declare function commit(input: MlDsaCustodyCommit): void;
declare const key: MlDsaCustodyCommit['key'];
declare const established: Variant<MlDsaCustodyCommit, 'custodyAction', 'established'>;

// @ts-expect-error Plaintext owner roots cannot enter protocol input, including through a spread.
prepare({ ...publicInputs, ownerRoot: secret });
// @ts-expect-error The canonical seed cannot cross this browser input.
prepare({ ...publicInputs, canonicalSeed: secret });
// @ts-expect-error A recovery digest is mandatory.
prepare({ ...publicInputs, continuity: { kind: 'recover' } });
prepare({
  ...publicInputs,
  // @ts-expect-error Create and recovery metadata cannot be combined.
  continuity: { kind: 'create', recordedKeyManifestDigestB64u: 'digest' },
});
// @ts-expect-error Code recovery cannot request a new key identity.
begin({
  ceremonyId: 'fixture',
  keySet: 'near_ml_dsa_65_v1',
  custody: { origin: 'recover', custodyJson: '{}', recoveryCode: new ArrayBuffer(32) },
  protocolInputs: createInputs,
});
// @ts-expect-error Establishment must carry encrypted custody records.
commit({ custodyAction: 'established', key });
// @ts-expect-error A broad spread cannot turn establishment records into a joining commit.
commit({ ...established, custodyAction: 'joined' });
