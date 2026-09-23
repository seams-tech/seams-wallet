import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
} from '../authorization/capabilityKinds';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '../authorization/capabilityKinds';
import {
  parseThresholdEcdsaSessionId,
  parseThresholdEd25519SessionId,
  parseWalletId as parseWalletIdResult,
  parseMpcMaterialActivationRef,
  mpcMaterialActivationRefsEqual,
  type WalletId,
} from './domainIds';
import type {
  MpcMaterialActivationRef,
  ThresholdEcdsaSessionId,
  ThresholdEd25519SessionId,
} from './domainIds';
import {
  parseThresholdEcdsaKeyHandle,
  type ThresholdEcdsaKeyHandle,
} from './thresholdEcdsaKeyHandle';
import { parseNearAccountId, type NearAccountId } from './near';
import { parseNearEd25519SigningKeyId, type NearEd25519SigningKeyId } from './registrationIntent';
import {
  normalizeRuntimePolicyScope,
  type RuntimePolicyScope,
} from '../threshold/signingRootScope';
import {
  parseRouterAbEd25519NormalSigningState,
  type RouterAbEd25519NormalSigningState,
} from './signingSessionSeal';
import {
  parseRouterAbEcdsaDerivationNormalSigningStateV1,
  type RouterAbEcdsaDerivationNormalSigningStateV1,
} from './routerAbEcdsaDerivation';
import { routerAbMpcMaterialActivationRefFromWire } from './routerAbNormalSigningIdentity';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '../device-linking/contracts';
import {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
} from '../device-linking/parsers';

/**
 * The registration journal's durable session projection. It keeps the
 * identities and signing context needed to replay a committed response while
 * excluding every bearer credential.
 */
export type RegistrationEstablishedEcdsaSessionProjectionV2 = {
  readonly sessionKind: 'credential_free_projection_v2';
  readonly thresholdSessionId: ThresholdEcdsaSessionId;
  readonly keyHandle: ThresholdEcdsaKeyHandle;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
};

export type RegistrationEstablishedEd25519SessionProjectionV2 = {
  readonly sessionKind: 'credential_free_projection_v2';
  readonly thresholdSessionId: ThresholdEd25519SessionId;
  readonly nearAccountId: NearAccountId;
  readonly nearEd25519SigningKeyId: NearEd25519SigningKeyId;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

export type RegistrationEstablishedSessionProjectionTokensV2 =
  | {
      readonly kind: 'evm_family_ecdsa';
      readonly ecdsa: RegistrationEstablishedEcdsaSessionProjectionV2;
      readonly ed25519?: never;
    }
  | {
      readonly kind: 'near_ed25519';
      readonly ed25519: RegistrationEstablishedEd25519SessionProjectionV2;
      readonly ecdsa?: never;
    }
  | {
      readonly kind: 'near_ed25519_and_evm_family_ecdsa';
      readonly ecdsa: RegistrationEstablishedEcdsaSessionProjectionV2;
      readonly ed25519: RegistrationEstablishedEd25519SessionProjectionV2;
    };

export type RegistrationEstablishedSessionProjectionV2 = {
  readonly kind: 'registration_established_wallet_session_projection_v2';
  readonly walletId: WalletId;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly walletSessionId: WalletSessionId;
  readonly quotaId: MpcWalletSigningQuotaId;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly walletSession: ActiveWalletSessionV1;
  readonly tokens: RegistrationEstablishedSessionProjectionTokensV2;
};

/**
 * The direct registration response keeps the primary credential beside the
 * exact browser record. Its runtime projection is shared with the receipt so
 * replay can return the same identity without recreating plaintext.
 */
export type RegistrationEstablishedSessionV2 = {
  readonly kind: 'registration_established_wallet_session_v2';
  readonly walletId: WalletId;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly walletSessionId: WalletSessionId;
  readonly quotaId: MpcWalletSigningQuotaId;
  readonly expiresAtMs: number;
  readonly remainingUses: number;
  readonly walletSession: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly tokens: RegistrationEstablishedSessionProjectionTokensV2;
};

export type RegistrationEstablishedSessionResultV2 =
  | {
      readonly kind: 'issued';
      readonly session: RegistrationEstablishedSessionV2;
    }
  | {
      readonly kind: 'already_committed';
      readonly session: RegistrationEstablishedSessionProjectionV2;
      readonly next: 'unlock_exact_method';
    };

export function parseRegistrationEstablishedSessionResultV2(
  raw: unknown,
): RegistrationEstablishedSessionResultV2 | null {
  const result = inspectRawObject(raw);
  if (!result || !('kind' in result) || typeof result.kind !== 'string') return null;
  switch (result.kind) {
    case 'issued': {
      if (!hasExactKeys(result, ['kind', 'session']) || !('session' in result)) return null;
      const session = parseRegistrationEstablishedSessionV2(result.session);
      return session === null ? null : { kind: 'issued', session };
    }
    case 'already_committed': {
      if (
        !hasExactKeys(result, ['kind', 'session', 'next']) ||
        !('session' in result) ||
        !('next' in result)
      ) {
        return null;
      }
      if (result.next !== 'unlock_exact_method') return null;
      const session = parseRegistrationEstablishedSessionProjectionV2(result.session);
      return session === null ? null : { kind: 'already_committed', session, next: result.next };
    }
    default:
      return null;
  }
}

export function parseRegistrationEstablishedSessionV2(
  raw: unknown,
): RegistrationEstablishedSessionV2 | null {
  try {
    const record = inspectRawObject(raw);
    if (
      !record ||
      !hasExactKeys(record, [
        'kind',
        'walletId',
        'authorizationId',
        'walletSessionId',
        'quotaId',
        'expiresAtMs',
        'remainingUses',
        'walletSession',
        'operationCredential',
        'tokens',
      ]) ||
      !('kind' in record) ||
      !('walletId' in record) ||
      !('authorizationId' in record) ||
      !('walletSessionId' in record) ||
      !('quotaId' in record) ||
      !('expiresAtMs' in record) ||
      !('remainingUses' in record) ||
      !('walletSession' in record) ||
      !('operationCredential' in record) ||
      !('tokens' in record) ||
      record.kind !== 'registration_established_wallet_session_v2'
    ) {
      return null;
    }
    const walletId = parseWalletIdResult(record.walletId);
    const walletSessionId = parseWalletSessionId(record.walletSessionId);
    const authorizationId = parseWalletSessionAuthorizationId(record.authorizationId);
    const quotaId = parseMpcWalletSigningQuotaId(record.quotaId);
    if (!walletId.ok || !authorizationId.ok || !walletSessionId.ok || !quotaId.ok) return null;
    const expiresAtMs = parseNonNegativeSafeInteger(record.expiresAtMs);
    const remainingUses = parseNonNegativeSafeInteger(record.remainingUses);
    if (expiresAtMs === null || expiresAtMs <= 0 || remainingUses === null || remainingUses <= 0) {
      return null;
    }
    const walletSession = parseActiveWalletSessionV1(record.walletSession);
    const operationCredential = parseWalletSessionOperationCredentialV1(record.operationCredential);
    if (
      walletSession.walletId !== walletId.value ||
      walletSession.authorizationId !== authorizationId.value ||
      walletSession.quotaId !== quotaId.value ||
      walletSession.expiresAtMs !== expiresAtMs ||
      operationCredential.walletSessionId !== walletSessionId.value
    ) {
      return null;
    }
    const tokens = parseRegistrationEstablishedSessionProjectionTokensV2(record.tokens);
    if (tokens === null) return null;
    if (!registrationSessionTokensMatchCapabilities(walletSession, tokens)) return null;
    return {
      kind: 'registration_established_wallet_session_v2',
      walletId: walletId.value,
      authorizationId: authorizationId.value,
      walletSessionId: walletSessionId.value,
      quotaId: quotaId.value,
      expiresAtMs,
      remainingUses,
      walletSession,
      operationCredential,
      tokens,
    };
  } catch {
    return null;
  }
}

function registrationSessionTokensMatchCapabilities(
  walletSession: ActiveWalletSessionV1,
  tokens: RegistrationEstablishedSessionProjectionTokensV2,
): boolean {
  switch (tokens.kind) {
    case 'evm_family_ecdsa':
      return (
        hasRegistrationSigningCapability(
          walletSession,
          'ecdsa_secp256k1',
          tokens.ecdsa.materialActivation,
        ) && !hasUnexpectedRegistrationSigningFamily(walletSession, 'ecdsa_secp256k1')
      );
    case 'near_ed25519':
      return (
        hasRegistrationSigningCapability(
          walletSession,
          'ed25519',
          tokens.ed25519.materialActivation,
        ) && !hasUnexpectedRegistrationSigningFamily(walletSession, 'ed25519')
      );
    case 'near_ed25519_and_evm_family_ecdsa':
      return (
        hasRegistrationSigningCapability(
          walletSession,
          'ecdsa_secp256k1',
          tokens.ecdsa.materialActivation,
        ) &&
        hasRegistrationSigningCapability(
          walletSession,
          'ed25519',
          tokens.ed25519.materialActivation,
        ) &&
        !hasUnexpectedRegistrationSigningFamily(walletSession, 'ed25519', 'ecdsa_secp256k1')
      );
    default:
      return false;
  }
}

function hasRegistrationSigningCapability(
  walletSession: ActiveWalletSessionV1,
  keyFamily: 'ed25519' | 'ecdsa_secp256k1',
  materialActivation: MpcMaterialActivationRef,
): boolean {
  return walletSession.capabilitySubjects.some(
    (subject) =>
      subject.kind === 'sign' &&
      subject.keyFamily === keyFamily &&
      mpcMaterialActivationRefsEqual(subject.materialActivation, materialActivation),
  );
}

function hasUnexpectedRegistrationSigningFamily(
  walletSession: ActiveWalletSessionV1,
  ...allowedFamilies: readonly ('ed25519' | 'ecdsa_secp256k1')[]
): boolean {
  return walletSession.capabilitySubjects.some(
    (subject) => subject.kind === 'sign' && !allowedFamilies.includes(subject.keyFamily),
  );
}

export function parseRegistrationEstablishedSessionProjectionV2(
  raw: unknown,
): RegistrationEstablishedSessionProjectionV2 | null {
  try {
    const record = inspectRawObject(raw);
    if (
      !record ||
      !hasExactKeys(record, [
        'kind',
        'walletId',
        'authorizationId',
        'walletSessionId',
        'quotaId',
        'expiresAtMs',
        'remainingUses',
        'walletSession',
        'tokens',
      ]) ||
      !('kind' in record) ||
      !('walletId' in record) ||
      !('authorizationId' in record) ||
      !('walletSessionId' in record) ||
      !('quotaId' in record) ||
      !('expiresAtMs' in record) ||
      !('remainingUses' in record) ||
      !('walletSession' in record) ||
      !('tokens' in record) ||
      record.kind !== 'registration_established_wallet_session_projection_v2'
    ) {
      return null;
    }
    const walletId = parseWalletIdResult(record.walletId);
    const authorizationId = parseWalletSessionAuthorizationId(record.authorizationId);
    const walletSessionId = parseWalletSessionId(record.walletSessionId);
    const quotaId = parseMpcWalletSigningQuotaId(record.quotaId);
    if (!walletId.ok || !authorizationId.ok || !walletSessionId.ok || !quotaId.ok) return null;
    if (new Set<string>([authorizationId.value, walletSessionId.value, quotaId.value]).size !== 3) {
      return null;
    }
    const expiresAtMs = parseNonNegativeSafeInteger(record.expiresAtMs);
    const remainingUses = parseNonNegativeSafeInteger(record.remainingUses);
    const walletSession = parseActiveWalletSessionV1(record.walletSession);
    const tokens = parseRegistrationEstablishedSessionProjectionTokensV2(record.tokens);
    if (
      expiresAtMs === null ||
      expiresAtMs <= 0 ||
      remainingUses === null ||
      tokens === null ||
      walletSession.walletId !== walletId.value ||
      walletSession.authorizationId !== authorizationId.value ||
      walletSession.quotaId !== quotaId.value ||
      walletSession.expiresAtMs !== expiresAtMs ||
      !registrationSessionTokensMatchCapabilities(walletSession, tokens)
    ) {
      return null;
    }
    return {
      kind: 'registration_established_wallet_session_projection_v2',
      walletId: walletId.value,
      authorizationId: authorizationId.value,
      walletSessionId: walletSessionId.value,
      quotaId: quotaId.value,
      expiresAtMs,
      remainingUses,
      walletSession,
      tokens,
    };
  } catch {
    return null;
  }
}

function parseRegistrationEstablishedSessionProjectionTokensV2(
  raw: unknown,
): RegistrationEstablishedSessionProjectionTokensV2 | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record) || typeof record.kind !== 'string') return null;
  switch (record.kind) {
    case 'evm_family_ecdsa': {
      if (!hasExactKeys(record, ['kind', 'ecdsa']) || !('ecdsa' in record)) return null;
      const ecdsa = parseRegistrationEstablishedEcdsaSessionProjectionV2(record.ecdsa);
      return ecdsa === null ? null : { kind: 'evm_family_ecdsa', ecdsa };
    }
    case 'near_ed25519': {
      if (!hasExactKeys(record, ['kind', 'ed25519']) || !('ed25519' in record)) return null;
      const ed25519 = parseRegistrationEstablishedEd25519SessionProjectionV2(record.ed25519);
      return ed25519 === null ? null : { kind: 'near_ed25519', ed25519 };
    }
    case 'near_ed25519_and_evm_family_ecdsa': {
      if (
        !hasExactKeys(record, ['kind', 'ecdsa', 'ed25519']) ||
        !('ecdsa' in record) ||
        !('ed25519' in record)
      ) {
        return null;
      }
      const ecdsa = parseRegistrationEstablishedEcdsaSessionProjectionV2(record.ecdsa);
      const ed25519 = parseRegistrationEstablishedEd25519SessionProjectionV2(record.ed25519);
      return ecdsa === null || ed25519 === null
        ? null
        : { kind: 'near_ed25519_and_evm_family_ecdsa', ecdsa, ed25519 };
    }
    default:
      return null;
  }
}

function parseRegistrationEstablishedEcdsaSessionProjectionV2(
  raw: unknown,
): RegistrationEstablishedEcdsaSessionProjectionV2 | null {
  const record = inspectRawObject(raw);
  if (
    !record ||
    !hasExactKeys(record, [
      'sessionKind',
      'thresholdSessionId',
      'keyHandle',
      'runtimePolicyScope',
      'materialActivation',
      'routerAbEcdsaDerivationNormalSigning',
    ]) ||
    !('sessionKind' in record) ||
    !('thresholdSessionId' in record) ||
    !('keyHandle' in record) ||
    !('runtimePolicyScope' in record) ||
    !('materialActivation' in record) ||
    !('routerAbEcdsaDerivationNormalSigning' in record) ||
    record.sessionKind !== 'credential_free_projection_v2'
  ) {
    return null;
  }
  const thresholdSessionId = parseThresholdEcdsaSessionId(record.thresholdSessionId);
  if (!thresholdSessionId.ok) return null;
  try {
    const keyHandle = parseThresholdEcdsaKeyHandle(record.keyHandle);
    const runtimePolicyScope = parseRuntimePolicyScopeProjection(record.runtimePolicyScope);
    const materialActivation = parseMpcMaterialActivationRef(record.materialActivation);
    if (!materialActivation.ok) return null;
    const routerAbEcdsaDerivationNormalSigning = parseRouterAbEcdsaDerivationNormalSigningStateV1(
      record.routerAbEcdsaDerivationNormalSigning,
    );
    if (!routerAbEcdsaDerivationNormalSigning) return null;
    const scopeMaterialActivation = routerAbMpcMaterialActivationRefFromWire(
      routerAbEcdsaDerivationNormalSigning.scope.material_activation,
    );
    if (!mpcMaterialActivationRefsEqual(materialActivation.value, scopeMaterialActivation)) {
      return null;
    }
    return {
      sessionKind: 'credential_free_projection_v2',
      thresholdSessionId: thresholdSessionId.value,
      keyHandle,
      runtimePolicyScope,
      materialActivation: materialActivation.value,
      routerAbEcdsaDerivationNormalSigning,
    };
  } catch {
    return null;
  }
}

function parseRegistrationEstablishedEd25519SessionProjectionV2(
  raw: unknown,
): RegistrationEstablishedEd25519SessionProjectionV2 | null {
  const record = inspectRawObject(raw);
  if (
    !record ||
    !hasExactKeys(record, [
      'sessionKind',
      'thresholdSessionId',
      'nearAccountId',
      'nearEd25519SigningKeyId',
      'runtimePolicyScope',
      'materialActivation',
      'routerAbNormalSigning',
    ]) ||
    !('sessionKind' in record) ||
    !('thresholdSessionId' in record) ||
    !('nearAccountId' in record) ||
    !('nearEd25519SigningKeyId' in record) ||
    !('runtimePolicyScope' in record) ||
    !('materialActivation' in record) ||
    !('routerAbNormalSigning' in record) ||
    record.sessionKind !== 'credential_free_projection_v2'
  ) {
    return null;
  }
  const thresholdSessionId = parseThresholdEd25519SessionId(record.thresholdSessionId);
  const nearAccountId = parseNearAccountId(record.nearAccountId);
  if (!thresholdSessionId.ok || !nearAccountId.ok) return null;
  try {
    const nearEd25519SigningKeyId = parseNearEd25519SigningKeyId(record.nearEd25519SigningKeyId);
    const runtimePolicyScope = parseRuntimePolicyScopeProjection(record.runtimePolicyScope);
    const materialActivation = parseMpcMaterialActivationRef(record.materialActivation);
    if (!materialActivation.ok) return null;
    const routerAbNormalSigning = parseRouterAbEd25519NormalSigningState(
      record.routerAbNormalSigning,
    );
    if (!routerAbNormalSigning) return null;
    return {
      sessionKind: 'credential_free_projection_v2',
      thresholdSessionId: thresholdSessionId.value,
      nearAccountId: nearAccountId.value,
      nearEd25519SigningKeyId,
      runtimePolicyScope,
      materialActivation: materialActivation.value,
      routerAbNormalSigning,
    };
  } catch {
    return null;
  }
}

function parseRuntimePolicyScopeProjection(raw: unknown): RuntimePolicyScope {
  const record = inspectRawObject(raw);
  if (
    !record ||
    !hasExactKeys(record, ['orgId', 'projectId', 'envId', 'signingRootVersion']) ||
    !('orgId' in record) ||
    !('projectId' in record) ||
    !('envId' in record) ||
    !('signingRootVersion' in record)
  ) {
    throw new Error('runtime policy scope projection is invalid');
  }
  return normalizeRuntimePolicyScope({
    orgId: record.orgId,
    projectId: record.projectId,
    envId: record.envId,
    signingRootVersion: record.signingRootVersion,
  });
}

function parseNonNegativeSafeInteger(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function inspectRawObject(value: unknown): object | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function hasExactKeys(record: object, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(record);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  );
}
