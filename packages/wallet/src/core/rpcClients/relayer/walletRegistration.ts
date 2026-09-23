import type {
  AddAuthMethodInput,
  AddAuthMethodIntentGrant,
  AddAuthMethodIntentCallerV1,
  AddAuthMethodIntentV1,
  WalletAddAuthMethodEmailOtpTargetV1,
  AddSignerIntentV1,
  AddSignerIntentGrant,
  EmailOtpRegistrationProof,
  RegistrationAuthMethodInput,
  RegisterWalletInput,
  RegistrationIntentGrant,
  RegistrationIntentV1,
  RegistrationNearAccountProvisioning,
  RegistrationSignerRequest,
  RegistrationSignerSetSelection,
  ResolvedRegistrationNearAccount,
  WalletAuthMethodRecordV2,
  WalletId,
  WebAuthnRpId,
} from '@shared/utils/registrationIntent';
import {
  addAuthMethodIntentGrantFromString,
  addSignerIntentGrantFromString,
  computeRegistrationIntentDigestB64u,
  parseAddAuthMethodIntentV1,
  parseAddSignerIntentV1,
  normalizeRegistrationAuthMethodInput,
  normalizeRegistrationSignerPlan,
  registrationSignerSetSelectionFromPlan,
  sameAddAuthMethodIntentV1,
  sameAddSignerIntentV1,
  walletIdFromString,
  type WalletAuthMethodRevocationProof,
} from '@shared/utils/registrationIntent';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import {
  parsePasskeyCustodyEnvelopeRecord,
  parseWalletCustodyRegistrationOutcome,
  type PasskeyCustodyEnvelopeRecord,
  type WalletCustodyCeremonyCommitPayload,
  type WalletCustodyRegistrationOutcome,
} from '@shared/passkey-custody';
import { parseImplicitNearAccountId, parseNamedNearAccountId } from '@shared/utils/near';
import { parseDigestB64u, type CorrelationId } from '@shared/utils/canonicalPrimitives';
import type { RegistrationEstablishedSessionResultV2 } from '@shared/utils/registrationEstablishedSession';
import { parseRegistrationEstablishedSessionResultV2 } from '@shared/utils/registrationEstablishedSession';
import {
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  parseWalletAuthMethodId,
  parseWalletId,
  type RootShareEpoch,
  type ThresholdEd25519SessionId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import {
  parseWebAuthnAuthenticatorDeviceInfo,
  type WebAuthnAuthenticatorDeviceInfo,
} from '@shared/utils/webauthnDeviceInfo';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { EcdsaKeyFactsInventoryWalletSessionCredential } from '@/core/types/sdkSentEvents';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoRegistrationAdmissionRequestV1,
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoBytes32V1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  parseWalletAuthAuthority,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { type RouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import {
  parseRouterAbEcdsaRegistrationPublicActivationReceiptV1,
  parseRouterAbEcdsaRegistrationRequestFactsV1,
  parseRouterAbEcdsaStrictForwardedRegistrationResponseV1,
  requireRouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaRegistrationRequestFactsV1,
  type RouterAbEcdsaRegistrationRequestV1,
  type RouterAbEcdsaRegistrationPublicActivationReceiptV1,
  type RouterAbEcdsaVerifiedClientActivationFactsV1,
  type RouterAbEcdsaStrictForwardedRegistrationResponseV1,
  type RouterAbEcdsaDerivationPublicCapabilityV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbPublicDigest32V1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import {
  parseThresholdEcdsaKeyIdentityTargets,
  type ThresholdEcdsaKeyIdentityInventoryEntry,
} from '@/core/signingEngine/session/passkey/ecdsaKeyFactsInventory';
import {
  thresholdEcdsaChainTargetsEqual,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  normalizeThresholdRuntimePolicyScope,
  type Ed25519AuthorityScope,
  type ThresholdRuntimePolicyScope,
} from '@/core/signingEngine/threshold/sessionPolicy';
import type {
  EcdsaDerivationRoleLocalPublicIdentity,
  ThresholdEcdsaDerivationRoleLocalBootstrapValue,
} from './thresholdEcdsa';
import { parseThresholdEcdsaDerivationRoleLocalBootstrapValue } from './thresholdEcdsa';
import {
  buildBearerAuthorizationHeader,
  buildRelayerJsonPostRequestInit,
  normalizeRelayerBaseUrl,
} from './relayerHttp';
import { type RegistrationSignerSetRequest } from './registrationSignerSetRequest';
import {
  parseWalletAddSignerChainTarget,
  parseWalletAddSignerEcdsaWalletKey,
  parseWalletEd25519YaoSignerPublicResult,
  parseWalletRegistrationFinalizeAuthority,
  parseWalletRegistrationFinalizeAuthorityBranch,
  parseWalletRegistrationFinalizeDiagnostics,
  parseWalletRegistrationFinalizeResponse,
  requireResponseParticipantPair,
  requireResponseRpId,
  requireResponseSafeInteger,
  requireResponseString,
} from './walletRegistrationTerminalResponse';

export { parseWalletRegistrationFinalizeResponse };

const REGISTRATION_ROUTE_PAYLOAD_DIAGNOSTICS_LABEL = '[Registration] wallet route payload summary';
const ROUTE_PAYLOAD_BREAKDOWN_MAX_DEPTH = 2;
const ROUTE_PAYLOAD_BREAKDOWN_MAX_FIELDS = 64;
const WALLET_REGISTRATION_SETUP_PATH = '/wallets/register/setup';
const WALLET_REGISTRATION_RESPOND_PATH = '/wallets/register/respond';
const WALLET_REGISTRATION_NEAR_ADMISSION_PATH = '/wallets/register/near-admission';
const WALLET_REGISTRATION_ACTIVATE_PATH = '/wallets/register/activate';
const WALLET_REGISTRATION_NEAR_PROVISIONING_PATH = '/wallets/register/near-provisioning';
/** Managed environment id header for Router API `api_credentials` auth. */
const ROUTER_API_ENVIRONMENT_ID_HEADER = 'X-Seams-Environment-Id';
const WALLET_REGISTRATION_PREPARE_PATH = '/wallets/register/prepare';
const WALLET_REGISTRATION_FINALIZE_PATH = '/wallets/register/finalize';
const WRANGLER_WORKER_RESTARTED_MID_REQUEST = 'Your worker restarted mid-request';

function utf8Bytes(value: string): number {
  try {
    return new TextEncoder().encode(String(value || '')).length;
  } catch {
    return String(value || '').length;
  }
}

function registrationBenchmarkDiagnosticsEnabled(): boolean {
  try {
    return (
      (globalThis as { __SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS?: unknown })
        .__SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS === true
    );
  } catch {
    return false;
  }
}

function collectPayloadSizeBreakdown(input: {
  value: unknown;
  out: Record<string, number>;
  path: string;
  depth: number;
}): void {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) return;
  if (Object.keys(input.out).length >= ROUTE_PAYLOAD_BREAKDOWN_MAX_FIELDS) return;
  for (const [key, entry] of Object.entries(input.value as Record<string, unknown>)) {
    if (Object.keys(input.out).length >= ROUTE_PAYLOAD_BREAKDOWN_MAX_FIELDS) return;
    const fieldPath = input.path ? `${input.path}.${key}` : key;
    if (typeof entry === 'string') {
      input.out[`${fieldPath}Bytes`] = utf8Bytes(entry);
    } else if (Array.isArray(entry)) {
      input.out[`${fieldPath}Count`] = entry.length;
    } else if (input.depth > 0 && entry && typeof entry === 'object') {
      collectPayloadSizeBreakdown({
        value: entry,
        out: input.out,
        path: fieldPath,
        depth: input.depth - 1,
      });
    }
  }
}

function payloadSizeBreakdown(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  collectPayloadSizeBreakdown({
    value,
    out,
    path: '',
    depth: ROUTE_PAYLOAD_BREAKDOWN_MAX_DEPTH,
  });
  return out;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readParsedJsonField(value: unknown, field: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, field);
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '{}';
  }
}

function walletRegistrationPostMaxAttempts(path: string): number {
  return path === WALLET_REGISTRATION_PREPARE_PATH ? 2 : 1;
}

function isWranglerWorkerRestartedMidRequestResponse(input: {
  path: string;
  status: number;
  responseText: string;
  attempt: number;
}): boolean {
  return (
    input.path === WALLET_REGISTRATION_PREPARE_PATH &&
    input.attempt === 0 &&
    input.status === 503 &&
    input.responseText.includes(WRANGLER_WORKER_RESTARTED_MID_REQUEST)
  );
}

async function postJson(args: {
  relayerUrl: string;
  path: string;
  body: unknown;
  headers?: Record<string, string>;
  /**
   * Receives the raw `Server-Timing` response header when the Gateway sends
   * one. Diagnostics only: never awaited, never allowed to throw into the
   * request, and null whenever the header is absent or unexposed by CORS.
   */
  onServerTiming?: (header: string | null) => void;
}): Promise<unknown> {
  const startedAt = Date.now();
  const requestBody = JSON.stringify(args.body);
  const maxAttempts = walletRegistrationPostMaxAttempts(args.path);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(
      `${normalizeRelayerBaseUrl(args.relayerUrl, { trim: false })}${args.path}`,
      buildRelayerJsonPostRequestInit({
        headers: args.headers,
        body: args.body,
        bodyJson: requestBody,
      }),
    );
    if (args.onServerTiming) {
      try {
        args.onServerTiming(response.headers.get('Server-Timing'));
      } catch {
        // Diagnostics must never change registration behavior.
      }
    }
    const responseText = await readResponseText(response);
    const data = parseJsonText(responseText);
    if (registrationBenchmarkDiagnosticsEnabled()) {
      console.info(REGISTRATION_ROUTE_PAYLOAD_DIAGNOSTICS_LABEL, {
        path: args.path,
        status: response.status,
        attempt,
        requestBytes: utf8Bytes(requestBody),
        requestSizeBreakdown: payloadSizeBreakdown(args.body),
        responseBytes: utf8Bytes(responseText),
        responseSizeBreakdown: payloadSizeBreakdown(data),
        totalMs: Date.now() - startedAt,
      });
    }
    if (
      isWranglerWorkerRestartedMidRequestResponse({
        path: args.path,
        status: response.status,
        responseText,
        attempt,
      })
    ) {
      continue;
    }
    if (!response.ok || readParsedJsonField(data, 'ok') === false) {
      throw new Error(
        String(
          readParsedJsonField(data, 'message') ||
            readParsedJsonField(data, 'error') ||
            readParsedJsonField(data, 'code') ||
            `HTTP ${response.status}`,
        ),
      );
    }
    return data;
  }
  throw new Error('wallet registration request exhausted retry attempts');
}

export type CreateRegistrationIntentRequest = {
  wallet: RegisterWalletInput;
  authMethod: RegistrationAuthMethodInput;
  signerSelection: RegistrationSignerSetRequest;
};

export type CreateRegistrationIntentResponse = {
  ok: true;
  intent: RegistrationIntentV1;
  registrationIntentDigestB64u: string;
  registrationIntentGrant: RegistrationIntentGrant;
  expiresAtMs: number;
};

export type CancelRegistrationIntentResponse = {
  ok: true;
  cancelled: boolean;
  releasedServerAllocatedWalletId: boolean;
};

export type FundImplicitNearAccountForTestingResponse =
  | {
      ok: true;
      walletId: string;
      nearAccountId: string;
      fundedAmountYocto: string;
      transactionHash?: string;
      message?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const FUND_IMPLICIT_NEAR_SUCCESS_REQUIRED_FIELDS = [
  'ok',
  'walletId',
  'nearAccountId',
  'fundedAmountYocto',
] as const;
const FUND_IMPLICIT_NEAR_SUCCESS_OPTIONAL_FIELDS = ['transactionHash', 'message'] as const;
const FUND_IMPLICIT_NEAR_FAILURE_FIELDS = ['ok', 'code', 'message'] as const;

function requireFundImplicitNearResponseObject(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertFundImplicitNearResponseFields(
  value: object,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  label: string,
): void {
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  const actualFields = Object.keys(value);
  if (actualFields.some((field) => !allowedFields.has(field))) {
    throw new Error(`${label} contains unexpected fields`);
  }
  for (const field of requiredFields) {
    if (!actualFields.includes(field)) {
      throw new Error(`${label}.${field} is required`);
    }
  }
}

function readFundImplicitNearResponseField(value: object, field: string): unknown {
  return Reflect.get(value, field);
}

function requireFundImplicitNearResponseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireFundImplicitNearOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

export function parseFundImplicitNearAccountForTestingResponse(
  value: unknown,
): FundImplicitNearAccountForTestingResponse {
  const response = requireFundImplicitNearResponseObject(
    value,
    'fund implicit NEAR account response',
  );
  const ok = readFundImplicitNearResponseField(response, 'ok');
  if (ok === true) {
    assertFundImplicitNearResponseFields(
      response,
      FUND_IMPLICIT_NEAR_SUCCESS_REQUIRED_FIELDS,
      FUND_IMPLICIT_NEAR_SUCCESS_OPTIONAL_FIELDS,
      'fund implicit NEAR account success response',
    );
    const walletIdResult = parseWalletId(readFundImplicitNearResponseField(response, 'walletId'));
    if (!walletIdResult.ok) throw new Error('fund implicit NEAR account walletId is invalid');
    const nearAccountIdResult = parseImplicitNearAccountId(
      readFundImplicitNearResponseField(response, 'nearAccountId'),
    );
    if (!nearAccountIdResult.ok) {
      throw new Error('fund implicit NEAR account nearAccountId is invalid');
    }
    const transactionHash = requireFundImplicitNearOptionalString(
      readFundImplicitNearResponseField(response, 'transactionHash'),
      'fund implicit NEAR account transactionHash',
    );
    const message = requireFundImplicitNearOptionalString(
      readFundImplicitNearResponseField(response, 'message'),
      'fund implicit NEAR account message',
    );
    return {
      ok: true,
      walletId: walletIdResult.value,
      nearAccountId: nearAccountIdResult.value,
      fundedAmountYocto: requireFundImplicitNearResponseString(
        readFundImplicitNearResponseField(response, 'fundedAmountYocto'),
        'fund implicit NEAR account fundedAmountYocto',
      ),
      ...(transactionHash === undefined ? {} : { transactionHash }),
      ...(message === undefined ? {} : { message }),
    };
  }
  if (ok === false) {
    assertFundImplicitNearResponseFields(
      response,
      FUND_IMPLICIT_NEAR_FAILURE_FIELDS,
      [],
      'fund implicit NEAR account failure response',
    );
    return {
      ok: false,
      code: requireFundImplicitNearResponseString(
        readFundImplicitNearResponseField(response, 'code'),
        'fund implicit NEAR account code',
      ),
      message: requireFundImplicitNearResponseString(
        readFundImplicitNearResponseField(response, 'message'),
        'fund implicit NEAR account message',
      ),
    };
  }
  throw new Error('fund implicit NEAR account response has an invalid ok discriminator');
}

export async function fundImplicitNearAccountForTesting(args: {
  relayerUrl: string;
  walletId: WalletId | string;
  nearAccountId: string;
  nearPublicKeyStr: string;
  walletSessionToken: string;
}): Promise<FundImplicitNearAccountForTestingResponse> {
  const walletId = String(args.walletId || '').trim();
  const nearAccountId = String(args.nearAccountId || '').trim();
  const nearPublicKeyStr = String(args.nearPublicKeyStr || '').trim();
  const walletSessionToken = String(args.walletSessionToken || '').trim();
  if (!walletId) throw new Error('walletId is required for implicit NEAR account funding');
  if (!nearAccountId) {
    throw new Error('nearAccountId is required for implicit NEAR account funding');
  }
  if (!nearPublicKeyStr) {
    throw new Error('nearPublicKeyStr is required for implicit NEAR account funding');
  }
  if (!walletSessionToken) {
    throw new Error('walletSessionToken is required for implicit NEAR account funding');
  }
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/near/implicit-account/fund`,
    headers: buildBearerAuthorizationHeader({
      token: walletSessionToken,
      missingMessage: 'walletSessionToken is required for implicit NEAR account funding',
    }),
    body: {
      nearAccountId,
      nearPublicKeyStr,
    },
  });
  return parseFundImplicitNearAccountForTestingResponse(response);
}

export type RegistrationPreparationId = string & { readonly __brand: 'RegistrationPreparationId' };

export function registrationPreparationIdFromString(value: string): RegistrationPreparationId {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Registration preparation id is required');
  }
  return normalized as RegistrationPreparationId;
}

export type WalletRegistrationRouteTimingName =
  | 'registrationIntentLoadMs'
  | 'registrationIntentDigestMs'
  | 'registrationIntentConsumeMs'
  | 'registrationAttemptGateMs'
  | 'registrationPreparationPersistMs'
  | 'registrationPreparationLoadMs'
  | 'registrationPreparationConsumeMs'
  | 'registrationPreparationScopeCheckMs'
  | 'registrationAuthorityVerifyMs'
  | 'registrationEcdsaPrepareMs'
  | 'registrationCeremonyPersistMs'
  | 'registerPrepareTotalMs'
  | 'registerStartTotalMs'
  | 'registrationEcdsaRespondMs'
  | 'registrationFinalizeReplayLoadMs'
  | 'registrationCeremonyLoadMs'
  | 'registrationEcdsaBootstrapVerifyMs'
  | 'sponsoredNearAccountCreateMs'
  | 'registrationKeygenMs'
  | 'registrationEmailOtpEnrollmentPlanMs'
  | 'relaySessionMintMs'
  | 'relayGoogleEmailOtpActivationPlanMs'
  | 'relayPersistenceMs'
  | 'registrationFinalizeReplayCacheMs'
  | 'registerFinalizeTotalMs';

export type WalletRegistrationRouteDiagnostics = {
  kind: 'wallet_registration_route_diagnostics_v1';
  route:
    | 'wallets_register_start'
    | 'wallets_register_ecdsa_derivation_respond'
    | 'wallets_register_finalize';
  entries: {
    name: WalletRegistrationRouteTimingName;
    durationMs: number;
  }[];
};

export type WalletRegistrationEd25519YaoStart = {
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
};

export type WalletRegistrationEcdsaPreparePayload = {
  kind: 'evm_family_ecdsa_keygen';
  chainTargets: readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]];
  prepare: WalletRegistrationEcdsaPrepareContext;
  strictRegistration: RouterAbEcdsaRegistrationRequestFactsV1;
};

const WALLET_REGISTRATION_ECDSA_PREPARE_FIELDS = [
  'formatVersion',
  'walletId',
  'evmFamilySigningKeySlotId',
  'ecdsaThresholdKeyId',
  'signingRootId',
  'signingRootVersion',
  'keyScope',
  'relayerKeyId',
  'registrationPreparationId',
  'requestId',
  'thresholdSessionId',
  'ttlMs',
  'remainingUses',
  'participantIds',
  'runtimePolicyScope',
] as const;

type WalletRegistrationSetupChainTarget =
  | {
      kind: 'evm';
      namespace: 'eip155';
      chainId: number;
      networkSlug?: string;
    }
  | {
      kind: 'tempo';
      chainId: number;
      networkSlug?: string;
    };

export type WalletRegistrationSetupEcdsaPreparePayload = Omit<
  WalletRegistrationEcdsaPreparePayload,
  'chainTargets'
> & {
  chainTargets: readonly [
    WalletRegistrationSetupChainTarget,
    ...WalletRegistrationSetupChainTarget[],
  ];
};

type WalletRegistrationStartResponseBase = {
  ok: true;
  registrationCeremonyId: string;
  intent: RegistrationIntentV1;
  registrationDiagnostics?: WalletRegistrationRouteDiagnostics;
};

export type WalletRegistrationStartResponse = WalletRegistrationStartResponseBase &
  (
    | {
        kind: 'near_ed25519';
        ed25519: WalletRegistrationEd25519YaoStart;
        ecdsa?: never;
      }
    | {
        kind: 'evm_family_ecdsa';
        ecdsa: WalletRegistrationEcdsaPreparePayload;
        ed25519?: never;
      }
    | {
        kind: 'near_ed25519_and_evm_family_ecdsa';
        ed25519: WalletRegistrationEd25519YaoStart;
        ecdsa: WalletRegistrationEcdsaPreparePayload;
      }
  );

/**
 * Refactor 94C. The `/wallets/register/setup` response.
 *
 * `signedSetup` is opaque to the client: it is carried to routes 2 and 3 and
 * echoed verbatim, never parsed. `registrationIntentDigestB64u` is the
 * challenge the WebAuthn create must sign.
 */
type WalletRegistrationSetupSuccessBase = {
  ok: true;
  registrationCeremonyId: string;
  walletId: string;
  walletAuthMethodId: WalletAuthMethodId;
  registrationIntentDigestB64u: string;
  intent: RegistrationIntentV1;
  signedSetup: string;
};

export type WalletRegistrationSetupResponseV2 =
  | (WalletRegistrationSetupSuccessBase & {
      kind: 'evm_family_ecdsa' | 'near_ed25519_and_evm_family_ecdsa';
      ecdsa: WalletRegistrationSetupEcdsaPreparePayload;
    })
  | (WalletRegistrationSetupSuccessBase & {
      kind: 'near_ed25519';
      ecdsa?: never;
    })
  | { ok: false; code: string; message: string; retryAfterMs?: number };

function requireWalletRegistrationResponseObject(args: {
  responseName: string;
  field: string;
  value: unknown;
}): object {
  if (args.value === null || typeof args.value !== 'object' || Array.isArray(args.value)) {
    throw new Error(`${args.responseName} response missing ${args.field}`);
  }
  return args.value;
}

function readWalletRegistrationResponseField(
  record: object,
  field: string,
  label: string,
): unknown {
  if (!Object.keys(record).includes(field)) {
    throw new Error(`${label} is missing ${field}`);
  }
  return Reflect.get(record, field);
}

function readOptionalWalletRegistrationResponseField(
  record: object,
  field: string,
  label: string,
): unknown {
  if (!Object.keys(record).includes(field)) return undefined;
  return Reflect.get(record, field);
}

function assertWalletRegistrationResponseKeys(
  record: object,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new Error(`${label} contains unexpected ${key}`);
  }
}

function requireWalletRegistrationResponseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function hasWalletRegistrationResponseField(record: object, field: string): boolean {
  return Object.keys(record).includes(field);
}

function requireWalletRegistrationSetupString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function requireWalletRegistrationSetupSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function readWalletRegistrationSetupString(record: object, field: string, label: string): string {
  return requireWalletRegistrationSetupString(
    readWalletRegistrationResponseField(record, field, label),
    `${label}.${field}`,
  );
}

function readWalletRegistrationSetupOptionalString(
  record: object,
  field: string,
  label: string,
): string | undefined {
  if (!hasWalletRegistrationResponseField(record, field)) return undefined;
  return requireWalletRegistrationSetupString(
    readWalletRegistrationResponseField(record, field, label),
    `${label}.${field}`,
  );
}

function readWalletRegistrationSetupSafeInteger(
  record: object,
  field: string,
  label: string,
  minimum: number,
): number {
  return requireWalletRegistrationSetupSafeInteger(
    readWalletRegistrationResponseField(record, field, label),
    `${label}.${field}`,
    minimum,
  );
}

function parseWalletRegistrationSetupParticipantIds(
  value: unknown,
  label: string,
): readonly number[] {
  const values = requireWalletRegistrationResponseArray(value, label);
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  const participantIds: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    participantIds.push(
      requireWalletRegistrationSetupSafeInteger(values[index], `${label}[${index}]`, 1),
    );
  }
  return participantIds;
}

function parseWalletRegistrationSetupParticipantPair(
  value: unknown,
  label: string,
): readonly [number, number] {
  const participantIds = parseWalletRegistrationSetupParticipantIds(value, label);
  if (participantIds.length !== 2 || participantIds[0] !== 1 || participantIds[1] !== 2) {
    throw new Error(`${label} must be [1, 2]`);
  }
  return [1, 2];
}

function parseWalletRegistrationSetupRuntimePolicyScope(
  value: unknown,
  responseName: string,
  requireSigningRootVersion = false,
): RegistrationIntentV1['runtimePolicyScope'] {
  if (value === undefined) return undefined;
  const scopeName = `${responseName} runtimePolicyScope`;
  const scope = requireWalletRegistrationResponseObject({
    responseName: scopeName,
    field: 'value',
    value,
  });
  assertWalletRegistrationResponseKeys(
    scope,
    ['orgId', 'projectId', 'envId', 'signingRootVersion'],
    scopeName,
  );
  const signingRootVersion = readWalletRegistrationSetupOptionalString(
    scope,
    'signingRootVersion',
    scopeName,
  );
  if (requireSigningRootVersion && signingRootVersion === undefined) {
    throw new Error(`${scopeName}.signingRootVersion is required`);
  }
  const base = {
    orgId: readWalletRegistrationSetupString(scope, 'orgId', scopeName),
    projectId: readWalletRegistrationSetupString(scope, 'projectId', scopeName),
    envId: readWalletRegistrationSetupString(scope, 'envId', scopeName),
  };
  return signingRootVersion === undefined
    ? base
    : {
        ...base,
        signingRootVersion,
      };
}

function parseWalletRegistrationSetupPrepareRuntimePolicyScope(
  value: unknown,
  responseName: string,
): ThresholdRuntimePolicyScope {
  const runtimePolicyScope = parseWalletRegistrationSetupRuntimePolicyScope(
    value,
    responseName,
    true,
  );
  if (!runtimePolicyScope || runtimePolicyScope.signingRootVersion === undefined) {
    throw new Error(`${responseName} runtimePolicyScope is invalid`);
  }
  return {
    orgId: runtimePolicyScope.orgId,
    projectId: runtimePolicyScope.projectId,
    envId: runtimePolicyScope.envId,
    signingRootVersion: runtimePolicyScope.signingRootVersion,
  };
}

function parseWalletRegistrationSetupAuthMethod(value: unknown): RegistrationAuthMethodInput {
  const responseName = 'Wallet registration setup intent authMethod';
  const authMethod = requireWalletRegistrationResponseObject({
    responseName,
    field: 'value',
    value,
  });
  const kind = readWalletRegistrationSetupString(authMethod, 'kind', responseName);
  switch (kind) {
    case 'passkey': {
      assertWalletRegistrationResponseKeys(
        authMethod,
        ['kind', 'rpId', 'authenticatorOptions'],
        responseName,
      );
      const rpId = parseWebAuthnRpId(
        readWalletRegistrationSetupString(authMethod, 'rpId', responseName),
      );
      if (!rpId.ok) throw new Error(`${responseName}.rpId is invalid`);
      if (!hasWalletRegistrationResponseField(authMethod, 'authenticatorOptions')) {
        break;
      }
      if (
        readWalletRegistrationResponseField(authMethod, 'authenticatorOptions', responseName) ===
        undefined
      ) {
        throw new Error(`${responseName}.authenticatorOptions must be defined when present`);
      }
      break;
    }
    case 'email_otp': {
      const proofKind = readWalletRegistrationSetupString(authMethod, 'proofKind', responseName);
      switch (proofKind) {
        case 'otp_challenge': {
          assertWalletRegistrationResponseKeys(
            authMethod,
            ['kind', 'proofKind', 'email', 'providerSubject', 'otpCode', 'challengeId'],
            responseName,
          );
          readWalletRegistrationSetupOptionalString(authMethod, 'challengeId', responseName);
          readWalletRegistrationSetupString(authMethod, 'email', responseName);
          readWalletRegistrationSetupString(authMethod, 'providerSubject', responseName);
          readWalletRegistrationSetupString(authMethod, 'otpCode', responseName);
          break;
        }
        case 'google_sso_registration': {
          assertWalletRegistrationResponseKeys(
            authMethod,
            [
              'kind',
              'proofKind',
              'email',
              'providerSubject',
              'googleEmailOtpRegistrationAttemptId',
              'googleEmailOtpRegistrationOfferId',
              'googleEmailOtpRegistrationCandidateId',
            ],
            responseName,
          );
          readWalletRegistrationSetupString(authMethod, 'email', responseName);
          readWalletRegistrationSetupString(authMethod, 'providerSubject', responseName);
          readWalletRegistrationSetupString(
            authMethod,
            'googleEmailOtpRegistrationAttemptId',
            responseName,
          );
          readWalletRegistrationSetupString(
            authMethod,
            'googleEmailOtpRegistrationOfferId',
            responseName,
          );
          readWalletRegistrationSetupString(
            authMethod,
            'googleEmailOtpRegistrationCandidateId',
            responseName,
          );
          break;
        }
        default:
          throw new Error(`${responseName}.proofKind is invalid`);
      }
      break;
    }
    default:
      throw new Error(`${responseName}.kind is invalid`);
  }
  const normalized = normalizeRegistrationAuthMethodInput(value);
  if (!normalized) throw new Error(`${responseName} is invalid`);
  return normalized;
}

function parseWalletRegistrationSetupNearAccountProvisioning(
  value: unknown,
): RegistrationNearAccountProvisioning {
  const responseName = 'Wallet registration setup intent accountProvisioning';
  const provisioning = requireWalletRegistrationResponseObject({
    responseName,
    field: 'value',
    value,
  });
  const kind = readWalletRegistrationSetupString(provisioning, 'kind', responseName);
  switch (kind) {
    case 'implicit_account':
      assertWalletRegistrationResponseKeys(provisioning, ['kind', 'accountIdSource'], responseName);
      if (
        readWalletRegistrationSetupString(provisioning, 'accountIdSource', responseName) !==
        'ed25519_public_key'
      ) {
        throw new Error(`${responseName}.accountIdSource is invalid`);
      }
      return { kind, accountIdSource: 'ed25519_public_key' };
    case 'sponsored_named_account': {
      assertWalletRegistrationResponseKeys(
        provisioning,
        ['kind', 'requestedAccountId', 'sponsor'],
        responseName,
      );
      if (readWalletRegistrationSetupString(provisioning, 'sponsor', responseName) !== 'relayer') {
        throw new Error(`${responseName}.sponsor is invalid`);
      }
      const requestedAccountId = parseNamedNearAccountId(
        readWalletRegistrationSetupString(provisioning, 'requestedAccountId', responseName),
      );
      if (!requestedAccountId.ok) throw new Error(`${responseName}.requestedAccountId is invalid`);
      return { kind, requestedAccountId: requestedAccountId.value, sponsor: 'relayer' };
    }
    default:
      throw new Error(`${responseName}.kind is invalid`);
  }
}

function sameWalletRegistrationSetupChainTarget(
  left: WalletRegistrationSetupChainTarget,
  right: WalletRegistrationSetupChainTarget,
): boolean {
  switch (left.kind) {
    case 'evm':
      return (
        right.kind === 'evm' &&
        left.namespace === right.namespace &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    case 'tempo':
      return (
        right.kind === 'tempo' &&
        left.chainId === right.chainId &&
        left.networkSlug === right.networkSlug
      );
    default:
      return assertNeverWalletRegistrationSetupChainTarget(left);
  }
}

function assertNeverWalletRegistrationSetupChainTarget(value: never): never {
  throw new Error(`Unsupported wallet registration setup chain target: ${String(value)}`);
}

function parseWalletRegistrationSetupEcdsaChainTarget(
  value: unknown,
  responseName: string,
): WalletRegistrationSetupChainTarget {
  const target = requireWalletRegistrationResponseObject({
    responseName,
    field: 'chainTarget',
    value,
  });
  const kind = readWalletRegistrationSetupString(target, 'kind', responseName);
  switch (kind) {
    case 'evm': {
      assertWalletRegistrationResponseKeys(
        target,
        ['kind', 'namespace', 'chainId', 'networkSlug'],
        responseName,
      );
      if (readWalletRegistrationSetupString(target, 'namespace', responseName) !== 'eip155') {
        throw new Error(`${responseName}.namespace is invalid`);
      }
      const chainId = readWalletRegistrationSetupSafeInteger(target, 'chainId', responseName, 1);
      const networkSlug = readWalletRegistrationSetupOptionalString(
        target,
        'networkSlug',
        responseName,
      );
      return networkSlug === undefined
        ? { kind, namespace: 'eip155', chainId }
        : { kind, namespace: 'eip155', chainId, networkSlug };
    }
    case 'tempo': {
      assertWalletRegistrationResponseKeys(
        target,
        ['kind', 'chainId', 'networkSlug'],
        responseName,
      );
      const chainId = readWalletRegistrationSetupSafeInteger(target, 'chainId', responseName, 1);
      const networkSlug = readWalletRegistrationSetupOptionalString(
        target,
        'networkSlug',
        responseName,
      );
      return networkSlug === undefined ? { kind, chainId } : { kind, chainId, networkSlug };
    }
    default:
      throw new Error(`${responseName}.kind is invalid`);
  }
}

function normalizeWalletRegistrationSetupEcdsaChainTarget(
  value: unknown,
): WalletRegistrationSetupChainTarget | null {
  try {
    return parseWalletRegistrationSetupEcdsaChainTarget(value, 'Wallet registration setup intent');
  } catch {
    return null;
  }
}

function parseWalletRegistrationSetupSignerRequest(value: unknown): RegistrationSignerRequest {
  const responseName = 'Wallet registration setup intent signer';
  const signer = requireWalletRegistrationResponseObject({
    responseName,
    field: 'value',
    value,
  });
  const kind = readWalletRegistrationSetupString(signer, 'kind', responseName);
  switch (kind) {
    case 'near_ed25519':
      assertWalletRegistrationResponseKeys(
        signer,
        ['kind', 'accountProvisioning', 'signerSlot', 'participantIds', 'derivationVersion'],
        responseName,
      );
      if (
        readWalletRegistrationSetupSafeInteger(signer, 'derivationVersion', responseName, 1) !== 1
      ) {
        throw new Error(`${responseName}.derivationVersion is invalid`);
      }
      return {
        kind,
        accountProvisioning: parseWalletRegistrationSetupNearAccountProvisioning(
          readWalletRegistrationResponseField(signer, 'accountProvisioning', responseName),
        ),
        signerSlot: readWalletRegistrationSetupSafeInteger(signer, 'signerSlot', responseName, 1),
        participantIds: parseWalletRegistrationSetupParticipantIds(
          readWalletRegistrationResponseField(signer, 'participantIds', responseName),
          `${responseName}.participantIds`,
        ),
        derivationVersion: 1,
      };
    case 'evm_family_ecdsa': {
      assertWalletRegistrationResponseKeys(
        signer,
        ['kind', 'participantIds', 'chainTargets'],
        responseName,
      );
      const chainTargets = requireWalletRegistrationResponseArray(
        readWalletRegistrationResponseField(signer, 'chainTargets', responseName),
        `${responseName}.chainTargets`,
      );
      if (chainTargets.length === 0)
        throw new Error(`${responseName}.chainTargets must not be empty`);
      const parsedChainTargets: WalletRegistrationSetupChainTarget[] = [];
      for (const chainTarget of chainTargets) {
        const parsed = parseWalletRegistrationSetupEcdsaChainTarget(
          chainTarget,
          `${responseName}.chainTargets`,
        );
        if (
          parsedChainTargets.some((existing) =>
            sameWalletRegistrationSetupChainTarget(existing, parsed),
          )
        ) {
          throw new Error(`${responseName}.chainTargets contains a duplicate target`);
        }
        parsedChainTargets.push(parsed);
      }
      return {
        kind,
        participantIds: parseWalletRegistrationSetupParticipantIds(
          readWalletRegistrationResponseField(signer, 'participantIds', responseName),
          `${responseName}.participantIds`,
        ),
        chainTargets: parsedChainTargets,
      };
    }
    default:
      throw new Error(`${responseName}.kind is invalid`);
  }
}

function parseWalletRegistrationSetupSignerSelection(
  value: unknown,
): RegistrationSignerSetSelection {
  const responseName = 'Wallet registration setup intent signerSelection';
  const selection = requireWalletRegistrationResponseObject({
    responseName,
    field: 'value',
    value,
  });
  assertWalletRegistrationResponseKeys(selection, ['kind', 'signers'], responseName);
  if (readWalletRegistrationSetupString(selection, 'kind', responseName) !== 'signer_set') {
    throw new Error(`${responseName}.kind is invalid`);
  }
  const rawSigners = requireWalletRegistrationResponseArray(
    readWalletRegistrationResponseField(selection, 'signers', responseName),
    `${responseName}.signers`,
  );
  if (rawSigners.length === 0) throw new Error(`${responseName}.signers must not be empty`);
  const signers: RegistrationSignerRequest[] = [];
  for (const rawSigner of rawSigners)
    signers.push(parseWalletRegistrationSetupSignerRequest(rawSigner));
  return { kind: 'signer_set', signers };
}

function parseWalletRegistrationSetupIntent(value: unknown): RegistrationIntentV1 {
  const responseName = 'Wallet registration setup intent';
  const intent = requireWalletRegistrationResponseObject({
    responseName,
    field: 'intent',
    value,
  });
  assertWalletRegistrationResponseKeys(
    intent,
    [
      'version',
      'walletId',
      'authMethod',
      'signerSelection',
      'foundingWalletAuthMethodId',
      'runtimePolicyScope',
      'nonceB64u',
    ],
    responseName,
  );
  if (
    readWalletRegistrationSetupString(intent, 'version', responseName) !== 'registration_intent_v1'
  ) {
    throw new Error(`${responseName}.version is invalid`);
  }
  const walletIdValue = readWalletRegistrationSetupString(intent, 'walletId', responseName);
  const walletId = parseWalletId(walletIdValue);
  if (!walletId.ok) throw new Error(`${responseName}.walletId is invalid`);
  const foundingWalletAuthMethodIdValue = readWalletRegistrationSetupString(
    intent,
    'foundingWalletAuthMethodId',
    responseName,
  );
  const foundingWalletAuthMethodId = parseWalletAuthMethodId(foundingWalletAuthMethodIdValue);
  if (!foundingWalletAuthMethodId.ok) {
    throw new Error(`${responseName}.foundingWalletAuthMethodId is invalid`);
  }
  const authMethod = parseWalletRegistrationSetupAuthMethod(
    readWalletRegistrationResponseField(intent, 'authMethod', responseName),
  );
  const signerSelection = parseWalletRegistrationSetupSignerSelection(
    readWalletRegistrationResponseField(intent, 'signerSelection', responseName),
  );
  const runtimePolicyScope = parseWalletRegistrationSetupRuntimePolicyScope(
    readOptionalWalletRegistrationResponseField(intent, 'runtimePolicyScope', responseName),
    responseName,
  );
  const nonceB64u = readWalletRegistrationSetupString(intent, 'nonceB64u', responseName);
  return runtimePolicyScope === undefined
    ? {
        version: 'registration_intent_v1',
        walletId: walletId.value,
        authMethod,
        signerSelection,
        foundingWalletAuthMethodId: foundingWalletAuthMethodId.value,
        nonceB64u,
      }
    : {
        version: 'registration_intent_v1',
        walletId: walletId.value,
        authMethod,
        signerSelection,
        foundingWalletAuthMethodId: foundingWalletAuthMethodId.value,
        runtimePolicyScope,
        nonceB64u,
      };
}

function parseWalletAddSignerEcdsaRespondResponse(
  value: unknown,
): WalletAddSignerEcdsaRespondResponse {
  const responseName = 'Wallet add-signer ECDSA derivation';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'response',
    value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'addSignerCeremonyId', 'ecdsa'],
    `${responseName} response`,
  );
  if (readWalletRegistrationResponseField(response, 'ok', `${responseName} response`) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const ecdsa = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa',
    value: readWalletRegistrationResponseField(response, 'ecdsa', `${responseName} response`),
  });
  assertWalletRegistrationResponseKeys(
    ecdsa,
    ['kind', 'strictResult'],
    `${responseName} response ecdsa`,
  );
  if (
    readWalletRegistrationResponseField(ecdsa, 'kind', `${responseName} response ecdsa`) !==
    'router_ab_ecdsa_registration_forwarded_v1'
  ) {
    throw new Error(`${responseName} response kind is invalid`);
  }
  return {
    ok: true,
    addSignerCeremonyId: requireResponseString({
      responseName,
      field: 'addSignerCeremonyId',
      value: readWalletRegistrationResponseField(response, 'addSignerCeremonyId', responseName),
    }),
    ecdsa: {
      kind: 'router_ab_ecdsa_registration_forwarded_v1',
      strictResult: parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
        readWalletRegistrationResponseField(
          ecdsa,
          'strictResult',
          `${responseName} response ecdsa`,
        ),
      ),
    },
  };
}

function parseWalletAddSignerEcdsaActivationResponse(
  value: unknown,
): WalletAddSignerEcdsaActivationResponse {
  const responseName = 'Wallet add-signer ECDSA activation';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'response',
    value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'addSignerCeremonyId', 'ecdsa'],
    `${responseName} response`,
  );
  if (readWalletRegistrationResponseField(response, 'ok', `${responseName} response`) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const ecdsa = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa',
    value: readWalletRegistrationResponseField(response, 'ecdsa', `${responseName} response`),
  });
  assertWalletRegistrationResponseKeys(
    ecdsa,
    ['kind', 'activation', 'bootstrap'],
    `${responseName} response ecdsa`,
  );
  if (
    readWalletRegistrationResponseField(ecdsa, 'kind', `${responseName} response ecdsa`) !==
    'router_ab_ecdsa_registration_activated_v1'
  ) {
    throw new Error(`${responseName} response kind is invalid`);
  }
  return {
    ok: true,
    addSignerCeremonyId: requireResponseString({
      responseName,
      field: 'addSignerCeremonyId',
      value: readWalletRegistrationResponseField(response, 'addSignerCeremonyId', responseName),
    }),
    ecdsa: {
      kind: 'router_ab_ecdsa_registration_activated_v1',
      activation: parseRouterAbEcdsaRegistrationPublicActivationReceiptV1(
        readWalletRegistrationResponseField(ecdsa, 'activation', `${responseName} response ecdsa`),
      ),
      bootstrap: parseThresholdEcdsaDerivationRoleLocalBootstrapValue(
        readWalletRegistrationResponseField(ecdsa, 'bootstrap', `${responseName} response ecdsa`),
      ),
    },
  };
}

export type WalletRegistrationFinalizeAuthMethod =
  | {
      kind: 'passkey';
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
    }
  | {
      kind: 'email_otp';
      registrationAuthorityId: string;
    };

export type WalletRegistrationEd25519YaoActivationReference = {
  kind: 'router_ab_ed25519_yao_activation_reference_v1';
  lifecycle_id: string;
  session_id: RouterAbEd25519YaoBytes32V1;
};

export type WalletRegistrationEd25519YaoSignerRuntimeBootstrap = {
  walletId: WalletId;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: Ed25519AuthorityScope;
  thresholdSessionId: string;
  authorizationId: WalletSessionAuthorizationId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  expiresAtMs: number;
  participantIds: readonly [number, number];
  remainingUses: number;
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicyScope: ThresholdRuntimePolicyScope;
  routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

/**
 * The response branch is retained alongside signer-runtime bootstrap facts.
 * A reused response carries no new credential; the caller's exact credential
 * remains the only admission proof for that existing session.
 */
export type WalletRegistrationEd25519YaoBootstrapSession =
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'issued_exact_wallet_session';
      operationCredential: WalletSessionOperationCredentialV1;
    })
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'already_committed_exact_wallet_session';
      operationCredential?: never;
    });

export type WalletEd25519YaoSignerPublicResult = {
  signerSlot: number;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  publicKey: string;
  relayerKeyId: string;
  keyVersion: string;
  recoveryExportCapable: true;
  participantIds: readonly [number, number];
};

export type WalletRegistrationEd25519YaoPublicResult = WalletEd25519YaoSignerPublicResult & {
  thresholdSessionId: ThresholdEd25519SessionId;
  runtimePolicyScope: ThresholdRuntimePolicyScope;
  routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

type WalletRegistrationFinalizeResponseBase = {
  ok: true;
  walletId: WalletId;
  authority: WalletAuthAuthority;
  foundingAuthority: ActiveWalletAuthorityV1;
  foundingAuthMethod: Extract<WalletAuthMethodRecordV2, { readonly status: 'active' }>;
  registrationDiagnostics?: WalletRegistrationRouteDiagnostics;
  /**
   * What became of the custody run that rode this leg, when one did. Absent
   * means no custody payload was sent — never that a sent one succeeded.
   *
   * A caller must act on anything other than `committed`: the registration
   * itself succeeded either way, so this is the only signal that the wallet's
   * seed is not yet recoverable.
   */
  walletCustody?: WalletCustodyRegistrationOutcome;
};

/**
 * The manifest the wallet's key set was registered against. Owner Wallet
 * Sessions name this digest, so the finalize that creates the key set is where
 * the client first learns it. Finalize-only: the activate leg precedes the key
 * set and has no manifest to name.
 */
type WalletRegistrationFinalizeManifest = {
  /**
   * Optional on the wire only because the activate leg's server builder does
   * not yet honor the contract that requires it; validated whenever present.
   * The NEAR provisioning completion always carries it.
   */
  custodyKeyManifestDigestB64u?: string;
};

export type WalletRegistrationFinalizeResponseAuthority =
  | {
      rpId: string;
      authMethod: Extract<WalletRegistrationFinalizeAuthMethod, { kind: 'passkey' }>;
    }
  | {
      authMethod: Extract<WalletRegistrationFinalizeAuthMethod, { kind: 'email_otp' }>;
      rpId?: never;
    };

type WalletRegistrationFinalizeSignerResult =
  | {
      kind: 'near_ed25519';
      authorityScope: Ed25519AuthorityScope;
      accountProvisioning: RegistrationNearAccountProvisioning;
      resolvedAccount: ResolvedRegistrationNearAccount;
      ed25519: WalletRegistrationEd25519YaoPublicResult;
      ecdsa?: never;
    }
  | {
      kind: 'evm_family_ecdsa';
      ecdsa: { walletKeys: WalletRegistrationEcdsaWalletKey[] };
      authorityScope?: never;
      accountProvisioning?: never;
      resolvedAccount?: never;
      ed25519?: never;
    };

export type EmailOtpWalletRegistrationFinalizeResponse = WalletRegistrationFinalizeResponseBase &
  WalletRegistrationFinalizeManifest &
  Extract<WalletRegistrationFinalizeResponseAuthority, { authMethod: { kind: 'email_otp' } }> &
  WalletRegistrationFinalizeSignerResult;

export type WalletRegistrationFinalizeResponse =
  | (WalletRegistrationFinalizeResponseBase &
      WalletRegistrationFinalizeManifest &
      Extract<WalletRegistrationFinalizeResponseAuthority, { authMethod: { kind: 'passkey' } }> &
      WalletRegistrationFinalizeSignerResult)
  | EmailOtpWalletRegistrationFinalizeResponse;

export function isEmailOtpWalletRegistrationFinalizeResponse(
  response: WalletRegistrationFinalizeResponse,
): response is EmailOtpWalletRegistrationFinalizeResponse {
  return response.authMethod.kind === 'email_otp';
}

export type WalletRegistrationEmailOtpEnrollmentMaterial = {
  enrollmentSealKeyVersion: string;
  serverSealedFactorCiphertextB64u: string;
  clientUnlockPublicKeyB64u: string;
  unlockKeyVersion: string;
};

export type CreateAddAuthMethodIntentRequest = {
  walletId: WalletId;
  rpId: string;
  authMethod: AddAuthMethodInput;
  /**
   * Which operation is asking. Required, and part of the digest the source
   * proof signs, so a proof taken for a same-device addition cannot start a
   * linked-device ceremony.
   */
  caller: AddAuthMethodIntentCallerV1;
};

export type CreateAddAuthMethodIntentResponse = {
  ok: true;
  intent: AddAuthMethodIntentV1;
  addAuthMethodIntentDigestB64u: string;
  addAuthMethodIntentGrant: AddAuthMethodIntentGrant;
  expiresAtMs: number;
};

function parseCreateAddAuthMethodIntentResponse(value: unknown): CreateAddAuthMethodIntentResponse {
  const responseName = 'Wallet add-auth-method intent';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'intent', 'addAuthMethodIntentDigestB64u', 'addAuthMethodIntentGrant', 'expiresAtMs'],
    responseName,
  );
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const intent = parseAddAuthMethodIntentV1(
    readWalletRegistrationResponseField(response, 'intent', responseName),
  );
  let addAuthMethodIntentDigestB64u: string;
  try {
    addAuthMethodIntentDigestB64u = parseDigestB64u(
      readWalletRegistrationResponseField(response, 'addAuthMethodIntentDigestB64u', responseName),
    );
  } catch {
    throw new Error(`${responseName} response has invalid addAuthMethodIntentDigestB64u`);
  }
  const grantValue = readWalletRegistrationResponseField(
    response,
    'addAuthMethodIntentGrant',
    responseName,
  );
  if (typeof grantValue !== 'string' || !grantValue.trim()) {
    throw new Error(`${responseName} response is missing addAuthMethodIntentGrant`);
  }
  return {
    ok: true,
    intent,
    addAuthMethodIntentDigestB64u,
    addAuthMethodIntentGrant: addAuthMethodIntentGrantFromString(grantValue),
    expiresAtMs: requireResponseSafeInteger({
      responseName,
      field: 'expiresAtMs',
      value: readWalletRegistrationResponseField(response, 'expiresAtMs', responseName),
      minimum: 1,
    }),
  };
}

export type CreateAddSignerIntentRequest = {
  walletId: WalletId;
  rpId: string;
  signerSelection: AddSignerIntentV1['signerSelection'];
};

export type CreateAddSignerIntentResponse = {
  ok: true;
  intent: AddSignerIntentV1;
  addSignerIntentDigestB64u: string;
  addSignerIntentGrant: AddSignerIntentGrant;
  expiresAtMs: number;
};

function parseCreateAddSignerIntentResponse(value: unknown): CreateAddSignerIntentResponse {
  const responseName = 'Wallet add-signer intent';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'intent', 'addSignerIntentDigestB64u', 'addSignerIntentGrant', 'expiresAtMs'],
    responseName,
  );
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const intent = parseAddSignerIntentV1(
    readWalletRegistrationResponseField(response, 'intent', responseName),
  );
  let addSignerIntentDigestB64u: string;
  try {
    addSignerIntentDigestB64u = parseDigestB64u(
      readWalletRegistrationResponseField(response, 'addSignerIntentDigestB64u', responseName),
    );
  } catch {
    throw new Error(`${responseName} response has invalid addSignerIntentDigestB64u`);
  }
  const grantValue = readWalletRegistrationResponseField(
    response,
    'addSignerIntentGrant',
    responseName,
  );
  if (typeof grantValue !== 'string' || !grantValue.trim()) {
    throw new Error(`${responseName} response is missing addSignerIntentGrant`);
  }
  return {
    ok: true,
    intent,
    addSignerIntentDigestB64u,
    addSignerIntentGrant: addSignerIntentGrantFromString(grantValue),
    expiresAtMs: requireResponseSafeInteger({
      responseName,
      field: 'expiresAtMs',
      value: readWalletRegistrationResponseField(response, 'expiresAtMs', responseName),
      minimum: 1,
    }),
  };
}

export type AddSignerAuth = {
  kind: 'webauthn_assertion';
  rpId: string;
  credential: WebAuthnAuthenticationCredential;
  expectedChallengeDigestB64u: string;
};

export type AddAuthMethodAuth =
  | {
      kind: 'webauthn_assertion';
      rpId: WebAuthnRpId;
      credential: WebAuthnAuthenticationCredential;
      expectedChallengeDigestB64u: string;
    }
  | {
      /* R103 zero-prompt handoff: owner authority carried by the active owner
         Wallet Session. The token travels as the bearer credential, never in
         the request body; the server resolves every identity fact from it. */
      kind: 'wallet_session';
      walletSessionToken: string;
    }
  | {
      /* R109C `email_otp_to_passkey`: the source is the wallet's Email OTP
         method, proved freshly by a one-time code the server verifies against
         this addition's intent digest. The digest travels so the server can
         refuse a code taken for any other operation. */
      kind: 'email_otp';
      challengeId: string;
      otpCode: string;
      expectedChallengeDigestB64u: string;
    };

export type WalletAddAuthMethodAuthority =
  | {
      kind: 'passkey';
      webauthnRegistration?: never;
      emailOtpRegistrationProof?: never;
    }
  | {
      kind: 'email_otp';
      emailOtpRegistrationProof: EmailOtpRegistrationProof;
      webauthnRegistration?: never;
    };

/**
 * Declared once in the shared package. The server mints these options, this
 * client hands them to `navigator.credentials.create`, and the linked-device
 * target preparation carries them to Device 2 — one declaration, so none of
 * the three can drift from the ceremony.
 */
import {
  parseWalletAddAuthMethodRegistrationOptions,
  type WalletAddAuthMethodRegistrationOptions,
} from '@shared/utils/addAuthMethodRegistration';
export type { WalletAddAuthMethodRegistrationOptions };

export type WalletAddAuthMethodStartResponse =
  | {
      ok: true;
      addAuthMethodCeremonyId: string;
      intent: AddAuthMethodIntentV1;
      custodyEnvelope: PasskeyCustodyEnvelopeRecord;
      registration: WalletAddAuthMethodRegistrationOptions;
      /** When the ceremony itself stops being finalizable. */
      addAuthMethodCeremonyExpiresAtMs: number;
    }
  | {
      ok: true;
      addAuthMethodCeremonyId: string;
      intent: AddAuthMethodIntentV1;
      /* R109C: the Email OTP target reseals the wallet's existing seed under
         its new factor, so this branch carries the source envelope too. Only
         the created-credential options are passkey-specific. */
      custodyEnvelope: PasskeyCustodyEnvelopeRecord;
      registration?: never;
      addAuthMethodCeremonyExpiresAtMs: number;
    };

export type WalletAddAuthMethodFinalizeResponse =
  | {
      ok: true;
      walletId: WalletId;
      rpId: WebAuthnRpId;
      /** The authority the new method was added to, as the server records it. */
      authority: WalletAuthAuthority;
      authMethod: {
        kind: 'passkey';
        status: 'active';
        credentialIdB64u: string;
        credentialPublicKeyB64u: string;
        counter: number;
        device: WebAuthnAuthenticatorDeviceInfo;
      };
    }
  | {
      ok: true;
      walletId: WalletId;
      rpId?: never;
      authority: WalletAuthAuthority;
      authMethod: {
        kind: 'email_otp';
        status: 'active';
      };
    };

function parseWalletAddAuthMethodFinalizeResponse(
  value: unknown,
): WalletAddAuthMethodFinalizeResponse {
  const responseName = 'Wallet add-auth-method finalize';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const authMethod = requireWalletRegistrationResponseObject({
    responseName,
    field: 'authMethod',
    value: readWalletRegistrationResponseField(response, 'authMethod', responseName),
  });
  const authMethodKind = readWalletRegistrationResponseField(
    authMethod,
    'kind',
    `${responseName} authMethod`,
  );
  if (authMethodKind !== 'passkey' && authMethodKind !== 'email_otp') {
    throw new Error(`${responseName} response has invalid authMethod kind`);
  }
  const walletIdResult = parseWalletId(
    readWalletRegistrationResponseField(response, 'walletId', responseName),
  );
  if (!walletIdResult.ok) {
    throw new Error(`${responseName} response has invalid walletId`);
  }
  const authority = parseWalletAuthAuthority(
    readWalletRegistrationResponseField(response, 'authority', responseName),
  );
  if (!authority) {
    throw new Error(`${responseName} response has invalid authority`);
  }
  if (authority.walletId !== walletIdResult.value) {
    throw new Error(`${responseName} response authority wallet mismatch`);
  }

  if (authMethodKind === 'passkey') {
    assertWalletRegistrationResponseKeys(
      response,
      ['ok', 'walletId', 'authority', 'rpId', 'authMethod'],
      responseName,
    );
    assertWalletRegistrationResponseKeys(
      authMethod,
      ['kind', 'status', 'credentialIdB64u', 'credentialPublicKeyB64u', 'counter', 'device'],
      `${responseName} authMethod`,
    );
    if (readWalletRegistrationResponseField(authMethod, 'status', responseName) !== 'active') {
      throw new Error(`${responseName} response has invalid authMethod status`);
    }
    if (authority.factor.kind !== 'passkey' || authority.verifier.kind !== 'webauthn') {
      throw new Error(`${responseName} response has inconsistent passkey authority`);
    }
    const rpId = parseWebAuthnRpId(
      readWalletRegistrationResponseField(response, 'rpId', responseName),
    );
    if (!rpId.ok) {
      throw new Error(`${responseName} response has invalid rpId`);
    }
    const credentialIdB64u = parseWebAuthnCredentialIdB64u(
      readWalletRegistrationResponseField(authMethod, 'credentialIdB64u', responseName),
    );
    if (!credentialIdB64u.ok) {
      throw new Error(`${responseName} response has invalid credentialIdB64u`);
    }
    const credentialPublicKeyB64uValue = readWalletRegistrationResponseField(
      authMethod,
      'credentialPublicKeyB64u',
      responseName,
    );
    if (typeof credentialPublicKeyB64uValue !== 'string' || !credentialPublicKeyB64uValue.trim()) {
      throw new Error(`${responseName} response is missing credentialPublicKeyB64u`);
    }
    const counter = readWalletRegistrationResponseField(authMethod, 'counter', responseName);
    if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(`${responseName} response has invalid counter`);
    }
    const device = parseWebAuthnAuthenticatorDeviceInfo(
      readWalletRegistrationResponseField(authMethod, 'device', responseName),
    );
    if (!device) {
      throw new Error(`${responseName} response has invalid device`);
    }
    if (
      authority.factor.credentialIdB64u !== credentialIdB64u.value ||
      authority.verifier.rpId !== rpId.value
    ) {
      throw new Error(`${responseName} response passkey authority binding mismatch`);
    }
    return {
      ok: true,
      walletId: walletIdResult.value,
      authority,
      rpId: rpId.value,
      authMethod: {
        kind: 'passkey',
        status: 'active',
        credentialIdB64u: credentialIdB64u.value,
        credentialPublicKeyB64u: credentialPublicKeyB64uValue.trim(),
        counter,
        device,
      },
    };
  }

  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'walletId', 'authority', 'authMethod'],
    responseName,
  );
  assertWalletRegistrationResponseKeys(
    authMethod,
    ['kind', 'status'],
    `${responseName} authMethod`,
  );
  if (readWalletRegistrationResponseField(authMethod, 'status', responseName) !== 'active') {
    throw new Error(`${responseName} response has invalid authMethod status`);
  }
  if (
    authority.factor.kind !== 'email_otp' ||
    authority.verifier.kind !== 'email_otp_wallet_auth_method'
  ) {
    throw new Error(`${responseName} response has inconsistent email OTP authority`);
  }
  return {
    ok: true,
    walletId: walletIdResult.value,
    authority,
    authMethod: { kind: 'email_otp', status: 'active' },
  };
}

export function parseWalletAddAuthMethodStartResponse(args: {
  readonly value: unknown;
  readonly expectedIntent: AddAuthMethodIntentV1;
}): WalletAddAuthMethodStartResponse {
  const responseName = 'Wallet add-auth-method start';
  const record = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value: args.value,
  });
  if (readWalletRegistrationResponseField(record, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const addAuthMethodCeremonyId = requireResponseString({
    responseName,
    field: 'addAuthMethodCeremonyId',
    value: readWalletRegistrationResponseField(record, 'addAuthMethodCeremonyId', responseName),
  });
  const intent = requireExactAddAuthMethodIntent(
    readWalletRegistrationResponseField(record, 'intent', responseName),
    args.expectedIntent,
  );
  if (args.expectedIntent.authMethod.kind === 'email_otp') {
    assertWalletRegistrationResponseKeys(
      record,
      [
        'ok',
        'addAuthMethodCeremonyId',
        'intent',
        'custodyEnvelope',
        'addAuthMethodCeremonyExpiresAtMs',
      ],
      responseName,
    );
    return {
      ok: true,
      addAuthMethodCeremonyId,
      intent,
      custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(
        readWalletRegistrationResponseField(record, 'custodyEnvelope', responseName),
      ),
      addAuthMethodCeremonyExpiresAtMs: requireResponseSafeInteger({
        responseName,
        field: 'addAuthMethodCeremonyExpiresAtMs',
        value: readWalletRegistrationResponseField(
          record,
          'addAuthMethodCeremonyExpiresAtMs',
          responseName,
        ),
        minimum: 1,
      }),
    };
  }
  assertWalletRegistrationResponseKeys(
    record,
    [
      'ok',
      'addAuthMethodCeremonyId',
      'intent',
      'custodyEnvelope',
      'registration',
      'addAuthMethodCeremonyExpiresAtMs',
    ],
    responseName,
  );
  return {
    ok: true,
    addAuthMethodCeremonyId,
    intent,
    custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(
      readWalletRegistrationResponseField(record, 'custodyEnvelope', responseName),
    ),
    registration: parseWalletAddAuthMethodRegistrationOptions(
      readWalletRegistrationResponseField(record, 'registration', responseName),
    ),
    addAuthMethodCeremonyExpiresAtMs: requireResponseSafeInteger({
      responseName,
      field: 'addAuthMethodCeremonyExpiresAtMs',
      value: readWalletRegistrationResponseField(
        record,
        'addAuthMethodCeremonyExpiresAtMs',
        responseName,
      ),
      minimum: 1,
    }),
  };
}

type WalletAddSignerStartResponseBase = {
  ok: true;
  addSignerCeremonyId: string;
  intent: AddSignerIntentV1;
};

export type WalletAddSignerStartResponse =
  | (WalletAddSignerStartResponseBase & {
      readonly authorizationKind: 'webauthn_assertion';
      kind: 'near_ed25519';
      ed25519: {
        admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
        custodyEnvelope: PasskeyCustodyEnvelopeRecord;
      };
      ecdsa?: never;
    })
  | (WalletAddSignerStartResponseBase & {
      readonly authorizationKind: 'webauthn_assertion';
      kind: 'evm_family_ecdsa';
      ecdsa: WalletRegistrationEcdsaPreparePayload & {
        readonly custodyEnvelope: PasskeyCustodyEnvelopeRecord;
      };
      ed25519?: never;
    });

export type WalletAddSignerEcdsaRespondResponse = {
  ok: true;
  addSignerCeremonyId: string;
  ecdsa: {
    kind: 'router_ab_ecdsa_registration_forwarded_v1';
    strictResult: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
  };
};

export type WalletAddSignerEcdsaActivationResponse = {
  ok: true;
  addSignerCeremonyId: string;
  ecdsa: {
    kind: 'router_ab_ecdsa_registration_activated_v1';
    activation: RouterAbEcdsaRegistrationPublicActivationReceiptV1;
    bootstrap: ThresholdEcdsaDerivationRoleLocalBootstrapValue;
  };
};

export type WalletAddSignerFinalizeResponse = {
  ok: true;
  walletId: WalletId;
} & (
  | {
      kind: 'near_ed25519';
      rpId: string;
      credentialIdB64u: string;
      ed25519: WalletEd25519YaoSignerPublicResult;
      ecdsa?: never;
    }
  | {
      kind: 'evm_family_ecdsa';
      rpId: string;
      ecdsa: { walletKeys: WalletRegistrationEcdsaWalletKey[] };
      ed25519?: never;
    }
);

function requireExactAddSignerIntent(
  value: unknown,
  expected: AddSignerIntentV1,
): AddSignerIntentV1 {
  try {
    const actual = parseAddSignerIntentV1(value);
    if (!sameAddSignerIntentV1(actual, expected)) {
      throw new Error('intent mismatch');
    }
  } catch {
    throw new Error('Wallet add-signer start response changed the admitted intent');
  }
  return expected;
}

function requireExactAddAuthMethodIntent(
  value: unknown,
  expected: AddAuthMethodIntentV1,
): AddAuthMethodIntentV1 {
  try {
    const actual = parseAddAuthMethodIntentV1(value);
    if (!sameAddAuthMethodIntentV1(actual, expected)) {
      throw new Error('intent mismatch');
    }
  } catch {
    throw new Error('Wallet add-auth-method start response changed the admitted intent');
  }
  return expected;
}

function parseWalletAddSignerEcdsaPrepareContext(
  value: unknown,
  responseName: string,
): WalletRegistrationEcdsaPrepareContext {
  const prepare = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa.prepare',
    value,
  });
  assertWalletRegistrationResponseKeys(
    prepare,
    WALLET_REGISTRATION_ECDSA_PREPARE_FIELDS,
    responseName,
  );
  if (
    readWalletRegistrationResponseField(prepare, 'formatVersion', responseName) !==
      'ecdsa-derivation-role-local' ||
    readWalletRegistrationResponseField(prepare, 'keyScope', responseName) !== 'evm-family'
  ) {
    throw new Error(`${responseName} response has invalid prepare discriminator`);
  }
  const runtimePolicyScope = normalizeThresholdRuntimePolicyScope(
    readWalletRegistrationResponseField(prepare, 'runtimePolicyScope', responseName),
  );
  if (!runtimePolicyScope) {
    throw new Error(`${responseName} response has invalid runtimePolicyScope`);
  }
  const result: WalletRegistrationEcdsaPrepareContext = {
    formatVersion: 'ecdsa-derivation-role-local',
    walletId: requireResponseString({
      responseName,
      field: 'prepare.walletId',
      value: readWalletRegistrationResponseField(prepare, 'walletId', responseName),
    }),
    evmFamilySigningKeySlotId: requireResponseString({
      responseName,
      field: 'prepare.evmFamilySigningKeySlotId',
      value: readWalletRegistrationResponseField(
        prepare,
        'evmFamilySigningKeySlotId',
        responseName,
      ),
    }),
    ecdsaThresholdKeyId: requireResponseString({
      responseName,
      field: 'prepare.ecdsaThresholdKeyId',
      value: readWalletRegistrationResponseField(prepare, 'ecdsaThresholdKeyId', responseName),
    }),
    signingRootId: requireResponseString({
      responseName,
      field: 'prepare.signingRootId',
      value: readWalletRegistrationResponseField(prepare, 'signingRootId', responseName),
    }),
    signingRootVersion: requireResponseString({
      responseName,
      field: 'prepare.signingRootVersion',
      value: readWalletRegistrationResponseField(prepare, 'signingRootVersion', responseName),
    }),
    keyScope: 'evm-family',
    relayerKeyId: requireResponseString({
      responseName,
      field: 'prepare.relayerKeyId',
      value: readWalletRegistrationResponseField(prepare, 'relayerKeyId', responseName),
    }),
    registrationPreparationId: registrationPreparationIdFromString(
      requireResponseString({
        responseName,
        field: 'prepare.registrationPreparationId',
        value: readWalletRegistrationResponseField(
          prepare,
          'registrationPreparationId',
          responseName,
        ),
      }),
    ),
    requestId: requireResponseString({
      responseName,
      field: 'prepare.requestId',
      value: readWalletRegistrationResponseField(prepare, 'requestId', responseName),
    }),
    thresholdSessionId: requireResponseString({
      responseName,
      field: 'prepare.thresholdSessionId',
      value: readWalletRegistrationResponseField(prepare, 'thresholdSessionId', responseName),
    }),
    ttlMs: requireResponseSafeInteger({
      responseName,
      field: 'prepare.ttlMs',
      value: readWalletRegistrationResponseField(prepare, 'ttlMs', responseName),
      minimum: 1,
    }),
    remainingUses: requireResponseSafeInteger({
      responseName,
      field: 'prepare.remainingUses',
      value: readWalletRegistrationResponseField(prepare, 'remainingUses', responseName),
      minimum: 0,
    }),
    participantIds: [
      ...requireResponseParticipantPair(
        readWalletRegistrationResponseField(prepare, 'participantIds', responseName),
        responseName,
      ),
    ],
    runtimePolicyScope,
  };
  return result;
}

function assertWalletRegistrationSetupEcdsaPrepareContext(
  value: unknown,
  responseName: string,
): void {
  const prepare = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa.prepare',
    value,
  });
  assertWalletRegistrationResponseKeys(
    prepare,
    WALLET_REGISTRATION_ECDSA_PREPARE_FIELDS,
    responseName,
  );
  if (
    readWalletRegistrationResponseField(prepare, 'formatVersion', responseName) !==
      'ecdsa-derivation-role-local' ||
    readWalletRegistrationResponseField(prepare, 'keyScope', responseName) !== 'evm-family'
  ) {
    throw new Error(`${responseName} response has invalid prepare discriminator`);
  }
  for (const field of [
    'walletId',
    'evmFamilySigningKeySlotId',
    'ecdsaThresholdKeyId',
    'signingRootId',
    'signingRootVersion',
    'relayerKeyId',
    'registrationPreparationId',
    'requestId',
    'thresholdSessionId',
  ] as const) {
    readWalletRegistrationSetupString(prepare, field, responseName);
  }
  readWalletRegistrationSetupSafeInteger(prepare, 'ttlMs', responseName, 1);
  readWalletRegistrationSetupSafeInteger(prepare, 'remainingUses', responseName, 0);
  parseWalletRegistrationSetupParticipantPair(
    readWalletRegistrationResponseField(prepare, 'participantIds', responseName),
    `${responseName}.participantIds`,
  );
  parseWalletRegistrationSetupPrepareRuntimePolicyScope(
    readWalletRegistrationResponseField(prepare, 'runtimePolicyScope', responseName),
    responseName,
  );
}

function parseWalletRegistrationEcdsaPrepare(
  value: unknown,
): WalletRegistrationSetupEcdsaPreparePayload {
  const responseName = 'Wallet registration setup ECDSA';
  const ecdsa = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa',
    value,
  });
  assertWalletRegistrationResponseKeys(
    ecdsa,
    ['kind', 'chainTargets', 'prepare', 'strictRegistration'],
    responseName,
  );
  if (
    readWalletRegistrationResponseField(ecdsa, 'kind', responseName) !== 'evm_family_ecdsa_keygen'
  ) {
    throw new Error(`${responseName} response has an invalid kind`);
  }
  const rawChainTargets = readWalletRegistrationResponseField(ecdsa, 'chainTargets', responseName);
  if (!Array.isArray(rawChainTargets) || rawChainTargets.length === 0) {
    throw new Error(`${responseName} response has invalid chainTargets`);
  }
  const chainTargets: WalletRegistrationSetupChainTarget[] = [];
  for (const rawChainTarget of rawChainTargets) {
    const chainTarget = parseWalletRegistrationSetupEcdsaChainTarget(
      rawChainTarget,
      `${responseName}.chainTargets`,
    );
    if (
      chainTargets.some((existing) => sameWalletRegistrationSetupChainTarget(existing, chainTarget))
    ) {
      throw new Error(`${responseName} response has duplicate chainTargets`);
    }
    chainTargets.push(chainTarget);
  }
  const [firstTarget, ...remainingTargets] = chainTargets;
  if (!firstTarget) throw new Error(`${responseName} response has invalid chainTargets`);
  const rawPrepare = readWalletRegistrationResponseField(ecdsa, 'prepare', responseName);
  assertWalletRegistrationSetupEcdsaPrepareContext(rawPrepare, responseName);
  const prepare = parseWalletAddSignerEcdsaPrepareContext(rawPrepare, responseName);
  const strictRegistration = parseRouterAbEcdsaRegistrationRequestFactsV1(
    readWalletRegistrationResponseField(ecdsa, 'strictRegistration', responseName),
  );
  if (strictRegistration.registration_purpose !== 'wallet_registration') {
    throw new Error(`${responseName} response has an invalid registration purpose`);
  }
  return {
    kind: 'evm_family_ecdsa_keygen',
    chainTargets: [firstTarget, ...remainingTargets],
    prepare,
    strictRegistration,
  };
}

type WalletRegistrationSetupSuccessKind =
  | 'near_ed25519'
  | 'evm_family_ecdsa'
  | 'near_ed25519_and_evm_family_ecdsa';

function walletRegistrationSetupKindFromIntent(
  intent: RegistrationIntentV1,
): WalletRegistrationSetupSuccessKind {
  let hasNearEd25519 = false;
  let hasEvmFamilyEcdsa = false;
  for (const signer of intent.signerSelection.signers) {
    switch (signer.kind) {
      case 'near_ed25519':
        hasNearEd25519 = true;
        break;
      case 'evm_family_ecdsa':
        hasEvmFamilyEcdsa = true;
        break;
      default:
        return assertNeverWalletRegistrationSetupSigner(signer);
    }
  }
  if (hasNearEd25519 && hasEvmFamilyEcdsa) {
    return 'near_ed25519_and_evm_family_ecdsa';
  }
  if (hasEvmFamilyEcdsa) return 'evm_family_ecdsa';
  if (hasNearEd25519) return 'near_ed25519';
  throw new Error('Wallet registration setup intent has no signer branch');
}

function assertNeverWalletRegistrationSetupSigner(value: never): never {
  throw new Error(`Unsupported wallet registration setup signer: ${String(value)}`);
}

function sameWalletRegistrationSetupParticipantIds(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameWalletRegistrationSetupRuntimePolicyScope(
  left: RegistrationIntentV1['runtimePolicyScope'],
  right: ThresholdRuntimePolicyScope,
): boolean {
  return (
    left !== undefined &&
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

function sameWalletRegistrationSetupChainTargetValue(
  left: unknown,
  right: WalletRegistrationSetupChainTarget,
): boolean {
  try {
    return sameWalletRegistrationSetupChainTarget(
      parseWalletRegistrationSetupEcdsaChainTarget(left, 'Wallet registration setup intent'),
      right,
    );
  } catch {
    return false;
  }
}

function assertWalletRegistrationSetupEcdsaBindings(args: {
  responseName: string;
  registrationCeremonyId: string;
  walletId: WalletId;
  intent: RegistrationIntentV1;
  ecdsa: WalletRegistrationSetupEcdsaPreparePayload;
}): void {
  const ecdsaSigner = args.intent.signerSelection.signers.find(
    (signer): signer is Extract<RegistrationSignerRequest, { kind: 'evm_family_ecdsa' }> =>
      signer.kind === 'evm_family_ecdsa',
  );
  if (!ecdsaSigner) {
    throw new Error(`${args.responseName} response has no ECDSA intent branch`);
  }
  if (
    ecdsaSigner.chainTargets.length !== args.ecdsa.chainTargets.length ||
    ecdsaSigner.chainTargets.some(
      (target, index) =>
        !sameWalletRegistrationSetupChainTargetValue(target, args.ecdsa.chainTargets[index]!),
    )
  ) {
    throw new Error(`${args.responseName} response ECDSA chainTargets do not match intent`);
  }
  if (
    !sameWalletRegistrationSetupParticipantIds(
      ecdsaSigner.participantIds,
      args.ecdsa.prepare.participantIds,
    )
  ) {
    throw new Error(`${args.responseName} response ECDSA participantIds do not match intent`);
  }
  if (args.ecdsa.prepare.walletId !== String(args.walletId)) {
    throw new Error(`${args.responseName} response ECDSA prepare walletId does not match response`);
  }
  if (
    !sameWalletRegistrationSetupRuntimePolicyScope(
      args.intent.runtimePolicyScope,
      args.ecdsa.prepare.runtimePolicyScope,
    )
  ) {
    throw new Error(`${args.responseName} response ECDSA runtimePolicyScope does not match intent`);
  }
  const strictLifecycle = args.ecdsa.strictRegistration.lifecycle;
  if (
    strictLifecycle.lifecycle_id !== args.registrationCeremonyId ||
    strictLifecycle.account_id !== String(args.walletId) ||
    args.ecdsa.strictRegistration.client_id !== String(args.walletId)
  ) {
    throw new Error(`${args.responseName} response ECDSA identities do not match response`);
  }
}

function parseWalletRegistrationSetupResponseV2(value: unknown): WalletRegistrationSetupResponseV2 {
  const responseName = 'Wallet registration setup';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const kind = readWalletRegistrationResponseField(response, 'kind', responseName);
  if (
    kind !== 'near_ed25519' &&
    kind !== 'evm_family_ecdsa' &&
    kind !== 'near_ed25519_and_evm_family_ecdsa'
  ) {
    throw new Error(`${responseName} response kind is invalid`);
  }
  const carriesEcdsa = kind !== 'near_ed25519';
  assertWalletRegistrationResponseKeys(
    response,
    [
      'ok',
      'registrationCeremonyId',
      'walletId',
      'walletAuthMethodId',
      'registrationIntentDigestB64u',
      'intent',
      'signedSetup',
      'kind',
      ...(carriesEcdsa ? ['ecdsa'] : []),
    ],
    responseName,
  );
  const registrationCeremonyId = readWalletRegistrationSetupString(
    response,
    'registrationCeremonyId',
    responseName,
  );
  const walletId = parseWalletId(
    readWalletRegistrationSetupString(response, 'walletId', responseName),
  );
  if (!walletId.ok) throw new Error(`${responseName} response has an invalid walletId`);
  const walletAuthMethodId = parseWalletAuthMethodId(
    readWalletRegistrationSetupString(response, 'walletAuthMethodId', responseName),
  );
  if (!walletAuthMethodId.ok) {
    throw new Error(`${responseName} response has an invalid walletAuthMethodId`);
  }
  const intent = parseWalletRegistrationSetupIntent(
    readWalletRegistrationResponseField(response, 'intent', responseName),
  );
  if (intent.walletId !== walletId.value) {
    throw new Error(`${responseName} response walletId does not match intent`);
  }
  if (intent.foundingWalletAuthMethodId !== walletAuthMethodId.value) {
    throw new Error(`${responseName} response walletAuthMethodId does not match intent`);
  }
  let registrationIntentDigestB64u: string;
  try {
    registrationIntentDigestB64u = parseDigestB64u(
      readWalletRegistrationResponseField(response, 'registrationIntentDigestB64u', responseName),
    );
  } catch {
    throw new Error(`${responseName} response has an invalid registrationIntentDigestB64u`);
  }
  const signedSetup = readWalletRegistrationResponseField(response, 'signedSetup', responseName);
  if (typeof signedSetup !== 'string' || !signedSetup.trim()) {
    throw new Error(`${responseName} response missing signedSetup`);
  }
  if (!carriesEcdsa) {
    if (walletRegistrationSetupKindFromIntent(intent) !== kind) {
      throw new Error(`${responseName} response kind does not match intent`);
    }
    return {
      ok: true,
      registrationCeremonyId,
      walletId: walletId.value,
      walletAuthMethodId: walletAuthMethodId.value,
      registrationIntentDigestB64u,
      intent,
      signedSetup,
      kind: 'near_ed25519',
    };
  }
  const ecdsa = parseWalletRegistrationEcdsaPrepare(
    readWalletRegistrationResponseField(response, 'ecdsa', responseName),
  );
  if (walletRegistrationSetupKindFromIntent(intent) !== kind) {
    throw new Error(`${responseName} response kind does not match intent`);
  }
  assertWalletRegistrationSetupEcdsaBindings({
    responseName,
    registrationCeremonyId,
    walletId: walletId.value,
    intent,
    ecdsa,
  });
  return {
    ok: true,
    registrationCeremonyId,
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    registrationIntentDigestB64u,
    intent,
    signedSetup,
    kind,
    ecdsa,
  };
}

type WalletRegistrationSetupRequestForBinding = {
  readonly wallet?: RegisterWalletInput;
  readonly authMethod: RegistrationAuthMethodInput;
  readonly signerSelection: RegistrationSignerSetSelection;
};

function normalizeWalletRegistrationSetupRequestForBinding(
  request: WalletRegistrationSetupRequestForBinding,
): {
  readonly authMethod: RegistrationAuthMethodInput;
  readonly signerSelection: RegistrationSignerSetSelection;
} {
  const authMethod = normalizeRegistrationAuthMethodInput(request.authMethod);
  if (!authMethod) throw new Error('Wallet registration setup request authMethod is invalid');
  const signerPlan = normalizeRegistrationSignerPlan(request.signerSelection);
  if (!signerPlan.ok) {
    throw new Error(
      `Wallet registration setup request signerSelection is invalid: ${signerPlan.message}`,
    );
  }
  const signerSelection = registrationSignerSetSelectionFromPlan(signerPlan.value, {
    normalizeEcdsaChainTarget: normalizeWalletRegistrationSetupEcdsaChainTarget,
  });
  if (!signerSelection.ok) {
    throw new Error(
      `Wallet registration setup request signerSelection is invalid: ${signerSelection.message}`,
    );
  }
  return { authMethod, signerSelection: signerSelection.value };
}

function registrationIntentWithExpectedSetupRequest(
  intent: RegistrationIntentV1,
  request: ReturnType<typeof normalizeWalletRegistrationSetupRequestForBinding>,
): RegistrationIntentV1 {
  const base = {
    version: 'registration_intent_v1' as const,
    walletId: intent.walletId,
    authMethod: request.authMethod,
    signerSelection: request.signerSelection,
    foundingWalletAuthMethodId: intent.foundingWalletAuthMethodId,
    nonceB64u: intent.nonceB64u,
  };
  return intent.runtimePolicyScope === undefined
    ? base
    : {
        ...base,
        runtimePolicyScope: intent.runtimePolicyScope,
      };
}

async function assertWalletRegistrationSetupRequestBindings(args: {
  response: Extract<WalletRegistrationSetupResponseV2, { ok: true }>;
  requestedWallet?: RegisterWalletInput;
  request: ReturnType<typeof normalizeWalletRegistrationSetupRequestForBinding>;
}): Promise<void> {
  if (args.requestedWallet?.kind === 'provided') {
    const requestedWalletId = String(args.requestedWallet.walletId);
    if (requestedWalletId !== args.response.walletId) {
      throw new Error('Wallet registration setup response walletId does not match request');
    }
  }
  const actualDigest = await computeRegistrationIntentDigestB64u(args.response.intent);
  if (actualDigest !== args.response.registrationIntentDigestB64u) {
    throw new Error('Wallet registration setup response digest does not match intent');
  }
  const expectedIntent = registrationIntentWithExpectedSetupRequest(
    args.response.intent,
    args.request,
  );
  const expectedDigest = await computeRegistrationIntentDigestB64u(expectedIntent);
  if (expectedDigest !== args.response.registrationIntentDigestB64u) {
    throw new Error('Wallet registration setup response intent does not match request');
  }
}

function parseWalletAddSignerEcdsaPrepare(
  value: unknown,
  expectedIntent: AddSignerIntentV1,
): WalletRegistrationEcdsaPreparePayload {
  const responseName = 'Wallet add-signer ECDSA start';
  const record = requireWalletRegistrationResponseObject({ responseName, field: 'ecdsa', value });
  assertWalletRegistrationResponseKeys(
    record,
    ['kind', 'chainTargets', 'prepare', 'strictRegistration', 'custodyEnvelope'],
    responseName,
  );
  const kind = readWalletRegistrationResponseField(record, 'kind', responseName);
  const responseChainTargets = readWalletRegistrationResponseField(
    record,
    'chainTargets',
    responseName,
  );
  if (kind !== 'evm_family_ecdsa_keygen' || !Array.isArray(responseChainTargets)) {
    throw new Error(`${responseName} response has invalid payload`);
  }
  if (expectedIntent.signerSelection.mode !== 'ecdsa') {
    throw new Error(`${responseName} response substituted signer branch`);
  }
  const expectedTargets = expectedIntent.signerSelection.ecdsa.chainTargets;
  if (responseChainTargets.length !== expectedTargets.length) {
    throw new Error(`${responseName} response changed target count`);
  }
  const chainTargets: ThresholdEcdsaChainTarget[] = [];
  for (let index = 0; index < responseChainTargets.length; index += 1) {
    const target = responseChainTargets[index];
    const actual = parseWalletAddSignerChainTarget(target, responseName);
    const expectedValue = expectedTargets[index];
    if (!expectedValue) {
      throw new Error(`${responseName} response changed chainTarget`);
    }
    const expected = parseWalletAddSignerChainTarget(expectedValue, responseName);
    if (!thresholdEcdsaChainTargetsEqual(actual, expected)) {
      throw new Error(`${responseName} response changed chainTarget`);
    }
    chainTargets.push(actual);
  }
  const [firstTarget, ...remainingTargets] = chainTargets;
  if (!firstTarget) {
    throw new Error(`${responseName} response requires an EVM-family target`);
  }
  const prepare = parseWalletAddSignerEcdsaPrepareContext(
    readWalletRegistrationResponseField(record, 'prepare', responseName),
    responseName,
  );
  const strictRegistration = parseRouterAbEcdsaRegistrationRequestFactsV1(
    readWalletRegistrationResponseField(record, 'strictRegistration', responseName),
  );
  if (strictRegistration.registration_purpose !== 'wallet_add_signer') {
    throw new Error(`${responseName} response has invalid registration purpose`);
  }
  return {
    kind: 'evm_family_ecdsa_keygen',
    chainTargets: [firstTarget, ...remainingTargets],
    prepare,
    strictRegistration,
  };
}

export function parseWalletAddSignerStartResponse(args: {
  value: unknown;
  expectedIntent: AddSignerIntentV1;
}): WalletAddSignerStartResponse {
  const responseName = 'Wallet add-signer start';
  const record = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value: args.value,
  });
  assertWalletRegistrationResponseKeys(
    record,
    ['ok', 'addSignerCeremonyId', 'intent', 'authorizationKind', 'kind', 'ed25519', 'ecdsa'],
    responseName,
  );
  if (readWalletRegistrationResponseField(record, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const addSignerCeremonyId = requireResponseString({
    responseName,
    field: 'addSignerCeremonyId',
    value: readWalletRegistrationResponseField(record, 'addSignerCeremonyId', responseName),
  });
  const intent = requireExactAddSignerIntent(
    readWalletRegistrationResponseField(record, 'intent', responseName),
    args.expectedIntent,
  );
  const authorizationKind = readWalletRegistrationResponseField(
    record,
    'authorizationKind',
    responseName,
  );
  if (authorizationKind !== 'webauthn_assertion') {
    throw new Error(`${responseName} response has invalid authorization kind`);
  }
  const kind = readWalletRegistrationResponseField(record, 'kind', responseName);
  switch (kind) {
    case 'near_ed25519': {
      if (
        authorizationKind !== 'webauthn_assertion' ||
        intent.signerSelection.mode !== 'ed25519' ||
        readOptionalWalletRegistrationResponseField(record, 'ecdsa', responseName) !== undefined
      ) {
        throw new Error(`${responseName} response substituted signer branch`);
      }
      const ed25519 = requireWalletRegistrationResponseObject({
        responseName,
        field: 'ed25519',
        value: readWalletRegistrationResponseField(record, 'ed25519', responseName),
      });
      assertWalletRegistrationResponseKeys(
        ed25519,
        ['admissionRequest', 'custodyEnvelope'],
        responseName,
      );
      const admission = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
        readWalletRegistrationResponseField(ed25519, 'admissionRequest', responseName),
      );
      if (!admission.ok) throw new Error(admission.message);
      return {
        ok: true,
        addSignerCeremonyId,
        intent,
        authorizationKind: 'webauthn_assertion',
        kind: 'near_ed25519',
        ed25519: {
          admissionRequest: admission.value,
          custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(
            readWalletRegistrationResponseField(ed25519, 'custodyEnvelope', responseName),
          ),
        },
      };
    }
    case 'evm_family_ecdsa': {
      if (
        intent.signerSelection.mode !== 'ecdsa' ||
        readOptionalWalletRegistrationResponseField(record, 'ed25519', responseName) !== undefined
      ) {
        throw new Error(`${responseName} response substituted signer branch`);
      }
      const rawEcdsa = readWalletRegistrationResponseField(record, 'ecdsa', responseName);
      const ecdsa = parseWalletAddSignerEcdsaPrepare(rawEcdsa, intent);
      const ecdsaRecord = requireWalletRegistrationResponseObject({
        responseName,
        field: 'ecdsa',
        value: rawEcdsa,
      });
      return {
        ok: true,
        addSignerCeremonyId,
        intent,
        authorizationKind: 'webauthn_assertion',
        kind: 'evm_family_ecdsa',
        ecdsa: {
          ...ecdsa,
          custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(
            readWalletRegistrationResponseField(ecdsaRecord, 'custodyEnvelope', responseName),
          ),
        },
      };
    }
    default:
      throw new Error(`${responseName} response has invalid kind`);
  }
}

export function parseWalletAddSignerFinalizeResponse(args: {
  value: unknown;
  expectedKind: FinalizeWalletAddSignerArgs['kind'];
}): WalletAddSignerFinalizeResponse {
  const responseName = 'Wallet add-signer finalize';
  const record = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value: args.value,
  });
  assertWalletRegistrationResponseKeys(
    record,
    ['ok', 'walletId', 'kind', 'rpId', 'credentialIdB64u', 'ed25519', 'ecdsa'],
    responseName,
  );
  const ok = readWalletRegistrationResponseField(record, 'ok', responseName);
  const kind = readWalletRegistrationResponseField(record, 'kind', responseName);
  if (ok !== true || kind !== args.expectedKind) {
    throw new Error(`${responseName} response substituted signer branch`);
  }
  const walletId = walletIdFromString(
    requireResponseString({
      responseName,
      field: 'walletId',
      value: readWalletRegistrationResponseField(record, 'walletId', responseName),
    }),
  );
  const rpId = requireResponseRpId(
    readWalletRegistrationResponseField(record, 'rpId', responseName),
    responseName,
  );
  switch (kind) {
    case 'near_ed25519': {
      if (
        readOptionalWalletRegistrationResponseField(record, 'ecdsa', responseName) !== undefined
      ) {
        throw new Error(`${responseName} response mixed signer branches`);
      }
      const ed25519 = parseWalletEd25519YaoSignerPublicResult(
        readWalletRegistrationResponseField(record, 'ed25519', responseName),
        'Wallet add-signer Ed25519 finalize',
      );
      return {
        ok: true,
        walletId,
        kind: 'near_ed25519',
        rpId,
        credentialIdB64u: requireResponseString({
          responseName,
          field: 'credentialIdB64u',
          value: readWalletRegistrationResponseField(record, 'credentialIdB64u', responseName),
        }),
        ed25519,
      };
    }
    case 'evm_family_ecdsa': {
      if (
        readOptionalWalletRegistrationResponseField(record, 'ed25519', responseName) !==
          undefined ||
        readOptionalWalletRegistrationResponseField(record, 'credentialIdB64u', responseName) !==
          undefined
      ) {
        throw new Error(`${responseName} response mixed signer branches`);
      }
      const ecdsa = requireWalletRegistrationResponseObject({
        responseName,
        field: 'ecdsa',
        value: readWalletRegistrationResponseField(record, 'ecdsa', responseName),
      });
      assertWalletRegistrationResponseKeys(ecdsa, ['walletKeys'], responseName);
      const walletKeys = requireWalletRegistrationResponseArray(
        readWalletRegistrationResponseField(ecdsa, 'walletKeys', responseName),
        `${responseName} walletKeys`,
      );
      if (walletKeys.length === 0) {
        throw new Error(`${responseName} response has invalid walletKeys`);
      }
      return {
        ok: true,
        walletId,
        kind: 'evm_family_ecdsa',
        rpId,
        ecdsa: {
          walletKeys: walletKeys.map(parseWalletAddSignerEcdsaFinalizeWalletKey),
        },
      };
    }
    default:
      throw new Error(`${responseName} response has invalid kind`);
  }
}

function parseWalletAddSignerEcdsaFinalizeWalletKey(
  value: unknown,
): WalletRegistrationEcdsaWalletKey {
  return parseWalletAddSignerEcdsaWalletKey(value, 'Wallet add-signer ECDSA finalize');
}

export type WalletRegistrationEcdsaPrepareContext = {
  formatVersion: 'ecdsa-derivation-role-local';
  walletId: string;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: string;
  signingRootId: string;
  signingRootVersion: string;
  keyScope: 'evm-family';
  relayerKeyId: string;
  registrationPreparationId: RegistrationPreparationId;
  requestId: string;
  thresholdSessionId: string;
  ttlMs: number;
  remainingUses: number;
  participantIds: readonly [number, number];
  runtimePolicyScope: ThresholdRuntimePolicyScope;
};

export type WalletRegistrationEcdsaClientBootstrap = WalletRegistrationEcdsaPrepareContext & {
  derivationClientSharePublicKey33B64u: string;
  clientShareRetryCounter: number;
  contextBinding32B64u: string;
  clientRootProof?: never;
  passkeyBootstrapAuthorization?: never;
};

export type WalletRegistrationEcdsaWalletKey = {
  keyScope: 'evm-family';
  chainTarget: ThresholdEcdsaChainTarget;
  walletId: string;
  evmFamilySigningKeySlotId: string;
  keyHandle: string;
  ecdsaThresholdKeyId: string;
  signingRootId: string;
  signingRootVersion: string;
  thresholdEcdsaPublicKeyB64u: string;
  thresholdOwnerAddress: string;
  relayerKeyId: string;
  relayerVerifyingShareB64u: string;
  contextBinding32B64u: string;
  derivationClientSharePublicKey33B64u: string;
  clientShareRetryCounter: number;
  relayerShareRetryCounter: number;
  participantIds: readonly [number, number];
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
};

export type WalletRegistrationEcdsaCompletedBootstrap = {
  bootstrap: ThresholdEcdsaDerivationRoleLocalBootstrapValue;
  publicIdentity: EcdsaDerivationRoleLocalPublicIdentity;
  relayerShareRetryCounter: number;
};

type WalletRegistrationStartAuthority =
  | {
      kind: 'passkey';
      webauthnRegistration: unknown;
      emailOtpRegistrationProof?: never;
    }
  | {
      kind: 'email_otp';
      emailOtpRegistrationProof: EmailOtpRegistrationProof;
      webauthnRegistration?: never;
    };

export type WalletRegistrationEcdsaDerivationRespondBootstrap = {
  walletId: string;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: string;
  relayerKeyId: string;
  applicationBindingDigestB64u: string;
  contextBinding32B64u: string;
  publicIdentity: EcdsaDerivationRoleLocalPublicIdentity;
  relayerShareRetryCounter: number;
  keyHandle: string;
  signingRootId: string;
  signingRootVersion: string;
  thresholdEcdsaPublicKeyB64u: string;
  ethereumAddress: string;
  relayerVerifyingShareB64u: string;
  participantIds: number[];
  routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
};

function requireMatchingString(args: {
  field: string;
  expected: unknown;
  actual: unknown;
}): string {
  const expected = String(args.expected || '').trim();
  const actual = String(args.actual || '').trim();
  if (!expected || !actual) {
    throw new Error(`ECDSA registration bootstrap returned incomplete ${args.field}`);
  }
  if (expected !== actual) {
    throw new Error(`ECDSA registration bootstrap ${args.field} mismatch`);
  }
  return actual;
}

function requireMatchingParticipantIds(args: {
  expected: readonly unknown[];
  actual: readonly unknown[];
}): number[] {
  const expected = args.expected.map((participantId) => Math.floor(Number(participantId)));
  const actual = args.actual.map((participantId) => Math.floor(Number(participantId)));
  const invalid =
    expected.length === 0 ||
    actual.length === 0 ||
    expected.some((participantId) => !Number.isSafeInteger(participantId) || participantId <= 0) ||
    actual.some((participantId) => !Number.isSafeInteger(participantId) || participantId <= 0);
  if (invalid) {
    throw new Error('ECDSA registration bootstrap returned incomplete participantIds');
  }
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error('ECDSA registration bootstrap participantIds mismatch');
  }
  return actual;
}

export function parseWalletRegistrationEcdsaDerivationRespond(args: {
  clientBootstrap: WalletRegistrationEcdsaClientBootstrap;
  serverBootstrap: ThresholdEcdsaDerivationRoleLocalBootstrapValue;
  activationEpoch: RootShareEpoch;
}): WalletRegistrationEcdsaDerivationRespondBootstrap {
  const clientBootstrap = args.clientBootstrap;
  const serverBootstrap = args.serverBootstrap;
  requireMatchingString({
    field: 'derivationClientSharePublicKey33B64u',
    expected: clientBootstrap.derivationClientSharePublicKey33B64u,
    actual: serverBootstrap.publicIdentity.derivationClientSharePublicKey33B64u,
  });
  const contextBinding32B64u = requireMatchingString({
    field: 'contextBinding32B64u',
    expected: clientBootstrap.contextBinding32B64u,
    actual: serverBootstrap.contextBinding32B64u,
  });
  const walletId = requireMatchingString({
    field: 'walletId',
    expected: clientBootstrap.walletId,
    actual: serverBootstrap.walletId,
  });
  const evmFamilySigningKeySlotId = requireMatchingString({
    field: 'evmFamilySigningKeySlotId',
    expected: clientBootstrap.evmFamilySigningKeySlotId,
    actual: serverBootstrap.evmFamilySigningKeySlotId,
  });
  requireMatchingString({
    field: 'activationEpoch',
    expected: args.activationEpoch,
    actual: serverBootstrap.activationEpoch,
  });
  const participantIds = requireMatchingParticipantIds({
    expected: clientBootstrap.participantIds,
    actual: serverBootstrap.participantIds,
  });

  const routerAbEcdsaDerivationNormalSigning = requireRouterAbEcdsaDerivationNormalSigningStateV1(
    serverBootstrap.routerAbEcdsaDerivationNormalSigning,
  );
  const ecdsaThresholdKeyId = String(serverBootstrap.ecdsaThresholdKeyId || '').trim();
  const keyHandle = String(serverBootstrap.keyHandle || '').trim();
  const signingRootId = String(serverBootstrap.signingRootId || '').trim();
  const signingRootVersion = String(serverBootstrap.signingRootVersion || '').trim();
  const applicationBindingDigestB64u = String(
    serverBootstrap.applicationBindingDigestB64u || '',
  ).trim();
  const thresholdEcdsaPublicKeyB64u = String(
    serverBootstrap.thresholdEcdsaPublicKeyB64u || '',
  ).trim();
  const ethereumAddress = String(serverBootstrap.ethereumAddress || '').trim();
  const relayerKeyId = String(serverBootstrap.relayerKeyId || '').trim();
  const relayerVerifyingShareB64u = String(serverBootstrap.relayerVerifyingShareB64u || '').trim();
  const relayerShareRetryCounter = Math.floor(Number(serverBootstrap.relayerShareRetryCounter));
  if (
    !walletId ||
    !evmFamilySigningKeySlotId ||
    !keyHandle ||
    !ecdsaThresholdKeyId ||
    !signingRootId ||
    !signingRootVersion ||
    !applicationBindingDigestB64u ||
    !thresholdEcdsaPublicKeyB64u ||
    !ethereumAddress ||
    !relayerKeyId ||
    !relayerVerifyingShareB64u ||
    !Number.isSafeInteger(relayerShareRetryCounter) ||
    relayerShareRetryCounter < 0 ||
    !participantIds.length ||
    participantIds.some(
      (participantId) => !Number.isSafeInteger(participantId) || participantId <= 0,
    )
  ) {
    throw new Error('ECDSA registration bootstrap returned incomplete session material');
  }
  return {
    walletId,
    evmFamilySigningKeySlotId,
    ecdsaThresholdKeyId,
    relayerKeyId,
    applicationBindingDigestB64u,
    contextBinding32B64u,
    publicIdentity: serverBootstrap.publicIdentity,
    relayerShareRetryCounter,
    keyHandle,
    signingRootId,
    signingRootVersion,
    thresholdEcdsaPublicKeyB64u,
    ethereumAddress,
    relayerVerifyingShareB64u,
    participantIds,
    routerAbEcdsaDerivationNormalSigning,
  };
}

export type WalletEcdsaKeyFactsInventoryTarget = {
  keyHandle: string;
  ecdsaThresholdKeyId?: never;
  chainTarget: ThresholdEcdsaChainTarget;
};

export type WalletEcdsaKeyFactsInventoryResponse = {
  ok: true;
  records: ThresholdEcdsaKeyIdentityInventoryEntry[];
  diagnostics: unknown;
};

function parseWalletEcdsaKeyFactsInventoryResponse(args: {
  readonly value: unknown;
  readonly walletId: WalletId;
  readonly rpId: string;
}): WalletEcdsaKeyFactsInventoryResponse {
  const responseName = 'Wallet ECDSA key-facts inventory';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value: args.value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'ecdsaKeyIdentityTargets', 'diagnostics'],
    responseName,
  );
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const records = requireWalletRegistrationResponseArray(
    readWalletRegistrationResponseField(response, 'ecdsaKeyIdentityTargets', responseName),
    `${responseName} ecdsaKeyIdentityTargets`,
  );
  return {
    ok: true,
    records: parseThresholdEcdsaKeyIdentityTargets({
      walletId: args.walletId,
      rpId: args.rpId,
      records,
    }),
    diagnostics: readWalletRegistrationResponseField(response, 'diagnostics', responseName),
  };
}

/**
 * Refactor 94C. `POST /wallets/register/setup` — the single admitted entry
 * point replacing the grant, intent, and start calls below.
 *
 * It is called *before* the WebAuthn create prompt, because its response
 * carries the challenge that create must sign. The server-side preparation
 * therefore overlaps the user's authenticator interaction.
 */
export async function setupWalletRegistration(args: {
  relayerUrl: string;
  request: {
    wallet?: RegisterWalletInput;
    signerSelection: CreateRegistrationIntentRequest['signerSelection'];
    authMethod: CreateRegistrationIntentRequest['authMethod'];
  };
  /**
   * The route's auth plane is `api_credentials` with `publishable_key` only —
   * no bootstrap token to mint first, and no secret-key fallback on a route
   * the browser calls directly. The key travels as a Bearer token and the
   * environment id as `X-Seams-Environment-Id`; the browser adds Origin.
   */
  auth: { publishableKey: string; environmentId: string };
  headers?: Record<string, string>;
  onServerTiming?: (header: string | null) => void;
}): Promise<WalletRegistrationSetupResponseV2> {
  const publishableKey = String(args.auth?.publishableKey || '').trim();
  const environmentId = String(args.auth?.environmentId || '').trim();
  if (!publishableKey || !environmentId) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'registration setup requires a publishable key and environment id',
    };
  }
  const normalizedRequest = normalizeWalletRegistrationSetupRequestForBinding(args.request);
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: WALLET_REGISTRATION_SETUP_PATH,
    headers: {
      ...args.headers,
      Authorization: `Bearer ${publishableKey}`,
      [ROUTER_API_ENVIRONMENT_ID_HEADER]: environmentId,
    },
    body: {
      ...(args.request.wallet ? { wallet: args.request.wallet } : {}),
      signerSelection: normalizedRequest.signerSelection,
      authMethod: normalizedRequest.authMethod,
    },
    ...(args.onServerTiming ? { onServerTiming: args.onServerTiming } : {}),
  });
  const parsed = parseWalletRegistrationSetupResponseV2(response);
  if (!parsed.ok) return parsed;
  await assertWalletRegistrationSetupRequestBindings({
    response: parsed,
    ...(args.request.wallet ? { requestedWallet: args.request.wallet } : {}),
    request: normalizedRequest,
  });
  return parsed;
}

export async function createWalletAddSignerIntent(args: {
  relayerUrl: string;
  walletId: WalletId;
  request: CreateAddSignerIntentRequest;
  auth: { publishableKey: string; environmentId: string };
}): Promise<CreateAddSignerIntentResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-signer intent');
  const publishableKey = String(args.auth.publishableKey || '').trim();
  const environmentId = String(args.auth.environmentId || '').trim();
  if (!publishableKey || !environmentId) {
    throw new Error('add-signer intent requires a publishable key and environment id');
  }
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/intent`,
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      [ROUTER_API_ENVIRONMENT_ID_HEADER]: environmentId,
    },
    body: args.request,
  });
  return parseCreateAddSignerIntentResponse(response);
}

export type RevokeWalletAuthMethodResponse =
  | {
      readonly ok: true;
      readonly walletId: WalletId;
      readonly authMethod: { readonly kind: 'passkey'; readonly status: 'revoked' };
      readonly rpId: WebAuthnRpId;
    }
  | {
      readonly ok: true;
      readonly walletId: WalletId;
      readonly authMethod: { readonly kind: 'email_otp'; readonly status: 'revoked' };
      readonly rpId?: never;
    };

function parseRevokeWalletAuthMethodResponse(value: unknown): RevokeWalletAuthMethodResponse {
  const responseName = 'Wallet auth-method revoke';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const walletIdResult = parseWalletId(
    readWalletRegistrationResponseField(response, 'walletId', responseName),
  );
  if (!walletIdResult.ok) {
    throw new Error(`${responseName} response has invalid walletId`);
  }
  const authMethod = requireWalletRegistrationResponseObject({
    responseName,
    field: 'authMethod',
    value: readWalletRegistrationResponseField(response, 'authMethod', responseName),
  });
  assertWalletRegistrationResponseKeys(
    authMethod,
    ['kind', 'status'],
    `${responseName} response authMethod`,
  );
  if (readWalletRegistrationResponseField(authMethod, 'status', responseName) !== 'revoked') {
    throw new Error(`${responseName} response has invalid authMethod status`);
  }
  switch (readWalletRegistrationResponseField(authMethod, 'kind', responseName)) {
    case 'passkey':
      assertWalletRegistrationResponseKeys(
        response,
        ['ok', 'walletId', 'authMethod', 'rpId'],
        responseName,
      );
      return {
        ok: true,
        walletId: walletIdResult.value,
        authMethod: { kind: 'passkey', status: 'revoked' },
        rpId: requireResponseRpId(
          readWalletRegistrationResponseField(response, 'rpId', responseName),
          responseName,
        ),
      };
    case 'email_otp':
      assertWalletRegistrationResponseKeys(
        response,
        ['ok', 'walletId', 'authMethod'],
        responseName,
      );
      return {
        ok: true,
        walletId: walletIdResult.value,
        authMethod: { kind: 'email_otp', status: 'revoked' },
      };
    default:
      throw new Error(`${responseName} response has invalid authMethod kind`);
  }
}

/**
 * R109C: revoke one auth method using a proof from a different active one.
 *
 * The route is the wallet's own auth-method management, not device linking:
 * a sibling on the same device is not a device, and the linked-device
 * management path authenticates an owner *request* rather than a factor proof
 * bound to this exact revocation.
 */
export async function revokeWalletAuthMethod(args: {
  relayerUrl: string;
  walletId: WalletId;
  walletAuthMethodId: string;
  requestedAtMs: number;
  sourceProof: WalletAuthMethodRevocationProof;
}): Promise<RevokeWalletAuthMethodResponse> {
  const walletId = String(args.walletId || '').trim();
  const walletAuthMethodId = String(args.walletAuthMethodId || '').trim();
  if (!walletId || !walletAuthMethodId) {
    throw new Error('auth-method revoke requires a wallet and a target method');
  }
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/auth-methods/${encodeURIComponent(
      walletAuthMethodId,
    )}/revoke`,
    // The server matches these four keys exactly; anything else is refused.
    body: {
      walletId,
      walletAuthMethodId,
      requestedAtMs: args.requestedAtMs,
      sourceProof: args.sourceProof,
    },
  });
  return parseRevokeWalletAuthMethodResponse(response);
}

export async function createWalletAddAuthMethodIntent(args: {
  relayerUrl: string;
  walletId: WalletId;
  request: CreateAddAuthMethodIntentRequest;
  auth: { publishableKey: string; environmentId: string };
}): Promise<CreateAddAuthMethodIntentResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-auth-method intent');
  const publishableKey = String(args.auth.publishableKey || '').trim();
  const environmentId = String(args.auth.environmentId || '').trim();
  if (!publishableKey || !environmentId) {
    throw new Error('add-auth-method intent requires a publishable key and environment id');
  }
  /* Flat, not nested. The caller branch travels as `caller` and `source`
     siblings because that is the shape the intent itself has, and the server
     reads the branch straight off the body with the same normalizer it uses on
     a stored intent. Sending `caller: { caller, source }` gives that normalizer
     an object where it expects the discriminant, and it refuses. */
  const callerBody =
    args.request.caller.caller === 'same_device_addition'
      ? { caller: 'same_device_addition' as const, source: args.request.caller.source }
      : { caller: 'linked_device_ceremony' as const };
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/auth-methods/intent`,
    headers: {
      Authorization: `Bearer ${publishableKey}`,
      [ROUTER_API_ENVIRONMENT_ID_HEADER]: environmentId,
    },
    body: {
      walletId: args.request.walletId,
      rpId: args.request.rpId,
      authMethod: args.request.authMethod,
      ...callerBody,
    },
  });
  return parseCreateAddAuthMethodIntentResponse(response);
}

/**
 * Refactor 94C route 2. Authenticated respond: the proof the client just
 * collected against setup's challenge travels with the ECDSA registration
 * request, so one round trip both establishes the verified authority and runs
 * the Router leg.
 *
 * The result is a discriminated signer plan, not a bundle with an optional
 * Ed25519 member. A mixed plan always carries deferred NEAR work; an
 * ECDSA-only plan has no arm to omit. The NEAR work is `deferred` by
 * construction — the caller starts it and must never await it to decide the
 * wallet is usable.
 */
export type WalletRegistrationRespondEd25519DeferredWork = {
  status: 'deferred';
  admissionRequest: WalletRegistrationEd25519YaoStart['admissionRequest'];
};

type WalletRegistrationRespondEcdsaBundles = {
  kind: 'router_ab_ecdsa_registration_forwarded_v1';
  strictResult: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
};

export type WalletRegistrationRespondResponseV2 =
  | {
      ok: true;
      registrationCeremonyId: string;
      kind: 'evm_family_ecdsa';
      ecdsa: WalletRegistrationRespondEcdsaBundles;
      ed25519?: never;
    }
  | {
      ok: true;
      registrationCeremonyId: string;
      kind: 'near_ed25519_and_evm_family_ecdsa';
      ecdsa: WalletRegistrationRespondEcdsaBundles;
      ed25519: WalletRegistrationRespondEd25519DeferredWork;
    }
  | {
      /* Ed25519-only: no ECDSA leg ran, so there are no proof bundles to
         verify. The deferred work is still deferred — being the wallet's sole
         signer is not a reason to block on it. */
      ok: true;
      registrationCeremonyId: string;
      kind: 'near_ed25519';
      ecdsa?: never;
      ed25519: WalletRegistrationRespondEd25519DeferredWork;
    };

export type WalletRegistrationNearAdmissionResponseV2 = {
  ok: true;
  registrationCeremonyId: string;
  ed25519: WalletRegistrationRespondEd25519DeferredWork;
};

/**
 * Strict boundary parser for route 2.
 *
 * `kind` selects which fields are legal, so the allowed-key set is computed
 * from it: a mixed response missing its Ed25519 arm, or an ECDSA-only response
 * carrying one, is rejected rather than silently narrowed. That is the point
 * of the discriminated union — a wallet whose NEAR branch was requested but
 * whose deferred work never arrived must fail loudly here, not register as
 * ECDSA-only.
 */
function parseWalletRegistrationRespondResponseV2(
  value: unknown,
): WalletRegistrationRespondResponseV2 {
  const responseName = 'Wallet registration respond';
  const response = requireWalletRegistrationResponseObject({ responseName, field: 'body', value });
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const registrationCeremonyId = requireResponseString({
    responseName,
    field: 'registrationCeremonyId',
    value: readWalletRegistrationResponseField(response, 'registrationCeremonyId', responseName),
  });
  /* Discriminate and check shape before parsing any nested payload. A wrong
     plan shape should say so, not surface as a confusing failure from deep
     inside the ECDSA bundle parser. */
  const kind = readWalletRegistrationResponseField(response, 'kind', responseName);
  if (
    kind !== 'evm_family_ecdsa' &&
    kind !== 'near_ed25519_and_evm_family_ecdsa' &&
    kind !== 'near_ed25519'
  ) {
    throw new Error(`${responseName} response kind is invalid`);
  }
  const carriesEcdsa = kind !== 'near_ed25519';
  const carriesEd25519 = kind !== 'evm_family_ecdsa';
  assertWalletRegistrationResponseKeys(
    response,
    [
      'ok',
      'registrationCeremonyId',
      'kind',
      ...(carriesEcdsa ? ['ecdsa'] : []),
      ...(carriesEd25519 ? ['ed25519'] : []),
    ],
    responseName,
  );
  const ed25519Response = readOptionalWalletRegistrationResponseField(
    response,
    'ed25519',
    responseName,
  );
  if (carriesEd25519 && ed25519Response === undefined) {
    throw new Error(`${responseName} signer plan is missing its ed25519 deferred work`);
  }
  if (!carriesEcdsa) {
    /* No ECDSA leg ran, so there is nothing to verify in the browser. */
    return {
      ok: true,
      registrationCeremonyId,
      kind: 'near_ed25519',
      ed25519: parseWalletRegistrationRespondEd25519DeferredWork(ed25519Response),
    };
  }
  const ecdsaRecord = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa',
    value: readWalletRegistrationResponseField(response, 'ecdsa', responseName),
  });
  assertWalletRegistrationResponseKeys(
    ecdsaRecord,
    ['kind', 'strictResult'],
    `${responseName} ecdsa`,
  );
  if (
    readWalletRegistrationResponseField(ecdsaRecord, 'kind', `${responseName} ecdsa`) !==
    'router_ab_ecdsa_registration_forwarded_v1'
  ) {
    throw new Error(`${responseName} ecdsa kind is invalid`);
  }
  const ed25519 = carriesEd25519
    ? parseWalletRegistrationRespondEd25519DeferredWork(ed25519Response)
    : null;
  const ecdsa: WalletRegistrationRespondEcdsaBundles = {
    kind: 'router_ab_ecdsa_registration_forwarded_v1',
    strictResult: parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
      readWalletRegistrationResponseField(ecdsaRecord, 'strictResult', `${responseName} ecdsa`),
    ),
  };
  return ed25519
    ? {
        ok: true,
        registrationCeremonyId,
        kind: 'near_ed25519_and_evm_family_ecdsa',
        ecdsa,
        ed25519,
      }
    : { ok: true, registrationCeremonyId, kind: 'evm_family_ecdsa', ecdsa };
}

function parseWalletRegistrationRespondEd25519DeferredWork(
  value: unknown,
): WalletRegistrationRespondEd25519DeferredWork {
  const responseName = 'Wallet registration respond ed25519';
  const record = requireWalletRegistrationResponseObject({ responseName, field: 'ed25519', value });
  assertWalletRegistrationResponseKeys(record, ['status', 'admissionRequest'], responseName);
  /* `deferred` is the only legal status. Anything else would mean the server
     believes this work is already running or complete, which no client is
     entitled to assume about NEAR provisioning. */
  if (readWalletRegistrationResponseField(record, 'status', responseName) !== 'deferred') {
    throw new Error(`${responseName} status is invalid`);
  }
  const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
    readWalletRegistrationResponseField(record, 'admissionRequest', responseName),
  );
  if (!admissionRequest.ok) {
    throw new Error(`${responseName} admissionRequest is invalid`);
  }
  return {
    status: 'deferred',
    admissionRequest: admissionRequest.value,
  };
}

type WalletRegistrationSignerPlanKind = WalletRegistrationRespondResponseV2['kind'];

type RespondWalletRegistrationArgsBase = {
  relayerUrl: string;
  headers?: Record<string, string>;
  registrationCeremonyId: string;
  /** Opaque; echoed exactly as setup returned it. */
  signedSetup: string;
  onServerTiming?: (header: string | null) => void;
} & WalletRegistrationStartAuthority;

type WalletRegistrationRespondEcdsaRequest = {
  kind: 'router_ab_ecdsa_registration_v1';
  strictRegistration: RouterAbEcdsaRegistrationRequestV1;
  requestDigestB64u: string;
};

type RespondWalletRegistrationArgs =
  | (RespondWalletRegistrationArgsBase & {
      signerPlanKind: 'near_ed25519';
      ecdsa?: never;
    })
  | (RespondWalletRegistrationArgsBase & {
      signerPlanKind: Exclude<WalletRegistrationSignerPlanKind, 'near_ed25519'>;
      ecdsa: WalletRegistrationRespondEcdsaRequest;
    });

function walletRegistrationRespondBody(
  args: RespondWalletRegistrationArgs,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    registrationCeremonyId: args.registrationCeremonyId,
    signedSetup: args.signedSetup,
    kind: args.signerPlanKind,
  };
  switch (args.kind) {
    case 'passkey':
      body.webauthn_registration = args.webauthnRegistration;
      break;
    case 'email_otp':
      body.emailOtpRegistrationProof = args.emailOtpRegistrationProof;
      break;
  }
  if (args.ecdsa) body.ecdsa = args.ecdsa;
  return body;
}

export async function respondWalletRegistration(
  args: RespondWalletRegistrationArgs,
): Promise<WalletRegistrationRespondResponseV2> {
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: WALLET_REGISTRATION_RESPOND_PATH,
    headers: args.headers,
    body: walletRegistrationRespondBody(args),
    onServerTiming: args.onServerTiming,
  });
  return parseWalletRegistrationRespondResponseV2(response);
}

export async function authorizeWalletRegistrationNearAdmission(
  args: RespondWalletRegistrationArgsBase,
): Promise<WalletRegistrationNearAdmissionResponseV2> {
  const body: Record<string, unknown> = {
    registrationCeremonyId: args.registrationCeremonyId,
    signedSetup: args.signedSetup,
  };
  switch (args.kind) {
    case 'passkey':
      body.webauthn_registration = args.webauthnRegistration;
      break;
    case 'email_otp':
      body.emailOtpRegistrationProof = args.emailOtpRegistrationProof;
      break;
  }
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: WALLET_REGISTRATION_NEAR_ADMISSION_PATH,
    headers: args.headers,
    body,
  });
  const responseName = 'Wallet registration NEAR admission';
  const record = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value: response,
  });
  assertWalletRegistrationResponseKeys(
    record,
    ['ok', 'registrationCeremonyId', 'ed25519'],
    responseName,
  );
  if (readWalletRegistrationResponseField(record, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  return {
    ok: true,
    registrationCeremonyId: requireResponseString({
      responseName,
      field: 'registrationCeremonyId',
      value: readWalletRegistrationResponseField(record, 'registrationCeremonyId', responseName),
    }),
    ed25519: parseWalletRegistrationRespondEd25519DeferredWork(
      readWalletRegistrationResponseField(record, 'ed25519', responseName),
    ),
  };
}

/**
 * Refactor 94C route 3. Activate absorbs finalize: one call carries the
 * browser-verified activation facts and the Email OTP enrollment material that
 * used to ride a separate finalize request, and returns the terminal wallet.
 *
 * `nearProvisioning` is a snapshot only. It never carries NEAR identifiers
 * before readiness — those appear once deferred provisioning reaches
 * `near_ready`, never from this response.
 */
/**
 * Activate absorbed two routes, so its response is the union of what both
 * returned: the finalize terminal wallet *and* the activation payload the old
 * `derivation/activate` returned.
 *
 * Both halves are load-bearing on the client. `activation` feeds
 * `finalizeRouterAbEcdsaRegistrationActivation`, and `bootstrap` feeds the
 * session bootstrap; without them the wallet registers server-side and cannot
 * sign locally, which is the opposite of what this route exists to deliver.
 *
 * Both live inside `ecdsa` alongside the wallet keys, matching the server
 * contract: one payload carrying everything the terminal leg produced. The
 * strict parser rejects a response missing them, so a server that folded the
 * legs without merging the payloads fails at the boundary rather than
 * silently producing a wallet that cannot sign.
 */
type ActivateTerminalEcdsaPayload = Extract<
  WalletRegistrationFinalizeResponse,
  { ok: true; kind: 'evm_family_ecdsa' }
>['ecdsa'] & {
  activation: RouterAbEcdsaRegistrationPublicActivationReceiptV1;
  bootstrap: ThresholdEcdsaDerivationRoleLocalBootstrapValue;
};

/**
 * Ed25519-only activate returns a wallet that cannot sign yet: its sole signer
 * arrives with the deferred Yao computation. `nearProvisioning` is required on
 * this arm — a pending wallet with no provisioning state would be
 * indistinguishable from one that never needed NEAR.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export type WalletRegistrationActivateEd25519PendingV2 = DistributiveOmit<
  Extract<WalletRegistrationFinalizeResponse, { ok: true; kind: 'near_ed25519' }>,
  | 'ed25519'
  | 'resolvedAccount'
  | 'accountProvisioning'
  | 'authorityScope'
  | 'foundingAuthority'
  | 'foundingAuthMethod'
  // The activate leg precedes the key set, so there is no manifest to name yet.
  | 'custodyKeyManifestDigestB64u'
> & {
  /* Required, not optional: a pending Ed25519-only wallet with no provisioning
     state would be indistinguishable from one that never needed NEAR. */
  nearProvisioning: { status: 'near_pending' };
  ed25519?: never;
  resolvedAccount?: never;
  accountProvisioning?: never;
  authorityScope?: never;
  ecdsa?: never;
};

export type WalletRegistrationActivateResponseV2 =
  | (Omit<
      Extract<WalletRegistrationFinalizeResponse, { ok: true; kind: 'evm_family_ecdsa' }>,
      never
    > & {
      ecdsa: ActivateTerminalEcdsaPayload;
      registrationEstablishedSession: RegistrationEstablishedSessionResultV2;
      nearProvisioning?: { status: 'near_pending' };
    })
  | WalletRegistrationActivateEd25519PendingV2;

function parseRegistrationEstablishedSessionResult(
  value: unknown,
  expectedWalletId: WalletId,
): RegistrationEstablishedSessionResultV2 {
  const responseName = 'Wallet registration established session';
  const parsed = parseRegistrationEstablishedSessionResultV2(value);
  if (parsed === null || parsed.session.walletId !== expectedWalletId) {
    throw new Error(`${responseName} direct session result is invalid`);
  }
  return parsed;
}

function buildWalletRegistrationFinalizeTerminalResponse(record: object, ecdsa: object): object {
  const responseName = 'Wallet registration activate';
  const registrationDiagnostics = readOptionalWalletRegistrationResponseField(
    record,
    'registrationDiagnostics',
    responseName,
  );
  const rpId = readOptionalWalletRegistrationResponseField(record, 'rpId', responseName);
  const walletCustody = readOptionalWalletRegistrationResponseField(
    record,
    'walletCustody',
    responseName,
  );
  const custodyKeyManifestDigestB64u = readOptionalWalletRegistrationResponseField(
    record,
    'custodyKeyManifestDigestB64u',
    responseName,
  );
  const terminal = {
    ok: readWalletRegistrationResponseField(record, 'ok', responseName),
    walletId: readWalletRegistrationResponseField(record, 'walletId', responseName),
    authority: readWalletRegistrationResponseField(record, 'authority', responseName),
    foundingAuthority: readWalletRegistrationResponseField(
      record,
      'foundingAuthority',
      responseName,
    ),
    foundingAuthMethod: readWalletRegistrationResponseField(
      record,
      'foundingAuthMethod',
      responseName,
    ),
    ...(registrationDiagnostics === undefined ? {} : { registrationDiagnostics }),
    ...(rpId === undefined ? {} : { rpId }),
    authMethod: readWalletRegistrationResponseField(record, 'authMethod', responseName),
    ...(walletCustody === undefined ? {} : { walletCustody }),
    ...(custodyKeyManifestDigestB64u === undefined ? {} : { custodyKeyManifestDigestB64u }),
    kind: 'evm_family_ecdsa' as const,
    ecdsa: {
      walletKeys: readWalletRegistrationResponseField(ecdsa, 'walletKeys', responseName),
    },
  };
  return terminal;
}

function buildWalletRegistrationNearFinalizeTerminalResponse(record: object): object {
  const responseName = 'Wallet registration NEAR provisioning';
  const registrationDiagnostics = readOptionalWalletRegistrationResponseField(
    record,
    'registrationDiagnostics',
    responseName,
  );
  const rpId = readOptionalWalletRegistrationResponseField(record, 'rpId', responseName);
  const walletCustody = readOptionalWalletRegistrationResponseField(
    record,
    'walletCustody',
    responseName,
  );
  const custodyKeyManifestDigestB64u = readOptionalWalletRegistrationResponseField(
    record,
    'custodyKeyManifestDigestB64u',
    responseName,
  );
  return {
    ok: readWalletRegistrationResponseField(record, 'ok', responseName),
    walletId: readWalletRegistrationResponseField(record, 'walletId', responseName),
    authority: readWalletRegistrationResponseField(record, 'authority', responseName),
    foundingAuthority: readWalletRegistrationResponseField(
      record,
      'foundingAuthority',
      responseName,
    ),
    foundingAuthMethod: readWalletRegistrationResponseField(
      record,
      'foundingAuthMethod',
      responseName,
    ),
    ...(registrationDiagnostics === undefined ? {} : { registrationDiagnostics }),
    ...(rpId === undefined ? {} : { rpId }),
    authMethod: readWalletRegistrationResponseField(record, 'authMethod', responseName),
    ...(walletCustody === undefined ? {} : { walletCustody }),
    ...(custodyKeyManifestDigestB64u === undefined ? {} : { custodyKeyManifestDigestB64u }),
    kind: 'near_ed25519' as const,
    authorityScope: readWalletRegistrationResponseField(record, 'authorityScope', responseName),
    accountProvisioning: readWalletRegistrationResponseField(
      record,
      'accountProvisioning',
      responseName,
    ),
    resolvedAccount: readWalletRegistrationResponseField(record, 'resolvedAccount', responseName),
    ed25519: readWalletRegistrationResponseField(record, 'ed25519', responseName),
  };
}

/**
 * Strict boundary parser for route 3.
 *
 * The terminal wallet body is exactly the finalize success this route
 * absorbed, so it is parsed by the existing finalize parser rather than a
 * second copy that could drift from it. Only `nearProvisioning` is new.
 *
 * That field is a status and nothing else: NEAR identifiers before readiness
 * are precisely what the deferred lifecycle exists to prevent, so a payload
 * carrying them here is rejected instead of passed through.
 */
function parseWalletRegistrationActivateResponseV2(
  value: unknown,
): WalletRegistrationActivateResponseV2 {
  const responseName = 'Wallet registration activate';
  const record = requireWalletRegistrationResponseObject({ responseName, field: 'body', value });
  const kind = readWalletRegistrationResponseField(record, 'kind', responseName);
  const nearProvisioning = readOptionalWalletRegistrationResponseField(
    record,
    'nearProvisioning',
    responseName,
  );
  const rawEstablishedSession = readOptionalWalletRegistrationResponseField(
    record,
    'registrationEstablishedSession',
    responseName,
  );
  if (kind === 'near_ed25519') {
    /* Ed25519-only: no ECDSA leg ran, so there is no activation payload and no
       local session to build. The wallet exists but cannot sign until the
       deferred completion installs its sole signer, which is why the pending
       provisioning status is required rather than optional here. */
    const provisioning = requireWalletRegistrationResponseObject({
      responseName,
      field: 'nearProvisioning',
      value: nearProvisioning,
    });
    assertWalletRegistrationResponseKeys(
      provisioning,
      ['status'],
      `${responseName} nearProvisioning`,
    );
    if (
      readWalletRegistrationResponseField(
        provisioning,
        'status',
        `${responseName} nearProvisioning`,
      ) !== 'near_pending'
    ) {
      throw new Error(`${responseName} Ed25519-only wallet must be pending NEAR provisioning`);
    }
    if (rawEstablishedSession !== undefined) {
      throw new Error(`${responseName} pending Ed25519 wallet cannot carry an established session`);
    }
    assertWalletRegistrationResponseKeys(
      record,
      [
        'ok',
        'walletId',
        'authority',
        'registrationDiagnostics',
        'rpId',
        'authMethod',
        'walletCustody',
        'kind',
        'nearProvisioning',
      ],
      responseName,
    );
    if (readWalletRegistrationResponseField(record, 'ok', responseName) !== true) {
      throw new Error(`${responseName} did not return a pending Ed25519 wallet`);
    }
    const walletId = walletIdFromString(
      requireResponseString({
        responseName,
        field: 'walletId',
        value: readWalletRegistrationResponseField(record, 'walletId', responseName),
      }),
    );
    const authority = parseWalletRegistrationFinalizeAuthority(
      readWalletRegistrationResponseField(record, 'authority', responseName),
    );
    const authorityBranch = parseWalletRegistrationFinalizeAuthorityBranch({
      response: {
        authMethod: readWalletRegistrationResponseField(record, 'authMethod', responseName),
        rpId: readOptionalWalletRegistrationResponseField(record, 'rpId', responseName),
      },
      walletId,
      authority,
    });
    const registrationDiagnosticsValue = readOptionalWalletRegistrationResponseField(
      record,
      'registrationDiagnostics',
      responseName,
    );
    const registrationDiagnostics =
      registrationDiagnosticsValue === undefined
        ? undefined
        : parseWalletRegistrationFinalizeDiagnostics(registrationDiagnosticsValue);
    if (authorityBranch.kind === 'passkey') {
      return {
        ok: true,
        kind: 'near_ed25519',
        walletId,
        authority,
        ...(registrationDiagnostics ? { registrationDiagnostics } : {}),
        rpId: authorityBranch.rpId,
        authMethod: authorityBranch.authMethod,
        nearProvisioning: { status: 'near_pending' },
      };
    }
    return {
      ok: true,
      kind: 'near_ed25519',
      walletId,
      authority,
      ...(registrationDiagnostics ? { registrationDiagnostics } : {}),
      authMethod: authorityBranch.authMethod,
      /* An Ed25519-only wallet has no key set yet, so no custody run can have
         ridden this call — but the field is carried rather than dropped, so a
         Gateway that reports one is never silently ignored. */
      ...(readOptionalWalletRegistrationResponseField(record, 'walletCustody', responseName) ===
      undefined
        ? {}
        : {
            walletCustody: parseWalletCustodyRegistrationOutcome(
              readWalletRegistrationResponseField(record, 'walletCustody', responseName),
              responseName,
            ),
          }),
      nearProvisioning: { status: 'near_pending' },
    };
  }
  if (kind !== 'evm_family_ecdsa') {
    throw new Error(`${responseName} response has invalid kind`);
  }
  const ecdsaRecord = requireWalletRegistrationResponseObject({
    responseName,
    field: 'ecdsa',
    value: readWalletRegistrationResponseField(record, 'ecdsa', responseName),
  });
  assertWalletRegistrationResponseKeys(
    record,
    [
      'ok',
      'walletId',
      'authority',
      'foundingAuthority',
      'foundingAuthMethod',
      'registrationDiagnostics',
      'rpId',
      'authMethod',
      'walletCustody',
      'custodyKeyManifestDigestB64u',
      'kind',
      'ecdsa',
      'nearProvisioning',
      'registrationEstablishedSession',
    ],
    responseName,
  );
  assertWalletRegistrationResponseKeys(
    ecdsaRecord,
    ['walletKeys', 'activation', 'bootstrap'],
    responseName,
  );
  const activation = readOptionalWalletRegistrationResponseField(
    ecdsaRecord,
    'activation',
    responseName,
  );
  const bootstrap = readOptionalWalletRegistrationResponseField(
    ecdsaRecord,
    'bootstrap',
    responseName,
  );
  /* Validate the snapshot before the terminal body, so a leaked NEAR
     identifier is reported as such rather than buried behind whatever the
     finalize parser objects to first. */
  if (nearProvisioning !== undefined) {
    const provisioning = requireWalletRegistrationResponseObject({
      responseName,
      field: 'nearProvisioning',
      value: nearProvisioning,
    });
    assertWalletRegistrationResponseKeys(
      provisioning,
      ['status'],
      `${responseName} nearProvisioning`,
    );
    if (
      readWalletRegistrationResponseField(
        provisioning,
        'status',
        `${responseName} nearProvisioning`,
      ) !== 'near_pending'
    ) {
      throw new Error(`${responseName} nearProvisioning status is invalid`);
    }
  }
  /* Without these the wallet cannot sign locally, so their absence is a
     failure of the route rather than an optional extra. */
  if (activation === undefined || bootstrap === undefined) {
    throw new Error(
      `${responseName} is missing the activation payload the client needs to build its ECDSA session`,
    );
  }
  const finalizeTerminal = buildWalletRegistrationFinalizeTerminalResponse(record, ecdsaRecord);
  const finalized = parseWalletRegistrationFinalizeResponse({
    value: finalizeTerminal,
    expectedKind: 'evm_family_ecdsa',
  });
  if (!finalized.ok || finalized.kind !== 'evm_family_ecdsa') {
    throw new Error(`${responseName} did not return an activated ECDSA wallet`);
  }
  const registrationEstablishedSession = parseRegistrationEstablishedSessionResult(
    rawEstablishedSession,
    finalized.walletId,
  );
  return {
    ...finalized,
    ecdsa: {
      ...finalized.ecdsa,
      activation: parseRouterAbEcdsaRegistrationPublicActivationReceiptV1(activation),
      bootstrap: parseThresholdEcdsaDerivationRoleLocalBootstrapValue(bootstrap),
    },
    registrationEstablishedSession,
    ...(nearProvisioning === undefined
      ? {}
      : { nearProvisioning: { status: 'near_pending' as const } }),
  };
}

type ActivateWalletRegistrationArgsBase = {
  relayerUrl: string;
  headers?: Record<string, string>;
  registrationCeremonyId: string;
  signedSetup: string;
  idempotencyKey: string;
  emailOtpEnrollment?: WalletRegistrationEmailOtpEnrollmentMaterial;
  /** The custody ceremony's sealed output for the key set this call activates. */
  walletCustodyCommit?: WalletCustodyCeremonyCommitPayload;
  onServerTiming?: (header: string | null) => void;
};

type WalletRegistrationActivateEcdsaRequest = {
  activationCorrelationId: CorrelationId;
  activationRequestDigestB64u: string;
  clientActivation: RouterAbEcdsaVerifiedClientActivationFactsV1;
  expectedKeyHandles?: string[];
};

type ActivateWalletRegistrationArgs =
  | (ActivateWalletRegistrationArgsBase & {
      signerPlanKind: 'near_ed25519';
      ecdsa?: never;
    })
  | (ActivateWalletRegistrationArgsBase & {
      signerPlanKind: Exclude<WalletRegistrationSignerPlanKind, 'near_ed25519'>;
      ecdsa: WalletRegistrationActivateEcdsaRequest;
    });

function walletRegistrationActivateBody(
  args: ActivateWalletRegistrationArgs,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    registrationCeremonyId: args.registrationCeremonyId,
    kind: args.signerPlanKind,
    signedSetup: args.signedSetup,
    idempotencyKey: args.idempotencyKey,
  };
  if (args.ecdsa) body.ecdsa = args.ecdsa;
  if (args.emailOtpEnrollment) body.emailOtpEnrollment = args.emailOtpEnrollment;
  if (args.walletCustodyCommit) body.walletCustodyCommit = args.walletCustodyCommit;
  return body;
}

export async function activateWalletRegistration(
  args: ActivateWalletRegistrationArgs,
): Promise<WalletRegistrationActivateResponseV2> {
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: WALLET_REGISTRATION_ACTIVATE_PATH,
    headers: args.headers,
    body: walletRegistrationActivateBody(args),
    onServerTiming: args.onServerTiming,
  });
  return parseWalletRegistrationActivateResponseV2(response);
}

/**
 * Refactor 94C route 4. The deferred NEAR completion, called once the Yao
 * computation the client started after respond has finished.
 *
 * One completion path serves both plans: an Ed25519-only wallet installs its
 * sole signer here, and a mixed wallet's NEAR arm lands here too. It carries
 * its own idempotency key because it is a separate effect from activate's —
 * sharing one would let a retry of this call replay activate's commit.
 *
 * A retryable failure leaves the pending wallet intact and the call
 * repeatable, so the caller reports provisioning state rather than unwinding
 * a wallet that already exists.
 */
type WalletRegistrationNearProvisioningFinalizeSuccessV2 = Extract<
  WalletRegistrationFinalizeResponse,
  { ok: true; kind: 'near_ed25519' }
>;

type WalletRegistrationNearProvisioningSuccessBaseV2 = {
  registrationEstablishedSession: RegistrationEstablishedSessionResultV2;
  nearProvisioning: { status: 'near_ready' };
};

export type WalletRegistrationNearProvisioningResponseV2 =
  | (Extract<
      WalletRegistrationNearProvisioningFinalizeSuccessV2,
      { authMethod: { kind: 'passkey' } }
    > &
      WalletRegistrationNearProvisioningSuccessBaseV2 & {
        sessionSeal?: WalletRegistrationSessionSealResponse;
      })
  | (Extract<
      WalletRegistrationNearProvisioningFinalizeSuccessV2,
      { authMethod: { kind: 'email_otp' } }
    > &
      WalletRegistrationNearProvisioningSuccessBaseV2 & {
        sessionSeal?: never;
      })
  | {
      ok: false;
      code: string;
      message: string;
      nearProvisioning?: { status: 'near_failed_retryable' };
    };

export type WalletRegistrationSessionSealResponse = {
  readonly ciphertext: string;
  readonly keyVersion: string;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
};

function parseWalletRegistrationSessionSealResponse(
  value: unknown,
): WalletRegistrationSessionSealResponse {
  const responseName = 'Wallet registration session seal';
  const record = requireWalletRegistrationResponseObject({ responseName, field: 'body', value });
  assertWalletRegistrationResponseKeys(
    record,
    ['ciphertext', 'keyVersion', 'expiresAtMs', 'remainingUses'],
    responseName,
  );
  const ciphertext = readWalletRegistrationResponseField(record, 'ciphertext', responseName);
  const keyVersion = readWalletRegistrationResponseField(record, 'keyVersion', responseName);
  const expiresAtMs = readWalletRegistrationResponseField(record, 'expiresAtMs', responseName);
  const remainingUses = readWalletRegistrationResponseField(record, 'remainingUses', responseName);
  if (
    typeof ciphertext !== 'string' ||
    !ciphertext.trim() ||
    typeof keyVersion !== 'string' ||
    !keyVersion.trim() ||
    typeof expiresAtMs !== 'number' ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    typeof remainingUses !== 'number' ||
    !Number.isSafeInteger(remainingUses) ||
    remainingUses < 0
  ) {
    throw new Error(`${responseName} is invalid`);
  }
  return { ciphertext, keyVersion, expiresAtMs, remainingUses };
}

function parseWalletRegistrationNearProvisioningResponseV2(
  value: unknown,
): WalletRegistrationNearProvisioningResponseV2 {
  const responseName = 'Wallet registration NEAR provisioning';
  const record = requireWalletRegistrationResponseObject({ responseName, field: 'body', value });
  if (readWalletRegistrationResponseField(record, 'ok', responseName) !== true) {
    const allowed = ['ok', 'code', 'message', 'nearProvisioning'] as const;
    assertWalletRegistrationResponseKeys(record, allowed, responseName);
    const code = readWalletRegistrationResponseField(record, 'code', responseName);
    const message = readWalletRegistrationResponseField(record, 'message', responseName);
    if (typeof code !== 'string' || typeof message !== 'string') {
      throw new Error(`${responseName} failure is invalid`);
    }
    const nearProvisioning = readOptionalWalletRegistrationResponseField(
      record,
      'nearProvisioning',
      responseName,
    );
    if (nearProvisioning !== undefined) {
      const status = requireWalletRegistrationResponseObject({
        responseName,
        field: 'nearProvisioning',
        value: nearProvisioning,
      });
      assertWalletRegistrationResponseKeys(status, ['status'], `${responseName} nearProvisioning`);
      if (
        readWalletRegistrationResponseField(
          status,
          'status',
          `${responseName} nearProvisioning`,
        ) !== 'near_failed_retryable'
      ) {
        throw new Error(`${responseName} failure status is invalid`);
      }
      return {
        ok: false,
        code,
        message,
        nearProvisioning: { status: 'near_failed_retryable' },
      };
    }
    return { ok: false, code, message };
  }
  assertWalletRegistrationResponseKeys(
    record,
    [
      'ok',
      'walletId',
      'authority',
      'foundingAuthority',
      'foundingAuthMethod',
      'registrationDiagnostics',
      'rpId',
      'authMethod',
      'walletCustody',
      'custodyKeyManifestDigestB64u',
      'kind',
      'accountProvisioning',
      'resolvedAccount',
      'ed25519',
      'authorityScope',
      'nearProvisioning',
      'registrationEstablishedSession',
      'sessionSeal',
    ],
    responseName,
  );
  const provisioning = requireWalletRegistrationResponseObject({
    responseName,
    field: 'nearProvisioning',
    value: readWalletRegistrationResponseField(record, 'nearProvisioning', responseName),
  });
  assertWalletRegistrationResponseKeys(
    provisioning,
    ['status'],
    `${responseName} nearProvisioning`,
  );
  if (
    readWalletRegistrationResponseField(
      provisioning,
      'status',
      `${responseName} nearProvisioning`,
    ) !== 'near_ready'
  ) {
    throw new Error(`${responseName} success status is invalid`);
  }
  const finalized = parseWalletRegistrationFinalizeResponse({
    value: buildWalletRegistrationNearFinalizeTerminalResponse(record),
    expectedKind: 'near_ed25519',
  });
  if (!finalized.ok || finalized.kind !== 'near_ed25519') {
    throw new Error(`${responseName} did not return a finalized Ed25519 wallet`);
  }
  const sessionSeal = readOptionalWalletRegistrationResponseField(
    record,
    'sessionSeal',
    responseName,
  );
  const registrationEstablishedSession = parseRegistrationEstablishedSessionResult(
    readWalletRegistrationResponseField(record, 'registrationEstablishedSession', responseName),
    finalized.walletId,
  );
  if (isEmailOtpWalletRegistrationFinalizeResponse(finalized)) {
    if (sessionSeal !== undefined) {
      throw new Error(`${responseName} returned a session seal for an Email OTP authority`);
    }
    return {
      ...finalized,
      nearProvisioning: { status: 'near_ready' },
      registrationEstablishedSession,
    };
  }
  const success = {
    ...finalized,
    nearProvisioning: { status: 'near_ready' } as const,
    registrationEstablishedSession,
  };
  if (sessionSeal === undefined) return success;
  return { ...success, sessionSeal: parseWalletRegistrationSessionSealResponse(sessionSeal) };
}

type CompleteWalletRegistrationNearProvisioningBaseArgs = {
  relayerUrl: string;
  headers?: Record<string, string>;
  registrationCeremonyId: string;
  signedSetup: string;
  /** Distinct from activate's: a separate effect needs a separate key. */
  idempotencyKey: string;
  ed25519: { activationReference: WalletRegistrationEd25519YaoActivationReference };
  /**
   * The custody ceremony's sealed output. For an Ed25519-only wallet this is
   * the call that establishes custody: activate had no key set to seal against.
   */
  walletCustodyCommit?: WalletCustodyCeremonyCommitPayload;
  onServerTiming?: (header: string | null) => void;
};

type CompleteWalletRegistrationNearProvisioningArgs =
  CompleteWalletRegistrationNearProvisioningBaseArgs &
    (
      | {
          auth:
            | { kind: 'passkey' }
            | {
                kind: 'email_otp';
                enrollment: WalletRegistrationEmailOtpEnrollmentMaterial;
              };
          sessionSeal?: never;
        }
      | {
          auth: { kind: 'passkey' };
          sessionSeal: {
            readonly thresholdSessionId: string;
            readonly ciphertext: string;
            readonly keyVersion?: string;
          };
        }
    );

export async function completeWalletRegistrationNearProvisioning(
  args: CompleteWalletRegistrationNearProvisioningArgs,
): Promise<WalletRegistrationNearProvisioningResponseV2> {
  const body: Record<string, unknown> = {
    registrationCeremonyId: args.registrationCeremonyId,
    signedSetup: args.signedSetup,
    idempotencyKey: args.idempotencyKey,
    ed25519: args.ed25519,
  };

  if (args.auth.kind === 'email_otp') {
    body.emailOtpEnrollment = args.auth.enrollment;
  }
  if (args.walletCustodyCommit) body.walletCustodyCommit = args.walletCustodyCommit;
  if (args.sessionSeal) body.sessionSeal = args.sessionSeal;
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: WALLET_REGISTRATION_NEAR_PROVISIONING_PATH,
    headers: args.headers,
    body,
    ...(args.onServerTiming ? { onServerTiming: args.onServerTiming } : {}),
  });
  return parseWalletRegistrationNearProvisioningResponseV2(response);
}

type FinalizeWalletRegistrationBaseArgs = {
  relayerUrl: string;
  headers?: Record<string, string>;
  registrationCeremonyId: string;
  idempotencyKey: string;
  emailOtpEnrollment?: WalletRegistrationEmailOtpEnrollmentMaterial;
};

export type FinalizeWalletRegistrationArgs = FinalizeWalletRegistrationBaseArgs &
  (
    | {
        kind: 'near_ed25519';
        ed25519: { activationReference: WalletRegistrationEd25519YaoActivationReference };
        ecdsa?: never;
      }
    | {
        kind: 'evm_family_ecdsa';
        ecdsa: { expectedKeyHandles?: string[] };
        ed25519?: never;
      }
  );

function addSignerAuthBody(auth: AddSignerAuth): unknown {
  switch (auth.kind) {
    case 'webauthn_assertion':
      return {
        kind: 'webauthn_assertion',
        rpId: auth.rpId,
        credential: auth.credential,
        expectedChallengeDigestB64u: auth.expectedChallengeDigestB64u,
      };
  }
}

function addAuthMethodAuthBody(auth: AddAuthMethodAuth): unknown {
  switch (auth.kind) {
    case 'webauthn_assertion':
      return {
        kind: 'webauthn_assertion',
        rpId: auth.rpId,
        credential: auth.credential,
        expectedChallengeDigestB64u: auth.expectedChallengeDigestB64u,
      };
    case 'wallet_session':
      // The kind only. The token is the bearer credential, and the server
      // refuses a body that carries session or credential facts.
      return { kind: 'wallet_session' };
    case 'email_otp':
      return {
        kind: 'email_otp',
        challengeId: auth.challengeId,
        otpCode: auth.otpCode,
        expectedChallengeDigestB64u: auth.expectedChallengeDigestB64u,
      };
  }
}

function addAuthMethodAuthorityBody(
  authority: WalletAddAuthMethodAuthority,
): Record<string, unknown> {
  switch (authority.kind) {
    case 'passkey':
      return {};
    case 'email_otp':
      return { emailOtpRegistrationProof: authority.emailOtpRegistrationProof };
  }
}

export async function startWalletAddSigner(args: {
  relayerUrl: string;
  walletId: WalletId;
  addSignerIntentGrant: AddSignerIntentGrant;
  addSignerIntentDigestB64u: string;
  intent: AddSignerIntentV1;
  auth: AddSignerAuth;
}): Promise<WalletAddSignerStartResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-signer start');
  const value = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/start`,
    body: {
      addSignerIntentGrant: args.addSignerIntentGrant,
      addSignerIntentDigestB64u: args.addSignerIntentDigestB64u,
      intent: args.intent,
      auth: addSignerAuthBody(args.auth),
    },
  });
  return parseWalletAddSignerStartResponse({ value, expectedIntent: args.intent });
}

function parseAddAuthMethodEmailOtpChallengeResponse(value: unknown): {
  challengeId: string;
  expiresAtMs: number;
  emailHint: string;
} {
  const responseName = 'Email OTP enrollment code';
  const response = requireWalletRegistrationResponseObject({
    responseName,
    field: 'body',
    value,
  });
  assertWalletRegistrationResponseKeys(
    response,
    ['ok', 'challengeId', 'expiresAtMs', 'emailHint'],
    responseName,
  );
  if (readWalletRegistrationResponseField(response, 'ok', responseName) !== true) {
    throw new Error(`${responseName} response is not successful`);
  }
  const challengeIdValue = readWalletRegistrationResponseField(
    response,
    'challengeId',
    responseName,
  );
  if (typeof challengeIdValue !== 'string' || !challengeIdValue.trim()) {
    throw new Error(`${responseName} response missing challengeId`);
  }
  const expiresAtMs = readWalletRegistrationResponseField(response, 'expiresAtMs', responseName);
  if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs < 1) {
    throw new Error(`${responseName} response has invalid expiresAtMs`);
  }
  const emailHint = readWalletRegistrationResponseField(response, 'emailHint', responseName);
  if (typeof emailHint !== 'string') {
    throw new Error(`${responseName} response has invalid emailHint`);
  }
  return {
    challengeId: challengeIdValue.trim(),
    expiresAtMs,
    emailHint,
  };
}

/**
 * Sends the enrollment code for an Email OTP addition.
 *
 * Carries no address: the server reads it from the intent the grant names, so
 * a client cannot redirect a wallet's enrollment code. Callable more than once
 * for the same intent, which is what a resend is.
 */
export async function requestAddAuthMethodEmailOtpChallenge(args: {
  relayerUrl: string;
  walletId: WalletId;
  addAuthMethodIntentGrant: AddAuthMethodIntentGrant;
  addAuthMethodIntentDigestB64u: string;
}): Promise<{ challengeId: string; expiresAtMs: number; emailHint: string }> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for the Email OTP enrollment code');
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/auth-methods/email-otp/challenge`,
    body: {
      addAuthMethodIntentGrant: args.addAuthMethodIntentGrant,
      addAuthMethodIntentDigestB64u: args.addAuthMethodIntentDigestB64u,
    },
  });
  return parseAddAuthMethodEmailOtpChallengeResponse(response);
}

export async function startWalletAddAuthMethod(args: {
  relayerUrl: string;
  walletId: WalletId;
  addAuthMethodIntentGrant: AddAuthMethodIntentGrant;
  addAuthMethodIntentDigestB64u: string;
  intent: AddAuthMethodIntentV1;
  auth: AddAuthMethodAuth;
  authority: WalletAddAuthMethodAuthority;
}): Promise<WalletAddAuthMethodStartResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-auth-method start');
  const value = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/auth-methods/start`,
    body: {
      addAuthMethodIntentGrant: args.addAuthMethodIntentGrant,
      addAuthMethodIntentDigestB64u: args.addAuthMethodIntentDigestB64u,
      intent: args.intent,
      auth: addAuthMethodAuthBody(args.auth),
      ...addAuthMethodAuthorityBody(args.authority),
    },
    ...(args.auth.kind === 'wallet_session'
      ? { headers: { authorization: `Bearer ${args.auth.walletSessionToken}` } }
      : {}),
  });
  return parseWalletAddAuthMethodStartResponse({ value, expectedIntent: args.intent });
}

export async function respondWalletAddSignerEcdsa(args: {
  relayerUrl: string;
  walletId: WalletId;
  addSignerCeremonyId: string;
  ecdsa: {
    kind: 'router_ab_ecdsa_registration_v1';
    strictRegistration: RouterAbEcdsaRegistrationRequestV1;
    requestDigestB64u: string;
  };
}): Promise<WalletAddSignerEcdsaRespondResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-signer ECDSA respond');
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/derivation/respond`,
    body: {
      addSignerCeremonyId: args.addSignerCeremonyId,
      ecdsa: args.ecdsa,
    },
  });
  return parseWalletAddSignerEcdsaRespondResponse(response);
}

export async function activateWalletAddSignerEcdsa(args: {
  relayerUrl: string;
  walletId: WalletId;
  addSignerCeremonyId: string;
  activationCorrelationId: CorrelationId;
  publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
  expectedActivationRequestDigest: RouterAbPublicDigest32V1Wire;
}): Promise<WalletAddSignerEcdsaActivationResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-signer ECDSA activation');
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/derivation/activate`,
    body: {
      addSignerCeremonyId: args.addSignerCeremonyId,
      ecdsa: {
        kind: 'router_ab_ecdsa_registration_activation_v1',
        activationCorrelationId: args.activationCorrelationId,
        publicFacts: args.publicFacts,
        expectedActivationRequestDigest: args.expectedActivationRequestDigest,
      },
    },
  });
  return parseWalletAddSignerEcdsaActivationResponse(response);
}

export type FinalizeWalletAddSignerArgs = {
  relayerUrl: string;
  walletId: WalletId;
  addSignerCeremonyId: string;
  idempotencyKey: string;
} & (
  | {
      kind: 'near_ed25519';
      ed25519: {
        activationReference: WalletRegistrationEd25519YaoActivationReference;
      };
      custodyKeySet: {
        readonly kind: 'near_ed25519_v1';
        readonly keyManifestDigestB64u: string;
        readonly registeredPublicKeyB64u: string;
      };
      ecdsa?: never;
    }
  | {
      kind: 'evm_family_ecdsa';
      ecdsa: {
        expectedKeyHandles?: string[];
      };
      custodyKeySet: {
        readonly kind: 'evm_family_ecdsa_v1';
        readonly keyManifestDigestB64u: string;
        readonly clientRootPublicKey33B64u: string;
      };
      ed25519?: never;
    }
);

function addSignerFinalizeBody(args: FinalizeWalletAddSignerArgs): unknown {
  switch (args.kind) {
    case 'near_ed25519':
      return {
        addSignerCeremonyId: args.addSignerCeremonyId,
        idempotencyKey: args.idempotencyKey,
        kind: args.kind,
        ed25519: args.ed25519,
        custodyKeySet: args.custodyKeySet,
      };
    case 'evm_family_ecdsa':
      return {
        addSignerCeremonyId: args.addSignerCeremonyId,
        idempotencyKey: args.idempotencyKey,
        kind: args.kind,
        ecdsa: args.ecdsa,
        custodyKeySet: args.custodyKeySet,
      };
  }
}

export async function finalizeWalletAddSigner(
  args: FinalizeWalletAddSignerArgs,
): Promise<WalletAddSignerFinalizeResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-signer finalize');
  const value = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/finalize`,
    body: addSignerFinalizeBody(args),
  });
  return parseWalletAddSignerFinalizeResponse({ value, expectedKind: args.kind });
}

export async function finalizeWalletAddAuthMethod(
  args:
    | {
        relayerUrl: string;
        walletId: WalletId;
        addAuthMethodCeremonyId: string;
        webauthnRegistration: unknown;
        custodyEnvelope: PasskeyCustodyEnvelopeRecord;
        emailOtpTarget?: never;
      }
    | {
        /* R109C's Email OTP target: verified by its one-use grant, so the body
           carries the resealed envelope and no created credential. The
           enrollment target says whether this addition creates the wallet's
           shared Email enrollment or binds to the one it already has. */
        relayerUrl: string;
        walletId: WalletId;
        addAuthMethodCeremonyId: string;
        webauthnRegistration?: never;
        custodyEnvelope: PasskeyCustodyEnvelopeRecord;
        emailOtpTarget: WalletAddAuthMethodEmailOtpTargetV1;
      }
    | {
        relayerUrl: string;
        walletId: WalletId;
        addAuthMethodCeremonyId: string;
        webauthnRegistration?: never;
        custodyEnvelope?: never;
        emailOtpTarget?: never;
      },
): Promise<WalletAddAuthMethodFinalizeResponse> {
  const walletId = String(args.walletId || '').trim();
  if (!walletId) throw new Error('walletId is required for add-auth-method finalize');
  const body =
    args.custodyEnvelope === undefined
      ? { addAuthMethodCeremonyId: args.addAuthMethodCeremonyId }
      : args.webauthnRegistration === undefined
        ? {
            addAuthMethodCeremonyId: args.addAuthMethodCeremonyId,
            custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(args.custodyEnvelope),
            emailOtpTarget: args.emailOtpTarget,
          }
        : {
            addAuthMethodCeremonyId: args.addAuthMethodCeremonyId,
            webauthnRegistration: args.webauthnRegistration,
            custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(args.custodyEnvelope),
          };
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/auth-methods/finalize`,
    body,
  });
  return parseWalletAddAuthMethodFinalizeResponse(response);
}

export async function fetchWalletEcdsaKeyFactsInventoryWithOperationCredential(args: {
  relayerUrl: string;
  walletId: WalletId;
  rpId: string;
  operationCredential: EcdsaKeyFactsInventoryWalletSessionCredential;
  keyTargets: readonly WalletEcdsaKeyFactsInventoryTarget[];
}): Promise<WalletEcdsaKeyFactsInventoryResponse> {
  const walletId = String(args.walletId || '').trim();
  const rpId = String(args.rpId || '').trim();
  const operationCredential = args.operationCredential;
  if (!walletId) {
    throw new Error('walletId is required for ECDSA key-facts inventory');
  }
  if (!rpId) {
    throw new Error('rpId is required for ECDSA key-facts inventory');
  }
  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/ecdsa/key-facts/inventory`,
    headers: buildBearerAuthorizationHeader({
      token: operationCredential.token,
      missingMessage:
        'Wallet Session operation credential is required for ECDSA key-facts inventory',
    }),
    body: {
      rpId,
      keyTargets: args.keyTargets,
      auth: {
        kind: operationCredential.kind,
        walletSessionId: operationCredential.walletSessionId,
      },
    },
  });
  return parseWalletEcdsaKeyFactsInventoryResponse({
    value: response,
    walletId: args.walletId,
    rpId,
  });
}

export async function fetchWalletEcdsaKeyFactsInventoryWithWebAuthn(args: {
  relayerUrl: string;
  walletId: WalletId;
  rpId: string;
  credential: WebAuthnAuthenticationCredential;
  keyTargets: readonly WalletEcdsaKeyFactsInventoryTarget[];
  serverNonceB64u: string;
  expectedChallengeDigestB64u: string;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
}): Promise<WalletEcdsaKeyFactsInventoryResponse> {
  const walletId = String(args.walletId || '').trim();
  const rpId = String(args.rpId || '').trim();
  const serverNonceB64u = String(args.serverNonceB64u || '').trim();
  const expectedChallengeDigestB64u = String(args.expectedChallengeDigestB64u || '').trim();
  if (!walletId) {
    throw new Error('walletId is required for ECDSA key-facts inventory');
  }
  if (!rpId) {
    throw new Error('rpId is required for ECDSA key-facts inventory');
  }
  if (!serverNonceB64u || !expectedChallengeDigestB64u) {
    throw new Error('WebAuthn ECDSA key-facts inventory requires challenge binding');
  }

  const response = await postJson({
    relayerUrl: args.relayerUrl,
    path: `/wallets/${encodeURIComponent(walletId)}/signers/ecdsa/key-facts/inventory`,
    body: {
      rpId,
      keyTargets: args.keyTargets,
      auth: {
        kind: 'webauthn_assertion',
        credential: args.credential,
        serverNonceB64u,
        expectedChallengeDigestB64u,
        ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
      },
    },
  });
  return parseWalletEcdsaKeyFactsInventoryResponse({
    value: response,
    walletId: args.walletId,
    rpId,
  });
}
