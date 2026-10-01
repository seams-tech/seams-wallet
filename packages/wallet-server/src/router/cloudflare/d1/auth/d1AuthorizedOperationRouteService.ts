import { parseTenantId } from '@shared/authorization/capabilityKinds';
import type { AuthorizationService } from '../../../../authorization/service';
import type { RouterApiServiceBag } from '../../../framework/authServicePort';
import type { CloudflareD1AuthorizationStore } from '../authorization/d1AuthorizationStore';
import type { NormalizedCloudflareD1RouterApiAuthServiceOptions } from './d1RouterApiAuthConfig';

type D1AuthorizedOperationRouteServiceAssembly = {
  readonly authorizationService: AuthorizationService;
  readonly authorizationStore: CloudflareD1AuthorizationStore;
  readonly options: Pick<NormalizedCloudflareD1RouterApiAuthServiceOptions, 'orgId'>;
};

export function createD1AuthorizedOperationRouteService(
  assembly: D1AuthorizedOperationRouteServiceAssembly,
): RouterApiServiceBag['authorizedOperations'] {
  const tenantId = parseTenantId(assembly.options.orgId);
  if (!tenantId.ok) {
    throw new Error(`orgId cannot identify an authorization tenant: ${tenantId.error.message}`);
  }
  return {
    tenantId: tenantId.value,
    resolveEcdsaWalletSessionOperation: assembly.authorizationStore.resolveEcdsaWalletSessionOperation.bind(
      assembly.authorizationStore,
    ),
    admitEcdsaWalletSessionOperation: assembly.authorizationStore.admitEcdsaWalletSessionOperation.bind(
      assembly.authorizationStore,
    ),
    readPinnedOwnerWalletScope: assembly.authorizationStore.readPinnedOwnerWalletScope.bind(
      assembly.authorizationStore,
    ),
    buildVerifiedOwnerProof: assembly.authorizationService.buildVerifiedOwnerProof.bind(
      assembly.authorizationService,
    ),
    recordVerifiedWalletOperationFactorEvidenceSet:
      assembly.authorizationService.recordVerifiedWalletOperationFactorEvidenceSet.bind(
        assembly.authorizationService,
      ),
    readAuthorizedOperationById: assembly.authorizationService.readAuthorizedOperationById.bind(
      assembly.authorizationService,
    ),
    readAuthorizedOperation: assembly.authorizationService.readAuthorizedOperation.bind(
      assembly.authorizationService,
    ),
    admitAuthorizedOperation: assembly.authorizationService.admitAuthorizedOperation.bind(
      assembly.authorizationService,
    ),
    prepareAuthorizedOperationAdmission:
      assembly.authorizationService.prepareAuthorizedOperationAdmission.bind(
        assembly.authorizationService,
      ),
    classifyAuthorizedOperationAdmissionFailure:
      assembly.authorizationService.classifyAuthorizedOperationAdmissionFailure.bind(
        assembly.authorizationService,
      ),
    completeAuthorizedOperation: assembly.authorizationService.completeAuthorizedOperation.bind(
      assembly.authorizationService,
    ),
  };
}
