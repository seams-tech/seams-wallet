/**
 * Readers shared by every Email OTP worker request: strings, route plans, chain targets, ECDSA
 * handle bindings and warm-material targets.
 */
import {
  type WalletAuthMethodId,
  parseMpcMaterialActivationRef,
  parseThresholdEd25519SessionId,
  type ThresholdEd25519SessionId,
  parseWalletAuthMethodId,
} from '@shared/utils/domainIds';
import { requireEvmFamilySigningKeySlotId } from '@shared/signing-lanes';
import {
  asRecord,
  requireTrimmedString,
  toOptionalTrimmedNonEmptyString,
} from '@shared/utils/validation';
import { normalizePositiveInteger } from '@shared/utils/normalize';
import { EMAIL_OTP_CHANNEL, type WalletEmailOtpChannel } from '@shared/utils/emailOtpDomain';
import { SIGNING_SESSION_SEAL_GROUP_ID } from '@shared/utils/signingSessionSeal';
import {
  parseWalletSessionOperationCredentialV1,
  type WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import type {
  EmailOtpEcdsaSessionBootstrapHandleBinding,
  EmailOtpEcdsaSessionHandleBinding,
  EmailOtpWalletRegistrationEcdsaPrepareHandleBinding,
  EmailOtpWalletRegistrationEcdsaPrepareHandleRequest,
  EmailOtpWorkerSessionHandleOperation,
  EmailOtpAuthoritySelector,
  EmailOtpWarmMaterialTarget,
} from '@/core/signingEngine/workerManager/workerTypes';
import {
  parseSigningSessionSealKeyVersion,
  type SigningSessionSealKeyVersion,
} from '../../../session/keyMaterialBrands';
import {
  thresholdEcdsaChainTargetFromRequest,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  normalizeThresholdRuntimePolicyScope,
  type ThresholdRuntimePolicyScope,
} from '@/core/signingEngine/threshold/sessionPolicy';
import {
  normalizeEmailOtpRoutePlan,
  type EmailOtpRoutePlan,
} from '../../../stepUpConfirmation/otpPrompt/authLane';

export function assertNeverEmailOtpWorker(value: never): never {
  throw new Error(`Unexpected Email OTP worker state: ${String(value)}`);
}

export function resolveEmailOtpAuthSubjectId(args: {
  walletId: string;
  userId?: unknown;
  routePlan: EmailOtpRoutePlan;
}): string {
  return readString(args.userId, 'userId');
}

export function readString(value: unknown, label: string): string {
  return requireTrimmedString(value, label);
}

export function readSigningSessionSealGroupId(
  value: unknown,
): typeof SIGNING_SESSION_SEAL_GROUP_ID {
  if (readString(value, 'groupId') !== SIGNING_SESSION_SEAL_GROUP_ID) {
    throw new Error('Unsupported signing-session seal groupId');
  }
  return SIGNING_SESSION_SEAL_GROUP_ID;
}

export function readThresholdEd25519SessionId(
  value: unknown,
  label: string,
): ThresholdEd25519SessionId {
  const parsed = parseThresholdEd25519SessionId(value);
  if (!parsed.ok) {
    throw new Error(`${label} is invalid`);
  }
  return parsed.value;
}

function readEvmFamilySigningKeySlotId(value: unknown, label: string) {
  return requireEvmFamilySigningKeySlotId(value, label);
}

export function readNumber(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`${label} must be a finite number`);
  }
  return normalized;
}

export function readEmailOtpAuthoritySelector(value: unknown): EmailOtpAuthoritySelector {
  const selector = asRecord(value);
  if (!selector) {
    throw new Error('Email OTP authority selector is required');
  }
  if (selector.kind === 'wallet') {
    rejectUnknownEmailOtpYaoFields(selector, ['kind'], 'authoritySelector');
    return { kind: 'wallet' };
  }
  if (selector.kind === 'wallet_auth_method') {
    rejectUnknownEmailOtpYaoFields(selector, ['kind', 'walletAuthMethodId'], 'authoritySelector');
    return {
      kind: 'wallet_auth_method',
      walletAuthMethodId: readString(selector.walletAuthMethodId, 'walletAuthMethodId'),
    };
  }
  throw new Error('Email OTP authority selector kind is invalid');
}

export function emailOtpAuthoritySelectorBody(selector: EmailOtpAuthoritySelector): {
  readonly walletAuthMethodId?: string;
} {
  return selector.kind === 'wallet_auth_method'
    ? { walletAuthMethodId: selector.walletAuthMethodId }
    : {};
}

export function readRoutePlan(value: unknown, label: string): EmailOtpRoutePlan {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} requires Email OTP routePlan`);
  const routeFamily = readString(record.routeFamily, `${label}.routePlan.routeFamily`);
  switch (routeFamily) {
    case 'login':
    case 'registration':
      rejectUnknownEmailOtpYaoFields(record, ['routeFamily', 'operation'], `${label}.routePlan`);
      break;
    case 'signing_session':
      rejectUnknownEmailOtpYaoFields(
        record,
        ['routeFamily', 'operation', 'authLane'],
        `${label}.routePlan`,
      );
      parseEmailOtpWorkerAuthLane(record.authLane, label);
      break;
    default:
      throw new Error(`${label}.routePlan.routeFamily is invalid`);
  }
  const plan = normalizeEmailOtpRoutePlan(value);
  if (!plan) throw new Error(`${label} requires Email OTP routePlan`);
  return plan;
}

function parseEmailOtpWorkerAuthLane(value: unknown, label: string): void {
  const lane = asRecord(value);
  if (!lane) throw new Error(`${label}.routePlan.authLane is required`);
  if (lane.kind !== 'signing_session') {
    throw new Error(`${label}.routePlan.authLane.kind is invalid`);
  }
  const curve = readString(lane.curve, `${label}.routePlan.authLane.curve`);
  switch (curve) {
    case 'ed25519':
      rejectUnknownEmailOtpYaoFields(
        lane,
        ['kind', 'operationCredential', 'curve'],
        `${label}.routePlan.authLane`,
      );
      parseWalletSessionOperationCredentialV1(lane.operationCredential);
      return;
    case 'ecdsa':
      rejectUnknownEmailOtpYaoFields(
        lane,
        ['kind', 'operationCredential', 'thresholdSessionId', 'curve', 'chainTarget'],
        `${label}.routePlan.authLane`,
      );
      parseWalletSessionOperationCredentialV1(lane.operationCredential);
      readString(lane.thresholdSessionId, `${label}.routePlan.authLane.thresholdSessionId`);
      parseWorkerChainTarget(lane.chainTarget);
      return;
    default:
      throw new Error(`${label}.routePlan.authLane.curve is invalid`);
  }
}

export const SIGNING_SESSION_SEAL_TRANSPORT_FIELDS = [
  'relayerUrl',
  'authorizationThresholdSessionId',
  'operationCredential',
  'signingSessionSealKeyVersion',
  'groupId',
] as const;

export function requireFixed32ArrayBuffer(value: unknown, label: string): Uint8Array {
  if (!(value instanceof ArrayBuffer)) {
    throw new Error(`${label} must be an ArrayBuffer`);
  }
  const bytes = new Uint8Array(value);
  if (bytes.length !== 32) {
    throw new Error(`${label} must contain 32 bytes`);
  }
  return bytes;
}

export function requireWorkerWalletAuthMethodId(value: unknown): WalletAuthMethodId {
  const parsed = parseWalletAuthMethodId(value);
  if (!parsed.ok) throw new Error(`walletAuthMethodId ${parsed.error.message}`);
  return parsed.value;
}

export function rejectUnknownEmailOtpYaoFields(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`${label} contains unsupported field: ${key}`);
    }
  }
}

export function parseEmailOtpWarmMaterialTarget(value: unknown): EmailOtpWarmMaterialTarget {
  const target = asRecord(value);
  if (!target) throw new Error('Email OTP warm material target is required');
  const kind = readString(target.kind, 'target.kind');
  switch (kind) {
    case 'ecdsa':
      rejectUnknownEmailOtpYaoFields(target, ['kind', 'thresholdSessionId'], 'target');
      return {
        kind: 'ecdsa',
        thresholdSessionId: readString(target.thresholdSessionId, 'target.thresholdSessionId'),
      };
    case 'ed25519_yao': {
      rejectUnknownEmailOtpYaoFields(
        target,
        ['kind', 'thresholdSessionId', 'materialActivation'],
        'target',
      );
      const materialActivation = parseMpcMaterialActivationRef(target.materialActivation);
      if (!materialActivation.ok) {
        throw new Error(
          `Email OTP warm material activation is invalid: ${materialActivation.error.message}`,
        );
      }
      return {
        kind: 'ed25519_yao',
        thresholdSessionId: readString(target.thresholdSessionId, 'target.thresholdSessionId'),
        materialActivation: materialActivation.value,
      };
    }
    default:
      throw new Error(`Unsupported Email OTP warm material target kind: ${kind}`);
  }
}

export function parseOptionalEmailOtpChannel(
  value: unknown,
  label: string,
): WalletEmailOtpChannel | undefined {
  if (value === undefined) return undefined;
  if (value !== EMAIL_OTP_CHANNEL) {
    throw new Error(`${label} must be ${EMAIL_OTP_CHANNEL}`);
  }
  return EMAIL_OTP_CHANNEL;
}

export function optionalWorkerPositiveInteger(value: unknown): number | undefined {
  const normalized = normalizePositiveInteger(value);
  return normalized == null ? undefined : normalized;
}

export function parseWorkerRuntimePolicyScope(
  value: unknown,
  label: string,
): ThresholdRuntimePolicyScope {
  const runtimePolicyScope = normalizeThresholdRuntimePolicyScope(value);
  if (!runtimePolicyScope) {
    throw new Error(`${label} requires runtimePolicyScope`);
  }
  return runtimePolicyScope;
}

export function parseWorkerChainTarget(value: unknown): ThresholdEcdsaChainTarget {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP worker request requires chainTarget');
  const kind = readString(obj.kind, 'chainTarget.kind');
  switch (kind) {
    case 'tempo':
      rejectUnknownEmailOtpYaoFields(obj, ['kind', 'chainId', 'networkSlug'], 'chainTarget');
      break;
    case 'evm':
      rejectUnknownEmailOtpYaoFields(
        obj,
        ['kind', 'namespace', 'chainId', 'networkSlug'],
        'chainTarget',
      );
      break;
    default:
      throw new Error('Email OTP worker request chainTarget.kind is invalid');
  }
  return thresholdEcdsaChainTargetFromRequest(obj);
}

function parseEmailOtpWorkerHandleOperation(value: unknown): EmailOtpWorkerSessionHandleOperation {
  const operation = readString(value, 'Email OTP worker handle operation');
  switch (operation) {
    case 'registration':
    case 'wallet_unlock':
    case 'sign':
    case 'export':
      return operation;
    default:
      throw new Error(`Unsupported Email OTP worker handle operation: ${operation}`);
  }
}

function parseOptionalWorkerEcdsaSessionHandleBinding(
  value: unknown,
): EmailOtpEcdsaSessionHandleBinding | undefined {
  if (value == null) return undefined;
  const obj = asRecord(value);
  if (!obj) {
    throw new Error('Email OTP ECDSA session handle binding must be an object');
  }
  const action = readString(
    obj.action ?? 'threshold_ecdsa_bootstrap',
    'ecdsaSessionHandleBinding.action',
  );
  if (action === 'wallet_registration_ecdsa_prepare') {
    rejectUnknownEmailOtpYaoFields(
      obj,
      [
        'evmFamilySigningKeySlotId',
        'authSubjectId',
        'action',
        'operation',
        'keyScope',
        'chainTarget',
      ],
      'ecdsaSessionHandleBinding',
    );
    const operation = parseEmailOtpWorkerHandleOperation(obj.operation);
    if (operation !== 'registration') {
      throw new Error(
        'Email OTP wallet-registration ECDSA handle binding requires registration operation',
      );
    }
    const keyScope = readString(obj.keyScope, 'ecdsaSessionHandleBinding.keyScope');
    if (keyScope !== 'evm-family') {
      throw new Error(
        'Email OTP wallet-registration ECDSA handle binding requires evm-family keyScope',
      );
    }
    return {
      evmFamilySigningKeySlotId: String(
        readEvmFamilySigningKeySlotId(
          obj.evmFamilySigningKeySlotId,
          'ecdsaSessionHandleBinding.evmFamilySigningKeySlotId',
        ),
      ),
      authSubjectId: readString(obj.authSubjectId, 'ecdsaSessionHandleBinding.authSubjectId'),
      action: 'wallet_registration_ecdsa_prepare',
      operation: 'registration',
      keyScope: 'evm-family',
      chainTarget: parseWorkerChainTarget(obj.chainTarget),
    };
  }
  if (action !== 'threshold_ecdsa_bootstrap') {
    throw new Error(`Unsupported Email OTP ECDSA session handle binding action: ${action}`);
  }
  rejectUnknownEmailOtpYaoFields(
    obj,
    ['authSubjectId', 'action', 'operation', 'keyHandle', 'chainTarget'],
    'ecdsaSessionHandleBinding',
  );
  const operation = parseEmailOtpWorkerHandleOperation(obj.operation);
  const common = {
    authSubjectId: readString(obj.authSubjectId, 'ecdsaSessionHandleBinding.authSubjectId'),
    action: 'threshold_ecdsa_bootstrap' as const,
    chainTarget: parseWorkerChainTarget(obj.chainTarget),
  };
  if (operation === 'registration') {
    throw new Error(
      'Email OTP registration ECDSA handle binding is retired; use wallet-registration prepare',
    );
  }
  if ('evmFamilySigningKeySlotId' in obj) {
    throw new Error('Email OTP runtime ECDSA handle binding forbids evmFamilySigningKeySlotId');
  }
  return {
    ...common,
    operation,
    keyHandle: readString(obj.keyHandle, 'ecdsaSessionHandleBinding.keyHandle'),
  };
}

export function parseOptionalWorkerEcdsaSessionBootstrapHandleBinding(
  value: unknown,
): EmailOtpEcdsaSessionBootstrapHandleBinding | undefined {
  const binding = parseOptionalWorkerEcdsaSessionHandleBinding(value);
  if (!binding) return undefined;
  if (binding.action === 'wallet_registration_ecdsa_prepare') {
    throw new Error(
      'Email OTP session bootstrap handle binding rejects wallet-registration action',
    );
  }
  return binding;
}

export function parseWorkerWalletRegistrationEcdsaPrepareHandleRequest(
  value: unknown,
): EmailOtpWalletRegistrationEcdsaPrepareHandleRequest {
  const obj = asRecord(value);
  if (!obj) {
    throw new Error('Email OTP registration enrollment material requires ECDSA handle request');
  }
  const kind = readString(obj.kind, 'ecdsaSessionHandle.kind');
  switch (kind) {
    case 'requested': {
      rejectUnknownEmailOtpYaoFields(obj, ['kind', 'bindings'], 'ecdsaSessionHandle');
      if (!Array.isArray(obj.bindings) || obj.bindings.length === 0) {
        throw new Error(
          'Email OTP registration enrollment material requires wallet-registration ECDSA handle bindings',
        );
      }
      const bindings: EmailOtpWalletRegistrationEcdsaPrepareHandleBinding[] = [];
      for (const value of obj.bindings) {
        const binding = parseOptionalWorkerEcdsaSessionHandleBinding(value);
        if (!binding || binding.action !== 'wallet_registration_ecdsa_prepare') {
          throw new Error(
            'Email OTP registration enrollment material requires wallet-registration ECDSA handle bindings',
          );
        }
        bindings.push(binding);
      }
      const first = bindings[0];
      if (!first) {
        throw new Error(
          'Email OTP registration enrollment material requires wallet-registration ECDSA handle bindings',
        );
      }
      return { kind: 'requested', bindings: [first, ...bindings.slice(1)] };
    }
    case 'not_requested':
      rejectUnknownEmailOtpYaoFields(obj, ['kind'], 'ecdsaSessionHandle');
      return { kind: 'not_requested' };
    default:
      throw new Error(`Unsupported Email OTP registration ECDSA handle request kind: ${kind}`);
  }
}

export function parseWorkerSealTransport(value: unknown): {
  relayerUrl: string;
  authorizationThresholdSessionId: string;
  operationCredential: WalletSessionOperationCredentialV1;
  signingSessionSealKeyVersion?: SigningSessionSealKeyVersion;
  groupId?: string;
} {
  const obj = asRecord(value);
  if (!obj) throw new Error('Email OTP worker request requires transport');
  rejectUnknownEmailOtpYaoFields(obj, SIGNING_SESSION_SEAL_TRANSPORT_FIELDS, 'transport');
  const operationCredential = parseWalletSessionOperationCredentialV1(obj.operationCredential);
  return {
    relayerUrl: readString(obj.relayerUrl, 'transport.relayerUrl'),
    authorizationThresholdSessionId: readString(
      obj.authorizationThresholdSessionId,
      'transport.authorizationThresholdSessionId',
    ),
    operationCredential,
    ...(toOptionalTrimmedNonEmptyString(obj.signingSessionSealKeyVersion)
      ? {
          signingSessionSealKeyVersion: parseSigningSessionSealKeyVersion(
            obj.signingSessionSealKeyVersion,
          ),
        }
      : {}),
    ...(toOptionalTrimmedNonEmptyString(obj.groupId)
      ? { groupId: toOptionalTrimmedNonEmptyString(obj.groupId)! }
      : {}),
  };
}

export function readRegistrationRoutePlan(value: unknown, label: string): EmailOtpRoutePlan {
  const routePlan = readRoutePlan(value, label);
  if (routePlan.routeFamily !== 'registration') {
    throw new Error(`${label} requires an Email OTP registration route plan`);
  }
  return routePlan;
}
