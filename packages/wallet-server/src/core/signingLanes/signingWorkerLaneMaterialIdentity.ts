import type { SigningWorkerLaneMaterialIdentityV1 as SharedSigningWorkerLaneMaterialIdentityV1 } from '@shared/signing-lanes';

export type SigningWorkerLaneMaterialIdentityV1<
  TKeyFamily extends 'ed25519' | 'ecdsa_secp256k1' =
    | 'ed25519'
    | 'ecdsa_secp256k1',
> = Readonly<SharedSigningWorkerLaneMaterialIdentityV1<TKeyFamily>>;

export type EcdsaSigningWorkerLaneMaterialIdentityV1 =
  SigningWorkerLaneMaterialIdentityV1<'ecdsa_secp256k1'>;
