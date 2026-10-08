import type {
  RouterApiKeyAuthAdapter,
  RouterApiKeyAuthFailureCode,
  RouterApiKeyAuthResult,
  RouterApiKeyPrincipal,
  RouterApiProjectEnvironment,
  RouterApiPublishableKeyAuthAdapter,
  RouterApiPublishableKeyAuthFailureCode,
  RouterApiPublishableKeyAuthResult,
  RouterApiProjectEnvironmentResolver,
  RouterApiUsageMeterAdapter,
} from '../../framework/apiCredentialPorts';
import { ROUTER_API_CREDENTIAL_SCOPES } from '../../framework/apiCredentialPorts';
import {
  decodeWalletConsoleTenantRootActiveLineageResponseV1,
  WALLET_CONSOLE_OP_PATHS_V1,
  WALLET_CONSOLE_SERVICE_ORIGIN_V1,
  type WalletConsoleTenantRootActiveLineageResolverV1,
  type WalletConsoleTenantRootActiveLineageV1,
} from './walletConsoleOps';
import type { TenantRootIdentityWireV1 } from '@shared/tenant-root';

/** The shape of a Cloudflare service binding (`Fetcher`). */
export interface WalletConsoleServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface WalletConsoleOpsClient {
  readonly apiKeyAuth: RouterApiKeyAuthAdapter;
  readonly publishableKeyAuth: RouterApiPublishableKeyAuthAdapter;
  readonly usageMeter: RouterApiUsageMeterAdapter;
  readonly projectEnvironments: RouterApiProjectEnvironmentResolver;
  readonly tenantRootActiveLineage: WalletConsoleTenantRootActiveLineageResolverV1;
}

// The origin is never routable: service bindings dispatch on the bound Worker,
// not DNS. It only namespaces the internal request URL.
async function postJson(
  service: WalletConsoleServiceBinding,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await service.fetch(`${WALLET_CONSOLE_SERVICE_ORIGIN_V1}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  return { status: response.status, body: parsed };
}

const PRINCIPAL_FIELDS = new Set([
  'apiKeyId',
  'orgId',
  'projectId',
  'envId',
  'environmentId',
  'scopes',
]);

const PROJECT_ENVIRONMENT_FIELDS = new Set([
  'id',
  'projectId',
  'key',
  'signingRootVersion',
  'status',
]);

function responseText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRouterApiCredentialScope(
  value: string,
): value is RouterApiKeyPrincipal['scopes'][number] {
  return (ROUTER_API_CREDENTIAL_SCOPES as readonly string[]).includes(value);
}

function authFailureStatus(status: number): 401 | 403 {
  return status === 403 ? 403 : 401;
}

function parseRouterApiKeyPrincipal(value: unknown): RouterApiKeyPrincipal | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  for (const field of Object.keys(record)) {
    if (!PRINCIPAL_FIELDS.has(field)) return null;
  }
  const apiKeyId = responseText(record.apiKeyId);
  const orgId = responseText(record.orgId);
  const environmentId = responseText(record.environmentId);
  if (!apiKeyId || !orgId || !environmentId || !Array.isArray(record.scopes)) return null;
  const scopes: RouterApiKeyPrincipal['scopes'] = [];
  for (const value of record.scopes) {
    if (typeof value !== 'string' || !isRouterApiCredentialScope(value)) return null;
    scopes.push(value);
  }
  const projectId = Object.hasOwn(record, 'projectId') ? responseText(record.projectId) : null;
  if (Object.hasOwn(record, 'projectId') && !projectId) return null;
  const envId = Object.hasOwn(record, 'envId') ? responseText(record.envId) : null;
  if (Object.hasOwn(record, 'envId') && !envId) return null;
  return {
    apiKeyId,
    orgId,
    environmentId,
    scopes,
    ...(projectId ? { projectId } : {}),
    ...(envId ? { envId } : {}),
  };
}

function parseSecretKeyFailureCode(value: unknown): RouterApiKeyAuthFailureCode | null {
  switch (value) {
    case 'secret_key_missing':
    case 'secret_key_invalid':
    case 'secret_key_revoked':
    case 'secret_key_forbidden_scope':
    case 'secret_key_ip_blocked':
    case 'secret_key_environment_mismatch':
      return value;
    default:
      return null;
  }
}

function parsePublishableKeyFailureCode(
  value: unknown,
): RouterApiPublishableKeyAuthFailureCode | null {
  switch (value) {
    case 'publishable_key_missing':
    case 'publishable_key_invalid':
    case 'publishable_key_revoked':
    case 'publishable_key_origin_blocked':
    case 'publishable_key_environment_mismatch':
      return value;
    default:
      return null;
  }
}

function parseSecretKeyAuthResponse(value: unknown, status: number): RouterApiKeyAuthResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.ok === true) {
    const principal = parseRouterApiKeyPrincipal(record.principal);
    return principal ? { ok: true, principal } : null;
  }
  if (record.ok !== false) return null;
  const code = parseSecretKeyFailureCode(record.code);
  const message = responseText(record.message);
  if (!code || !message) return null;
  return {
    ok: false,
    status: authFailureStatus(status),
    code,
    message,
  };
}

function parsePublishableKeyAuthResponse(
  value: unknown,
  status: number,
): RouterApiPublishableKeyAuthResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.ok === true) {
    const principal = parseRouterApiKeyPrincipal(record.principal);
    return principal ? { ok: true, principal } : null;
  }
  if (record.ok !== false) return null;
  const code = parsePublishableKeyFailureCode(record.code);
  const message = responseText(record.message);
  if (!code || !message) return null;
  return {
    ok: false,
    status: authFailureStatus(status),
    code,
    message,
  };
}

function parseProjectEnvironment(value: unknown): RouterApiProjectEnvironment | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  for (const field of Object.keys(record)) {
    if (!PROJECT_ENVIRONMENT_FIELDS.has(field)) return null;
  }
  const id = responseText(record.id);
  const projectId = responseText(record.projectId);
  const key = responseText(record.key);
  const signingRootVersion = responseText(record.signingRootVersion);
  if (!id || !projectId || !key || !signingRootVersion) return null;
  const status = Object.hasOwn(record, 'status') ? responseText(record.status) : null;
  if (Object.hasOwn(record, 'status') && !status) return null;
  return {
    id,
    projectId,
    key,
    signingRootVersion,
    ...(status ? { status } : {}),
  };
}

function parseProjectEnvironmentsResponse(value: unknown): RouterApiProjectEnvironment[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.ok !== true || !Array.isArray(record.environments)) return null;
  const environments: RouterApiProjectEnvironment[] = [];
  for (const value of record.environments) {
    const environment = parseProjectEnvironment(value);
    if (!environment) return null;
    environments.push(environment);
  }
  return environments;
}

function isUsageEventsSuccessResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.ok === true && Object.keys(record).length === 1;
}

function malformedSecretKeyAuthResult(status: number): RouterApiKeyAuthResult {
  return {
    ok: false,
    status: authFailureStatus(status),
    code: 'secret_key_invalid',
    message: 'Wallet Console authentication returned an invalid response',
  };
}

function malformedPublishableKeyAuthResult(status: number): RouterApiPublishableKeyAuthResult {
  return {
    ok: false,
    status: authFailureStatus(status),
    code: 'publishable_key_invalid',
    message: 'Wallet Console authentication returned an invalid response',
  };
}

/**
 * Gateway-side client for the private Wallet Console service binding. The
 * Wallet Gateway composes its Router API key auth and usage metering through
 * this client instead of a Console database binding.
 */
export function createWalletConsoleOpsClient(
  service: WalletConsoleServiceBinding,
): WalletConsoleOpsClient {
  return {
    apiKeyAuth: {
      async authenticate(input) {
        const { status, body } = await postJson(
          service,
          WALLET_CONSOLE_OP_PATHS_V1.secretKeyAuth,
          input,
        );
        return parseSecretKeyAuthResponse(body, status) ?? malformedSecretKeyAuthResult(status);
      },
    },
    publishableKeyAuth: {
      async authenticate(input) {
        const { status, body } = await postJson(
          service,
          WALLET_CONSOLE_OP_PATHS_V1.publishableKeyAuth,
          input,
        );
        return (
          parsePublishableKeyAuthResponse(body, status) ?? malformedPublishableKeyAuthResult(status)
        );
      },
    },
    projectEnvironments: {
      async listEnvironments(context, filters) {
        const { status, body } = await postJson(
          service,
          WALLET_CONSOLE_OP_PATHS_V1.projectEnvironments,
          { context, ...(filters ? { filters } : {}) },
        );
        const environments = parseProjectEnvironmentsResponse(body);
        if (!environments) {
          throw new Error(
            `Wallet Console environment resolution failed (HTTP ${status}): invalid response`,
          );
        }
        return environments;
      },
    },
    tenantRootActiveLineage: {
      async resolveActiveLineage(
        identity: TenantRootIdentityWireV1,
      ): Promise<WalletConsoleTenantRootActiveLineageV1 | null> {
        const { status, body } = await postJson(
          service,
          WALLET_CONSOLE_OP_PATHS_V1.tenantRootActiveLineage,
          identity,
        );
        const decoded = decodeWalletConsoleTenantRootActiveLineageResponseV1(body);
        if (!decoded.ok) {
          throw new Error(
            `Wallet Console tenant-root active-lineage resolution failed (HTTP ${status}): invalid response`,
          );
        }
        if (!decoded.value.ok) {
          if (status === 404 && decoded.value.code === 'tenant_root_active_lineage_not_found') {
            return null;
          }
          throw new Error(
            `Wallet Console tenant-root active-lineage resolution failed (HTTP ${status}): ${decoded.value.message}`,
          );
        }
        const lineage: WalletConsoleTenantRootActiveLineageV1 = {
          identityDigestB64u: decoded.value.identityDigestB64u,
          custodyLineageB64u: decoded.value.custodyLineageB64u,
        };
        return lineage;
      },
    },
    usageMeter: {
      async recordEvent(input) {
        const { status, body } = await postJson(
          service,
          WALLET_CONSOLE_OP_PATHS_V1.usageEvents,
          input,
        );
        if (!isUsageEventsSuccessResponse(body)) {
          throw new Error(
            `Wallet Console usage ingestion failed (HTTP ${status}): invalid response`,
          );
        }
      },
    },
  };
}
