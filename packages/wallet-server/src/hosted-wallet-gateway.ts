import { decodeTenantRootIdentityWireV1 } from '@seams-internal/shared-ts/tenant-root';
import { resolveRuntimeTenantRootLineage } from './cloud-host';
import {
  parseD1JsonColumn,
  type D1DatabaseLike,
  type D1Row,
} from './cloud-host';
import { withCors } from './cloud-host';
import {
  createCloudflareWalletGatewayRouterV1,
  createWalletConsoleOpsClient,
  type WalletConsoleServiceBinding,
} from './cloud-host';
import {
  createWalletRuntimeOpsHandler,
  handleWalletControlRequest,
  type WalletControlRuntimeBindings,
  type WalletRuntimeWalletIdentitiesResult,
  type WalletRuntimeWalletIdentityRequest,
} from './cloud-host';
import type { CloudflareD1EmailOtpServerSealConfig } from './cloud-host';
import {
  createCloudflareD1RouterApiAuthService,
  createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialActivationEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialDeactivationEndpointV1,
  createCloudflareOrdinaryInactiveSignerMaterialReservationEndpointV1,
  createD1LinkedDeviceOwnerSourceChildReaderV1,
  createD1LinkedDeviceSourceContributionPreparationPlannerV1,
  D1LinkedDeviceTargetCredentialProviderV1,
  D1WalletAuthMethodStore,
  type CloudflareD1RouterApiAuthServiceOptions,
} from './cloud-host';
import { loadCloudflareSignerWasmModule } from './cloud-host';
import { createSigningSessionSealOptions } from './cloud-host';
import { RouterAbEcdsaPresignRuntime } from './cloud-host';
import type { SigningSessionSealRoutesOptions } from './cloud-host';
import type {
  CfExecutionContext,
  CfScheduledEvent,
  FetchHandler,
  ScheduledHandler,
} from './cloud-host';
import {
  createRouterAbEd25519YaoHttpRegistrationBackendFromEnv,
  type RouterAbEd25519YaoGatewaySpanV1,
  type RouterAbEd25519YaoTenantRootResolutionInputV1,
  type RouterAbEd25519YaoTenantRootResolverV1,
} from './cloud-host';
import { type RouterAbEd25519YaoProductRegistrationRuntimeV1 } from './cloud-host';
import { D1WalletStore } from './cloud-host';
import { CloudflareD1RouterAbEd25519YaoCapabilityPersistence } from './cloud-host';
import {
  createRouterAbEcdsaEd25519CeremonyTokenIssuer,
  createRouterAbEcdsaStrictPostRegistrationPort,
  createRouterAbEcdsaStrictRegistrationPort,
  parseRouterAbEcdsaEd25519PrivateJwk,
  parseRouterAbEcdsaStrictRegistrationTopology,
  type RouterAbEcdsaCeremonyTokenIssuer,
  type RouterAbEcdsaStrictRegistrationTopology,
} from './cloud-host';
import {
  readEnvironmentCsv as readCsvList,
  readEnvironmentString as readEnvString,
  requireEnvironmentString as requireEnvString,
} from './cloud-host';
import { createEd25519SessionAdapter } from './cloud-host';
import { runRouterAbPrewarmScheduledV1 } from './cloud-host';
import {
  parseRouterAbPublicKeysetV2,
  type RouterAbPublicKeysetV2,
} from './cloud-host';
import { base64UrlEncode, parseWalletId } from './cloud-host';
import {
  createRouterAbServiceBindingFetch,
  ROUTER_AB_MPC_ROUTER_ORIGIN,
  ROUTER_AB_SIGNING_WORKER_ORIGIN,
  type RouterAbServiceBindingEnv,
} from './cloud-host';
import { handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1 } from './cloud-host';
import { createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1 } from './cloud-host';
import { RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter } from './cloud-host';
import type { RouterAbEd25519YaoRecoveryAuthorizationServicesV1 } from './cloud-host';
import { RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter } from './cloud-host';
import { createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1 } from './cloud-host';
import { handleRouterAbEd25519YaoRecoveryRequestScopedCloudflareV1 } from './cloud-host';
import type { WarmBootstrapLinkedEd25519AuthorityReaderV1 } from './cloud-host';
import { handleRouterAbEd25519YaoExportRequestScopedCloudflareV1 } from './cloud-host';
import {
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_STATUS_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
} from './cloud-host';
import { buildTenantRootIdentityFromAuthenticatedDeploymentV1 } from './cloud-host';

export interface CloudflareD1GatewayBaseEnv
  extends Readonly<Record<string, unknown>>, RouterAbServiceBindingEnv {
  readonly SIGNER_DB: D1DatabaseLike;
  readonly SEAMS_TENANT_STORAGE_NAMESPACE?: string;
  readonly SEAMS_STAGING_ORG_ID?: string;
  readonly SEAMS_STAGING_PROJECT_ID?: string;
  readonly SEAMS_STAGING_ENV_ID?: string;
  readonly RELAY_SESSION_HMAC_SECRET?: string;
  readonly SESSION_COOKIE_NAME?: string;
  readonly RELAY_SESSION_ISSUER?: string;
  readonly RELAY_SESSION_AUDIENCE?: string;
  readonly RELAY_CORS_ORIGINS?: string;
  readonly HOSTED_WALLET_ORIGINS?: string;
  readonly RELAYER_ACCOUNT_ID?: string;
  readonly RELAYER_PUBLIC_KEY?: string;
  readonly RELAYER_PRIVATE_KEY?: string;
  readonly NEAR_RPC_URL?: string;
  readonly ARC_RPC_URL?: string;
  readonly ACCOUNT_INITIAL_BALANCE?: string;
  readonly ENABLE_IMPLICIT_NEAR_ACCOUNT_TEST_FUNDING?: string;
  readonly GOOGLE_OIDC_CLIENT_ID?: string;
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
  readonly GITHUB_OAUTH_CLIENT_SECRET?: string;
  readonly GITHUB_OAUTH_CALLBACK_URL?: string;
  readonly ACCOUNT_ID_DERIVATION_SECRET?: string;
  readonly ROUTER_AB_NORMAL_SIGNING_WORKER_ID?: string;
  readonly SIGNING_WORKER_ID?: string;
  readonly ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET?: string;
  readonly ROUTER_AB_PREWARM_ENABLED: string;
  readonly ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK?: string;
  readonly ROUTER_AB_CEREMONY_JWT_ISSUER?: string;
  readonly ROUTER_AB_CEREMONY_JWT_AUDIENCE?: string;
  readonly ROUTER_AB_CEREMONY_JWT_KEY_ID?: string;
  readonly ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON?: string;
  readonly ROUTER_AB_PUBLIC_KEYSET_JSON?: string;
  readonly LINKED_DEVICE_WEBAUTHN_RP_ID?: string;
  readonly SIGNING_SESSION_SEAL_ROOT_SECRET_B64U?: string;
  readonly SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION?: string;
  readonly SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS?: string;
  readonly EMAIL_OTP_DELIVERY_MODE?: string;
  readonly EMAIL_OTP_RUNTIME_PROFILE?: string;
  readonly EMAIL_OTP_PROVIDER?: string;
  readonly EMAIL_OTP_FROM_ADDRESS?: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_OTP_SES_REGION?: string;
  readonly EMAIL_OTP_SES_ACCESS_KEY_ID?: string;
  readonly EMAIL_OTP_SES_SECRET_ACCESS_KEY?: string;
  readonly EMAIL_OTP_DEMO_ALLOWED_ORIGINS?: string;
  readonly EMAIL_OTP_PRODUCTION?: string;
  readonly EMAIL_OTP_DEV_OUTBOX_ENABLED?: string;
  readonly EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_CHALLENGE_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_VERIFY_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_VERIFY_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_GRANT_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_GRANT_RATE_LIMIT_WINDOW_MS?: string;
  readonly EMAIL_OTP_MAX_ATTEMPTS?: string;
  readonly EMAIL_OTP_LOCKOUT_TTL_MS?: string;
  readonly EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_MAX?: string;
  readonly EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_WINDOW_MS?: string;
}

export function readStagingHostedWalletOrigins(
  env: Pick<CloudflareD1GatewayBaseEnv, 'HOSTED_WALLET_ORIGINS'>,
): string[] {
  return readCsvList(requireEnvString(env, 'HOSTED_WALLET_ORIGINS'));
}

export interface CloudflareD1GatewayEnv extends CloudflareD1GatewayBaseEnv {
  readonly WALLET_CONSOLE: WalletConsoleServiceBinding;
}

export interface HostedWalletGatewayDependenciesV1 {
  readonly emailOtpDeliveryProvider?: CloudflareD1RouterApiAuthServiceOptions['emailOtpDeliveryProvider'];
}

type RouterApiReadyRow = {
  readonly table_count?: unknown;
};

type RouterApiTenantScope = {
  readonly namespace: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

const RELAY_SIGNER_READY_TABLES = Object.freeze([
  'wallets',
  'wallet_auth_methods',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
  'linked_device_wallet_session_credential_deliveries_v1',
  'verified_wallet_operation_evidence_sets',
  'verified_owner_proof_consumptions',
  'email_otp_challenges',
  'email_otp_grants',
  'router_ab_yao_versioned_json_records',
  'router_ab_yao_versioned_json_cas_guard',
  'router_ab_yao_capability_replacements',
  'router_ab_normal_signing_admission_records',
  'registration_ceremony_records',
  'registration_ceremony_cas_guard',
  'lane_enrollments',
  'lane_protocol_operations',
  'lane_product_epochs',
  'lane_receipts',
  'lane_effect_journal',
  'lane_locks',
  'lane_cas_guard',
  'linked_device_sessions',
  'linked_device_session_cas_guard',
  'linked_device_session_transcripts',
  'linked_device_request_proof_nonces',
  'linked_device_target_credentials',
  'linked_device_target_commit_reservations',
  'linked_device_email_otp_grants',
  'linked_device_ed25519_export_root_transfers',
]);

const ROUTER_AB_CEREMONY_JWKS_PATH = '/.well-known/router-ab-ceremony-jwks.json';

function emitRefactor93GatewaySpan(span: RouterAbEd25519YaoGatewaySpanV1): void {
  console.log(JSON.stringify(span));
}

export function createStagingEd25519YaoBackend(
  env: CloudflareD1GatewayBaseEnv,
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1,
) {
  const keyEnvironment = stagingEd25519YaoKeyEnvironment(env);
  return createRouterAbEd25519YaoHttpRegistrationBackendFromEnv({
    env: {
      MPC_ROUTER_URL: ROUTER_AB_MPC_ROUTER_ORIGIN,
      SIGNING_WORKER_ID: requireEnvString(env, 'SIGNING_WORKER_ID'),
      ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET: requireEnvString(
        env,
        'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET',
      ),
      DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY: keyEnvironment.DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY,
      DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY: keyEnvironment.DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY,
      SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY:
        keyEnvironment.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
    },
    resolveTenantRoot,
    onSpan: emitRefactor93GatewaySpan,
    fetch: createRouterAbServiceBindingFetch(env),
  });
}

function stagingTenantScope(env: CloudflareD1GatewayBaseEnv): RouterApiTenantScope {
  return {
    namespace: requireEnvString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE'),
    orgId: requireEnvString(env, 'SEAMS_STAGING_ORG_ID'),
    projectId: requireEnvString(env, 'SEAMS_STAGING_PROJECT_ID'),
    envId: requireEnvString(env, 'SEAMS_STAGING_ENV_ID'),
  };
}

type StagingTenantRootIdentity = Parameters<
  CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage']['resolveActiveLineage']
>[0];

function createStagingTenantRootCustodyLineage(
  ops: ReturnType<typeof createWalletConsoleOpsClient>,
): CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'] {
  return {
    resolveActiveLineageForRuntimeScope: resolveRuntimeTenantRootLineage.bind(
      null,
      ops.projectEnvironments,
      ops.tenantRootActiveLineage,
    ),
    resolveActiveLineage: resolveStagingTenantRootActiveLineage.bind(
      null,
      ops.tenantRootActiveLineage,
    ),
  };
}

async function resolveStagingTenantRootActiveLineage(
  resolver: ReturnType<typeof createWalletConsoleOpsClient>['tenantRootActiveLineage'],
  identity: StagingTenantRootIdentity,
) {
  const decoded = decodeTenantRootIdentityWireV1({
    orgId: identity.orgId,
    projectId: identity.projectId,
    envId: identity.envId,
    signingRootId: identity.signingRootId,
    signingRootVersion: identity.signingRootVersion,
  });
  if (!decoded.ok) throw new Error('Staging tenant-root identity is not canonical');
  return resolver.resolveActiveLineage(decoded.value);
}

type StagingActiveTenantRootResolver = (input: {
  readonly walletId: string;
  readonly materialActivation: Parameters<
    ReturnType<
      typeof createCloudflareD1RouterApiAuthService
    >['walletRegistration']['resolveActiveEd25519TenantRoot']
  >[0]['materialActivation'];
}) => Promise<Awaited<ReturnType<RouterAbEd25519YaoTenantRootResolverV1>>>;

type StagingTenantRootContext = {
  readonly scope: RouterApiTenantScope;
  readonly tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'];
};

type StagingActiveTenantRootInput = Parameters<StagingActiveTenantRootResolver>[0];
type StagingTenantRootResolutionResult = Awaited<
  ReturnType<RouterAbEd25519YaoTenantRootResolverV1>
>;
type StagingServiceComposition = Awaited<ReturnType<typeof createStagingRouterApiAuthComposition>>;
type StagingServiceCompositionPromise = ReturnType<typeof createStagingRouterApiAuthComposition>;
type StagingServiceLoader = StagingTenantRootContext & {
  readonly env: CloudflareD1GatewayBaseEnv;
  readonly yaoRuntime: RouterAbEd25519YaoProductRegistrationRuntimeV1;
  readonly dependencies: HostedWalletGatewayDependenciesV1;
  promise: StagingServiceCompositionPromise | null;
};
type StagingRecoveryAuthorizationServices = RouterAbEd25519YaoRecoveryAuthorizationServicesV1;
type StagingLinkedAuthorityInput = Parameters<
  WarmBootstrapLinkedEd25519AuthorityReaderV1['readInstalledEd25519AuthorityByMaterialActivationV1']
>[0];
type StagingLinkedAuthorityResult = Awaited<
  ReturnType<
    WarmBootstrapLinkedEd25519AuthorityReaderV1['readInstalledEd25519AuthorityByMaterialActivationV1']
  >
>;

function stagingTenantRootIdentity(
  scope: RouterApiTenantScope,
  applicationBinding: { readonly signing_root_id: string },
  signingRootVersion: string,
): StagingTenantRootIdentity {
  const identity = buildTenantRootIdentityFromAuthenticatedDeploymentV1({
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootId: applicationBinding.signing_root_id,
    signingRootVersion,
  });
  if (!identity.ok) {
    throw new Error('Staging tenant-root identity is not canonical');
  }
  return identity.value;
}

async function resolveStagingDeploymentTenantRoot(
  scope: RouterApiTenantScope,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  applicationBinding: { readonly signing_root_id: string },
  signingRootVersion: string,
): Promise<Awaited<ReturnType<RouterAbEd25519YaoTenantRootResolverV1>>> {
  const identity = stagingTenantRootIdentity(scope, applicationBinding, signingRootVersion);
  const tenantRoot = await tenantRootCustodyLineage.resolveActiveLineage(identity);
  if (!tenantRoot) throw new Error('Ed25519 tenant root is not active');
  return tenantRoot;
}

async function resolveStagingRegistrationTenantRoot(
  context: StagingTenantRootContext,
  input: RouterAbEd25519YaoTenantRootResolutionInputV1,
): Promise<StagingTenantRootResolutionResult> {
  switch (input.operation) {
    case 'registration':
      return await resolveStagingDeploymentTenantRoot(
        context.scope,
        context.tenantRootCustodyLineage,
        input.admissionRequest.application_binding,
        input.admissionRequest.scope.root_share_epoch,
      );
    case 'recovery':
    case 'export':
      throw new Error('Ed25519 active-material tenant-root resolver is unavailable');
  }
}

async function resolveStagingTenantRoot(
  context: StagingTenantRootContext & {
    readonly resolveActiveTenantRoot: StagingActiveTenantRootResolver;
  },
  input: RouterAbEd25519YaoTenantRootResolutionInputV1,
): Promise<StagingTenantRootResolutionResult> {
  switch (input.operation) {
    case 'registration':
      return await resolveStagingDeploymentTenantRoot(
        context.scope,
        context.tenantRootCustodyLineage,
        input.admissionRequest.application_binding,
        input.admissionRequest.scope.root_share_epoch,
      );
    case 'recovery':
      return await context.resolveActiveTenantRoot({
        walletId: input.admissionRequest.application_binding.wallet_id,
        materialActivation: input.admissionRequest.active_material_activation,
      });
    case 'export':
      return await context.resolveActiveTenantRoot({
        walletId: input.admissionRequest.application_binding.wallet_id,
        materialActivation: input.admissionRequest.scope.material_activation,
      });
  }
}

type StagingLinkedDeviceTenantRootInput = Parameters<
  typeof createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1
>[0]['resolveTenantRoot'] extends (input: infer T) => Promise<unknown>
  ? T
  : never;

async function resolveStagingLinkedDeviceTenantRoot(
  context: StagingTenantRootContext,
  input: StagingLinkedDeviceTenantRootInput,
): Promise<StagingTenantRootResolutionResult> {
  return await resolveStagingDeploymentTenantRoot(
    context.scope,
    context.tenantRootCustodyLineage,
    input.applicationBinding,
    input.targetAdmission.binding.lifecycle.root_share_epoch,
  );
}

function createStagingRegistrationTenantRootResolver(
  scope: RouterApiTenantScope,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): RouterAbEd25519YaoTenantRootResolverV1 {
  return resolveStagingRegistrationTenantRoot.bind(undefined, {
    scope,
    tenantRootCustodyLineage,
  });
}

function createStagingTenantRootResolver(
  scope: RouterApiTenantScope,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  resolveActiveTenantRoot: StagingActiveTenantRootResolver,
): RouterAbEd25519YaoTenantRootResolverV1 {
  return resolveStagingTenantRoot.bind(undefined, {
    scope,
    tenantRootCustodyLineage,
    resolveActiveTenantRoot,
  });
}

function createStagingLinkedDeviceTenantRootResolver(
  scope: RouterApiTenantScope,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): Parameters<
  typeof createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1
>[0]['resolveTenantRoot'] {
  return resolveStagingLinkedDeviceTenantRoot.bind(undefined, {
    scope,
    tenantRootCustodyLineage,
  });
}

async function createStagingRouterApiAuthComposition(
  env: CloudflareD1GatewayBaseEnv,
  scope: RouterApiTenantScope,
  yaoRuntime: RouterAbEd25519YaoProductRegistrationRuntimeV1,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  dependencies: HostedWalletGatewayDependenciesV1,
) {
  const ecdsaCeremonyTokenIssuer = createStagingEcdsaCeremonyTokenIssuer(env);
  const topology = requireStagingEcdsaRegistrationTopology(env);
  const tokenScope = {
    orgId: scope.orgId,
    projectId: scope.projectId,
    environment: scope.envId,
  };
  const ecdsaStrictRegistration = createRouterAbEcdsaStrictRegistrationPort({
    router: env.MPC_ROUTER,
    tokenIssuer: ecdsaCeremonyTokenIssuer,
    tokenScope,
    topology,
  });
  const ecdsaStrictPostRegistration = createRouterAbEcdsaStrictPostRegistrationPort({
    router: env.MPC_ROUTER,
    tokenIssuer: ecdsaCeremonyTokenIssuer,
    tokenScope,
    topology,
  });
  const service = createCloudflareD1RouterApiAuthService({
    database: env.SIGNER_DB,
    namespace: scope.namespace,
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    relayerAccount: readEnvString(env, 'RELAYER_ACCOUNT_ID'),
    relayerPublicKey: readEnvString(env, 'RELAYER_PUBLIC_KEY'),
    relayerPrivateKey: readEnvString(env, 'RELAYER_PRIVATE_KEY'),
    nearRpcUrl: readEnvString(env, 'NEAR_RPC_URL'),
    signerWasmModuleOrPath: loadCloudflareSignerWasmModule,
    accountInitialBalance: readEnvString(env, 'ACCOUNT_INITIAL_BALANCE'),
    implicitNearAccountTestFundingEnabled: readEnvString(
      env,
      'ENABLE_IMPLICIT_NEAR_ACCOUNT_TEST_FUNDING',
    ),
    googleOidcClientId: readEnvString(env, 'GOOGLE_OIDC_CLIENT_ID'),
    githubOAuth: stagingGithubOAuthConfig(env),
    accountIdDerivationSecret: requireEnvString(env, 'ACCOUNT_ID_DERIVATION_SECRET'),
    emailOtpServerSeal: stagingEmailOtpServerSealConfig(env),
    emailOtpDeliveryMode: readEnvString(env, 'EMAIL_OTP_DELIVERY_MODE'),
    emailOtpRuntimeProfile: readEnvString(env, 'EMAIL_OTP_RUNTIME_PROFILE'),
    emailOtpDeliveryProvider: dependencies.emailOtpDeliveryProvider,
    emailOtpDemoAllowedOrigins: readEnvString(env, 'EMAIL_OTP_DEMO_ALLOWED_ORIGINS'),
    emailOtpProduction: readEnvString(env, 'EMAIL_OTP_PRODUCTION'),
    emailOtpDevOutboxEnabled: readEnvString(env, 'EMAIL_OTP_DEV_OUTBOX_ENABLED'),
    emailOtpChallengeRateLimitMax: readEnvString(env, 'EMAIL_OTP_CHALLENGE_RATE_LIMIT_MAX'),
    emailOtpChallengeRateLimitWindowMs: readEnvString(
      env,
      'EMAIL_OTP_CHALLENGE_RATE_LIMIT_WINDOW_MS',
    ),
    emailOtpVerifyRateLimitMax: readEnvString(env, 'EMAIL_OTP_VERIFY_RATE_LIMIT_MAX'),
    emailOtpVerifyRateLimitWindowMs: readEnvString(env, 'EMAIL_OTP_VERIFY_RATE_LIMIT_WINDOW_MS'),
    emailOtpGrantRateLimitMax: readEnvString(env, 'EMAIL_OTP_GRANT_RATE_LIMIT_MAX'),
    emailOtpGrantRateLimitWindowMs: readEnvString(env, 'EMAIL_OTP_GRANT_RATE_LIMIT_WINDOW_MS'),
    emailOtpMaxAttempts: readEnvString(env, 'EMAIL_OTP_MAX_ATTEMPTS'),
    emailOtpLockoutTtlMs: readEnvString(env, 'EMAIL_OTP_LOCKOUT_TTL_MS'),
    emailOtpGoogleRegistrationAttemptRateLimitMax: readEnvString(
      env,
      'EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_MAX',
    ),
    emailOtpGoogleRegistrationAttemptRateLimitWindowMs: readEnvString(
      env,
      'EMAIL_OTP_GOOGLE_REGISTRATION_ATTEMPT_RATE_LIMIT_WINDOW_MS',
    ),
    routerAbEcdsaPresignRuntime: createStagingEcdsaPresignRuntime(env),
    ed25519YaoProductRegistration: yaoRuntime,
    ecdsaStrictRegistration,
    tenantRootCustodyLineage,
    linkedDevice: stagingLinkedDeviceSessionComposition(env, scope, tenantRootCustodyLineage),
  });
  return { service, ecdsaStrictPostRegistration };
}

async function loadStagingRouterApiAuthComposition(
  context: StagingServiceLoader,
): Promise<StagingServiceComposition> {
  context.promise ??= createStagingRouterApiAuthComposition(
    context.env,
    context.scope,
    context.yaoRuntime,
    context.tenantRootCustodyLineage,
    context.dependencies,
  );
  return await context.promise;
}

async function resolveStagingActiveTenantRootFromService(
  service: ReturnType<typeof createCloudflareD1RouterApiAuthService>,
  input: StagingActiveTenantRootInput,
): Promise<StagingTenantRootResolutionResult> {
  const resolved = await service.walletRegistration.resolveActiveEd25519TenantRoot(input);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved;
}

async function resolveStagingActiveTenantRootFromLoader(
  context: StagingServiceLoader,
  input: StagingActiveTenantRootInput,
): Promise<StagingTenantRootResolutionResult> {
  const { service } = await loadStagingRouterApiAuthComposition(context);
  return await resolveStagingActiveTenantRootFromService(service, input);
}

async function resolveStagingRecoveryAuthorizationServices(
  context: StagingServiceLoader,
): Promise<StagingRecoveryAuthorizationServices> {
  const { service } = await loadStagingRouterApiAuthComposition(context);
  return {
    authorizationSessions: service.authorizationSessions,
    preparedRecoveryAdmission: service.passkeyCustody,
    resolveEd25519MaterialActivation:
      service.walletRegistration.resolveEd25519MaterialActivation.bind(service.walletRegistration),
  };
}

async function readStagingLinkedAuthority(
  context: StagingServiceLoader,
  input: StagingLinkedAuthorityInput,
): Promise<StagingLinkedAuthorityResult> {
  const { service } = await loadStagingRouterApiAuthComposition(context);
  const reader = service.linkedDeviceEd25519AuthorityReader;
  return reader ? await reader.readInstalledEd25519AuthorityByMaterialActivationV1(input) : null;
}

function stagingLinkedDeviceSessionComposition(
  env: CloudflareD1GatewayBaseEnv,
  scope: RouterApiTenantScope,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): NonNullable<CloudflareD1RouterApiAuthServiceOptions['linkedDevice']> {
  const walletStore = new D1WalletStore({
    database: env.SIGNER_DB,
    ...scope,
    ensureSchema: false,
  });
  const walletAuthMethodStore = new D1WalletAuthMethodStore({
    database: env.SIGNER_DB,
    ...scope,
    ensureSchema: false,
  });
  const sourceChildReader = createD1LinkedDeviceOwnerSourceChildReaderV1({
    walletAuthMethodStore,
    walletStore,
  });
  const serviceFetch = createRouterAbServiceBindingFetch(env);
  const internalServiceAuthSecret = requireEnvString(env, 'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET');
  const keyEnvironment = stagingEd25519YaoKeyEnvironment(env);
  const deriverAInputPublicKeyB64u = x25519PublicKeyB64u(
    keyEnvironment.DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY,
  );
  const deriverBInputPublicKeyB64u = x25519PublicKeyB64u(
    keyEnvironment.DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY,
  );
  const signingWorkerRecipientPublicKeyB64u = x25519PublicKeyB64u(
    keyEnvironment.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
  );
  return {
    session: {
      readOwnerSourceChildV1: sourceChildReader.readOwnerSourceChildV1,
      targetPasskeyRpId: requireEnvString(env, 'LINKED_DEVICE_WEBAUTHN_RP_ID'),
      targetCredential: ({
        verifiedLinkBuilder,
        targetCredentialVerification,
        targetPlanner,
        resolveOwnerSourceChildV1,
        emailOtpGrants,
      }) =>
        new D1LinkedDeviceTargetCredentialProviderV1({
          database: env.SIGNER_DB,
          scope,
          verifier: targetCredentialVerification,
          ...(emailOtpGrants === undefined ? {} : { emailOtpGrants }),
          planner: targetPlanner,
          sourceContributionPreparationPlanner:
            createD1LinkedDeviceSourceContributionPreparationPlannerV1({
              resolveOwnerSourceChildV1,
              deriverAInputPublicKeyB64u,
              deriverBInputPublicKeyB64u,
              signingWorkerRecipientPublicKeyB64u,
            }),
          verifiedLinkBuilder,
        }),
      authorityInstallation: {
        reservationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialReservationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
        activationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialActivationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
        deactivationEndpoint: createCloudflareOrdinaryInactiveSignerMaterialDeactivationEndpointV1({
          fetch: serviceFetch,
          internalServiceAuthSecret,
        }),
      },
      sourceContributionRouter: createCloudflareLinkedDeviceEd25519SourcePreservingRouterEndpointV1(
        {
          fetch: serviceFetch,
          internalServiceAuthSecret,
          resolveTenantRoot: createStagingLinkedDeviceTenantRootResolver(
            scope,
            tenantRootCustodyLineage,
          ),
        },
      ),
    },
  };
}

/**
 * The split Wallet Gateway (R105 Phase 4 cutover target): serves the Wallet
 * runtime only, holds no Console database binding, and reaches the Wallet
 * Console deployment exclusively through the exact service-binding ops.
 * The sponsored-relay route extensions stay on the Wallet Console deployment
 * until policy/sponsorship resolution operations join the binding.
 */
export async function createHostedWalletGatewayCompositionV1(
  env: CloudflareD1GatewayEnv,
  dependencies: HostedWalletGatewayDependenciesV1 = {},
) {
  const scope = stagingTenantScope(env);
  const session = stagingSessionAdapter(env);
  const tenantRootCustodyLineage = createStagingTenantRootCustodyLineage(
    createWalletConsoleOpsClient(env.WALLET_CONSOLE),
  );
  const yaoRuntime = createStagingYaoRequestScopedRuntime(
    env,
    createStagingRegistrationTenantRootResolver(scope, tenantRootCustodyLineage),
  );
  const { service, ecdsaStrictPostRegistration } = await createStagingRouterApiAuthComposition(
    env,
    scope,
    yaoRuntime,
    tenantRootCustodyLineage,
    dependencies,
  );
  const handler = createCloudflareWalletGatewayRouterV1({
    service,
    walletConsole: env.WALLET_CONSOLE,
    signerDatabase: env.SIGNER_DB,
    signerStorageNamespace: scope.namespace,
    router: {
      healthz: true,
      readyz: true,
      corsOrigins: readCsvList(env.RELAY_CORS_ORIGINS),
      hostedWalletOrigins: readStagingHostedWalletOrigins(env),
      session,
      sessionCookieName: readEnvString(env, 'SESSION_COOKIE_NAME'),
      routerAbPublicKeyset: requireStagingRouterAbPublicKeyset(env),
      routerAbNormalSigningRouterProxy: {
        internalServiceAuthSecret: requireEnvString(env, 'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET'),
        fetch: (request) => env.MPC_ROUTER.fetch(request),
      },
      routerAbEcdsaStrictPostRegistration: ecdsaStrictPostRegistration,
      readyCheck: async () => {
        await assertD1Tables({
          database: env.SIGNER_DB,
          label: 'SIGNER_DB',
          tables: RELAY_SIGNER_READY_TABLES,
        });
      },
      signingSessionSeal: stagingSigningSessionSealOptions(env),
      routerAbEd25519YaoProduct: yaoRuntime,
    },
  });
  return { handler, service, session };
}

export async function createSplitGatewayRouterHandler(
  env: CloudflareD1GatewayEnv,
  dependencies: HostedWalletGatewayDependenciesV1 = {},
): Promise<FetchHandler> {
  const composition = await createHostedWalletGatewayCompositionV1(env, dependencies);
  return composition.handler;
}

export async function handleSplitGatewayWalletRuntimeRequest(
  request: Request,
  env: CloudflareD1GatewayEnv & WalletControlRuntimeBindings,
  dependencies: HostedWalletGatewayDependenciesV1 = {},
): Promise<Response | null> {
  const controlResponse = await handleWalletControlRequest(request, env);
  if (controlResponse) return controlResponse;
  const handler = createWalletRuntimeOpsHandler(async () => {
    const scope = stagingTenantScope(env);
    const tenantRootCustodyLineage = createStagingTenantRootCustodyLineage(
      createWalletConsoleOpsClient(env.WALLET_CONSOLE),
    );
    const yaoRuntime = createStagingYaoRequestScopedRuntime(
      env,
      createStagingRegistrationTenantRootResolver(scope, tenantRootCustodyLineage),
    );
    const { service } = await createStagingRouterApiAuthComposition(
      env,
      scope,
      yaoRuntime,
      tenantRootCustodyLineage,
      dependencies,
    );
    return {
      executeSignedDelegate: service.executeSignedDelegate.bind(service),
      getRelayerAccount: service.router.getRelayerAccount.bind(service.router),
      getWalletIdentities: (input) => readWalletRuntimeIdentities(env, input),
    };
  });
  return await handler(request);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function readWalletRuntimeIdentities(
  env: CloudflareD1GatewayEnv,
  input: WalletRuntimeWalletIdentityRequest,
): Promise<WalletRuntimeWalletIdentitiesResult> {
  const placeholders = input.wallets.map(() => '?').join(', ');
  const rows = await env.SIGNER_DB.prepare(
    `SELECT project_id, wallet_id, signer_family, record_json
       FROM wallet_signers
      WHERE namespace = ?
        AND org_id = ?
        AND wallet_id IN (${placeholders})`,
  )
    .bind(
      requireEnvString(env, 'SEAMS_TENANT_STORAGE_NAMESPACE'),
      input.orgId,
      ...input.wallets.map((wallet) => wallet.walletId),
    )
    .all<D1Row>();
  const requestedWallets = new Map(input.wallets.map((wallet) => [wallet.walletId, wallet]));
  const identities = new Map<string, { nearAccountId: string; evmAddress: `0x${string}` | null }>();
  for (const row of rows.results || []) {
    const walletId = String(row.wallet_id || '').trim();
    const requested = requestedWallets.get(walletId);
    if (!requested || requested.projectId !== String(row.project_id || '').trim()) continue;
    const record = parseD1JsonColumn(row.record_json);
    if (!isJsonRecord(record)) continue;
    const current = identities.get(walletId) || { nearAccountId: '', evmAddress: null };
    if (String(row.signer_family || '').trim() === 'ed25519') {
      current.nearAccountId = String(record.nearAccountId || '').trim();
    }
    if (String(row.signer_family || '').trim() === 'ecdsa' && isJsonRecord(record.walletKey)) {
      const address = String(record.walletKey.thresholdOwnerAddress || '')
        .trim()
        .toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(address)) current.evmAddress = address as `0x${string}`;
    }
    identities.set(walletId, current);
  }
  return {
    identities: Array.from(identities.entries()).flatMap(([walletId, identity]) =>
      identity.nearAccountId && identity.evmAddress
        ? [{ walletId, nearAccountId: identity.nearAccountId, evmAddress: identity.evmAddress }]
        : [],
    ),
  };
}

export async function handleSplitGatewayRequest(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 = {},
): Promise<Response> {
  if (request.method === 'GET' && new URL(request.url).pathname === ROUTER_AB_CEREMONY_JWKS_PATH) {
    return routerAbCeremonyJwksResponse(env);
  }
  const operation = yaoDirectOperationForRequest(request);
  if (operation !== null) {
    const response = await handlePartitionedD1Operation(
      env,
      request,
      operation,
      createStagingTenantRootCustodyLineage(createWalletConsoleOpsClient(env.WALLET_CONSOLE)),
      dependencies,
    );
    withCors(response.headers, { corsOrigins: readCsvList(env.RELAY_CORS_ORIGINS) }, request);
    return response;
  }
  const handler = await createSplitGatewayRouterHandler(env, dependencies);
  return await handler(request, env, ctx);
}

function requireStagingRouterAbPublicKeyset(
  env: CloudflareD1GatewayBaseEnv,
): RouterAbPublicKeysetV2 {
  const source = requireEnvString(env, 'ROUTER_AB_PUBLIC_KEYSET_JSON');
  const parsed = parseJsonValue(source);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (Object.getPrototypeOf(parsed) !== Object.prototype && Object.getPrototypeOf(parsed) !== null)
  ) {
    throw new Error('ROUTER_AB_PUBLIC_KEYSET_JSON must contain a JSON object');
  }
  return parseRouterAbPublicKeysetV2(parsed);
}

function stagingEd25519YaoKeyEnvironment(env: CloudflareD1GatewayBaseEnv) {
  const keyset = requireStagingRouterAbPublicKeyset(env);
  return {
    DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY:
      keyset.signer_envelope_hpke.current.deriver_a.public_key,
    DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY:
      keyset.signer_envelope_hpke.current.deriver_b.public_key,
    SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY:
      keyset.signing_worker_server_output_hpke.public_key,
  };
}

function x25519PublicKeyB64u(value: string): string {
  if (!/^x25519:[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      'signing worker server output HPKE public key must use x25519:<64 lowercase hex chars> encoding',
    );
  }
  const hex = value.slice('x25519:'.length);
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return base64UrlEncode(bytes);
}

function createStagingEcdsaCeremonyTokenIssuer(
  env: CloudflareD1GatewayBaseEnv,
): RouterAbEcdsaCeremonyTokenIssuer {
  return createRouterAbEcdsaEd25519CeremonyTokenIssuer({
    issuer: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_ISSUER'),
    audience: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_AUDIENCE'),
    keyId: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_KEY_ID'),
    privateJwk: requireStagingEcdsaCeremonyPrivateJwk(env),
  });
}

function requireStagingEcdsaCeremonyPrivateJwk(env: CloudflareD1GatewayBaseEnv) {
  const privateJwkSource = requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK');
  const privateJwk = parseRouterAbEcdsaEd25519PrivateJwk(parseJsonValue(privateJwkSource));
  if (!privateJwk) {
    throw new Error('ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK must be an Ed25519 private JWK');
  }
  return privateJwk;
}

function requireStagingEcdsaRegistrationTopology(
  env: CloudflareD1GatewayBaseEnv,
): RouterAbEcdsaStrictRegistrationTopology {
  const source = requireEnvString(env, 'ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON');
  const topology = parseRouterAbEcdsaStrictRegistrationTopology(parseJsonValue(source));
  if (!topology) {
    throw new Error(
      'ROUTER_AB_ECDSA_REGISTRATION_TOPOLOGY_JSON must contain the MPCRouter topology',
    );
  }
  return topology;
}

function routerAbCeremonyJwksResponse(env: CloudflareD1GatewayBaseEnv): Response {
  const issuer = createStagingEcdsaCeremonyTokenIssuer(env);
  return new Response(JSON.stringify(issuer.publicJwks()), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

let cachedStagingSigningSessionSealOptions: SigningSessionSealRoutesOptions | null = null;

export function stagingSigningSessionSealOptions(
  env: Pick<
    CloudflareD1GatewayBaseEnv,
    | 'SIGNING_SESSION_SEAL_ROOT_SECRET_B64U'
    | 'SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION'
    | 'SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS'
  >,
): SigningSessionSealRoutesOptions | undefined {
  if (cachedStagingSigningSessionSealOptions) return cachedStagingSigningSessionSealOptions;
  const seal = stagingEmailOtpServerSealConfig(env);
  if (!seal) return undefined;
  cachedStagingSigningSessionSealOptions = createSigningSessionSealOptions({
    rootSecretB64u: seal.rootSecretB64u,
    currentKeyVersion: seal.currentKeyVersion,
    acceptedWarmKeyVersions: seal.acceptedWarmKeyVersions,
  });
  return cachedStagingSigningSessionSealOptions;
}

function createStagingEcdsaPresignRuntime(
  env: CloudflareD1GatewayBaseEnv,
): RouterAbEcdsaPresignRuntime {
  return new RouterAbEcdsaPresignRuntime({
    config: {
      nodeRole: 'coordinator',
      participantIds: {
        clientParticipantId: 1,
        relayerParticipantId: 2,
        participantIds2p: [1, 2],
      },
    },
    signingWorkerTransport: {
      kind: 'configured',
      signingWorkerBaseUrl: ROUTER_AB_SIGNING_WORKER_ORIGIN,
      auth: {
        kind: 'internal_service_auth_secret',
        secret: requireEnvString(env, 'ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET'),
      },
      fetchImpl: createRouterAbServiceBindingFetch(env),
    },
    ensureReady: readyStagingEcdsaPresignRuntime,
  });
}

async function readyStagingEcdsaPresignRuntime(): Promise<void> {}

async function assertD1Tables(input: {
  readonly database: D1DatabaseLike;
  readonly label: string;
  readonly tables: readonly string[];
}): Promise<void> {
  const row = await input.database
    .prepare(
      `SELECT COUNT(*) AS table_count
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${d1StringList(input.tables)})`,
    )
    .first<RouterApiReadyRow>();
  const count = Number(row?.table_count || 0);
  if (count !== input.tables.length) {
    throw new Error(
      `${input.label} migration has created ${count} of ${input.tables.length} staging-ready tables`,
    );
  }
}

function stagingEmailOtpServerSealConfig(
  env: Pick<
    CloudflareD1GatewayBaseEnv,
    | 'SIGNING_SESSION_SEAL_ROOT_SECRET_B64U'
    | 'SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION'
    | 'SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS'
  >,
): CloudflareD1EmailOtpServerSealConfig | undefined {
  const rootSecretB64u = readEnvString(env, 'SIGNING_SESSION_SEAL_ROOT_SECRET_B64U');
  const currentKeyVersion = readEnvString(env, 'SIGNING_SESSION_SEAL_CURRENT_KEY_VERSION');
  const acceptedWarmKeyVersions = readEnvString(
    env,
    'SIGNING_SESSION_SEAL_ACCEPTED_WARM_KEY_VERSIONS',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!rootSecretB64u && !currentKeyVersion) {
    return undefined;
  }
  if (!rootSecretB64u || !currentKeyVersion || acceptedWarmKeyVersions.length === 0) {
    throw new Error(
      'Email OTP server seal requires the root secret, current key version, and accepted warm key versions',
    );
  }
  return {
    rootSecretB64u,
    currentKeyVersion,
    acceptedWarmKeyVersions,
  };
}

function stagingGithubOAuthConfig(env: CloudflareD1GatewayBaseEnv) {
  const clientId = readEnvString(env, 'GITHUB_OAUTH_CLIENT_ID');
  const clientSecret = readEnvString(env, 'GITHUB_OAUTH_CLIENT_SECRET');
  const callbackUrl = readEnvString(env, 'GITHUB_OAUTH_CALLBACK_URL');
  if (!clientId && !clientSecret && !callbackUrl) return undefined;
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error(
      'GitHub OAuth requires GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_CALLBACK_URL',
    );
  }
  return { clientId, clientSecret, callbackUrl };
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function d1StringList(values: readonly string[]): string {
  return values.map(d1StringLiteral).join(', ');
}

function d1StringLiteral(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`invalid D1 table name ${value}`);
  }
  return `'${value}'`;
}

type RouterApiYaoDirectOperationV1 =
  | 'registration_admission'
  | 'registration_execute'
  | 'recovery_bootstrap'
  | 'recovery_admission'
  | 'recovery_execute'
  | 'recovery_activate'
  | 'recovery_status'
  | 'export_admission'
  | 'export_execute';

function yaoDirectOperationForRequest(request: Request): RouterApiYaoDirectOperationV1 | null {
  if (request.method !== 'POST') return null;
  const pathname = new URL(request.url).pathname;
  switch (pathname) {
    case ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1:
      return 'registration_admission';
    case ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1:
      return 'registration_execute';
    case ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1:
      return 'recovery_bootstrap';
    case ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1:
      return 'recovery_admission';
    case ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1:
      return 'recovery_execute';
    case ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1:
      return 'recovery_activate';
    case ROUTER_AB_ED25519_YAO_RECOVERY_STATUS_PATH_V1:
      return 'recovery_status';
    case ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1:
      return 'export_admission';
    case ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1:
      return 'export_execute';
    default:
      return null;
  }
}

async function handlePartitionedD1Operation(
  env: CloudflareD1GatewayBaseEnv,
  request: Request,
  operation: RouterApiYaoDirectOperationV1,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  dependencies: HostedWalletGatewayDependenciesV1,
): Promise<Response> {
  switch (operation) {
    case 'registration_admission':
    case 'registration_execute':
      return await handleRouterAbEd25519YaoRegistrationRequestScopedCloudflareV1({
        request,
        store: createStagingYaoPartitionedStateStore(env),
        backend: createStagingEd25519YaoBackend(
          env,
          createStagingRegistrationTenantRootResolver(
            stagingTenantScope(env),
            tenantRootCustodyLineage,
          ),
        ),
      });
    case 'recovery_bootstrap':
    case 'recovery_admission':
    case 'recovery_execute':
    case 'recovery_activate':
    case 'recovery_status':
      return await handleRouterAbEd25519YaoRecoveryRequestScopedCloudflareV1({
        request,
        ...createStagingRecoveryRequestScopedDependencies(
          env,
          tenantRootCustodyLineage,
          dependencies,
        ),
      });
    case 'export_admission':
    case 'export_execute': {
      const scope = stagingTenantScope(env);
      const yaoRuntime = createStagingYaoRequestScopedRuntime(
        env,
        createStagingRegistrationTenantRootResolver(scope, tenantRootCustodyLineage),
      );
      const { service } = await createStagingRouterApiAuthComposition(
        env,
        scope,
        yaoRuntime,
        tenantRootCustodyLineage,
        dependencies,
      );
      return await handleRouterAbEd25519YaoExportRequestScopedCloudflareV1({
        request,
        ...createStagingExportRequestScopedDependencies(env, service, tenantRootCustodyLineage),
      });
    }
  }
}

function createStagingYaoPartitionedStateStore(
  env: CloudflareD1GatewayBaseEnv,
): ReturnType<typeof createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1> {
  const scope = stagingTenantScope(env);
  return createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1({
    database: env.SIGNER_DB,
    scope,
  });
}

async function loadStagingPersistedActiveCapability(
  env: CloudflareD1GatewayBaseEnv,
  lookup: Parameters<RouterAbEd25519YaoProductRegistrationRuntimeV1['resolveActiveCapability']>[0],
) {
  const walletId = parseWalletId(lookup.walletId);
  if (!walletId.ok) return null;
  const signer = await stagingWalletStore(env).getEd25519SignerBySlot({
    walletId: walletId.value,
    signerSlot: lookup.signerSlot,
  });
  return signer?.activeYaoCapability || null;
}

function createStagingYaoRequestScopedRuntime(
  env: CloudflareD1GatewayBaseEnv,
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1,
): RouterAbEd25519YaoProductRegistrationRuntimeV1 {
  return createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1({
    signingWorkerId: requireEnvString(env, 'SIGNING_WORKER_ID'),
    store: createStagingYaoPartitionedStateStore(env),
    registrationBackend: createStagingEd25519YaoBackend(env, resolveTenantRoot),
    loadPersistedActiveCapability: loadStagingPersistedActiveCapability.bind(undefined, env),
  });
}

/**
 * Builds the recovery request-scoped dependencies from the environment alone.
 * This is new composition wiring over the existing authorization classes, not a
 * second authorization implementation: the same adapter the tenant runtime uses
 * is constructed here against request-scoped state instead of runtime-held
 * state, which is the dependency Refactor 93 exists to remove.
 */
export function createStagingRecoveryRequestScopedDependencies(
  env: CloudflareD1GatewayBaseEnv,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
  dependencies: HostedWalletGatewayDependenciesV1 = {},
): {
  readonly store: ReturnType<typeof createStagingYaoPartitionedStateStore>;
  readonly backend: ReturnType<typeof createStagingEd25519YaoBackend>;
  readonly authorization: RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter;
  readonly capabilityPersistence: CloudflareD1RouterAbEd25519YaoCapabilityPersistence;
  readonly capabilities: RouterAbEd25519YaoProductRegistrationRuntimeV1;
  readonly linkedAuthorities: WarmBootstrapLinkedEd25519AuthorityReaderV1;
} {
  const scope = stagingTenantScope(env);
  const store = createStagingYaoPartitionedStateStore(env);
  const registrationTenantRootResolver = createStagingRegistrationTenantRootResolver(
    scope,
    tenantRootCustodyLineage,
  );
  const yaoRuntime = createStagingYaoRequestScopedRuntime(env, registrationTenantRootResolver);
  const serviceLoader: StagingServiceLoader = {
    env,
    scope,
    yaoRuntime,
    tenantRootCustodyLineage,
    dependencies,
    promise: null,
  };
  const resolveActiveTenantRoot: StagingActiveTenantRootResolver =
    resolveStagingActiveTenantRootFromLoader.bind(undefined, serviceLoader);
  const tenantRootResolver = createStagingTenantRootResolver(
    scope,
    tenantRootCustodyLineage,
    resolveActiveTenantRoot,
  );
  return {
    store,
    backend: createStagingEd25519YaoBackend(env, tenantRootResolver),
    authorization: new RouterAbEd25519YaoRecoveryWalletSessionAuthorizationAdapter(
      resolveStagingRecoveryAuthorizationServices.bind(undefined, serviceLoader),
    ),
    capabilityPersistence: new CloudflareD1RouterAbEd25519YaoCapabilityPersistence({
      database: env.SIGNER_DB,
      scope,
      walletStore: stagingWalletStore(env),
      ensureSchema: false,
    }),
    capabilities: yaoRuntime,
    /* Warm bootstraps for device-linked authorities need the installed linked
       projection; built on first use the same way the authorization adapter
       builds its composition. */
    linkedAuthorities: {
      readInstalledEd25519AuthorityByMaterialActivationV1: readStagingLinkedAuthority.bind(
        undefined,
        serviceLoader,
      ),
    },
  };
}

/**
 * Builds export request-scoped state while reusing the request's authoritative
 * Router API factor and owner-proof services.
 */
export function createStagingExportRequestScopedDependencies(
  env: CloudflareD1GatewayBaseEnv,
  service: ReturnType<typeof createCloudflareD1RouterApiAuthService>,
  tenantRootCustodyLineage: CloudflareD1RouterApiAuthServiceOptions['tenantRootCustodyLineage'],
): {
  readonly store: ReturnType<typeof createStagingYaoPartitionedStateStore>;
  readonly backend: ReturnType<typeof createStagingEd25519YaoBackend>;
  readonly authorization: RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter;
  readonly capabilities: RouterAbEd25519YaoProductRegistrationRuntimeV1;
} {
  const scope = stagingTenantScope(env);
  const registrationTenantRootResolver = createStagingRegistrationTenantRootResolver(
    scope,
    tenantRootCustodyLineage,
  );
  const resolveActiveTenantRoot: StagingActiveTenantRootResolver =
    resolveStagingActiveTenantRootFromService.bind(undefined, service);
  const store = createStagingYaoPartitionedStateStore(env);
  return {
    store,
    backend: createStagingEd25519YaoBackend(
      env,
      createStagingTenantRootResolver(scope, tenantRootCustodyLineage, resolveActiveTenantRoot),
    ),
    authorization: new RouterAbEd25519YaoExportOwnerProofAuthorizationAdapter(
      service.webAuthn,
      service.emailOtp,
      service.walletAuthMethods,
      service.authorizedOperations,
      service.walletRegistration.resolveEd25519MaterialActivation.bind(service.walletRegistration),
    ),
    capabilities: createStagingYaoRequestScopedRuntime(env, registrationTenantRootResolver),
  };
}

function stagingSessionAdapter(env: CloudflareD1GatewayBaseEnv) {
  return createEd25519SessionAdapter({
    privateJwk: requireStagingEcdsaCeremonyPrivateJwk(env),
    keyId: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_KEY_ID'),
    cookieName: readEnvString(env, 'SESSION_COOKIE_NAME'),
    issuer: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_ISSUER'),
    audience: requireEnvString(env, 'ROUTER_AB_CEREMONY_JWT_AUDIENCE'),
  });
}

function stagingWalletStore(env: CloudflareD1GatewayBaseEnv): D1WalletStore {
  const scope = stagingTenantScope(env);
  return new D1WalletStore({
    database: env.SIGNER_DB,
    namespace: scope.namespace,
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    ensureSchema: false,
  });
}
