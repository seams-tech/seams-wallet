import {
  resolveTenantRootIdentityV1,
  type ActiveEcdsaMaterialActivationV1,
  type ActiveEd25519MaterialActivationV1,
} from '../../packages/wallet-server/src/router/domains/tenantRoot/tenantRootIdentityResolution';
import type { TenantRootIdentityV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import type { WalletConsoleTenantRootActiveLineageResponseV1 } from '@seams/wallet-server/cloud-host';

import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 as publicBuilder } from '../../packages/wallet-server/src/cloud-host';
void publicBuilder;

const directIdentityFields = {
  orgId: 'org-a',
  projectId: 'project-a',
  envId: 'env-a',
  signingRootId: 'project-a:env-a',
  signingRootVersion: 'root-v1',
};
// @ts-expect-error The trusted identity cannot be reconstructed with a raw object literal.
const directIdentity: TenantRootIdentityV1 = directIdentityFields;
void directIdentity;

declare const trustedIdentity: TenantRootIdentityV1;
const spreadIdentity = { ...trustedIdentity };
// @ts-expect-error Spreading an opaque identity must not manufacture its proof.
const identityFromSpread: TenantRootIdentityV1 = spreadIdentity;
void identityFromSpread;

declare const activeEd25519Material: ActiveEd25519MaterialActivationV1;
declare const activeEcdsaMaterial: ActiveEcdsaMaterialActivationV1;

resolveTenantRootIdentityV1({
  kind: 'ed25519_b5_active_material',
  activeMaterial: activeEd25519Material,
});

resolveTenantRootIdentityV1({
  kind: 'ecdsa_b5_active_material',
  activeMaterial: activeEcdsaMaterial,
});

resolveTenantRootIdentityV1({
  kind: 'ed25519_b5_active_material',
  activeMaterial: activeEd25519Material,
  // @ts-expect-error Wallet Session state cannot select a tenant root.
  walletSession: {},
});

resolveTenantRootIdentityV1({
  kind: 'ecdsa_b5_active_material',
  activeMaterial: activeEcdsaMaterial,
  // @ts-expect-error A caller cannot supply the active tenant-root epoch.
  tenantRootShareEpoch: 2,
});

resolveTenantRootIdentityV1({
  kind: 'ecdsa_b5_active_material',
  activeMaterial: activeEcdsaMaterial,
  // @ts-expect-error A caller cannot select the Deriver role.
  role: 'deriver_a',
});

resolveTenantRootIdentityV1({
  kind: 'ecdsa_b5_active_material',
  activeMaterial: activeEcdsaMaterial,
  // @ts-expect-error A caller cannot override the stable signing-root identity.
  signingRootId: 'caller-selected-root',
});

resolveTenantRootIdentityV1({
  kind: 'ed25519_b5_active_material',
  activeMaterial: activeEd25519Material,
  // @ts-expect-error Credential identity cannot select a tenant root.
  credentialIdB64u: 'credential-from-request',
});

resolveTenantRootIdentityV1({
  kind: 'ed25519_b5_active_material',
  activeMaterial: activeEd25519Material,
  // @ts-expect-error Request bodies cannot carry an R120 identity override.
  tenantRootIdentity: {
    orgId: 'org-a',
    projectId: 'project-a',
    envId: 'env-a',
    signingRootId: 'project-a:env-a',
    signingRootVersion: 'root-v1',
  },
});

// @ts-expect-error The curve discriminator must match the successful B5 branch.
resolveTenantRootIdentityV1({
  kind: 'ed25519_b5_active_material',
  activeMaterial: activeEcdsaMaterial,
});

const validLineageResponse: WalletConsoleTenantRootActiveLineageResponseV1 = {
  ok: true,
  identityDigestB64u: 'identity-digest',
  custodyLineageB64u: 'custody-lineage',
};
void validLineageResponse;

const invalidSuccessWithFailureCode: WalletConsoleTenantRootActiveLineageResponseV1 = {
  ok: true,
  identityDigestB64u: 'identity-digest',
  custodyLineageB64u: 'custody-lineage',
  // @ts-expect-error Success responses cannot carry failure fields.
  code: 'tenant_root_active_lineage_not_found',
};
void invalidSuccessWithFailureCode;

// @ts-expect-error Failure responses cannot carry lineage payload fields.
const invalidFailureWithSuccessPayload: WalletConsoleTenantRootActiveLineageResponseV1 = {
  ok: false,
  code: 'tenant_root_active_lineage_not_found',
  message: 'No active lineage exists',
  identityDigestB64u: 'identity-digest',
};
void invalidFailureWithSuccessPayload;

// @ts-expect-error Successful responses require both lineage digest fields.
const invalidSuccessWithoutCustodyLineage: WalletConsoleTenantRootActiveLineageResponseV1 = {
  ok: true,
  identityDigestB64u: 'identity-digest',
};
void invalidSuccessWithoutCustodyLineage;
