import {
  decodeTenantRootIdentityWireV1,
  type TenantRootIdentityDecodeErrorV1,
} from '@shared/tenant-root';
import type { TenantRootIdentityFieldV1, TenantRootIdentityWireV1 } from '@shared/tenant-root';
import type { RouterApiCredentialScope } from '../../framework/apiCredentialPorts';

// The exact private service-binding surface between the Wallet Gateway and
// the Wallet Console deployment (R105 Phase 4). Five operations cross the
// binding: API-key validation, publishable-key validation, idempotent
// usage-event ingestion, project-environment lookup, and active tenant-root
// lineage lookup. There is no generic SQL or query operation, and the Gateway
// never receives the Console database.

export const WALLET_CONSOLE_OPS_BASE_PATH_V1 = '/internal/wallet-console/v1';
export const WALLET_CONSOLE_SERVICE_ORIGIN_V1 = 'https://wallet-console.internal';

export const WALLET_CONSOLE_OP_PATHS_V1 = {
  secretKeyAuth: `${WALLET_CONSOLE_OPS_BASE_PATH_V1}/secret-key-auth`,
  publishableKeyAuth: `${WALLET_CONSOLE_OPS_BASE_PATH_V1}/publishable-key-auth`,
  usageEvents: `${WALLET_CONSOLE_OPS_BASE_PATH_V1}/usage-events`,
  projectEnvironments: `${WALLET_CONSOLE_OPS_BASE_PATH_V1}/project-environments`,
  tenantRootActiveLineage: `${WALLET_CONSOLE_OPS_BASE_PATH_V1}/tenant-root/active-lineage`,
} as const;

export interface WalletConsoleSecretKeyAuthRequestV1 {
  readonly secret: string;
  readonly endpoint: string;
  readonly requiredScopes: RouterApiCredentialScope[];
  readonly sourceIp?: string;
  readonly environmentId?: string;
}

export interface WalletConsolePrincipalV1 {
  readonly apiKeyId: string;
  readonly orgId: string;
  readonly projectId?: string;
  readonly envId?: string;
  readonly environmentId: string;
  readonly scopes: readonly RouterApiCredentialScope[];
}

export type WalletConsoleSecretKeyAuthResponseV1 =
  | { readonly ok: true; readonly principal: WalletConsolePrincipalV1 }
  | {
      readonly ok: false;
      readonly status: 401 | 403;
      readonly code: string;
      readonly message: string;
    };

export interface WalletConsolePublishableKeyAuthRequestV1 {
  readonly secret: string;
  readonly origin: string;
  readonly environmentId: string;
}

export type WalletConsolePublishableKeyAuthResponseV1 = WalletConsoleSecretKeyAuthResponseV1;

export interface WalletConsoleUsageEventV1 {
  readonly orgId: string;
  readonly environmentId: string;
  readonly apiKeyId: string;
  readonly endpoint: string;
  readonly walletId: string;
  readonly action: 'wallet_created';
  readonly succeeded: boolean;
  readonly occurredAt?: string;
  /** Producer-owned idempotency key; replays with the same id must not double-count. */
  readonly sourceEventId?: string;
}

export interface WalletConsoleUsageEventsResponseV1 {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface WalletConsoleProjectEnvironmentsRequestV1 {
  readonly context: {
    readonly orgId: string;
    readonly actorUserId: string;
    readonly roles: readonly string[];
    readonly environmentId?: string;
    readonly projectId?: string;
  };
  readonly filters?: { readonly status?: string };
}

export interface WalletConsoleProjectEnvironmentV1 {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly signingRootVersion: string;
  readonly status?: string;
}

export interface WalletConsoleProjectEnvironmentsResponseV1 {
  readonly ok: boolean;
  readonly environments?: readonly WalletConsoleProjectEnvironmentV1[];
  readonly code?: string;
  readonly message?: string;
}

export type WalletConsoleTenantRootIdentityField = TenantRootIdentityFieldV1;

export type WalletConsoleTenantRootActiveLineageRequestV1 = TenantRootIdentityWireV1;

export interface WalletConsoleTenantRootActiveLineageV1 {
  readonly identityDigestB64u: string;
  readonly custodyLineageB64u: string;
}

export type WalletConsoleTenantRootActiveLineageResponseV1 =
  | {
      readonly ok: true;
      readonly identityDigestB64u: string;
      readonly custodyLineageB64u: string;
      readonly code?: never;
      readonly message?: never;
    }
  | {
      readonly ok: false;
      readonly code: 'invalid_body' | 'tenant_root_active_lineage_not_found';
      readonly message: string;
      readonly identityDigestB64u?: never;
      readonly custodyLineageB64u?: never;
    };

export type WalletConsoleDecodeResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type WalletConsoleTenantRootActiveLineageRequestDecodeError =
  | { readonly kind: 'invalid_object' }
  | {
      readonly kind: 'missing_field';
      readonly field: WalletConsoleTenantRootIdentityField;
    }
  | { readonly kind: 'unexpected_field'; readonly field: string }
  | {
      readonly kind: 'invalid_field';
      readonly field: WalletConsoleTenantRootIdentityField;
    };

export type WalletConsoleTenantRootActiveLineageResponseField =
  | 'ok'
  | 'identityDigestB64u'
  | 'custodyLineageB64u'
  | 'code'
  | 'message';

export type WalletConsoleTenantRootActiveLineageResponseDecodeError =
  | { readonly kind: 'invalid_object' }
  | { readonly kind: 'invalid_discriminant'; readonly field: 'ok' }
  | {
      readonly kind: 'missing_field';
      readonly field: WalletConsoleTenantRootActiveLineageResponseField;
    }
  | { readonly kind: 'unexpected_field'; readonly field: string }
  | {
      readonly kind: 'invalid_field';
      readonly field: WalletConsoleTenantRootActiveLineageResponseField;
    };

const TENANT_ROOT_ACTIVE_LINEAGE_SUCCESS_FIELDS = [
  'ok',
  'identityDigestB64u',
  'custodyLineageB64u',
] as const satisfies readonly WalletConsoleTenantRootActiveLineageResponseField[];

const TENANT_ROOT_ACTIVE_LINEAGE_SUCCESS_FIELD_SET: ReadonlySet<string> = new Set(
  TENANT_ROOT_ACTIVE_LINEAGE_SUCCESS_FIELDS,
);

const TENANT_ROOT_ACTIVE_LINEAGE_FAILURE_FIELDS = [
  'ok',
  'code',
  'message',
] as const satisfies readonly WalletConsoleTenantRootActiveLineageResponseField[];

const TENANT_ROOT_ACTIVE_LINEAGE_FAILURE_FIELD_SET: ReadonlySet<string> = new Set(
  TENANT_ROOT_ACTIVE_LINEAGE_FAILURE_FIELDS,
);

function canonicalProtocolString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
  return value;
}

function mapTenantRootIdentityDecodeError(
  error: TenantRootIdentityDecodeErrorV1,
): WalletConsoleTenantRootActiveLineageRequestDecodeError {
  switch (error.kind) {
    case 'invalid_object':
      return error;
    case 'missing_field':
      return error;
    case 'unexpected_field':
      return error;
    case 'invalid_field':
      return error;
  }
}

export function decodeWalletConsoleTenantRootActiveLineageRequestV1(
  value: unknown,
): WalletConsoleDecodeResult<
  TenantRootIdentityWireV1,
  WalletConsoleTenantRootActiveLineageRequestDecodeError
> {
  const decoded = decodeTenantRootIdentityWireV1(value);
  if (!decoded.ok) {
    return { ok: false, error: mapTenantRootIdentityDecodeError(decoded.error) };
  }
  return {
    ok: true,
    value: {
      orgId: decoded.value.orgId,
      projectId: decoded.value.projectId,
      envId: decoded.value.envId,
      signingRootId: decoded.value.signingRootId,
      signingRootVersion: decoded.value.signingRootVersion,
    },
  };
}

export function decodeWalletConsoleTenantRootActiveLineageResponseV1(
  value: unknown,
): WalletConsoleDecodeResult<
  WalletConsoleTenantRootActiveLineageResponseV1,
  WalletConsoleTenantRootActiveLineageResponseDecodeError
> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: { kind: 'invalid_object' } };
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(record, 'ok')) {
    return { ok: false, error: { kind: 'missing_field', field: 'ok' } };
  }
  if (record.ok !== true && record.ok !== false) {
    return { ok: false, error: { kind: 'invalid_discriminant', field: 'ok' } };
  }
  const expectedFields =
    record.ok === true
      ? TENANT_ROOT_ACTIVE_LINEAGE_SUCCESS_FIELDS
      : TENANT_ROOT_ACTIVE_LINEAGE_FAILURE_FIELDS;
  const expectedFieldSet =
    record.ok === true
      ? TENANT_ROOT_ACTIVE_LINEAGE_SUCCESS_FIELD_SET
      : TENANT_ROOT_ACTIVE_LINEAGE_FAILURE_FIELD_SET;
  for (const field of expectedFields) {
    if (!Object.hasOwn(record, field)) {
      return { ok: false, error: { kind: 'missing_field', field } };
    }
  }
  for (const field of Object.keys(record)) {
    if (!expectedFieldSet.has(field)) {
      return { ok: false, error: { kind: 'unexpected_field', field } };
    }
  }
  if (record.ok === true) {
    const identityDigestB64u = canonicalProtocolString(record.identityDigestB64u);
    if (!identityDigestB64u) {
      return {
        ok: false,
        error: { kind: 'invalid_field', field: 'identityDigestB64u' },
      };
    }
    const custodyLineageB64u = canonicalProtocolString(record.custodyLineageB64u);
    if (!custodyLineageB64u) {
      return {
        ok: false,
        error: { kind: 'invalid_field', field: 'custodyLineageB64u' },
      };
    }
    return { ok: true, value: { ok: true, identityDigestB64u, custodyLineageB64u } };
  }
  if (record.code !== 'invalid_body' && record.code !== 'tenant_root_active_lineage_not_found') {
    return { ok: false, error: { kind: 'invalid_field', field: 'code' } };
  }
  const message = canonicalProtocolString(record.message);
  if (!message) return { ok: false, error: { kind: 'invalid_field', field: 'message' } };
  return { ok: true, value: { ok: false, code: record.code, message } };
}

export interface WalletConsoleTenantRootActiveLineageResolverV1 {
  resolveActiveLineage(
    identity: TenantRootIdentityWireV1,
  ): Promise<WalletConsoleTenantRootActiveLineageV1 | null>;
}
