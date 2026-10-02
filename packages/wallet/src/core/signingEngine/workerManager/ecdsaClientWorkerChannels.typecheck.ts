import type {
  OpaqueEcdsaPresignAuthorityResponseV1,
  RehydrateEcdsaRoleLocalSigningMaterialRequestV1,
} from './ecdsaClientWorkerChannels';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type { EcdsaRoleLocalPersistedMaterialRef } from '../session/keyMaterialBrands';

declare const authority: WalletAuthAuthorityRef;
declare const materialActivation: MpcMaterialActivationRef;
declare const materialRef: EcdsaRoleLocalPersistedMaterialRef;

void ({
  kind: 'open_ecdsa_role_local_signing_material_v1',
  authority,
  materialActivation,
} satisfies RehydrateEcdsaRoleLocalSigningMaterialRequestV1);

void ({
  kind: 'open_ecdsa_role_local_signing_material_v1',
  authority,
  materialActivation,
  // @ts-expect-error Worker-open requests cannot select material by caller-provided durable ref.
  materialRef,
} satisfies RehydrateEcdsaRoleLocalSigningMaterialRequestV1);

void ({
  kind: 'opaque_ecdsa_presign_authority_result_v1',
  requestId: 'request-success',
  ok: true,
  result: {
    kind: 'progress',
    progress: {
      stage: 'triples',
      event: 'none',
      outgoingMessages: [],
    },
  },
} satisfies OpaqueEcdsaPresignAuthorityResponseV1);

void ({
  kind: 'opaque_ecdsa_presign_authority_result_v1',
  requestId: 'request-failure',
  ok: false,
  error: 'material unavailable',
} satisfies OpaqueEcdsaPresignAuthorityResponseV1);
