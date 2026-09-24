import type {
  RouterAbEd25519YaoExportAdmissionRequestV1,
  RouterAbEd25519YaoRecoveryAdmissionRequestV1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type { TenantRootActiveLineageV1 } from '../tenantRoot/tenantRootCustodyLineage';
import type { TenantRootIdentityV1 } from '../tenantRoot/tenantRootIdentityResolution';
import type { TenantRootIdentityWireV1 } from '@shared/tenant-root/tenantRootIdentity';
import { tenantRootIdentityDigestB64uV1 } from '../../cloudflare/runtime/tenantRootCreationGrant';

export type RouterAbEd25519YaoResolvedTenantRootV1 = TenantRootActiveLineageV1 & {
  readonly identity: TenantRootIdentityV1;
};

export type RouterAbEd25519YaoTenantRootWireV1 = {
  readonly identity: TenantRootIdentityWireV1;
  readonly custody_lineage_b64u: string;
};

export async function routerAbEd25519YaoTenantRootWireV1(
  root: RouterAbEd25519YaoResolvedTenantRootV1,
): Promise<RouterAbEd25519YaoTenantRootWireV1> {
  const identityDigestB64u = await tenantRootIdentityDigestB64uV1(root.identity);
  if (identityDigestB64u !== root.identityDigestB64u) {
    throw new Error('Resolved Yao tenant-root identity differs from its active lineage');
  }
  return {
    identity: {
      orgId: root.identity.orgId,
      projectId: root.identity.projectId,
      envId: root.identity.envId,
      signingRootId: root.identity.signingRootId,
      signingRootVersion: root.identity.signingRootVersion,
    },
    custody_lineage_b64u: root.custodyLineageB64u,
  };
}

export type RouterAbEd25519YaoTenantRootResolutionInputV1 =
  | {
      readonly operation: 'registration';
      readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
    }
  | {
      readonly operation: 'recovery';
      readonly admissionRequest: RouterAbEd25519YaoRecoveryAdmissionRequestV1;
    }
  | {
      readonly operation: 'export';
      readonly admissionRequest: RouterAbEd25519YaoExportAdmissionRequestV1;
    };

export type RouterAbEd25519YaoTenantRootResolverV1 = (
  input: RouterAbEd25519YaoTenantRootResolutionInputV1,
) => Promise<RouterAbEd25519YaoResolvedTenantRootV1>;

export type RouterAbEd25519YaoRegistrationExecuteAdmissionContextV1 =
  RouterAbEd25519YaoRegistrationAdmissionRequestV1;

export type RouterAbEd25519YaoRecoveryExecuteAdmissionContextV1 =
  RouterAbEd25519YaoRecoveryAdmissionRequestV1;

export type RouterAbEd25519YaoExportExecuteAdmissionContextV1 =
  RouterAbEd25519YaoExportAdmissionRequestV1;
