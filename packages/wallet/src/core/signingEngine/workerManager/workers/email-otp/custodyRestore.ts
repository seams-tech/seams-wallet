/**
 * Checks an unlock's exact Wallet Session and wallet custody projection, then restores ECDSA and
 * Ed25519 signing material from custody.
 */
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  parsePasskeyCustodyEnvelopeRecord,
  parseWalletCustodyEvmFamilyActivationCompletion,
  isWalletCustodySeedBinding,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
import { asRecord } from '@shared/utils/validation';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
  type ActiveWalletSessionV1,
  type WalletCapabilitySubjectV1,
  type WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import { createRelayerExactWalletSessionStatusPort } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import {
  parseEmailOtpVerifiedAuthorityProjection,
  type EmailOtpVerifiedAuthorityProjection,
} from '@/core/signingEngine/session/emailOtp/publicTypes';
import {
  parseWalletCustodyUnlockKeyManifest,
  type WalletCustodyUnlockKeyManifest,
  type WalletCustodyUnlockKeyManifestEntry,
} from '@/core/rpcClients/relayer/walletRecoveryPrepare';
import { joinCustodyWireFromEnvelopeRecord } from '@/core/signingEngine/walletCustody/joinCustodyWire';
import {
  openWalletCustodyEd25519ActiveClientV1,
  walletCustodyCacheEnvelopeFromRecordV1,
  type WalletCustodyActivationFactsV1,
} from '@/core/signingEngine/walletCustody/openCustodyCache';
import type {
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpEcdsaCustodyContinuityV1,
  EmailOtpEcdsaCustodyRestoreV1,
  EmailOtpEcdsaCustodySignerV1,
  EmailOtpAuthoritySelector,
  EmailOtpWalletUnlockMaterialRequest,
} from '@/core/signingEngine/workerManager/workerTypes';
import type { RouterAbEd25519YaoActiveClientMetadataV1 } from '../../../threshold/ed25519/yaoClient';
import type { WalletRegistrationEd25519YaoBootstrapSession } from '@shared/utils/registrationContracts';
import {
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  sameRouterAbEcdsaDerivationPublicCapabilityV1,
  sameRouterAbEcdsaRegistrationActivationReceiptV1,
  type RouterAbEcdsaCredentialFreeSessionActivationResponseV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { ExactWalletSessionAuthorization } from '../../../session/persistence/walletSessionAuthorizationProjection';
import { sameRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  wallet_custody_ceremony_join_v1,
  type WasmCeremonyEvmActivationPendingV1,
  type WasmCeremonyProtocolPreparedV1,
  type WasmCeremonySeedHeldV1,
} from '../../../../../../../../wasm/wallet_custody_ceremony/pkg/wallet_custody_ceremony.js';
import {
  assertNeverEmailOtpWorker,
  parseWorkerChainTarget,
  parseWorkerRuntimePolicyScope,
  readString,
} from './payloadParsing';
import {
  parseEmailOtpEd25519YaoBootstrapSession,
  readEmailOtpEd25519YaoRecoveryBootstrapRecord,
} from './materialParsing';
import { ensureWalletCustodyCeremonyWasm } from './crypto';
import { storeEmailOtpEd25519YaoActiveClient } from './sessionState';

export type EmailOtpWalletCustodyUnlockProjection = {
  readonly kind: 'wallet_custody_email_otp_unlock_v1';
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly enrollmentSealKeyVersion: string;
  readonly envelopeVersion: string;
  readonly envelopeRevision: number;
  readonly storeVersion: string;
  readonly activeKeySetIds: readonly string[];
  readonly keyManifest: WalletCustodyUnlockKeyManifest;
  readonly envelope: PasskeyCustodyEnvelopeRecord;
};

export function bytesToLowerHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

export type EmailOtpUnlockSecretMaterialRequest =
  | Extract<EmailOtpWalletUnlockMaterialRequest, { kind: 'ecdsa' }>
  | { kind: 'ed25519_yao_export' }
  | EmailOtpEd25519OperationRecoveryMaterialRequest
  | Extract<
      EmailOtpWalletUnlockMaterialRequest,
      {
        kind: 'ed25519_yao_recovery' | 'wallet_unlock_capabilities';
      }
    >;

export type EmailOtpEd25519OperationRecoveryMaterialRequest = Omit<
  Extract<EmailOtpWalletUnlockMaterialRequest, { kind: 'ed25519_yao_recovery' }>,
  'kind'
> & {
  readonly kind: 'ed25519_yao_operation_recovery';
  readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
};

function walletSessionHasEcdsaActivation(args: {
  readonly record: ActiveWalletSessionV1;
  readonly activation: RouterAbEcdsaCredentialFreeSessionActivationResponseV1;
}): boolean {
  const materialActivation = routerAbMpcMaterialActivationRefFromWire(
    args.activation.public_capability.material_activation,
  );
  let matchCount = 0;
  for (const subject of args.record.capabilitySubjects) {
    if (
      subject.kind === 'sign' &&
      subject.keyFamily === 'ecdsa_secp256k1' &&
      mpcMaterialActivationRefsEqual(subject.materialActivation, materialActivation)
    ) {
      matchCount += 1;
    }
  }
  return matchCount === 1;
}

function appendEmailOtpWalletUnlockSignerSubjects(
  subjects: WalletCapabilitySubjectV1[],
  kind: 'sign' | 'export_keys',
  authority: EmailOtpVerifiedAuthorityProjection['authority'],
): void {
  const activations = authority.signerActivations;
  if (activations.keyFamilies.length === 1) {
    const keyFamily = activations.keyFamilies[0];
    if (keyFamily === 'ed25519') {
      if (!activations.ed25519) {
        throw new Error('Email OTP Wallet Session Ed25519 activation is missing');
      }
      subjects.push({
        kind,
        keyFamily,
        materialActivation: activations.ed25519.materialActivation,
      });
      return;
    }
    if (!activations.ecdsa) {
      throw new Error('Email OTP Wallet Session ECDSA activation is missing');
    }
    subjects.push({
      kind,
      keyFamily,
      materialActivation: activations.ecdsa.materialActivation,
    });
    return;
  }
  if (
    activations.keyFamilies.length !== 2 ||
    activations.keyFamilies[0] !== 'ed25519' ||
    activations.keyFamilies[1] !== 'ecdsa_secp256k1' ||
    !activations.ed25519 ||
    !activations.ecdsa
  ) {
    throw new Error('Email OTP Wallet Session signer activations are invalid');
  }
  subjects.push(
    {
      kind,
      keyFamily: 'ed25519',
      materialActivation: activations.ed25519.materialActivation,
    },
    {
      kind,
      keyFamily: 'ecdsa_secp256k1',
      materialActivation: activations.ecdsa.materialActivation,
    },
  );
}

function emailOtpWalletUnlockCapabilitySubjects(
  authority: EmailOtpVerifiedAuthorityProjection['authority'],
): readonly [WalletCapabilitySubjectV1, ...WalletCapabilitySubjectV1[]] {
  const subjects: WalletCapabilitySubjectV1[] = [];
  if (authority.permissions.includes('sign')) {
    appendEmailOtpWalletUnlockSignerSubjects(subjects, 'sign', authority);
  }
  if (authority.permissions.includes('export_keys')) {
    appendEmailOtpWalletUnlockSignerSubjects(subjects, 'export_keys', authority);
  }
  if (authority.permissions.includes('link_devices')) subjects.push({ kind: 'link_devices' });
  if (authority.permissions.includes('revoke_devices')) subjects.push({ kind: 'revoke_devices' });
  const [first, ...remaining] = subjects;
  if (!first) {
    throw new Error('Email OTP Wallet Session authority has no capability subjects');
  }
  return [first, ...remaining];
}

function emailOtpWalletUnlockCapabilitySubjectsMatchAuthority(
  record: ActiveWalletSessionV1,
  authority: EmailOtpVerifiedAuthorityProjection['authority'],
): boolean {
  const expected = emailOtpWalletUnlockCapabilitySubjects(authority);
  if (record.capabilitySubjects.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const actual = record.capabilitySubjects[index];
    const expectedSubject = expected[index];
    if (!actual || !expectedSubject || actual.kind !== expectedSubject.kind) return false;
    switch (actual.kind) {
      case 'sign':
      case 'export_keys':
        if (
          expectedSubject.kind !== actual.kind ||
          expectedSubject.keyFamily !== actual.keyFamily ||
          !mpcMaterialActivationRefsEqual(
            expectedSubject.materialActivation,
            actual.materialActivation,
          )
        ) {
          return false;
        }
        break;
      case 'link_devices':
      case 'revoke_devices':
        if (expectedSubject.kind !== actual.kind) return false;
        break;
      default:
        return assertNeverEmailOtpWorker(actual);
    }
  }
  return true;
}

export function parseEmailOtpWalletUnlockBootstrapSession(
  value: unknown,
  unlockCredential: unknown,
): WalletRegistrationEd25519YaoBootstrapSession {
  const obj = readEmailOtpEd25519YaoRecoveryBootstrapRecord(value);
  const sessionObj = asRecord(obj.session);
  if (!sessionObj) throw new Error('Email OTP Ed25519 Yao recovery session is required');
  const session = parseEmailOtpEd25519YaoBootstrapSession(sessionObj, {
    kind: 'wallet_unlock_response',
    unlockCredential,
  });
  if (sessionObj.sessionKind === 'issued_exact_wallet_session') {
    return {
      ...session,
      sessionKind: 'issued_exact_wallet_session',
      operationCredential: parseWalletSessionOperationCredentialV1(sessionObj.operationCredential),
    };
  }
  if (sessionObj.sessionKind === 'already_committed_exact_wallet_session') {
    return { ...session, sessionKind: 'already_committed_exact_wallet_session' };
  }
  throw new Error('Email OTP Ed25519 Yao recovery session kind is invalid');
}

type EmailOtpWalletUnlockExactSession = {
  readonly relayUrl: string;
  readonly rawWalletSession: unknown;
  readonly rawOperationCredential: unknown;
  readonly walletId: string;
  readonly providerSubjectId: string;
  readonly verifiedAuthorityProjection: EmailOtpVerifiedAuthorityProjection;
  readonly ed25519Session: WalletRegistrationEd25519YaoBootstrapSession;
};

export async function resolveEmailOtpWalletUnlockExactSessionAuthorization(
  args: EmailOtpWalletUnlockExactSession,
): Promise<ExactWalletSessionAuthorization> {
  const hasWalletSession = args.rawWalletSession !== undefined;
  const hasOperationCredential = args.rawOperationCredential !== undefined;
  if (hasWalletSession !== hasOperationCredential) {
    throw new Error('Email OTP unlock returned only part of its exact Wallet Session');
  }
  let record: ActiveWalletSessionV1;
  let operationCredential: WalletSessionOperationCredentialV1;
  if (hasWalletSession) {
    if (args.ed25519Session.sessionKind !== 'already_committed_exact_wallet_session') {
      throw new Error('Email OTP unlock returned competing Wallet Session credentials');
    }
    record = parseActiveWalletSessionV1(args.rawWalletSession);
    operationCredential = parseWalletSessionOperationCredentialV1(args.rawOperationCredential);
  } else {
    if (args.ed25519Session.sessionKind !== 'issued_exact_wallet_session') {
      throw new Error('Email OTP unlock did not return its exact Wallet Session credential');
    }
    const status = await createRelayerExactWalletSessionStatusPort({
      relayerUrl: args.relayUrl,
      operationCredential: args.ed25519Session.operationCredential,
    }).read({
      walletSessionId: args.ed25519Session.walletSessionId,
      quotaId: args.ed25519Session.quotaId,
    });
    if (
      status.status !== 'active' ||
      status.walletSessionId !== args.ed25519Session.walletSessionId ||
      status.quotaId !== args.ed25519Session.quotaId ||
      status.expiresAtMs !== args.ed25519Session.expiresAtMs ||
      status.remainingUses !== args.ed25519Session.remainingUses
    ) {
      throw new Error('Email OTP issued Wallet Session status does not match its bootstrap');
    }
    record = status.authorization;
    operationCredential = args.ed25519Session.operationCredential;
  }
  const authority = args.verifiedAuthorityProjection.authority;
  const authMethod = args.verifiedAuthorityProjection.authMethod;
  const mismatches: string[] = [];
  const expect = (holds: boolean, binding: string): void => {
    if (!holds) mismatches.push(binding);
  };
  expect(String(record.walletId) === args.walletId, 'record.walletId=requested.walletId');
  expect(record.walletId === authority.walletId, 'record.walletId=authority.walletId');
  expect(record.walletId === authMethod.walletId, 'record.walletId=authMethod.walletId');
  expect(record.authorityId === authority.authorityId, 'record.authorityId');
  expect(record.authMethodId === authMethod.walletAuthMethodId, 'record.authMethodId');
  expect(record.authorityDigestB64u === authority.authorityDigestB64u, 'record.authorityDigest');
  expect(
    record.authorityRevocationEpoch === authority.revocationEpoch,
    'record.authorityRevocationEpoch',
  );
  expect(args.ed25519Session.walletId === record.walletId, 'ed25519Session.walletId');
  expect(
    args.ed25519Session.authorizationId === record.authorizationId,
    'ed25519Session.authorizationId',
  );
  expect(args.ed25519Session.quotaId === record.quotaId, 'ed25519Session.quotaId');
  expect(args.ed25519Session.expiresAtMs === record.expiresAtMs, 'ed25519Session.expiresAtMs');
  expect(args.ed25519Session.authorityScope.kind === 'email_otp', 'ed25519Session.scope.kind');
  expect(
    args.ed25519Session.authorityScope.kind === 'email_otp' &&
      args.ed25519Session.authorityScope.providerUserId === args.providerSubjectId,
    'ed25519Session.scope.providerUserId',
  );
  expect(
    operationCredential.walletSessionId === args.ed25519Session.walletSessionId,
    'ed25519Session.walletSessionId',
  );
  expect(
    emailOtpWalletUnlockCapabilitySubjectsMatchAuthority(record, authority),
    'record.capabilitySubjects=authority.signerActivations',
  );
  if (mismatches.length > 0) {
    throw new Error(
      `Email OTP unlock exact Wallet Session does not match its Ed25519 bootstrap: ${mismatches.join(', ')}`,
    );
  }
  return { record, operationCredential };
}

export async function parseEmailOtpWalletUnlockExactSessionAuthorization(
  args: EmailOtpWalletUnlockExactSession & {
    readonly activation: RouterAbEcdsaCredentialFreeSessionActivationResponseV1;
  },
): Promise<ExactWalletSessionAuthorization> {
  const exact = await resolveEmailOtpWalletUnlockExactSessionAuthorization(args);
  const record = exact.record;
  const activationSession = args.activation.session;
  if (
    String(record.walletId) !== String(args.activation.public_capability.client_id) ||
    record.authorizationId !== activationSession.authorization_id ||
    record.quotaId !== activationSession.quota_id ||
    record.expiresAtMs !== activationSession.expires_at_ms ||
    exact.operationCredential.walletSessionId !== activationSession.wallet_session_id ||
    args.ed25519Session.remainingUses !== activationSession.remaining_uses ||
    !walletSessionHasEcdsaActivation({ record, activation: args.activation })
  ) {
    throw new Error('Email OTP unlock exact Wallet Session does not match ECDSA activation');
  }
  return exact;
}

export function parseEmailOtpWalletCustodyUnlockProjection(args: {
  raw: unknown;
  walletId: string;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
}): EmailOtpWalletCustodyUnlockProjection {
  const projection = asRecord(args.raw);
  if (!projection || projection.kind !== 'wallet_custody_email_otp_unlock_v1') {
    throw new Error('Email OTP unlock omitted its wallet custody projection');
  }
  const walletId = readString(projection.walletId, 'walletCustody.walletId');
  const enrollmentId = readString(projection.enrollmentId, 'walletCustody.enrollmentId');
  const enrollmentSealKeyVersion = readString(
    projection.enrollmentSealKeyVersion,
    'walletCustody.enrollmentSealKeyVersion',
  );
  if (
    walletId !== args.walletId ||
    enrollmentId !== args.enrollmentId ||
    enrollmentSealKeyVersion !== args.enrollmentSealKeyVersion
  ) {
    throw new Error('Email OTP wallet custody projection changed its enrollment binding');
  }
  const envelope = parsePasskeyCustodyEnvelopeRecord(projection.envelope);
  if (
    envelope.walletId !== walletId ||
    envelope.lifecycle.state !== 'active' ||
    !isWalletCustodySeedBinding(envelope.binding) ||
    envelope.factor.kind !== 'email_otp' ||
    envelope.factor.enrollmentId !== enrollmentId ||
    envelope.factor.enrollmentSealKeyVersion !== enrollmentSealKeyVersion
  ) {
    throw new Error('Email OTP wallet custody envelope binding is invalid');
  }
  const envelopeVersion = readString(projection.envelopeVersion, 'walletCustody.envelopeVersion');
  if (String(envelope.envelopeVersion) !== envelopeVersion) {
    throw new Error('Email OTP wallet custody envelope version changed');
  }
  const envelopeRevision = Number(projection.envelopeRevision);
  if (!Number.isSafeInteger(envelopeRevision) || envelopeRevision < 1) {
    throw new Error('Email OTP wallet custody envelope revision is invalid');
  }
  if (envelopeRevision !== Number(envelope.envelopeRevision)) {
    throw new Error('Email OTP wallet custody envelope revision changed');
  }
  const storeVersion = readString(projection.storeVersion, 'walletCustody.storeVersion');
  const keyManifest = parseWalletCustodyUnlockKeyManifest(projection.keyManifest, walletId);
  if (!Array.isArray(projection.activeKeySetIds) || projection.activeKeySetIds.length === 0) {
    throw new Error('Email OTP wallet custody projection omitted active key sets');
  }
  const activeKeySetIds = projection.activeKeySetIds.map((value, index) =>
    readString(value, `walletCustody.activeKeySetIds[${index}]`),
  );
  if (
    new Set(activeKeySetIds).size !== activeKeySetIds.length ||
    activeKeySetIds.length !== keyManifest.entries.length ||
    activeKeySetIds.some(
      (keySetId) => !keyManifest.entries.some((entry) => entry.keySetId === keySetId),
    )
  ) {
    throw new Error('Email OTP wallet custody projection key sets are inconsistent');
  }
  return {
    kind: 'wallet_custody_email_otp_unlock_v1',
    walletId,
    enrollmentId,
    enrollmentSealKeyVersion,
    envelopeVersion,
    envelopeRevision,
    storeVersion,
    activeKeySetIds,
    keyManifest,
    envelope,
  };
}

function emailOtpEcdsaKeyManifestEntry(args: {
  material: EmailOtpUnlockSecretMaterialRequest;
  keyManifest: WalletCustodyUnlockKeyManifest;
}): Extract<WalletCustodyUnlockKeyManifestEntry, { kind: 'evm_family_ecdsa' }> {
  const keyHandle =
    args.material.kind === 'wallet_unlock_capabilities'
      ? args.material.ecdsa.sessionHandleBinding.keyHandle
      : args.material.kind === 'ecdsa'
        ? args.material.ecdsaSessionHandleBinding.keyHandle
        : '';
  const entry = args.keyManifest.entries.find(
    (
      candidate,
    ): candidate is Extract<WalletCustodyUnlockKeyManifestEntry, { kind: 'evm_family_ecdsa' }> =>
      candidate.kind === 'evm_family_ecdsa' && candidate.keyHandle === keyHandle,
  );
  if (!entry) {
    throw new Error('Email OTP wallet custody projection omitted the requested ECDSA key set');
  }
  return entry;
}

export function parseEmailOtpEcdsaCustodyContinuity(
  raw: unknown,
): EmailOtpEcdsaCustodyContinuityV1 {
  const continuity = asRecord(raw);
  if (!continuity || continuity.kind !== 'wallet_custody_ecdsa_sync_continuity_v1') {
    throw new Error('Email OTP unlock returned invalid ECDSA custody continuity');
  }
  if (!Array.isArray(continuity.signers) || continuity.signers.length === 0) {
    throw new Error('Email OTP unlock returned no ECDSA custody signers');
  }
  const signers: EmailOtpEcdsaCustodySignerV1[] = continuity.signers.map((rawSigner, index) => {
    const signer = asRecord(rawSigner);
    const walletKey = signer && asRecord(signer.walletKey);
    if (!signer || !walletKey) {
      throw new Error(`Email OTP ECDSA custody signer ${index} is invalid`);
    }
    const participantIds = walletKey.participantIds;
    if (
      !Array.isArray(participantIds) ||
      participantIds.length !== 2 ||
      participantIds[0] !== 1 ||
      participantIds[1] !== 2
    ) {
      throw new Error('Email OTP ECDSA custody participants are invalid');
    }
    return {
      chainTarget: parseWorkerChainTarget(signer.chainTarget),
      walletKey: {
        walletId: readString(walletKey.walletId, 'ecdsaCustody.walletKey.walletId'),
        keyHandle: readString(walletKey.keyHandle, 'ecdsaCustody.walletKey.keyHandle'),
        ecdsaThresholdKeyId: readString(
          walletKey.ecdsaThresholdKeyId,
          'ecdsaCustody.walletKey.ecdsaThresholdKeyId',
        ),
        signingRootId: readString(walletKey.signingRootId, 'ecdsaCustody.walletKey.signingRootId'),
        signingRootVersion: readString(
          walletKey.signingRootVersion,
          'ecdsaCustody.walletKey.signingRootVersion',
        ),
        relayerKeyId: readString(walletKey.relayerKeyId, 'ecdsaCustody.walletKey.relayerKeyId'),
        contextBinding32B64u: readString(
          walletKey.contextBinding32B64u,
          'ecdsaCustody.walletKey.contextBinding32B64u',
        ),
        derivationClientSharePublicKey33B64u: readString(
          walletKey.derivationClientSharePublicKey33B64u,
          'ecdsaCustody.walletKey.derivationClientSharePublicKey33B64u',
        ),
        participantIds: [1, 2],
        publicCapability: parseRouterAbEcdsaDerivationPublicCapabilityV1(
          walletKey.publicCapability,
        ),
      },
      activationReceipt: parseRouterAbEcdsaRegistrationActivationReceiptV1(
        signer.activationReceipt,
      ),
      runtimePolicyScope: parseWorkerRuntimePolicyScope(
        signer.runtimePolicyScope,
        'ecdsaCustody.runtimePolicyScope',
      ),
    };
  });
  return { kind: 'wallet_custody_ecdsa_sync_continuity_v1', signers };
}

function ethereumAddressFromEcdsaIdentityB64u(value: string): string {
  const address = base64UrlDecode(value);
  if (address.length !== 20) {
    throw new Error('Email OTP ECDSA activation returned an invalid Ethereum address');
  }
  return `0x${bytesToLowerHex(address)}`;
}

export async function restoreEmailOtpEcdsaMaterialFromCustody(args: {
  projection: EmailOtpWalletCustodyUnlockProjection;
  clientSecret32: Uint8Array;
  material: EmailOtpUnlockSecretMaterialRequest;
  continuity: EmailOtpEcdsaCustodyContinuityV1;
}): Promise<EmailOtpEcdsaCustodyRestoreV1> {
  const wire = joinCustodyWireFromEnvelopeRecord(args.projection.envelope);
  if (!wire.ok) throw new Error(`Email OTP wallet custody envelope is unusable: ${wire.reason}`);
  const keySet = emailOtpEcdsaKeyManifestEntry({
    material: args.material,
    keyManifest: args.projection.keyManifest,
  });
  await ensureWalletCustodyCeremonyWasm();
  const factorSecret32 = args.clientSecret32.slice();
  let seedHeld: WasmCeremonySeedHeldV1 | null = null;
  let prepared: WasmCeremonyProtocolPreparedV1 | null = null;
  let pending: WasmCeremonyEvmActivationPendingV1 | null = null;
  try {
    seedHeld = wallet_custody_ceremony_join_v1(factorSecret32, wire.custodyJson);
    prepared = seedHeld.prepare_evm_family(
      JSON.stringify({ applicationBindingDigestB64u: keySet.applicationBindingDigestB64u }),
    );
    seedHeld = null;
    const derivedPublicKey = prepared.ecdsa_client_share_public_key33_b64u();
    if (!derivedPublicKey || derivedPublicKey !== keySet.clientRootPublicKey33B64u) {
      throw new Error('Email OTP wallet custody ECDSA material does not match its key manifest');
    }
    const first = args.continuity.signers[0];
    if (!first || first.walletKey.keyHandle !== keySet.keyHandle) {
      throw new Error('Email OTP ECDSA custody continuity does not match the requested key set');
    }
    for (const signer of args.continuity.signers) {
      if (
        signer.walletKey.walletId !== args.projection.walletId ||
        signer.walletKey.keyHandle !== first.walletKey.keyHandle ||
        signer.walletKey.ecdsaThresholdKeyId !== first.walletKey.ecdsaThresholdKeyId ||
        signer.walletKey.signingRootId !== first.walletKey.signingRootId ||
        signer.walletKey.signingRootVersion !== first.walletKey.signingRootVersion ||
        signer.walletKey.relayerKeyId !== first.walletKey.relayerKeyId ||
        !sameRouterAbEcdsaDerivationPublicCapabilityV1(
          signer.walletKey.publicCapability,
          first.walletKey.publicCapability,
        ) ||
        !sameRouterAbEcdsaRegistrationActivationReceiptV1(
          signer.activationReceipt,
          first.activationReceipt,
        ) ||
        !sameRuntimePolicyScope(signer.runtimePolicyScope, first.runtimePolicyScope)
      ) {
        throw new Error('Email OTP ECDSA custody continuity conflicts across targets');
      }
    }
    const identity = first.activationReceipt.ecdsa_activation.public_identity;
    pending = prepared.prepare_evm_activation_joining_custody(
      keySet.evmFamilySigningKeySlotId,
      keySet.recordedKeyManifestDigestB64u,
    );
    prepared = null;
    const generatedCompletion: unknown = pending.complete(
      JSON.stringify({
        relayerKeyId: first.walletKey.relayerKeyId,
        relayerPublicKey33B64u: identity.server_public_key33_b64u,
        groupPublicKey33B64u: identity.threshold_public_key33_b64u,
        ethereumAddress: ethereumAddressFromEcdsaIdentityB64u(identity.ethereum_address20_b64u),
        relayerShareRetryCounter: identity.server_share_retry_counter,
      }),
    );
    pending = null;
    const completed = parseWalletCustodyEvmFamilyActivationCompletion(generatedCompletion);
    if (
      completed.walletId !== args.projection.walletId ||
      completed.keyManifestDigestB64u !== keySet.recordedKeyManifestDigestB64u ||
      completed.clientRootPublicKey33B64u !== keySet.clientRootPublicKey33B64u
    ) {
      throw new Error('Email OTP ECDSA custody activation changed its registered identity');
    }
    return {
      continuity: args.continuity,
      readyStateBlobB64u: completed.ecdsaReadyStateBlobB64u,
      publicFacts: completed.ecdsaPublicFacts,
    };
  } finally {
    factorSecret32.fill(0);
    prepared?.free();
    pending?.free();
    seedHeld?.free();
  }
}

export function walletCustodyActivationFactsFromEmailOtpBootstrap(
  bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1,
): WalletCustodyActivationFactsV1 {
  const capability = bootstrap.capability;
  const continuity = capability.registrationContinuity;
  return {
    materialActivation: capability.materialActivation,
    lifecycleId: capability.lifecycle.lifecycleId,
    signingRootVersion: capability.lifecycle.rootShareEpoch,
    signingRootId: capability.applicationBinding.signing_root_id,
    signerSetId: capability.lifecycle.signerSetId,
    thresholdSessionId: capability.lifecycle.thresholdSessionId,
    activationTranscriptB64u: base64UrlEncode(Uint8Array.from(continuity.activationTranscript)),
    activationCapabilityBindingB64u: base64UrlEncode(
      Uint8Array.from(capability.activeCapabilityBinding),
    ),
  };
}

type EmailOtpEd25519WalletCustodyRestoreResult =
  | {
      kind: 'opened';
      activeClientHandle: string;
      metadata: RouterAbEd25519YaoActiveClientMetadataV1;
    }
  | { kind: 'cache_absent' };

export async function restoreEmailOtpEd25519FromCustodyCache(args: {
  relayUrl: string;
  walletId: string;
  projection: EmailOtpWalletCustodyUnlockProjection;
  material:
    | Extract<EmailOtpUnlockSecretMaterialRequest, { kind: 'ed25519_yao_recovery' }>
    | EmailOtpEd25519OperationRecoveryMaterialRequest
    | Extract<EmailOtpUnlockSecretMaterialRequest, { kind: 'wallet_unlock_capabilities' }>;
  bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
  clientSecret32: Uint8Array;
}): Promise<EmailOtpEd25519WalletCustodyRestoreResult> {
  const cacheRequest =
    args.material.kind === 'wallet_unlock_capabilities'
      ? args.material.ed25519Yao.walletCustodyEd25519Material
      : args.material.walletCustodyEd25519Material;
  if (cacheRequest.kind === 'absent') {
    return { kind: 'cache_absent' };
  }
  const activeClient = await openWalletCustodyEd25519ActiveClientV1({
    material: cacheRequest.material,
    activation: walletCustodyActivationFactsFromEmailOtpBootstrap(args.bootstrap),
    envelope: walletCustodyCacheEnvelopeFromRecordV1(args.projection.envelope),
    ownedFactorSecret: args.clientSecret32.slice(),
  });
  try {
    const activated = storeEmailOtpEd25519YaoActiveClient(activeClient);
    return {
      kind: 'opened',
      activeClientHandle: activated.activeClientHandle,
      metadata: activated.metadata,
    };
  } catch (error) {
    activeClient.dispose();
    throw error;
  }
}

export function requireVerifiedEmailOtpAuthorityProjection(args: {
  raw: unknown;
  walletId: string;
  authoritySelector: EmailOtpAuthoritySelector;
}): EmailOtpVerifiedAuthorityProjection {
  const projection = parseEmailOtpVerifiedAuthorityProjection(args.raw);
  if (String(projection.authority.walletId) !== args.walletId) {
    throw new Error('Email OTP verified authority projection changed wallets');
  }
  if (
    args.authoritySelector.kind === 'wallet_auth_method' &&
    String(projection.authMethod.walletAuthMethodId) !==
      String(args.authoritySelector.walletAuthMethodId)
  ) {
    throw new Error('Email OTP verified authority projection changed auth methods');
  }
  return projection;
}
