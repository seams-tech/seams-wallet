import {
  ROUTER_API_CREDENTIAL_SCOPES,
  type RouterApiCredentialScope,
} from '../../framework/apiCredentialPorts';
import {
  WALLET_CONSOLE_OP_PATHS_V1,
  type WalletConsolePrincipalV1,
} from './walletConsoleOps';
import { decodeWalletConsoleTenantRootActiveLineageRequestV1 } from './walletConsoleOps';
import type { WalletConsoleServiceBinding } from './walletConsoleOpsClient';

export interface StaticWalletConsoleBindingConfigV1 {
  readonly credential: {
    readonly apiKeyId: string;
    readonly publishableKey: string;
    readonly secretKey?: string;
    readonly allowedOrigins: readonly string[];
    readonly scopes: readonly RouterApiCredentialScope[];
  };
  readonly deployment: {
    readonly orgId: string;
    readonly projectId: string;
    readonly environmentId: string;
    readonly environmentKey: string;
    readonly signingRootVersion: string;
  };
  readonly tenantRoot: {
    readonly identityDigestB64u: string;
    readonly custodyLineageB64u: string;
    readonly signingRootId: string;
  };
}

export function parseStaticWalletConsoleBindingConfigV1(
  value: unknown,
): StaticWalletConsoleBindingConfigV1 {
  const root = requiredRecord(value, 'static Wallet deployment config');
  const credential = requiredRecord(root.credential, 'credential');
  const deployment = requiredRecord(root.deployment, 'deployment');
  const tenantRoot = requiredRecord(root.tenantRoot, 'tenantRoot');
  return {
    credential: {
      apiKeyId: requiredConfigText(credential.apiKeyId, 'credential.apiKeyId'),
      publishableKey: requiredConfigText(
        credential.publishableKey,
        'credential.publishableKey',
      ),
      ...(credential.secretKey === undefined
        ? {}
        : { secretKey: requiredConfigText(credential.secretKey, 'credential.secretKey') }),
      allowedOrigins: requiredStringList(
        credential.allowedOrigins,
        'credential.allowedOrigins',
      ),
      scopes: requiredScopeList(credential.scopes),
    },
    deployment: {
      orgId: requiredConfigText(deployment.orgId, 'deployment.orgId'),
      projectId: requiredConfigText(deployment.projectId, 'deployment.projectId'),
      environmentId: requiredConfigText(deployment.environmentId, 'deployment.environmentId'),
      environmentKey: requiredConfigText(
        deployment.environmentKey,
        'deployment.environmentKey',
      ),
      signingRootVersion: requiredConfigText(
        deployment.signingRootVersion,
        'deployment.signingRootVersion',
      ),
    },
    tenantRoot: {
      identityDigestB64u: requiredConfigText(
        tenantRoot.identityDigestB64u,
        'tenantRoot.identityDigestB64u',
      ),
      custodyLineageB64u: requiredConfigText(
        tenantRoot.custodyLineageB64u,
        'tenantRoot.custodyLineageB64u',
      ),
      signingRootId: requiredConfigText(tenantRoot.signingRootId, 'tenantRoot.signingRootId'),
    },
  };
}

function requiredRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const parsed = record(value);
  if (!parsed) throw new Error(`${label} must be an object`);
  return parsed;
}

function requiredConfigText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requiredStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is required`);
  return value.map((entry, index) => requiredConfigText(entry, `${label}[${index}]`));
}

function requiredScopeList(value: unknown): readonly RouterApiCredentialScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('credential.scopes is required');
  }
  return value.map(parseScope);
}

function parseScope(value: unknown, index: number): RouterApiCredentialScope {
  if (typeof value === 'string') {
    for (const scope of ROUTER_API_CREDENTIAL_SCOPES) {
      if (scope === value) return scope;
    }
  }
  throw new Error(`credential.scopes[${index}] is invalid`);
}

export function createStaticWalletConsoleBindingV1(
  config: StaticWalletConsoleBindingConfigV1,
): WalletConsoleServiceBinding {
  return { fetch: handleStaticWalletConsoleRequestV1.bind(undefined, config) };
}

export async function handleStaticWalletConsoleRequestV1(
  config: StaticWalletConsoleBindingConfigV1,
  input: Request | string,
  init?: RequestInit,
): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  if (request.method !== 'POST') return json({ ok: false, message: 'Method not allowed' }, 405);
  const body: unknown = await request.json().catch(() => null);
  switch (new URL(request.url).pathname) {
    case WALLET_CONSOLE_OP_PATHS_V1.publishableKeyAuth:
      return publishableKeyResponse(config, body);
    case WALLET_CONSOLE_OP_PATHS_V1.secretKeyAuth:
      return secretKeyResponse(config, body);
    case WALLET_CONSOLE_OP_PATHS_V1.projectEnvironments:
      return projectEnvironmentsResponse(config, body);
    case WALLET_CONSOLE_OP_PATHS_V1.tenantRootActiveLineage:
      return activeLineageResponse(config, body);
    case WALLET_CONSOLE_OP_PATHS_V1.usageEvents:
      return json({ ok: true });
    default:
      return json({ ok: false, message: 'Unknown Wallet Console operation' }, 404);
  }
}

function publishableKeyResponse(
  config: StaticWalletConsoleBindingConfigV1,
  value: unknown,
): Response {
  const body = record(value);
  if (!body || body.secret !== config.credential.publishableKey) {
    return authFailure('publishable_key_invalid', 'Publishable key is invalid');
  }
  if (body.environmentId !== config.deployment.environmentId) {
    return authFailure(
      'publishable_key_environment_mismatch',
      'Publishable key environment does not match',
      403,
    );
  }
  if (
    typeof body.origin !== 'string' ||
    !config.credential.allowedOrigins.includes(body.origin)
  ) {
    return authFailure(
      'publishable_key_origin_blocked',
      'Publishable key origin is not allowed',
      403,
    );
  }
  return json({ ok: true, principal: principal(config) });
}

function secretKeyResponse(
  config: StaticWalletConsoleBindingConfigV1,
  value: unknown,
): Response {
  const body = record(value);
  if (!config.credential.secretKey || !body || body.secret !== config.credential.secretKey) {
    return authFailure('secret_key_invalid', 'Secret key is invalid');
  }
  if (
    typeof body.environmentId === 'string' &&
    body.environmentId !== config.deployment.environmentId
  ) {
    return authFailure(
      'secret_key_environment_mismatch',
      'Secret key environment does not match',
      403,
    );
  }
  if (!Array.isArray(body.requiredScopes)) {
    return authFailure('secret_key_forbidden_scope', 'Required scopes are invalid', 403);
  }
  for (const scope of body.requiredScopes) {
    if (typeof scope !== 'string' || !includesScope(config.credential.scopes, scope)) {
      return authFailure('secret_key_forbidden_scope', 'Secret key scope is not allowed', 403);
    }
  }
  return json({ ok: true, principal: principal(config) });
}

function includesScope(scopes: readonly RouterApiCredentialScope[], value: string): boolean {
  for (const scope of scopes) {
    if (scope === value) return true;
  }
  return false;
}

function projectEnvironmentsResponse(
  config: StaticWalletConsoleBindingConfigV1,
  value: unknown,
): Response {
  const body = record(value);
  const context = record(body?.context);
  if (!context || context.orgId !== config.deployment.orgId) {
    return json({ ok: false, code: 'environment_not_found', message: 'Environment not found' }, 404);
  }
  return json({
    ok: true,
    environments: [
      {
        id: config.deployment.environmentId,
        projectId: config.deployment.projectId,
        key: config.deployment.environmentKey,
        signingRootVersion: config.deployment.signingRootVersion,
        status: 'ACTIVE',
      },
    ],
  });
}

function activeLineageResponse(
  config: StaticWalletConsoleBindingConfigV1,
  value: unknown,
): Response {
  const decoded = decodeWalletConsoleTenantRootActiveLineageRequestV1(value);
  if (!decoded.ok) {
    return json({ ok: false, code: 'invalid_body', message: 'Identity is invalid' }, 400);
  }
  const identity = decoded.value;
  if (
    identity.orgId !== config.deployment.orgId ||
    identity.projectId !== config.deployment.projectId ||
    identity.envId !== config.deployment.environmentId ||
    identity.signingRootId !== config.tenantRoot.signingRootId ||
    identity.signingRootVersion !== config.deployment.signingRootVersion
  ) {
    return json(
      {
        ok: false,
        code: 'tenant_root_active_lineage_not_found',
        message: 'Active tenant-root lineage was not found',
      },
      404,
    );
  }
  return json({
    ok: true,
    identityDigestB64u: config.tenantRoot.identityDigestB64u,
    custodyLineageB64u: config.tenantRoot.custodyLineageB64u,
  });
}

function principal(config: StaticWalletConsoleBindingConfigV1): WalletConsolePrincipalV1 {
  return {
    apiKeyId: config.credential.apiKeyId,
    orgId: config.deployment.orgId,
    projectId: config.deployment.projectId,
    envId: config.deployment.environmentKey,
    environmentId: config.deployment.environmentId,
    scopes: config.credential.scopes,
  };
}

function authFailure(code: string, message: string, status: 401 | 403 = 401): Response {
  return json({ ok: false, code, message }, status);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
