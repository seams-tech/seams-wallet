/**
 * State the worker holds between requests: warm ECDSA and Ed25519 Yao factors, active Yao
 * clients, and the signing-session seal that persists warm factors outside the worker.
 */
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/base64';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { Variant } from '@shared/utils/variant';
import { asRecordOrArray } from '@shared/utils/validation';
import {
  joinNormalizedUrl,
  normalizeNonNegativeInteger,
  normalizeOptionalNonEmptyString,
  normalizeOptionalTrimmedString,
  normalizePositiveInteger,
} from '@shared/utils/normalize';
import {
  SIGNING_SESSION_SEAL_GROUP_ID,
  WALLET_SESSION_SEAL_BASE_PATH,
} from '@shared/utils/signingSessionSeal';
import {
  parseWalletSessionOperationCredentialV1,
  type WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type {
  EmailOtpEcdsaSessionBootstrapHandleBinding,
  EmailOtpEcdsaSessionBootstrapHandlePayload,
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpWarmMaterialTarget,
  EmailOtpWorkerOperationMap,
} from '@/core/signingEngine/workerManager/workerTypes';
import { materialActivationKey } from '@/core/signingEngine/session/sealedRecovery/materialActivationKey';
import type {
  RouterAbEd25519YaoActiveClientMetadataV1,
  RouterAbEd25519YaoActiveClientV1,
  RouterAbEd25519YaoClientSigningShareV1,
} from '../../../threshold/ed25519/yaoClient';
import type { RouterAbEcdsaPostRegistrationSessionActivationResponseV1 } from '@shared/utils/routerAbEcdsaDerivation';
import { getShamir3PassRuntime } from '../shamir3pass/runtime';
import {
  readString,
  rejectUnknownEmailOtpYaoFields,
  SIGNING_SESSION_SEAL_TRANSPORT_FIELDS,
} from './payloadParsing';
import { removeClientSealToSecret32 } from './crypto';

const MAX_EMAIL_OTP_ED25519_YAO_ACTIVE_CLIENTS = 64;

type EmailOtpWarmSessionEntry = {
  signingSessionSecret32: Uint8Array;
  expiresAtMs: number;
  remainingUses: number;
};

type EmailOtpEd25519YaoWarmFactorEntry = {
  kind: 'ed25519_yao_factor';
  thresholdSessionId: string;
  factorSecret32: Uint8Array;
  materialActivation: MpcMaterialActivationRef;
  expiresAtMs: number;
  remainingUses: number;
};

type EmailOtpWarmMaterialEntry =
  | { kind: 'ecdsa'; entry: EmailOtpWarmSessionEntry }
  | { kind: 'ed25519_yao'; entry: EmailOtpEd25519YaoWarmFactorEntry };

type EmailOtpWarmSessionStatusResult =
  EmailOtpWorkerOperationMap['getEmailOtpWarmSessionStatus']['result'];

type EmailOtpWarmSessionSealResult =
  EmailOtpWorkerOperationMap['sealEmailOtpWarmSessionMaterial']['result'];

type EmailOtpEcdsaWarmSessionRehydrateResult =
  EmailOtpWorkerOperationMap['rehydrateEmailOtpEcdsaWarmSessionMaterial']['result'];

type ExactEmailOtpEcdsaWarmSessionRestore =
  EmailOtpWorkerOperationMap['rehydrateEmailOtpEcdsaWarmSessionMaterial']['payload']['restore'];

type ExactEmailOtpEcdsaWarmSessionTransport = {
  relayerUrl: string;
  authorizationThresholdSessionId: string;
  operationCredential: WalletSessionOperationCredentialV1;
  keyVersion?: string;
  groupId: string;
};

type ExactEmailOtpEcdsaWarmSessionRehydrateArgs = {
  sealedSecretB64u: string;
  remainingUses: number;
  expiresAtMs: number;
  transport: ExactEmailOtpEcdsaWarmSessionTransport;
  restore: ExactEmailOtpEcdsaWarmSessionRestore;
};

type ParseEmailOtpEcdsaWarmSessionRehydrateArgsResult =
  | { kind: 'parsed'; value: ExactEmailOtpEcdsaWarmSessionRehydrateArgs }
  | { kind: 'error'; error: EmailOtpEcdsaWarmSessionRehydrateResult };

type SigningSessionSealTransport = {
  relayerUrl: string;
  authorizationThresholdSessionId: string;
  operationCredential: WalletSessionOperationCredentialV1;
  keyVersion?: string;
  groupId?: string;
};

type SigningSessionSealRouteResult =
  | {
      ok: true;
      ciphertext: string;
      keyVersion?: string;
      expiresAtMs?: number;
      remainingUses?: number;
    }
  | { ok: false; code: string; message: string };

type EmailOtpEd25519YaoActiveClientEntry = {
  kind: 'active_client';
  activeClient: RouterAbEd25519YaoActiveClientV1;
};

export type EmailOtpEd25519YaoWorkerActivationHandle = {
  activeClientHandle: string;
  metadata: RouterAbEd25519YaoActiveClientMetadataV1;
};

const emailOtpWarmSessions = new Map<string, EmailOtpWarmSessionEntry>();
const emailOtpEd25519YaoWarmFactors = new Map<string, EmailOtpEd25519YaoWarmFactorEntry>();
export const emailOtpEd25519YaoActiveClients = new Map<
  string,
  EmailOtpEd25519YaoActiveClientEntry
>();
const signingSessionSealApplyInFlight = new Map<string, Promise<EmailOtpWarmSessionSealResult>>();
const signingSessionSealRemoveInFlight = new Map<
  string,
  Promise<EmailOtpEcdsaWarmSessionRehydrateResult>
>();
const SIGNING_SESSION_SEAL_BASE_PATH = WALLET_SESSION_SEAL_BASE_PATH;

function cloneEmailOtpEd25519YaoMetadata(
  metadata: RouterAbEd25519YaoActiveClientMetadataV1,
): RouterAbEd25519YaoActiveClientMetadataV1 {
  return {
    kind: metadata.kind,
    scope: { ...metadata.scope },
    applicationBinding: { ...metadata.applicationBinding },
    participantIds: [metadata.participantIds[0], metadata.participantIds[1]],
    materialActivation: metadata.materialActivation,
    registeredPublicKey: metadata.registeredPublicKey.slice(),
    signingWorkerVerifyingShare: metadata.signingWorkerVerifyingShare.slice(),
    stateEpoch: metadata.stateEpoch,
    transcript: metadata.transcript.slice(),
    activeCapabilityBinding: [...metadata.activeCapabilityBinding],
  };
}

export function removeEmailOtpEd25519YaoActiveClient(activeClientHandle: string): boolean {
  const entry = emailOtpEd25519YaoActiveClients.get(activeClientHandle);
  if (!entry) return false;
  emailOtpEd25519YaoActiveClients.delete(activeClientHandle);
  entry.activeClient.dispose();
  return true;
}

export function storeEmailOtpEd25519YaoActiveClient(
  activeClient: RouterAbEd25519YaoActiveClientV1,
): EmailOtpEd25519YaoWorkerActivationHandle {
  if (activeClient.status().kind !== 'active') {
    throw new Error('Email OTP Ed25519 Yao worker rejects disposed Client state');
  }
  if (emailOtpEd25519YaoActiveClients.size >= MAX_EMAIL_OTP_ED25519_YAO_ACTIVE_CLIENTS) {
    throw new Error('Email OTP Ed25519 Yao active Client capacity is exhausted');
  }
  const activeClientHandle = secureRandomId(
    'email-otp-ed25519-yao-active-client',
    32,
    'Email OTP Ed25519 Yao active Client handles',
  );
  const metadata = cloneEmailOtpEd25519YaoMetadata(activeClient.metadata());
  emailOtpEd25519YaoActiveClients.set(activeClientHandle, {
    kind: 'active_client',
    activeClient,
  });
  return { activeClientHandle, metadata };
}

export function cloneEmailOtpEd25519YaoSigningShare(
  share: RouterAbEd25519YaoClientSigningShareV1,
): RouterAbEd25519YaoClientSigningShareV1 {
  return {
    clientCommitments: {
      hiding: share.clientCommitments.hiding,
      binding: share.clientCommitments.binding,
    },
    clientVerifyingShare: share.clientVerifyingShare.slice(),
    clientSignatureShareB64u: share.clientSignatureShareB64u,
  };
}

function parseEmailOtpEcdsaWarmSessionRehydrateArgs(args: {
  sealedSecretB64u: string;
  remainingUses: number;
  expiresAtMs: number;
  transport: SigningSessionSealTransport;
  restore: ExactEmailOtpEcdsaWarmSessionRestore;
}): ParseEmailOtpEcdsaWarmSessionRehydrateArgsResult {
  const thresholdSessionId = normalizeOptionalTrimmedString(args.restore.thresholdSessionId);
  if (!thresholdSessionId) {
    return {
      kind: 'error',
      error: { ok: false, code: 'invalid_args', message: 'Missing thresholdSessionId' },
    };
  }
  const sealedSecretB64u = normalizeOptionalTrimmedString(args.sealedSecretB64u);
  if (!sealedSecretB64u) {
    return {
      kind: 'error',
      error: { ok: false, code: 'invalid_args', message: 'Missing sealedSecretB64u' },
    };
  }
  const groupId = normalizeOptionalNonEmptyString(args.transport.groupId);
  if (!groupId) {
    return {
      kind: 'error',
      error: {
        ok: false,
        code: 'invalid_args',
        message: 'Missing groupId for signing-session restore',
      },
    };
  }
  const walletId = readString(args.restore.walletId, 'walletId');
  const keyHandle = readString(args.restore.keyHandle, 'keyHandle');
  return {
    kind: 'parsed',
    value: {
      sealedSecretB64u,
      remainingUses: Math.max(0, Math.floor(Number(args.remainingUses) || 0)),
      expiresAtMs: Math.max(0, Math.floor(Number(args.expiresAtMs) || 0)),
      transport: {
        relayerUrl: readString(args.transport.relayerUrl, 'relayerUrl'),
        authorizationThresholdSessionId: readString(
          args.transport.authorizationThresholdSessionId,
          'authorizationThresholdSessionId',
        ),
        operationCredential: args.transport.operationCredential,
        ...(args.transport.keyVersion ? { keyVersion: args.transport.keyVersion } : {}),
        groupId,
      },
      restore: {
        thresholdSessionId,
        walletId,
        keyHandle,
        chainTarget: args.restore.chainTarget,
        authSubjectId: readString(args.restore.authSubjectId, 'authSubjectId'),
      },
    },
  };
}

export function parseSigningSessionSealTransport(
  value: unknown,
): SigningSessionSealTransport | null {
  const transport = asRecordOrArray(value);
  if (!transport) return null;
  rejectUnknownEmailOtpYaoFields(
    transport,
    SIGNING_SESSION_SEAL_TRANSPORT_FIELDS,
    'signingSessionSealTransport',
  );
  const relayerUrl = normalizeOptionalNonEmptyString(transport.relayerUrl);
  const authorizationThresholdSessionId = normalizeOptionalTrimmedString(
    transport.authorizationThresholdSessionId,
  );
  if (!relayerUrl || !authorizationThresholdSessionId) return null;
  let operationCredential: WalletSessionOperationCredentialV1;
  try {
    operationCredential = parseWalletSessionOperationCredentialV1(transport.operationCredential);
  } catch {
    return null;
  }
  const keyVersion = normalizeOptionalNonEmptyString(transport.signingSessionSealKeyVersion);
  const groupId = normalizeOptionalNonEmptyString(transport.groupId);
  return {
    relayerUrl,
    authorizationThresholdSessionId,
    operationCredential,
    ...(keyVersion ? { keyVersion } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

export function invalidSigningSessionSealTransport(): { ok: false; code: string; message: string } {
  return { ok: false, code: 'invalid_args', message: 'Invalid signing-session seal transport' };
}

function parseSigningSessionSealRouteResult(value: unknown): SigningSessionSealRouteResult {
  const result = asRecordOrArray(value);
  if (!result || typeof result.ok !== 'boolean') {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Invalid signing-session seal response',
    };
  }
  if (!result.ok) {
    return {
      ok: false,
      code: typeof result.code === 'string' ? result.code : 'request_failed',
      message:
        typeof result.message === 'string' ? result.message : 'Signing-session seal request failed',
    };
  }
  const ciphertext = normalizeOptionalTrimmedString(result.ciphertext);
  if (!ciphertext) {
    return {
      ok: false,
      code: 'invalid_response',
      message: 'Missing ciphertext in signing-session seal response',
    };
  }
  const keyVersion = normalizeOptionalNonEmptyString(result.keyVersion);
  const expiresAtMs = normalizePositiveInteger(result.expiresAtMs);
  const remainingUses = normalizeNonNegativeInteger(result.remainingUses);
  return {
    ok: true,
    ciphertext,
    ...(keyVersion ? { keyVersion } : {}),
    ...(expiresAtMs != null ? { expiresAtMs } : {}),
    ...(remainingUses != null ? { remainingUses } : {}),
  };
}

function makeSigningSessionSealSingleFlightKey(args: {
  operation: 'apply-server-seal' | 'remove-server-seal';
  thresholdSessionId: string;
  materialIdentity: string;
  relayerUrl: string;
  keyVersion?: string;
  groupId?: string;
  payloadB64u?: string;
}): string {
  const operation =
    args.operation === 'remove-server-seal' ? 'remove-server-seal' : 'apply-server-seal';
  return [
    operation,
    normalizeOptionalTrimmedString(args.thresholdSessionId) || '',
    normalizeOptionalTrimmedString(args.materialIdentity) || '',
    normalizeOptionalTrimmedString(args.relayerUrl) || '',
    normalizeOptionalNonEmptyString(args.keyVersion) || '',
    normalizeOptionalNonEmptyString(args.groupId) || '',
    normalizeOptionalNonEmptyString(args.payloadB64u) || '',
  ].join('|');
}

async function callSigningSessionSealRoute(args: {
  operation: 'apply-server-seal' | 'remove-server-seal';
  transport: SigningSessionSealTransport;
  thresholdSessionId: string;
  ciphertext: string;
  keyVersion?: string;
}): Promise<SigningSessionSealRouteResult> {
  const operation =
    args.operation === 'remove-server-seal' ? 'remove-server-seal' : 'apply-server-seal';
  const url = joinNormalizedUrl(
    args.transport.relayerUrl,
    `${SIGNING_SESSION_SEAL_BASE_PATH}/${operation}`,
  );
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const keyVersion = normalizeOptionalNonEmptyString(args.keyVersion);
    headers.Authorization = `Bearer ${args.transport.operationCredential.token}`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify({
        thresholdSessionId: args.thresholdSessionId,
        ciphertext: args.ciphertext,
        ...(keyVersion ? { keyVersion } : {}),
      }),
    });
    const data = await response.json().catch(() => null);
    const parsed = parseSigningSessionSealRouteResult(data);
    if (!response.ok && parsed.ok) {
      return {
        ok: false,
        code: 'http_error',
        message: `Signing-session seal route returned HTTP ${response.status}`,
      };
    }
    return parsed;
  } catch (error: unknown) {
    return signingSessionSealFailure('network_error', error, 'Signing-session seal request failed');
  }
}

function signingSessionSealFailure(
  code: string,
  error: unknown,
  fallbackMessage: string,
): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code,
    message: error instanceof Error ? error.message : String(error || fallbackMessage),
  };
}

function resolvePolicyFromServerAndLocal(args: {
  localRemainingUses: number;
  localExpiresAtMs: number;
  serverRemainingUses?: number;
  serverExpiresAtMs?: number;
}): EmailOtpWarmSessionStatusResult {
  const localRemainingUses = Math.max(0, Math.floor(Number(args.localRemainingUses) || 0));
  const localExpiresAtMs = Math.max(0, Math.floor(Number(args.localExpiresAtMs) || 0));
  const serverRemainingUses =
    normalizeNonNegativeInteger(args.serverRemainingUses) ?? localRemainingUses;
  const serverExpiresAtMs = normalizePositiveInteger(args.serverExpiresAtMs) || localExpiresAtMs;
  const remainingUses = Math.min(localRemainingUses, serverRemainingUses);
  const expiresAtMs = Math.min(localExpiresAtMs, serverExpiresAtMs);
  if (remainingUses <= 0) return emailOtpWarmMaterialFailure('exhausted');
  if (expiresAtMs <= Date.now()) return emailOtpWarmMaterialFailure('expired');
  return { ok: true, remainingUses, expiresAtMs };
}

function deleteEmailOtpWarmSession(thresholdSessionId: string): void {
  const entry = emailOtpWarmSessions.get(thresholdSessionId);
  if (entry) {
    zeroizeBytes(entry.signingSessionSecret32);
    emailOtpWarmSessions.delete(thresholdSessionId);
  }
}

export function deleteEmailOtpEd25519YaoWarmFactor(
  materialActivation: MpcMaterialActivationRef,
): void {
  const activationKey = materialActivationKey(materialActivation);
  const entry = emailOtpEd25519YaoWarmFactors.get(activationKey);
  if (!entry) return;
  zeroizeBytes(entry.factorSecret32);
  emailOtpEd25519YaoWarmFactors.delete(activationKey);
}

export function deleteEmailOtpWarmMaterial(target: EmailOtpWarmMaterialTarget): void {
  switch (target.kind) {
    case 'ecdsa':
      deleteEmailOtpWarmSession(target.thresholdSessionId);
      return;
    case 'ed25519_yao':
      deleteEmailOtpEd25519YaoWarmFactor(target.materialActivation);
      return;
  }
}

function putEmailOtpEd25519YaoWarmFactor(args: {
  target: Extract<EmailOtpWarmMaterialTarget, { kind: 'ed25519_yao' }>;
  factorSecret32: Uint8Array;
  expiresAtMs: number;
  remainingUses: number;
}): void {
  const thresholdSessionId = readString(
    args.target.thresholdSessionId,
    'target.thresholdSessionId',
  );
  const activationKey = materialActivationKey(args.target.materialActivation);
  const expiresAtMs = Math.floor(Number(args.expiresAtMs) || 0);
  const remainingUses = Math.floor(Number(args.remainingUses) || 0);
  if (args.factorSecret32.length !== 32) {
    throw new Error('Email OTP Ed25519 Yao factor must contain 32 bytes');
  }
  if (expiresAtMs <= Date.now() || remainingUses <= 0) {
    throw new Error('Invalid Email OTP Ed25519 Yao warm-factor policy');
  }
  deleteEmailOtpEd25519YaoWarmFactor(args.target.materialActivation);
  emailOtpEd25519YaoWarmFactors.set(activationKey, {
    kind: 'ed25519_yao_factor',
    thresholdSessionId,
    factorSecret32: Uint8Array.from(args.factorSecret32),
    materialActivation: args.target.materialActivation,
    expiresAtMs,
    remainingUses,
  });
}

export function bindEmailOtpEd25519YaoCapabilityWarmFactor(args: {
  bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
  factorSecret32: Uint8Array;
  materialActivation: MpcMaterialActivationRef;
}): void {
  putEmailOtpEd25519YaoWarmFactor({
    target: {
      kind: 'ed25519_yao',
      thresholdSessionId: args.bootstrap.session.thresholdSessionId,
      materialActivation: args.materialActivation,
    },
    factorSecret32: args.factorSecret32,
    expiresAtMs: args.bootstrap.session.expiresAtMs,
    remainingUses: args.bootstrap.session.remainingUses,
  });
}

export function issueEmailOtpEcdsaSessionHandle(args: {
  walletId: string;
  binding: EmailOtpEcdsaSessionBootstrapHandleBinding;
}): EmailOtpEcdsaSessionBootstrapHandlePayload {
  const sessionId = secureRandomId(
    'email-otp-session',
    32,
    'Email OTP ECDSA authorization handles',
  );
  return {
    kind: 'email_otp_worker_session_handle_v1' as const,
    sessionId,
    walletId: readString(args.walletId, 'walletId'),
    authSubjectId: readString(args.binding.authSubjectId, 'authSubjectId'),
    keyHandle: readString(args.binding.keyHandle, 'keyHandle'),
    action: 'threshold_ecdsa_bootstrap',
    operation: args.binding.operation,
    chainTarget: args.binding.chainTarget,
  };
}

export function bindEmailOtpEcdsaWarmSessionFactor(args: {
  session: Pick<
    RouterAbEcdsaPostRegistrationSessionActivationResponseV1['session'],
    'threshold_session_id' | 'remaining_uses' | 'expires_at_ms'
  >;
  factorSecret32: Uint8Array;
}): void {
  const thresholdSessionId = readString(args.session.threshold_session_id, 'thresholdSessionId');
  if (args.factorSecret32.length !== 32) {
    throw new Error('Email OTP ECDSA warm factor must contain 32 bytes');
  }
  const remainingUses = normalizePositiveInteger(args.session.remaining_uses);
  const expiresAtMs = normalizePositiveInteger(args.session.expires_at_ms);
  if (!remainingUses || !expiresAtMs || expiresAtMs <= Date.now()) {
    throw new Error('Email OTP ECDSA warm factor requires an active session policy');
  }
  deleteEmailOtpWarmSession(thresholdSessionId);
  emailOtpWarmSessions.set(thresholdSessionId, {
    signingSessionSecret32: Uint8Array.from(args.factorSecret32),
    remainingUses,
    expiresAtMs,
  });
}

function resolveEmailOtpWarmMaterialEntry(
  target: EmailOtpWarmMaterialTarget,
): EmailOtpWarmMaterialEntry | null {
  switch (target.kind) {
    case 'ecdsa': {
      const entry = emailOtpWarmSessions.get(target.thresholdSessionId);
      return entry ? { kind: 'ecdsa', entry } : null;
    }
    case 'ed25519_yao': {
      const entry = emailOtpEd25519YaoWarmFactors.get(
        materialActivationKey(target.materialActivation),
      );
      if (!entry || entry.thresholdSessionId !== target.thresholdSessionId) return null;
      if (!mpcMaterialActivationRefsEqual(entry.materialActivation, target.materialActivation)) {
        return null;
      }
      return { kind: 'ed25519_yao', entry };
    }
  }
}

function emailOtpWarmMaterialSecret32(entry: EmailOtpWarmMaterialEntry): Uint8Array {
  switch (entry.kind) {
    case 'ecdsa':
      return entry.entry.signingSessionSecret32;
    case 'ed25519_yao':
      return entry.entry.factorSecret32;
  }
}

function updateEmailOtpWarmMaterialPolicy(args: {
  target: EmailOtpWarmMaterialTarget;
  material: EmailOtpWarmMaterialEntry;
  remainingUses: number;
  expiresAtMs: number;
}): void {
  switch (args.material.kind) {
    case 'ecdsa':
      if (args.target.kind !== 'ecdsa') {
        throw new Error('Email OTP warm ECDSA material target mismatch');
      }
      emailOtpWarmSessions.set(args.target.thresholdSessionId, {
        signingSessionSecret32: args.material.entry.signingSessionSecret32,
        remainingUses: args.remainingUses,
        expiresAtMs: args.expiresAtMs,
      });
      return;
    case 'ed25519_yao':
      if (args.target.kind !== 'ed25519_yao') {
        throw new Error('Email OTP warm Ed25519 material target mismatch');
      }
      emailOtpEd25519YaoWarmFactors.set(materialActivationKey(args.target.materialActivation), {
        kind: 'ed25519_yao_factor',
        thresholdSessionId: args.material.entry.thresholdSessionId,
        factorSecret32: args.material.entry.factorSecret32,
        materialActivation: args.material.entry.materialActivation,
        remainingUses: args.remainingUses,
        expiresAtMs: args.expiresAtMs,
      });
      return;
  }
}

const EMAIL_OTP_WARM_MATERIAL_FAILURE_MESSAGES = {
  not_found: 'Email OTP warm-session material is not available',
  expired: 'Email OTP warm-session material expired',
  exhausted: 'Email OTP warm-session material exhausted',
} as const;

type EmailOtpWarmMaterialFailure = Variant<EmailOtpWarmSessionStatusResult, 'ok', false>;

function emailOtpWarmMaterialFailure(
  code: keyof typeof EMAIL_OTP_WARM_MATERIAL_FAILURE_MESSAGES,
): EmailOtpWarmMaterialFailure {
  return { ok: false, code, message: EMAIL_OTP_WARM_MATERIAL_FAILURE_MESSAGES[code] };
}

export function readEmailOtpWarmSessionStatus(
  target: EmailOtpWarmMaterialTarget,
): EmailOtpWarmSessionStatusResult {
  const material = resolveEmailOtpWarmMaterialEntry(target);
  if (!material) return emailOtpWarmMaterialFailure('not_found');
  if (Date.now() >= material.entry.expiresAtMs) {
    deleteEmailOtpWarmMaterial(target);
    return emailOtpWarmMaterialFailure('expired');
  }
  if (material.entry.remainingUses <= 0) {
    deleteEmailOtpWarmMaterial(target);
    return emailOtpWarmMaterialFailure('exhausted');
  }
  return {
    ok: true,
    remainingUses: material.entry.remainingUses,
    expiresAtMs: material.entry.expiresAtMs,
  };
}

/** Warm material that is present, unexpired and not exhausted. */
function readUsableEmailOtpWarmMaterial(
  target: EmailOtpWarmMaterialTarget,
): { ok: true; material: EmailOtpWarmMaterialEntry } | EmailOtpWarmMaterialFailure {
  const status = readEmailOtpWarmSessionStatus(target);
  if (!status.ok) return status;
  const material = resolveEmailOtpWarmMaterialEntry(target);
  return material ? { ok: true, material } : emailOtpWarmMaterialFailure('not_found');
}

export function consumeEmailOtpWarmSessionUses(args: {
  target: EmailOtpWarmMaterialTarget;
  uses?: number;
}): EmailOtpWarmSessionStatusResult {
  const usable = readUsableEmailOtpWarmMaterial(args.target);
  if (!usable.ok) return usable;
  const material = usable.material;
  const uses = Math.max(1, Math.floor(Number(args.uses) || 1));
  if (material.entry.remainingUses < uses) return emailOtpWarmMaterialFailure('exhausted');
  material.entry.remainingUses -= uses;
  const remainingUses = material.entry.remainingUses;
  const expiresAtMs = material.entry.expiresAtMs;
  if (remainingUses <= 0) {
    deleteEmailOtpWarmMaterial(args.target);
  } else {
    updateEmailOtpWarmMaterialPolicy({
      target: args.target,
      material,
      remainingUses,
      expiresAtMs,
    });
  }
  return {
    ok: true,
    remainingUses,
    expiresAtMs,
  };
}

export async function sealEmailOtpWarmSessionMaterial(args: {
  target: EmailOtpWarmMaterialTarget;
  transport: SigningSessionSealTransport;
}): Promise<EmailOtpWarmSessionSealResult> {
  const authorizationThresholdSessionId = args.transport.authorizationThresholdSessionId;
  const groupId = normalizeOptionalNonEmptyString(args.transport.groupId);
  if (!groupId) {
    return {
      ok: false,
      code: 'invalid_args',
      message: 'Missing groupId for signing-session seal',
    };
  }
  const usable = readUsableEmailOtpWarmMaterial(args.target);
  if (!usable.ok) return usable;
  const material = usable.material;
  const secret32 = emailOtpWarmMaterialSecret32(material);
  const payloadB64u = base64UrlEncode(secret32);
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'apply-server-seal',
    thresholdSessionId: authorizationThresholdSessionId,
    materialIdentity:
      args.target.kind === 'ecdsa'
        ? args.target.thresholdSessionId
        : materialActivationKey(args.target.materialActivation),
    relayerUrl: args.transport.relayerUrl,
    keyVersion: args.transport.keyVersion,
    groupId,
    payloadB64u,
  });
  const inFlight = signingSessionSealApplyInFlight.get(singleFlightKey);
  if (inFlight) return await inFlight;

  const task = (async (): Promise<EmailOtpWarmSessionSealResult> => {
    try {
      const runtime = await getShamir3PassRuntime();
      const clientKeyHandle = await runtime.createClientKeyHandle({
        groupId: SIGNING_SESSION_SEAL_GROUP_ID,
      });
      try {
        const clientEncryptedCiphertext = await runtime.addClientSealBytesWithKeyHandle({
          ciphertext: secret32,
          keyHandle: clientKeyHandle.keyHandle,
        });
        const applied = await callSigningSessionSealRoute({
          operation: 'apply-server-seal',
          transport: args.transport,
          thresholdSessionId: authorizationThresholdSessionId,
          ciphertext: readString(clientEncryptedCiphertext, 'clientEncryptedCiphertext'),
          keyVersion: args.transport.keyVersion,
        });
        if (!applied.ok) return applied;
        const sealedSecretB64u = await runtime.removeClientSealWithKeyHandle({
          ciphertextB64u: applied.ciphertext,
          keyHandle: clientKeyHandle.keyHandle,
        });
        const policy = resolvePolicyFromServerAndLocal({
          localRemainingUses: material.entry.remainingUses,
          localExpiresAtMs: material.entry.expiresAtMs,
          serverRemainingUses: applied.remainingUses,
          serverExpiresAtMs: applied.expiresAtMs,
        });
        if (!policy.ok) {
          deleteEmailOtpWarmMaterial(args.target);
          return policy;
        }
        updateEmailOtpWarmMaterialPolicy({
          target: args.target,
          material,
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
        });
        const keyVersion = normalizeOptionalNonEmptyString(applied.keyVersion);
        const common = {
          ok: true,
          sealedSecretB64u: readString(sealedSecretB64u, 'sealedSecretB64u'),
          ...(keyVersion ? { keyVersion } : {}),
          remainingUses: policy.remainingUses,
          expiresAtMs: policy.expiresAtMs,
        } as const;
        switch (material.kind) {
          case 'ecdsa':
            return { ...common, materialKind: 'ecdsa' };
          case 'ed25519_yao':
            return {
              ...common,
              materialKind: 'ed25519_yao',
              materialActivation: material.entry.materialActivation,
            };
        }
      } finally {
        await runtime
          .destroyClientKeyHandle({ keyHandle: clientKeyHandle.keyHandle })
          .catch(() => undefined);
      }
    } catch (error: unknown) {
      return signingSessionSealFailure('internal', error, 'Failed to apply signing-session seal');
    }
  })().finally(() => {
    signingSessionSealApplyInFlight.delete(singleFlightKey);
  });

  signingSessionSealApplyInFlight.set(singleFlightKey, task);
  return await task;
}

export async function rehydrateEmailOtpEcdsaWarmSessionMaterial(args: {
  target: Extract<EmailOtpWarmMaterialTarget, { kind: 'ecdsa' }>;
  sealedSecretB64u: string;
  remainingUses: number;
  expiresAtMs: number;
  transport: SigningSessionSealTransport;
  restore: ExactEmailOtpEcdsaWarmSessionRestore;
}): Promise<EmailOtpEcdsaWarmSessionRehydrateResult> {
  if (args.target.thresholdSessionId !== args.restore.thresholdSessionId) {
    return {
      ok: false,
      code: 'invalid_args',
      message: 'Email OTP ECDSA restore target does not match the restored session',
    };
  }
  const parsed = parseEmailOtpEcdsaWarmSessionRehydrateArgs(args);
  if (parsed.kind === 'error') return parsed.error;
  const {
    sealedSecretB64u,
    remainingUses: localRemainingUses,
    expiresAtMs: localExpiresAtMs,
    transport,
    restore,
  } = parsed.value;
  const thresholdSessionId = restore.thresholdSessionId;
  const authorizationThresholdSessionId = transport.authorizationThresholdSessionId;
  if (localRemainingUses <= 0) {
    return { ok: false, code: 'exhausted', message: 'Email OTP signing-session seal exhausted' };
  }
  if (localExpiresAtMs <= Date.now()) {
    return { ok: false, code: 'expired', message: 'Email OTP signing-session seal expired' };
  }
  const singleFlightKey = makeSigningSessionSealSingleFlightKey({
    operation: 'remove-server-seal',
    thresholdSessionId: authorizationThresholdSessionId,
    materialIdentity: thresholdSessionId,
    relayerUrl: transport.relayerUrl,
    keyVersion: transport.keyVersion,
    groupId: transport.groupId,
    payloadB64u: sealedSecretB64u,
  });
  const inFlight = signingSessionSealRemoveInFlight.get(singleFlightKey);
  if (inFlight) return await inFlight;

  const task = (async (): Promise<EmailOtpEcdsaWarmSessionRehydrateResult> => {
    let signingSessionSecret32: Uint8Array | null = null;
    let serverRemainingUses: number | undefined;
    let serverExpiresAtMs: number | undefined;
    try {
      const runtime = await getShamir3PassRuntime();
      const clientKeyHandle = await runtime.createClientKeyHandle({
        groupId: SIGNING_SESSION_SEAL_GROUP_ID,
      });
      try {
        const clientEncryptedCiphertext = await runtime.addClientSealWithKeyHandle({
          ciphertextB64u: sealedSecretB64u,
          keyHandle: clientKeyHandle.keyHandle,
        });
        const removed = await callSigningSessionSealRoute({
          operation: 'remove-server-seal',
          transport,
          thresholdSessionId: authorizationThresholdSessionId,
          ciphertext: readString(clientEncryptedCiphertext, 'clientEncryptedCiphertext'),
          keyVersion: transport.keyVersion,
        });
        if (!removed.ok) return removed;
        serverRemainingUses = removed.remainingUses;
        serverExpiresAtMs = removed.expiresAtMs;
        const unsealedSecret = await removeClientSealToSecret32({
          runtime,
          ciphertextB64u: removed.ciphertext,
          keyHandle: clientKeyHandle.keyHandle,
        });
        if (unsealedSecret.kind === 'corrupt_local_custody') return unsealedSecret;
        signingSessionSecret32 = unsealedSecret.secret32;
      } finally {
        await runtime
          .destroyClientKeyHandle({ keyHandle: clientKeyHandle.keyHandle })
          .catch(() => undefined);
      }

      const policy = resolvePolicyFromServerAndLocal({
        localRemainingUses,
        localExpiresAtMs,
        serverRemainingUses,
        serverExpiresAtMs,
      });
      if (!policy.ok) return policy;
      const emailOtpSessionHandle = issueEmailOtpEcdsaSessionHandle({
        walletId: restore.walletId,
        binding: {
          action: 'threshold_ecdsa_bootstrap',
          operation: 'sign',
          keyHandle: restore.keyHandle,
          authSubjectId: restore.authSubjectId,
          chainTarget: restore.chainTarget,
        },
      });
      if (!signingSessionSecret32) {
        throw new Error('Email OTP signing-session seal returned no local material');
      }
      deleteEmailOtpWarmSession(thresholdSessionId);
      emailOtpWarmSessions.set(thresholdSessionId, {
        signingSessionSecret32,
        remainingUses: policy.remainingUses,
        expiresAtMs: policy.expiresAtMs,
      });
      signingSessionSecret32 = null;
      return {
        ok: true,
        emailOtpSessionHandle,
        remainingUses: policy.remainingUses,
        expiresAtMs: policy.expiresAtMs,
      };
    } catch (error: unknown) {
      return signingSessionSealFailure(
        'internal',
        error,
        'Failed to rehydrate Email OTP signing session',
      );
    } finally {
      zeroizeBytes(signingSessionSecret32);
      signingSessionSealRemoveInFlight.delete(singleFlightKey);
    }
  })();

  signingSessionSealRemoveInFlight.set(singleFlightKey, task);
  return await task;
}
