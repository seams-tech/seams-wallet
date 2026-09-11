import type { WebAuthnAuthenticationCredential } from '../../types/webauthn';
import { errorMessage } from '@shared/utils/errors';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import { parseRootShareEpoch, type RootShareEpoch } from '@shared/utils/domainIds';
import {
  ROUTER_AB_ECDSA_DERIVATION_BOOTSTRAP_PATH,
  ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH,
  ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH,
  ROUTER_AB_ECDSA_DERIVATION_SESSION_ACTIVATION_PATH,
  parseRouterAbEcdsaExplicitExportForwardedResponseV1,
  parseRouterAbEcdsaPostRegistrationSessionActivationResponseV1,
  parseRouterAbEcdsaDerivationActivationRefreshResponseV1,
  requireRouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaExplicitExportForwardedResponseV1,
  type RouterAbEcdsaDerivationExplicitExportRequestV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationActivationRefreshCommitRequestV1,
  type RouterAbEcdsaDerivationActivationRefreshResponseV1,
  type RouterAbEcdsaPostRegistrationSessionActivationRequestV1,
  type RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { ThresholdRuntimePolicyScope } from '../../signingEngine/threshold/sessionPolicy';
import { toWalletId, type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EcdsaThresholdKeyId } from '@/core/signingEngine/session/identity/emailOtpEcdsaDerivationIdentity';
import { toEcdsaDerivationThresholdKeyId } from '@/core/signingEngine/session/identity/emailOtpEcdsaDerivationIdentity';
import type {
  EcdsaClientRootPublicKey33B64u,
  DerivationClientSharePublicKey33B64u,
  EcdsaDerivationRelayerPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import {
  buildBearerAuthorizationHeader,
  buildRelayerJsonPostRequestInit,
  normalizeRelayerBaseUrl,
} from './relayerHttp';

const WRANGLER_WORKER_RESTARTED_MID_REQUEST = 'Your worker restarted mid-request';

function requireThresholdEcdsaRootShareEpoch(value: unknown, field: string) {
  const parsed = parseRootShareEpoch(value);
  if (!parsed.ok) throw new Error(`${field} is invalid`);
  return parsed.value;
}

export type EcdsaDerivationRoleLocalPublicIdentity = {
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  relayerPublicKey33B64u: EcdsaDerivationRelayerPublicKey33B64u;
  groupPublicKey33B64u: string;
  ethereumAddress: string;
};

export type ThresholdEcdsaDerivationRoleLocalClientRootProof = {
  version: 'ecdsa-derivation:role-local:first-bootstrap-root-proof:v2';
  clientRootPublicKey33B64u: EcdsaClientRootPublicKey33B64u;
  digest32B64u: string;
  signature65B64u: string;
};

export type ThresholdEcdsaDerivationRoleLocalPasskeyBootstrapAuthorization =
  | {
      kind: 'passkey_bootstrap';
      rpId: string;
      webauthn_authentication: WebAuthnAuthenticationCredential;
      runtimePolicyScope: ThresholdRuntimePolicyScope;
      projectEnvironmentId?: never;
      projectEnvironmentPublishableKey?: never;
    }
  | {
      kind: 'passkey_bootstrap';
      rpId: string;
      webauthn_authentication: WebAuthnAuthenticationCredential;
      projectEnvironmentId: string;
      projectEnvironmentPublishableKey: string;
      runtimePolicyScope?: never;
    };

export type ThresholdEcdsaDerivationRoleLocalBootstrapRequest = {
  formatVersion: 'ecdsa-derivation-role-local';
  walletId: WalletId;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  signingRootId: string;
  signingRootVersion: string;
  keyScope: 'evm-family';
  relayerKeyId: string;
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  clientShareRetryCounter: number;
  contextBinding32B64u: string;
  requestId: string;
  sessionId: string;
  ttlMs: number;
  remainingUses: number;
  participantIds: number[];
  auth?: ThresholdEcdsaDerivationRouteAuth;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
} & (
  | {
      clientRootProof: ThresholdEcdsaDerivationRoleLocalClientRootProof;
      passkeyBootstrapAuthorization?: never;
    }
  | {
      clientRootProof?: never;
      passkeyBootstrapAuthorization: ThresholdEcdsaDerivationRoleLocalPasskeyBootstrapAuthorization;
    }
  | {
      clientRootProof?: never;
      passkeyBootstrapAuthorization?: never;
    }
);

type ThresholdEcdsaDerivationRoleLocalBootstrapBodyBase = {
  formatVersion: 'ecdsa-derivation-role-local';
  walletId: string;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: string;
  signingRootId: string;
  signingRootVersion: string;
  keyScope: 'evm-family';
  relayerKeyId: string;
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  clientShareRetryCounter: number;
  contextBinding32B64u: string;
  requestId: string;
  sessionId: string;
  ttlMs: number;
  remainingUses: number;
  participantIds: number[];
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
};

type ThresholdEcdsaDerivationRoleLocalBootstrapBodyPasskeyAuthorization =
  | {
      kind: 'passkey_bootstrap';
      rpId: string;
      webauthn_authentication: WebAuthnAuthenticationCredential;
      runtimePolicyScope: ThresholdRuntimePolicyScope;
      projectEnvironmentId?: never;
    }
  | {
      kind: 'passkey_bootstrap';
      rpId: string;
      webauthn_authentication: WebAuthnAuthenticationCredential;
      projectEnvironmentId: string;
      runtimePolicyScope?: never;
    };

type ThresholdEcdsaDerivationRoleLocalBootstrapBody = {
  formatVersion: 'ecdsa-derivation-role-local';
  walletId: string;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: string;
  signingRootId: string;
  signingRootVersion: string;
  keyScope: 'evm-family';
  relayerKeyId: string;
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  clientShareRetryCounter: number;
  contextBinding32B64u: string;
  requestId: string;
  sessionId: string;
  ttlMs: number;
  remainingUses: number;
  participantIds: number[];
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
} & (
  | {
      clientRootProof: ThresholdEcdsaDerivationRoleLocalClientRootProof;
      passkeyBootstrapAuthorization?: never;
    }
  | {
      clientRootProof?: never;
      passkeyBootstrapAuthorization: ThresholdEcdsaDerivationRoleLocalBootstrapBodyPasskeyAuthorization;
    }
  | {
      clientRootProof?: never;
      passkeyBootstrapAuthorization?: never;
    }
);

export type ThresholdEcdsaDerivationRoleLocalBootstrapValue = {
  formatVersion: 'ecdsa-derivation-role-local';
  walletId: WalletId;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  relayerKeyId: string;
  applicationBindingDigestB64u: string;
  contextBinding32B64u: string;
  publicIdentity: EcdsaDerivationRoleLocalPublicIdentity;
  clientShareRetryCounter: number;
  relayerShareRetryCounter: number;
  publicTranscriptDigest32B64u: string;
  keyHandle: string;
  signingRootId: string;
  signingRootVersion: string;
  thresholdEcdsaPublicKeyB64u: string;
  ethereumAddress: string;
  relayerVerifyingShareB64u: string;
  participantIds: number[];
  thresholdSessionId: string;
  activationEpoch: RootShareEpoch;
  expiresAtMs: number;
  expiresAt: string;
  remainingUses: number;
  routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
};

export type ThresholdEcdsaDerivationRoleLocalRouteResult<T> =
  | { ok: true; value: T }
  | { ok: false; code?: string; message?: string; error?: string };

export type ThresholdEcdsaDerivationRouteAuth =
  | WalletSessionOperationCredentialV1
  | { kind: 'publishable_key'; token: string };

function requireNonEmptyString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Missing ${field}`);
  return text;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing ${field}`);
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  const number = requireNumber(value, field);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return number;
}

function requireParticipantIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('participantIds must be a non-empty array');
  }
  return value.map((entry) => {
    const participantId = Number(entry);
    if (!Number.isSafeInteger(participantId) || participantId <= 0) {
      throw new Error('participantIds must contain positive integer ids');
    }
    return participantId;
  });
}

function requireExactJsonObject(value: unknown, fields: readonly string[], field: string): object {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`Missing ${field}`);
  }
  const expected = new Set(fields);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new Error(`${field} contains unexpected fields`);
  }
  return value;
}

function readJsonField(value: object, field: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || !('value' in descriptor)) throw new Error(`Missing ${label}`);
  return descriptor.value;
}

const NON_EXPORT_BOOTSTRAP_RESPONSE_FIELDS = [
  'formatVersion',
  'walletId',
  'evmFamilySigningKeySlotId',
  'ecdsaThresholdKeyId',
  'relayerKeyId',
  'applicationBindingDigestB64u',
  'contextBinding32B64u',
  'publicIdentity',
  'clientShareRetryCounter',
  'relayerShareRetryCounter',
  'publicTranscriptDigest32B64u',
  'keyHandle',
  'signingRootId',
  'signingRootVersion',
  'thresholdEcdsaPublicKeyB64u',
  'ethereumAddress',
  'relayerVerifyingShareB64u',
  'participantIds',
  'thresholdSessionId',
  'activationEpoch',
  'expiresAtMs',
  'expiresAt',
  'remainingUses',
  'routerAbEcdsaDerivationNormalSigning',
] as const;

function parseEcdsaDerivationRoleLocalPublicIdentity(
  value: unknown,
): EcdsaDerivationRoleLocalPublicIdentity {
  const record = requireExactJsonObject(
    value,
    [
      'derivationClientSharePublicKey33B64u',
      'relayerPublicKey33B64u',
      'groupPublicKey33B64u',
      'ethereumAddress',
    ],
    'publicIdentity',
  );
  const derivationClientSharePublicKey33B64u = requireNonEmptyString(
    readJsonField(
      record,
      'derivationClientSharePublicKey33B64u',
      'publicIdentity.derivationClientSharePublicKey33B64u',
    ),
    'publicIdentity.derivationClientSharePublicKey33B64u',
  ) as DerivationClientSharePublicKey33B64u;
  const relayerPublicKey33B64u = requireNonEmptyString(
    readJsonField(record, 'relayerPublicKey33B64u', 'publicIdentity.relayerPublicKey33B64u'),
    'publicIdentity.relayerPublicKey33B64u',
  ) as EcdsaDerivationRelayerPublicKey33B64u;
  return {
    derivationClientSharePublicKey33B64u,
    relayerPublicKey33B64u,
    groupPublicKey33B64u: requireNonEmptyString(
      readJsonField(record, 'groupPublicKey33B64u', 'publicIdentity.groupPublicKey33B64u'),
      'publicIdentity.groupPublicKey33B64u',
    ),
    ethereumAddress: requireNonEmptyString(
      readJsonField(record, 'ethereumAddress', 'publicIdentity.ethereumAddress'),
      'publicIdentity.ethereumAddress',
    ),
  };
}

export function parseThresholdEcdsaDerivationRoleLocalBootstrapValue(
  value: unknown,
): ThresholdEcdsaDerivationRoleLocalBootstrapValue {
  const record = requireExactJsonObject(value, NON_EXPORT_BOOTSTRAP_RESPONSE_FIELDS, 'value');
  if (
    readJsonField(record, 'formatVersion', 'value.formatVersion') !== 'ecdsa-derivation-role-local'
  ) {
    throw new Error('value.formatVersion is invalid');
  }
  const walletId = toWalletId(readJsonField(record, 'walletId', 'value.walletId'));
  const evmFamilySigningKeySlotId = requireNonEmptyString(
    readJsonField(record, 'evmFamilySigningKeySlotId', 'value.evmFamilySigningKeySlotId'),
    'evmFamilySigningKeySlotId',
  );
  const ecdsaThresholdKeyId = toEcdsaDerivationThresholdKeyId(
    readJsonField(record, 'ecdsaThresholdKeyId', 'value.ecdsaThresholdKeyId'),
  );
  const relayerKeyId = requireNonEmptyString(
    readJsonField(record, 'relayerKeyId', 'value.relayerKeyId'),
    'relayerKeyId',
  );
  const applicationBindingDigestB64u = requireNonEmptyString(
    readJsonField(record, 'applicationBindingDigestB64u', 'value.applicationBindingDigestB64u'),
    'applicationBindingDigestB64u',
  );
  const contextBinding32B64u = requireNonEmptyString(
    readJsonField(record, 'contextBinding32B64u', 'value.contextBinding32B64u'),
    'contextBinding32B64u',
  );
  const publicIdentity = parseEcdsaDerivationRoleLocalPublicIdentity(
    readJsonField(record, 'publicIdentity', 'value.publicIdentity'),
  );
  const clientShareRetryCounter = requireNonNegativeInteger(
    readJsonField(record, 'clientShareRetryCounter', 'value.clientShareRetryCounter'),
    'clientShareRetryCounter',
  );
  const relayerShareRetryCounter = requireNonNegativeInteger(
    readJsonField(record, 'relayerShareRetryCounter', 'value.relayerShareRetryCounter'),
    'relayerShareRetryCounter',
  );
  const keyHandle = requireNonEmptyString(
    readJsonField(record, 'keyHandle', 'value.keyHandle'),
    'keyHandle',
  );
  const signingRootId = requireNonEmptyString(
    readJsonField(record, 'signingRootId', 'value.signingRootId'),
    'signingRootId',
  );
  const signingRootVersion = requireNonEmptyString(
    readJsonField(record, 'signingRootVersion', 'value.signingRootVersion'),
    'signingRootVersion',
  );
  const participantIds = requireParticipantIds(
    readJsonField(record, 'participantIds', 'value.participantIds'),
  );
  const thresholdSessionId = requireNonEmptyString(
    readJsonField(record, 'thresholdSessionId', 'value.thresholdSessionId'),
    'thresholdSessionId',
  );
  const activationEpoch = requireThresholdEcdsaRootShareEpoch(
    readJsonField(record, 'activationEpoch', 'value.activationEpoch'),
    'activationEpoch',
  );
  const expiresAtMs = requireNumber(
    readJsonField(record, 'expiresAtMs', 'value.expiresAtMs'),
    'expiresAtMs',
  );
  const routerAbEcdsaDerivationNormalSigning = requireRouterAbEcdsaDerivationNormalSigningStateV1(
    readJsonField(
      record,
      'routerAbEcdsaDerivationNormalSigning',
      'value.routerAbEcdsaDerivationNormalSigning',
    ),
  );
  return {
    formatVersion: 'ecdsa-derivation-role-local',
    walletId,
    evmFamilySigningKeySlotId,
    ecdsaThresholdKeyId,
    relayerKeyId,
    applicationBindingDigestB64u,
    contextBinding32B64u,
    publicIdentity,
    clientShareRetryCounter,
    relayerShareRetryCounter,
    publicTranscriptDigest32B64u: requireNonEmptyString(
      readJsonField(record, 'publicTranscriptDigest32B64u', 'value.publicTranscriptDigest32B64u'),
      'publicTranscriptDigest32B64u',
    ),
    keyHandle,
    signingRootId,
    signingRootVersion,
    thresholdEcdsaPublicKeyB64u: requireNonEmptyString(
      readJsonField(record, 'thresholdEcdsaPublicKeyB64u', 'value.thresholdEcdsaPublicKeyB64u'),
      'thresholdEcdsaPublicKeyB64u',
    ),
    ethereumAddress: requireNonEmptyString(
      readJsonField(record, 'ethereumAddress', 'value.ethereumAddress'),
      'ethereumAddress',
    ),
    relayerVerifyingShareB64u: requireNonEmptyString(
      readJsonField(record, 'relayerVerifyingShareB64u', 'value.relayerVerifyingShareB64u'),
      'relayerVerifyingShareB64u',
    ),
    participantIds,
    thresholdSessionId,
    activationEpoch,
    expiresAtMs,
    expiresAt: requireNonEmptyString(
      readJsonField(record, 'expiresAt', 'value.expiresAt'),
      'expiresAt',
    ),
    remainingUses: requireNumber(
      readJsonField(record, 'remainingUses', 'value.remainingUses'),
      'remainingUses',
    ),
    routerAbEcdsaDerivationNormalSigning,
  };
}

function resolveBearerToken(auth?: ThresholdEcdsaDerivationRouteAuth): string {
  if (!auth) return '';
  if (auth.kind === 'opaque_wallet_session_operation_credential_v1') {
    return auth.token;
  }
  return String(auth.token || '').trim();
}

function buildRelayRequestInit(args: {
  auth?: ThresholdEcdsaDerivationRouteAuth;
  publishableKeyAuth?: string;
  body: unknown;
}): RequestInit {
  const bearerToken = resolveBearerToken(args.auth);
  const publishableKeyAuth = String(args.publishableKeyAuth || '').trim();
  const headers = bearerToken
    ? buildBearerAuthorizationHeader({
        token: bearerToken,
        missingMessage: 'bearer token is required',
      })
    : publishableKeyAuth
      ? buildBearerAuthorizationHeader({
          token: publishableKeyAuth,
          missingMessage: 'publishable key auth is required',
        })
      : undefined;
  return buildRelayerJsonPostRequestInit({
    headers,
    body: args.body,
  });
}

type RelayerFailureResponseV1 = {
  readonly code: string;
  readonly message: string;
};

function defaultRelayerFailureResponse(status: number): RelayerFailureResponseV1 {
  return {
    code: 'http_error',
    message: `HTTP ${status}`,
  };
}

function decodeRelayerFailureResponse(value: unknown): RelayerFailureResponseV1 | null {
  try {
    const record = requireExactJsonObject(value, ['ok', 'code', 'message'], 'relayer failure');
    if (readJsonField(record, 'ok', 'relayer failure.ok') !== false) throw new Error('invalid ok');
    const code = readJsonField(record, 'code', 'relayer failure.code');
    const message = readJsonField(record, 'message', 'relayer failure.message');
    if (typeof code !== 'string' || !code.trim()) throw new Error('invalid code');
    if (typeof message !== 'string' || !message.trim()) throw new Error('invalid message');
    return { code: code.trim(), message: message.trim() };
  } catch {
    return null;
  }
}

type ThresholdEcdsaBootstrapResponseV1 =
  | { readonly kind: 'success'; readonly value: unknown }
  | { readonly kind: 'failure'; readonly code: string; readonly message: string };

function decodeThresholdEcdsaBootstrapResponse(
  value: unknown,
  response: Response,
): ThresholdEcdsaBootstrapResponseV1 {
  const failure = decodeRelayerFailureResponse(value);
  if (failure) return { kind: 'failure', ...failure };
  if (!response.ok) {
    return { kind: 'failure', ...defaultRelayerFailureResponse(response.status) };
  }
  try {
    const record = requireExactJsonObject(value, ['ok', 'value'], 'threshold ECDSA bootstrap');
    if (readJsonField(record, 'ok', 'threshold ECDSA bootstrap.ok') !== true) {
      throw new Error('bootstrap was rejected');
    }
    return {
      kind: 'success',
      value: readJsonField(record, 'value', 'threshold ECDSA bootstrap.value'),
    };
  } catch {
    return {
      kind: 'failure',
      code: 'server_rejected',
      message: 'HTTP response contained an unusable bootstrap payload',
    };
  }
}

async function parseRelayJson(response: Response): Promise<unknown> {
  const text = await readResponseText(response);
  if (isWranglerWorkerRestartedMidRequestResponse(text)) {
    return {
      ok: false,
      code: 'worker_restarted_mid_request',
      message: WRANGLER_WORKER_RESTARTED_MID_REQUEST,
    };
  }
  return parseJsonText(text);
}

export async function routerAbEcdsaExplicitExport(
  relayServerUrl: string,
  input: {
    readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
    readonly requestDigestB64u: string;
    readonly auth: ThresholdEcdsaDerivationRouteAuth;
  },
): Promise<
  ThresholdEcdsaDerivationRoleLocalRouteResult<RouterAbEcdsaExplicitExportForwardedResponseV1>
> {
  try {
    const base = normalizeRelayerBaseUrl(relayServerUrl);
    if (!base) throw new Error('Missing relayServerUrl');
    const response = await fetch(
      `${base}${ROUTER_AB_ECDSA_DERIVATION_EXPORT_PATH}`,
      buildRelayRequestInit({
        auth: input.auth,
        body: {
          request: input.request,
          requestDigestB64u: input.requestDigestB64u,
        },
      }),
    );
    const json = await parseRelayJson(response);
    if (!response.ok) {
      const failure =
        decodeRelayerFailureResponse(json) ?? defaultRelayerFailureResponse(response.status);
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
      };
    }
    return {
      ok: true,
      value: parseRouterAbEcdsaExplicitExportForwardedResponseV1(json),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error) || 'Router A/B ECDSA explicit export failed',
    };
  }
}

export async function routerAbEcdsaActivationRefresh(
  relayServerUrl: string,
  input: {
    readonly request: RouterAbEcdsaDerivationActivationRefreshCommitRequestV1;
    readonly requestDigestB64u: string;
    readonly auth: ThresholdEcdsaDerivationRouteAuth;
  },
): Promise<
  ThresholdEcdsaDerivationRoleLocalRouteResult<RouterAbEcdsaDerivationActivationRefreshResponseV1>
> {
  try {
    const base = normalizeRelayerBaseUrl(relayServerUrl);
    if (!base) throw new Error('Missing relayServerUrl');
    const response = await fetch(
      `${base}${ROUTER_AB_ECDSA_DERIVATION_REFRESH_PATH}`,
      buildRelayRequestInit({
        auth: input.auth,
        body: { request: input.request, requestDigestB64u: input.requestDigestB64u },
      }),
    );
    const json = await parseRelayJson(response);
    if (!response.ok) {
      const failure =
        decodeRelayerFailureResponse(json) ?? defaultRelayerFailureResponse(response.status);
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
      };
    }
    return {
      ok: true,
      value: parseRouterAbEcdsaDerivationActivationRefreshResponseV1(json),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error) || 'Router A/B ECDSA activation refresh failed',
    };
  }
}

export async function activateRouterAbEcdsaPostRegistrationSession(
  relayServerUrl: string,
  input: {
    readonly request: RouterAbEcdsaPostRegistrationSessionActivationRequestV1;
    readonly auth: ThresholdEcdsaDerivationRouteAuth;
  },
): Promise<
  ThresholdEcdsaDerivationRoleLocalRouteResult<RouterAbEcdsaPostRegistrationSessionActivationResponseV1>
> {
  try {
    const base = normalizeRelayerBaseUrl(relayServerUrl);
    if (!base) throw new Error('Missing relayServerUrl');
    const response = await fetch(
      `${base}${ROUTER_AB_ECDSA_DERIVATION_SESSION_ACTIVATION_PATH}`,
      buildRelayRequestInit({
        auth: input.auth,
        body: input.request,
      }),
    );
    const json = await parseRelayJson(response);
    if (!response.ok) {
      const failure =
        decodeRelayerFailureResponse(json) ?? defaultRelayerFailureResponse(response.status);
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
      };
    }
    return {
      ok: true,
      value: parseRouterAbEcdsaPostRegistrationSessionActivationResponseV1(json),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error) || 'Router A/B ECDSA session activation failed',
    };
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isWranglerWorkerRestartedMidRequestResponse(text: string): boolean {
  return text.includes(WRANGLER_WORKER_RESTARTED_MID_REQUEST);
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(
      `Failed to parse threshold ECDSA relayer response JSON: ${errorMessage(error)}`,
    );
  }
}

export async function thresholdEcdsaDerivationRoleLocalBootstrap(
  relayServerUrl: string,
  args: ThresholdEcdsaDerivationRoleLocalBootstrapRequest,
): Promise<
  ThresholdEcdsaDerivationRoleLocalRouteResult<ThresholdEcdsaDerivationRoleLocalBootstrapValue>
> {
  try {
    const base = normalizeRelayerBaseUrl(relayServerUrl);
    if (!base) throw new Error('Missing relayServerUrl');
    const bodyBase: ThresholdEcdsaDerivationRoleLocalBootstrapBodyBase = {
      formatVersion: 'ecdsa-derivation-role-local',
      walletId: requireNonEmptyString(args.walletId, 'walletId'),
      evmFamilySigningKeySlotId: requireNonEmptyString(
        args.evmFamilySigningKeySlotId,
        'evmFamilySigningKeySlotId',
      ),
      ecdsaThresholdKeyId: requireNonEmptyString(args.ecdsaThresholdKeyId, 'ecdsaThresholdKeyId'),
      signingRootId: requireNonEmptyString(args.signingRootId, 'signingRootId'),
      signingRootVersion: requireNonEmptyString(args.signingRootVersion, 'signingRootVersion'),
      keyScope: 'evm-family',
      relayerKeyId: requireNonEmptyString(args.relayerKeyId, 'relayerKeyId'),
      derivationClientSharePublicKey33B64u: requireNonEmptyString(
        args.derivationClientSharePublicKey33B64u,
        'derivationClientSharePublicKey33B64u',
      ) as DerivationClientSharePublicKey33B64u,
      clientShareRetryCounter: requireNumber(
        args.clientShareRetryCounter,
        'clientShareRetryCounter',
      ),
      contextBinding32B64u: requireNonEmptyString(
        args.contextBinding32B64u,
        'contextBinding32B64u',
      ),
      requestId: requireNonEmptyString(args.requestId, 'requestId'),
      sessionId: requireNonEmptyString(args.sessionId, 'sessionId'),
      ttlMs: requireNonNegativeInteger(args.ttlMs, 'ttlMs'),
      remainingUses: requireNonNegativeInteger(args.remainingUses, 'remainingUses'),
      participantIds: requireParticipantIds(args.participantIds),
      ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
    };
    const bodyPasskeyAuthorization =
      (): ThresholdEcdsaDerivationRoleLocalBootstrapBodyPasskeyAuthorization | null => {
        const authorization = args.passkeyBootstrapAuthorization;
        if (!authorization) return null;
        const runtimePolicyScope = authorization.runtimePolicyScope;
        if (runtimePolicyScope) {
          return {
            kind: 'passkey_bootstrap',
            rpId: requireNonEmptyString(authorization.rpId, 'passkeyBootstrapAuthorization.rpId'),
            webauthn_authentication: authorization.webauthn_authentication,
            runtimePolicyScope,
          };
        }
        return {
          kind: 'passkey_bootstrap',
          rpId: requireNonEmptyString(authorization.rpId, 'passkeyBootstrapAuthorization.rpId'),
          webauthn_authentication: authorization.webauthn_authentication,
          projectEnvironmentId: requireNonEmptyString(
            authorization.projectEnvironmentId,
            'passkeyBootstrapAuthorization.projectEnvironmentId',
          ),
        };
      };
    const passkeyAuthorizationBody = bodyPasskeyAuthorization();
    const body: ThresholdEcdsaDerivationRoleLocalBootstrapBody = args.clientRootProof
      ? {
          ...bodyBase,
          clientRootProof: {
            version: 'ecdsa-derivation:role-local:first-bootstrap-root-proof:v2',
            clientRootPublicKey33B64u: requireNonEmptyString(
              args.clientRootProof.clientRootPublicKey33B64u,
              'clientRootProof.clientRootPublicKey33B64u',
            ) as EcdsaClientRootPublicKey33B64u,
            digest32B64u: requireNonEmptyString(
              args.clientRootProof.digest32B64u,
              'clientRootProof.digest32B64u',
            ),
            signature65B64u: requireNonEmptyString(
              args.clientRootProof.signature65B64u,
              'clientRootProof.signature65B64u',
            ),
          },
        }
      : passkeyAuthorizationBody
        ? {
            ...bodyBase,
            passkeyBootstrapAuthorization: passkeyAuthorizationBody,
          }
        : bodyBase;
    const response = await fetch(
      `${base}${ROUTER_AB_ECDSA_DERIVATION_BOOTSTRAP_PATH}`,
      buildRelayRequestInit({
        auth: args.auth,
        publishableKeyAuth:
          args.passkeyBootstrapAuthorization &&
          'projectEnvironmentPublishableKey' in args.passkeyBootstrapAuthorization
            ? args.passkeyBootstrapAuthorization.projectEnvironmentPublishableKey
            : undefined,
        body,
      }),
    );
    const json = await parseRelayJson(response);
    const decoded = decodeThresholdEcdsaBootstrapResponse(json, response);
    if (decoded.kind === 'failure') {
      return {
        ok: false,
        code: decoded.code,
        message: decoded.message,
      };
    }
    return {
      ok: true,
      value: parseThresholdEcdsaDerivationRoleLocalBootstrapValue(decoded.value),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: errorMessage(error) || 'Failed to bootstrap threshold-ecdsa role-local derivation',
    };
  }
}
