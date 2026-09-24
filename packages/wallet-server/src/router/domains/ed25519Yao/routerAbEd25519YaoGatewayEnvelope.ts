import type {
  RouterAbEd25519YaoExportAdmissionRequestV1,
  RouterAbEd25519YaoRecoveryAdmissionRequestV1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type { TenantRootActiveLineageV1 } from '../tenantRoot/tenantRootCustodyLineage';
import type { TenantRootIdentityV1 } from '../tenantRoot/tenantRootIdentityResolution';
import type { TenantRootIdentityWireV1 } from '@shared/tenant-root/tenantRootIdentity';
import { decodeTenantRootIdentityWireV1 } from '@shared/tenant-root/tenantRootIdentity';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { tenantRootIdentityDigestB64uV1 } from '../../cloudflare/runtime/tenantRootCreationGrant';

export type RouterAbEd25519YaoResolvedTenantRootV1 = TenantRootActiveLineageV1 & {
  readonly identity: TenantRootIdentityV1;
};

export type RouterAbEd25519YaoTenantRootWireV1 = {
  readonly identity: TenantRootIdentityWireV1;
  readonly custody_lineage_b64u: string;
};

export function parseRouterAbEd25519YaoTenantRootWireV1(
  input: unknown,
): RouterAbEd25519YaoTenantRootWireV1 | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'identity') ||
    !Object.hasOwn(record, 'custody_lineage_b64u')
  ) return null;
  const identity = decodeTenantRootIdentityWireV1(record.identity);
  const lineage = record.custody_lineage_b64u;
  if (!identity.ok || typeof lineage !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(lineage)) {
    return null;
  }
  try {
    const bytes = base64UrlDecode(lineage);
    if (bytes.length !== 16 || base64UrlEncode(bytes) !== lineage) return null;
  } catch {
    return null;
  }
  return {
    identity: {
      orgId: identity.value.orgId,
      projectId: identity.value.projectId,
      envId: identity.value.envId,
      signingRootId: identity.value.signingRootId,
      signingRootVersion: identity.value.signingRootVersion,
    },
    custody_lineage_b64u: lineage,
  };
}

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
