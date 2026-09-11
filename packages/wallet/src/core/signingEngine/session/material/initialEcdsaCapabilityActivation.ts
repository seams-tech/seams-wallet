import {
  parseSdkEcdsaDerivationSigningRootId,
  parseSdkEcdsaDerivationSigningRootVersion,
  type EcdsaThresholdKeyId,
  type SigningRootId,
  type SigningRootVersion,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import { deriveThresholdEcdsaKeyHandle } from '@shared/utils/thresholdEcdsaKeyHandle';
import {
  parseCapabilityInstanceRef,
  parseMpcMaterialOwnerRef,
  type DomainIdParseResult,
} from '@shared/utils/domainIds';
import {
  parseCorrelationId,
  parseDigestB64u,
  parseIsoTimestamp,
  type CorrelationId,
  type DigestB64u,
  type IsoTimestamp,
} from '@shared/utils/canonicalPrimitives';
import { base64UrlEncode } from '@shared/utils/base64';
import { requireEvmFamilySigningKeySlotId } from '@shared/signing-lanes';
import {
  parseCanonicalEcdsaServerActivationRequest,
  parseEcdsaCapabilityManifestId,
  parseEcdsaCapabilityManifestRevision,
  parseEvmFamilyEcdsaSignerId,
  type CanonicalEcdsaServerActivationRequest,
} from '@shared/utils/ecdsaCapabilityActivation';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import type { ThresholdEcdsaChainTarget } from '@/core/platform/types';
import type { EvmFamilySigningKeySlotId } from '@shared/signing-lanes';
import {
  normalizeRuntimePolicyScope,
  type RuntimePolicyScope,
} from '@shared/threshold/signingRootScope';
import {
  parseRouterAbEcdsaVerifiedClientActivationFactsV1,
  type RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { PersistInitialCanonicalEcdsaActivationRequestV1 } from '../../routerAb/ecdsaDerivation/clientCeremony';
import { toParticipantId, type ParticipantId } from '../identity/evmFamilyEcdsaIdentity';
import {
  parseEcdsaClientVerifyingPublicKey33B64u,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseEcdsaRoleLocalBindingDigest,
  parseEcdsaRoleLocalDurableMaterialRef,
  parseEcdsaThresholdKeyId,
  type EcdsaClientVerifyingPublicKey33B64u,
  type EcdsaRelayerKeyId,
  type EcdsaRoleLocalBindingDigest,
} from '../keyMaterialBrands';
import {
  buildEcdsaActivationBinding,
  buildEcdsaCapabilityScope,
  buildEcdsaManifestIdentity,
  buildEcdsaRoleLocalMaterialBinding,
  buildNoCurrentEcdsaManifestExpectation,
  buildNoCurrentEcdsaServerGenerationExpectation,
  buildPreparedEvmFamilySigner,
  type EcdsaActivationBinding,
  type NoCurrentEcdsaManifestExpectation,
  type NoCurrentEcdsaServerGenerationExpectation,
} from './ecdsaCapabilityManifest';

type PlannerOwnedIdentityExclusions = {
  readonly capability?: never;
  readonly signerId?: never;
  readonly materialOwner?: never;
  readonly manifestId?: never;
  readonly manifestRevision?: never;
  readonly activationId?: never;
  readonly durableMaterialRef?: never;
  readonly thresholdSessionId?: never;
  readonly walletSessionId?: never;
  readonly materialHandle?: never;
  readonly pendingPayloadB64u?: never;
};

export type InitialEcdsaCapabilityActivationPlanInput = {
  readonly authority: WalletAuthAuthorityRef;
  readonly targetMemberships: readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]];
  readonly evmFamilySigningKeySlotId: EvmFamilySigningKeySlotId;
  readonly ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  readonly signingRootId: SigningRootId;
  readonly signingRootVersion: SigningRootVersion;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly clientVerifyingPublicKey33B64u: EcdsaClientVerifyingPublicKey33B64u;
  readonly participantIds: readonly [ParticipantId, ...ParticipantId[]];
  readonly relayerKeyId: EcdsaRelayerKeyId;
  readonly bindingDigest: EcdsaRoleLocalBindingDigest;
  readonly journalId: CorrelationId;
  readonly requestDigest: DigestB64u;
  readonly canonicalRequest: CanonicalEcdsaServerActivationRequest;
  readonly createdAt: IsoTimestamp;
} & PlannerOwnedIdentityExclusions;

export type InitialEcdsaCapabilityActivationPlan = {
  readonly journalId: CorrelationId;
  readonly expectedManifest: NoCurrentEcdsaManifestExpectation;
  readonly expectedGeneration: NoCurrentEcdsaServerGenerationExpectation;
  readonly activationBinding: EcdsaActivationBinding;
  readonly requestDigest: DigestB64u;
  readonly canonicalRequest: CanonicalEcdsaServerActivationRequest;
  readonly createdAt: IsoTimestamp;
  readonly pendingPayloadB64u?: never;
};

export function parsePersistInitialCanonicalEcdsaActivationRequestV1(
  value: unknown,
): PersistInitialCanonicalEcdsaActivationRequestV1 {
  const record = requireRecord(value, 'Initial canonical ECDSA activation request');
  requireExactKeys(record, 'Initial canonical ECDSA activation request', [
    'kind',
    'bootstrapOwner',
    'ceremonyId',
    'clientActivation',
    'planInput',
  ]);
  if (
    record.kind !== 'persist_initial_canonical_ecdsa_activation_v1' ||
    record.bootstrapOwner !== 'wallet_custody'
  ) {
    throw new Error('Initial canonical ECDSA activation request discriminant is invalid');
  }
  return {
    kind: 'persist_initial_canonical_ecdsa_activation_v1',
    bootstrapOwner: 'wallet_custody',
    ceremonyId: parseCorrelationId(record.ceremonyId),
    clientActivation: parseRouterAbEcdsaVerifiedClientActivationFactsV1(record.clientActivation),
    planInput: parseInitialEcdsaCapabilityActivationPlanInput(record.planInput),
  };
}

function parseInitialEcdsaCapabilityActivationPlanInput(
  value: unknown,
): InitialEcdsaCapabilityActivationPlanInput {
  const record = requireRecord(value, 'Initial canonical ECDSA activation plan input');
  requireExactKeys(record, 'Initial canonical ECDSA activation plan input', [
    'authority',
    'targetMemberships',
    'evmFamilySigningKeySlotId',
    'ecdsaThresholdKeyId',
    'signingRootId',
    'signingRootVersion',
    'runtimePolicyScope',
    'clientVerifyingPublicKey33B64u',
    'participantIds',
    'relayerKeyId',
    'bindingDigest',
    'journalId',
    'requestDigest',
    'canonicalRequest',
    'createdAt',
  ]);
  return {
    authority: requireAuthority(record.authority),
    targetMemberships: parseInitialEcdsaTargetMemberships(record.targetMemberships),
    evmFamilySigningKeySlotId: requireEvmFamilySigningKeySlotId(
      record.evmFamilySigningKeySlotId,
      'Initial canonical ECDSA activation signing key slot',
    ),
    ecdsaThresholdKeyId: parseEcdsaThresholdKeyId(record.ecdsaThresholdKeyId),
    signingRootId: parseSdkEcdsaDerivationSigningRootId(record.signingRootId),
    signingRootVersion: parseSdkEcdsaDerivationSigningRootVersion(record.signingRootVersion),
    runtimePolicyScope: parseInitialEcdsaRuntimePolicyScope(record.runtimePolicyScope),
    clientVerifyingPublicKey33B64u: parseEcdsaClientVerifyingPublicKey33B64u(
      record.clientVerifyingPublicKey33B64u,
    ),
    participantIds: parseInitialEcdsaParticipantIds(record.participantIds),
    relayerKeyId: parseEcdsaRelayerKeyId(record.relayerKeyId),
    bindingDigest: parseEcdsaRoleLocalBindingDigest(record.bindingDigest),
    journalId: parseCorrelationId(record.journalId),
    requestDigest: parseDigestB64u(record.requestDigest),
    canonicalRequest: parseCanonicalEcdsaServerActivationRequest(record.canonicalRequest),
    createdAt: parseIsoTimestamp(record.createdAt),
  };
}

function parseInitialEcdsaTargetMemberships(
  value: unknown,
): readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Initial canonical ECDSA activation target memberships are required');
  }
  const targets: ThresholdEcdsaChainTarget[] = [];
  for (const [index, target] of value.entries()) {
    targets.push(parseInitialEcdsaTargetMembership(target, `targetMemberships[${index}]`));
  }
  const [first, ...rest] = targets;
  if (!first) {
    throw new Error('Initial canonical ECDSA activation target memberships are required');
  }
  return [first, ...rest];
}

function parseInitialEcdsaTargetMembership(
  value: unknown,
  label: string,
): ThresholdEcdsaChainTarget {
  const record = requireRecord(value, label);
  if (record.kind === 'evm') {
    requireExactKeys(record, label, ['kind', 'namespace', 'chainId', 'networkSlug']);
    if (record.namespace !== 'eip155') {
      throw new Error(`${label}.namespace is invalid`);
    }
    return {
      kind: 'evm',
      namespace: 'eip155',
      chainId: requirePositiveSafeInteger(record.chainId, `${label}.chainId`),
      networkSlug: requireNonEmptyCanonicalString(record.networkSlug, `${label}.networkSlug`),
    };
  }
  if (record.kind === 'tempo') {
    requireExactKeys(record, label, ['kind', 'chainId', 'networkSlug']);
    return {
      kind: 'tempo',
      chainId: requirePositiveSafeInteger(record.chainId, `${label}.chainId`),
      networkSlug: requireNonEmptyCanonicalString(record.networkSlug, `${label}.networkSlug`),
    };
  }
  throw new Error(`${label}.kind is invalid`);
}

function parseInitialEcdsaParticipantIds(
  value: unknown,
): readonly [ParticipantId, ...ParticipantId[]] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Initial canonical ECDSA activation participant ids are required');
  }
  const participantIds: ParticipantId[] = [];
  for (const [index, participantId] of value.entries()) {
    if (typeof participantId !== 'number' || !Number.isInteger(participantId)) {
      throw new Error(`participantIds[${index}] must be an integer`);
    }
    participantIds.push(toParticipantId(participantId));
  }
  const [first, ...rest] = participantIds;
  if (!first) {
    throw new Error('Initial canonical ECDSA activation participant ids are required');
  }
  return [first, ...rest];
}

function parseInitialEcdsaRuntimePolicyScope(value: unknown): RuntimePolicyScope {
  const record = requireRecord(value, 'Initial canonical ECDSA activation runtime policy scope');
  requireExactKeys(record, 'Initial canonical ECDSA activation runtime policy scope', [
    'orgId',
    'projectId',
    'envId',
    'signingRootVersion',
  ]);
  return normalizeRuntimePolicyScope(record);
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireNonEmptyCanonicalString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function verifiedClientActivationFactsEqual(
  left: RouterAbEcdsaVerifiedClientActivationFactsV1,
  right: RouterAbEcdsaVerifiedClientActivationFactsV1,
): boolean {
  return (
    left.registrationRequestDigestB64u === right.registrationRequestDigestB64u &&
    left.proofTranscriptDigestB64u === right.proofTranscriptDigestB64u &&
    left.contextBinding32B64u === right.contextBinding32B64u &&
    left.derivationClientSharePublicKey33B64u === right.derivationClientSharePublicKey33B64u &&
    left.clientShareRetryCounter === right.clientShareRetryCounter &&
    left.participantId === right.participantId
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function digestFromActivationCommitWire(value: unknown): DigestB64u {
  const record = requireRecord(value, 'ECDSA activation commit request digest');
  requireExactKeys(record, 'ECDSA activation commit request digest', ['bytes']);
  if (
    !Array.isArray(record.bytes) ||
    record.bytes.length !== 32 ||
    record.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error('ECDSA activation commit request digest bytes are invalid');
  }
  return parseDigestB64u(base64UrlEncode(Uint8Array.from(record.bytes)));
}

function activationCommitCeremonyId(record: Record<string, unknown>): string {
  if (record.operation === 'wallet_registration_activate_v2') {
    requireExactKeys(record, 'ECDSA activation operation', [
      'operation',
      'registrationCeremonyId',
      'activationCorrelationId',
      'idempotencyKey',
      'publicFacts',
    ]);
    const ceremonyId = String(record.registrationCeremonyId || '').trim();
    if (!ceremonyId) throw new Error('ECDSA activation operation ceremony identity is invalid');
    return ceremonyId;
  }
  if (record.operation === 'wallet_add_signer_activate_v2') {
    requireExactKeys(record, 'ECDSA activation operation', [
      'operation',
      'addSignerCeremonyId',
      'activationCorrelationId',
      'publicFacts',
    ]);
    const ceremonyId = String(record.addSignerCeremonyId || '').trim();
    if (!ceremonyId) throw new Error('ECDSA activation operation ceremony identity is invalid');
    return ceremonyId;
  }
  const hasRegistrationId = Object.hasOwn(record, 'registrationCeremonyId');
  const hasAddSignerId = Object.hasOwn(record, 'addSignerCeremonyId');
  if (hasRegistrationId === hasAddSignerId) {
    throw new Error('ECDSA activation commit request requires one ceremony identity');
  }
  const field = hasRegistrationId ? 'registrationCeremonyId' : 'addSignerCeremonyId';
  requireExactKeys(record, 'ECDSA activation commit request', [field, 'ecdsa']);
  const ceremonyId = String(record[field] || '').trim();
  if (!ceremonyId) throw new Error('ECDSA activation commit ceremony identity is invalid');
  return ceremonyId;
}

function assertCanonicalRequestMatchesVerifiedCeremony(input: {
  readonly ceremonyId: string;
  readonly planInput: InitialEcdsaCapabilityActivationPlanInput;
  readonly clientActivation: RouterAbEcdsaVerifiedClientActivationFactsV1;
}): void {
  const request = requireRecord(
    JSON.parse(input.planInput.canonicalRequest),
    'ECDSA activation commit request',
  );
  if (activationCommitCeremonyId(request) !== input.ceremonyId) {
    throw new Error('ECDSA activation commit request changed the ceremony identity');
  }
  if (request.operation === 'wallet_registration_activate_v2') {
    if (parseCorrelationId(request.activationCorrelationId) !== input.planInput.journalId) {
      throw new Error('ECDSA activation operation changed the activation correlation');
    }
    if (!String(request.idempotencyKey || '').trim()) {
      throw new Error('ECDSA activation operation requires an idempotency key');
    }
    const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(request.publicFacts);
    if (!verifiedClientActivationFactsEqual(publicFacts, input.clientActivation)) {
      throw new Error('ECDSA activation operation changed the verified client facts');
    }
    return;
  }
  if (request.operation === 'wallet_add_signer_activate_v2') {
    if (parseCorrelationId(request.activationCorrelationId) !== input.planInput.journalId) {
      throw new Error('ECDSA activation operation changed the activation correlation');
    }
    const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(request.publicFacts);
    if (!verifiedClientActivationFactsEqual(publicFacts, input.clientActivation)) {
      throw new Error('ECDSA activation operation changed the verified client facts');
    }
    return;
  }
  const ecdsa = requireRecord(request.ecdsa, 'ECDSA activation commit request ecdsa');
  requireExactKeys(ecdsa, 'ECDSA activation commit request ecdsa', [
    'kind',
    'activationCorrelationId',
    'publicFacts',
    'expectedActivationRequestDigest',
  ]);
  if (ecdsa.kind !== 'router_ab_ecdsa_registration_activation_v1') {
    throw new Error('ECDSA activation commit request kind is invalid');
  }
  if (parseCorrelationId(ecdsa.activationCorrelationId) !== input.planInput.journalId) {
    throw new Error('ECDSA activation commit request changed the activation correlation');
  }
  if (
    digestFromActivationCommitWire(ecdsa.expectedActivationRequestDigest) !==
    input.planInput.requestDigest
  ) {
    throw new Error('ECDSA activation commit request changed the prepared request digest');
  }
  const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(ecdsa.publicFacts);
  if (!verifiedClientActivationFactsEqual(publicFacts, input.clientActivation)) {
    throw new Error('ECDSA activation commit request changed the verified client facts');
  }
}

export function assertInitialEcdsaActivationPlanMatchesVerifiedCeremony(input: {
  readonly ceremonyId: string;
  readonly planInput: InitialEcdsaCapabilityActivationPlanInput;
  readonly clientActivation: RouterAbEcdsaVerifiedClientActivationFactsV1;
}): void {
  const clientActivation = parseRouterAbEcdsaVerifiedClientActivationFactsV1(
    input.clientActivation,
  );
  if (
    input.planInput.journalId !== parseCorrelationId(input.ceremonyId) ||
    input.planInput.bindingDigest !== clientActivation.contextBinding32B64u ||
    input.planInput.clientVerifyingPublicKey33B64u !==
      clientActivation.derivationClientSharePublicKey33B64u ||
    input.planInput.participantIds.length !== 2 ||
    input.planInput.participantIds[0] !== toParticipantId(1) ||
    input.planInput.participantIds[1] !== toParticipantId(2)
  ) {
    throw new Error('Initial canonical ECDSA activation plan does not match the live ceremony');
  }
  assertCanonicalRequestMatchesVerifiedCeremony({
    ceremonyId: input.ceremonyId,
    planInput: input.planInput,
    clientActivation,
  });
}

function unwrapDomainId<T>(result: DomainIdParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function requireAuthority(authority: unknown): WalletAuthAuthorityRef {
  const parsed = parseWalletAuthAuthorityRef(authority);
  if (!parsed) throw new Error('Initial ECDSA activation requires an exact wallet authority');
  return parsed;
}

function freshCapabilityRef() {
  return unwrapDomainId(
    parseCapabilityInstanceRef(
      secureRandomId('ecdsa-capability', 32, 'initial ECDSA capability identities'),
    ),
  );
}

function freshSignerId() {
  return parseEvmFamilyEcdsaSignerId(
    secureRandomId('ecdsa-signer', 32, 'initial ECDSA signer identities'),
  );
}

function materialOwnerRefForAuthority(authority: WalletAuthAuthorityRef) {
  return unwrapDomainId(parseMpcMaterialOwnerRef(authority.walletId));
}

function freshManifestIdentity() {
  return buildEcdsaManifestIdentity({
    manifestId: parseEcdsaCapabilityManifestId(
      secureRandomId('ecdsa-manifest', 32, 'initial ECDSA manifest identities'),
    ),
    manifestRevision: parseEcdsaCapabilityManifestRevision(1),
  });
}

function freshDurableMaterialRef() {
  return parseEcdsaRoleLocalDurableMaterialRef(
    secureRandomId('ecdsa-role-local-material', 32, 'initial ECDSA durable material identities'),
  );
}

function normalizeParticipantIds(
  participantIds: readonly [ParticipantId, ...ParticipantId[]],
): readonly [ParticipantId, ...ParticipantId[]] {
  const [first, ...rest] = participantIds;
  const normalizedRest: ParticipantId[] = [];
  for (const participantId of rest) normalizedRest.push(toParticipantId(participantId));
  return [toParticipantId(first), ...normalizedRest];
}

export async function buildInitialEcdsaCapabilityActivationPlan(
  input: InitialEcdsaCapabilityActivationPlanInput,
): Promise<InitialEcdsaCapabilityActivationPlan> {
  const authority = requireAuthority(input.authority);
  const signingRootId = parseSdkEcdsaDerivationSigningRootId(input.signingRootId);
  const signingRootVersion = parseSdkEcdsaDerivationSigningRootVersion(input.signingRootVersion);
  const ecdsaThresholdKeyId = parseEcdsaThresholdKeyId(input.ecdsaThresholdKeyId);
  const roleLocalBinding = buildEcdsaRoleLocalMaterialBinding({
    keyHandle: parseEcdsaKeyHandle(
      await deriveThresholdEcdsaKeyHandle({
        ecdsaThresholdKeyId,
        signingRootId,
        signingRootVersion,
      }),
    ),
    ecdsaThresholdKeyId,
    clientVerifyingPublicKey33B64u: parseEcdsaClientVerifyingPublicKey33B64u(
      input.clientVerifyingPublicKey33B64u,
    ),
    participantIds: normalizeParticipantIds(input.participantIds),
    relayerKeyId: parseEcdsaRelayerKeyId(input.relayerKeyId),
  });
  const signer = buildPreparedEvmFamilySigner({
    capability: freshCapabilityRef(),
    signerId: freshSignerId(),
    authority,
    scope: buildEcdsaCapabilityScope({
      targetMemberships: input.targetMemberships,
    }),
    materialOwner: materialOwnerRefForAuthority(authority),
    signingRootId,
    signingRootVersion,
  });
  const activationBinding = buildEcdsaActivationBinding({
    targetManifest: freshManifestIdentity(),
    signer,
    roleLocalBinding,
    bindingDigest: parseEcdsaRoleLocalBindingDigest(input.bindingDigest),
    durableMaterialRef: freshDurableMaterialRef(),
  });
  return {
    journalId: parseCorrelationId(input.journalId),
    expectedManifest: buildNoCurrentEcdsaManifestExpectation(),
    expectedGeneration: buildNoCurrentEcdsaServerGenerationExpectation(),
    activationBinding,
    requestDigest: parseDigestB64u(input.requestDigest),
    canonicalRequest: parseCanonicalEcdsaServerActivationRequest(input.canonicalRequest),
    createdAt: parseIsoTimestamp(input.createdAt),
  };
}
