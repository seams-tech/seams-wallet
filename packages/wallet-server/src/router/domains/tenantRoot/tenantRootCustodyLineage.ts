import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { TenantRootIdentityV1 } from './tenantRootIdentityResolution';

export type TenantRootActiveLineageV1 = {
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
};

export type TenantRootRuntimeActiveLineageV1 = TenantRootActiveLineageV1 & {
  /** The lineage's identity, whose envId is the Console environment ID. */
  readonly identity: TenantRootIdentityV1;
  readonly projectEnvironmentId: string;
};

export interface TenantRootCustodyLineageResolverV1 {
  /** Runtime envId is an environment key; resolve its Console ID before root lookup. */
  resolveActiveLineageForRuntimeScope(
    scope: RuntimePolicyScope & { readonly signingRootId: string },
  ): Promise<TenantRootRuntimeActiveLineageV1 | null>;
  resolveActiveLineage(identity: TenantRootIdentityV1): Promise<TenantRootActiveLineageV1 | null>;
}
