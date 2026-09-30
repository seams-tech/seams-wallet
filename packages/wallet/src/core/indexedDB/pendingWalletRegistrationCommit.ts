import { sha256HexUtf8 } from '@shared/utils/digests';
import {
  parseRouterAbEd25519YaoRegistrationAdmissionRequestV1,
  parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1,
  sameRouterAbEd25519YaoActivationBindingV1,
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  parseEmailOtpChallengeId,
  parseEmailOtpProviderUserId,
  parseWalletAuthMethodId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  parseVerifiedEmailAddress,
  hasWhitespaceOrControlCharacters,
  parseMpcMaterialActivationRef,
  type WalletAuthMethodId,
  type WalletId,
  type EmailOtpChallengeId,
  type EmailOtpProviderUserId,
  type VerifiedEmailAddress,
  type WebAuthnCredentialIdB64u,
  type WebAuthnRpId,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import {
  parseCorrelationId,
  parseDigestB64u,
  type CorrelationId,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import {
  isEmailOtpWalletAuthAuthority,
  isPasskeyWalletAuthAuthority,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import {
  type EstablishedCustodyRecordsPayload,
  type RecoveryReplacementEnvelopePayload,
  type WalletCustodyCeremonyCommitPayload,
  type WalletCustodyCeremonyRecoveryWrapPayload,
  type WalletCustodyEvmFamilyPublicFacts,
  type WalletCustodyRecoveryCodeLocatorPayload,
} from '@shared/passkey-custody';
import type { WalletEmailOtpEnrollmentMaterialV1 } from '@shared/utils/registrationAuthMethodInput';
import type { RouterAbEd25519YaoBytes32V1 } from '@shared/utils/routerAbEd25519Yao';
import {
  parseRouterAbEcdsaVerifiedClientActivationFactsV1,
  type RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  wireLiteral,
  wireObject,
  wireResult,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
  type WireParser,
} from '@shared/utils/wireSchema';

type PendingWalletRegistrationEcdsaReplayV1 = {
  readonly activationJournalId: CorrelationId;
  readonly clientActivation: RouterAbEcdsaVerifiedClientActivationFactsV1;
  readonly activationRequestDigestB64u: DigestB64u;
};

/**
 * The local registration journal entry written before a terminal request.
 *
 * This record deliberately contains request identities and sealed local
 * material only. A Wallet Session token, operation credential, and terminal
 * response are not part of the record and cannot be reconstructed from it.
 */
export type PendingWalletRegistrationCommitAuthV1 =
  | {
      readonly kind: 'passkey';
      readonly rpId: WebAuthnRpId;
      readonly credentialIdB64u: WebAuthnCredentialIdB64u;
      readonly transports: readonly string[];
    }
  | {
      readonly kind: 'email_otp';
      readonly email: VerifiedEmailAddress;
      readonly registrationAuthorityId: EmailOtpChallengeId;
      readonly providerSubject: EmailOtpProviderUserId;
      /** Sealed server factor material needed to retry Route 4 after reload. */
      readonly enrollment: WalletEmailOtpEnrollmentMaterialV1;
    };

export type PendingWalletRegistrationActivationReferenceV1 = {
  readonly kind: 'router_ab_ed25519_yao_activation_reference_v1';
  readonly lifecycle_id: string;
  readonly session_id: RouterAbEd25519YaoBytes32V1;
};

type PendingWalletRegistrationEd25519LocalMaterialV1 = {
  readonly activationReference: PendingWalletRegistrationActivationReferenceV1;
  readonly localMaterial: {
    readonly b64u: string;
    readonly nonceB64u: string;
    readonly applicationBindingDigestB64u: string;
  };
  readonly metadata: PendingWalletRegistrationEd25519MetadataV1;
};

type PendingWalletRegistrationMixedEd25519LocalMaterialV1 =
  PendingWalletRegistrationEd25519LocalMaterialV1 & {
    readonly custodyCommit: PendingWalletRegistrationNearCustodyCommitV1;
  };

type PendingWalletRegistrationCustodyCommitV1 =
  | (WalletCustodyCeremonyCommitPayload & { readonly keySet: 'near_ed25519_v1' })
  | (WalletCustodyCeremonyCommitPayload & { readonly keySet: 'evm_family_ecdsa_v1' });

type PendingWalletRegistrationNearCustodyCommitV1 = Extract<
  PendingWalletRegistrationCustodyCommitV1,
  { readonly keySet: 'near_ed25519_v1' }
>;

type PendingWalletRegistrationEcdsaCustodyCommitV1 = Extract<
  PendingWalletRegistrationCustodyCommitV1,
  { readonly keySet: 'evm_family_ecdsa_v1' }
>;

export type PendingWalletRegistrationEd25519MetadataV1 = {
  readonly materialActivation: MpcMaterialActivationRef;
  readonly registeredPublicKeyB64u: string;
  readonly signingWorkerVerifyingShareB64u: string;
  readonly stateEpoch: string;
  readonly signingWorkerId: string;
  readonly participantIds: readonly [number, number];
  readonly nearEd25519SigningKeyId: string;
  readonly signerSlot: number;
};

export type PendingWalletRegistrationLocalMaterialV1 =
  | {
      readonly keyFamilies: readonly ['ecdsa_secp256k1'];
      readonly custodyCommit: PendingWalletRegistrationEcdsaCustodyCommitV1;
      readonly ecdsa: PendingWalletRegistrationEcdsaReplayV1;
      readonly ed25519?: never;
      readonly activationReference?: never;
    }
  | {
      readonly keyFamilies: readonly ['ed25519'];
      readonly custodyCommit: PendingWalletRegistrationNearCustodyCommitV1;
      readonly ed25519: PendingWalletRegistrationEd25519LocalMaterialV1;
      readonly ecdsa?: never;
      readonly activationReference?: never;
    };

type PersistedMixedRegistrationMaterialV1 = {
  readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'];
  readonly custodyCommit: PendingWalletRegistrationEcdsaCustodyCommitV1;
  readonly ed25519: PendingWalletRegistrationMixedEd25519LocalMaterialV1;
  readonly ecdsa: PendingWalletRegistrationEcdsaReplayV1;
  readonly activationReference?: never;
};

type PendingWalletRegistrationSignerPlanKind =
  | 'near_ed25519'
  | 'evm_family_ecdsa'
  | 'near_ed25519_and_evm_family_ecdsa';

type PendingWalletRegistrationCommitCommonV1 = {
  readonly kind: 'pending_wallet_registration_commit_v1';
  readonly registrationCeremonyId: string;
  readonly idempotencyKey: string;
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly signedSetup: string;
  readonly auth: PendingWalletRegistrationCommitAuthV1;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

type PendingWalletRegistrationEd25519LocalMaterialBranchV1 = Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ed25519'] }
>;

export type PendingWalletRegistrationCommitV1 =
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'registration_activate';
      readonly phase?: never;
      readonly completion?: never;
      readonly admissionRequest?: never;
      readonly admissionReceipt?: never;
      readonly baseCustodyCommit?: never;
      readonly checkpointJson?: never;
      readonly signerPlanKind: 'near_ed25519';
      readonly localMaterial: PendingWalletRegistrationEd25519LocalMaterialBranchV1;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'registration_activate';
      readonly phase?: never;
      readonly completion?: never;
      readonly admissionRequest?: never;
      readonly admissionReceipt?: never;
      readonly baseCustodyCommit?: never;
      readonly checkpointJson?: never;
      readonly signerPlanKind: 'evm_family_ecdsa';
      readonly localMaterial: Extract<
        PendingWalletRegistrationLocalMaterialV1,
        { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
      >;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'registration_activate';
      readonly phase?: never;
      readonly completion?: never;
      readonly admissionRequest?: never;
      readonly admissionReceipt?: never;
      readonly baseCustodyCommit?: never;
      readonly checkpointJson?: never;
      readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
      readonly localMaterial: Extract<
        PendingWalletRegistrationLocalMaterialV1,
        { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
      >;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'near_provisioning';
      readonly phase: 'joined';
      readonly completion: NearRegistrationCompletion;
      readonly admissionRequest?: never;
      readonly admissionReceipt?: never;
      readonly baseCustodyCommit?: never;
      readonly checkpointJson?: never;
      readonly signerPlanKind: 'near_ed25519' | 'near_ed25519_and_evm_family_ecdsa';
      readonly localMaterial: PendingWalletRegistrationEd25519LocalMaterialBranchV1;
    })
  | PendingNearRegistrationContinuationV1;

export type NearRegistrationCompletion =
  | { readonly kind: 'sealed_material'; readonly prepared?: never }
  | {
      readonly kind: 'encrypted_checkpoint';
      readonly prepared: Extract<
        PendingNearRegistrationContinuationV1,
        { readonly phase: 'execution_prepared' }
      >;
    };

export type PendingNearRegistrationContinuationV1 = PendingWalletRegistrationCommitCommonV1 & {
  readonly operation: 'near_provisioning';
  readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
  readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  readonly baseCustodyCommit: PendingWalletRegistrationEcdsaCustodyCommitV1;
  readonly localMaterial?: never;
  readonly completion?: never;
} & (
    | {
        readonly phase: 'planned';
        readonly admissionReceipt?: never;
        readonly checkpointJson?: never;
      }
    | {
        readonly phase: 'execution_prepared';
        readonly admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
        readonly checkpointJson: string;
      }
  );

function pendingRegistrationIdentity(
  record: PendingWalletRegistrationCommitCommonV1,
): PendingWalletRegistrationCommitCommonV1 {
  return {
    kind: record.kind,
    registrationCeremonyId: record.registrationCeremonyId,
    idempotencyKey: record.idempotencyKey,
    walletId: record.walletId,
    walletAuthMethodId: record.walletAuthMethodId,
    signedSetup: record.signedSetup,
    auth: record.auth,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
  };
}

export function planPendingNearRegistration(
  activation: Extract<
    PendingWalletRegistrationCommitV1,
    {
      readonly operation: 'registration_activate';
      readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
    }
  >,
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
): Extract<PendingNearRegistrationContinuationV1, { readonly phase: 'planned' }> {
  if (admissionRequest.application_binding.wallet_id !== activation.walletId)
    throw new Error('NEAR continuation wallet mismatch');
  return {
    ...pendingRegistrationIdentity(activation),
    operation: 'near_provisioning',
    signerPlanKind: activation.signerPlanKind,
    phase: 'planned',
    admissionRequest,
    baseCustodyCommit: activation.localMaterial.custodyCommit,
  };
}

function validNearRegistrationCheckpoint(
  checkpointJson: string,
  receipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>,
  admission: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
): boolean {
  try {
    const fields = decodeJournalObject(JSON.parse(checkpointJson), [
      'executeRequestJson',
      'applicationBindingDigestB64u',
      'nonceB64u',
      'ciphertextB64u',
    ]);
    if (!fields) return false;
    const executeJson = parseCanonicalString(fields.get('executeRequestJson'));
    if (
      !executeJson ||
      !parseCanonicalString(fields.get('applicationBindingDigestB64u')) ||
      !parseCanonicalString(fields.get('nonceB64u')) ||
      !parseCanonicalString(fields.get('ciphertextB64u'))
    )
      return false;
    const execute = parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1(
      JSON.parse(executeJson),
    );
    return (
      execute.ok &&
      sameRouterAbEd25519YaoActivationBindingV1(execute.value.binding, receipt.binding) &&
      receipt.binding.lifecycle.lifecycle_id === admission.scope.lifecycle_id &&
      receipt.binding.lifecycle.account_id === admission.scope.account_id
    );
  } catch {
    return false;
  }
}

export function preparePendingNearRegistration(
  planned: Extract<PendingNearRegistrationContinuationV1, { readonly phase: 'planned' }>,
  admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>,
  checkpointJson: string,
): Extract<PendingNearRegistrationContinuationV1, { readonly phase: 'execution_prepared' }> {
  if (
    !validNearRegistrationCheckpoint(checkpointJson, admissionReceipt, planned.admissionRequest)
  ) {
    throw new Error('Invalid NEAR registration execution checkpoint');
  }
  return {
    ...pendingRegistrationIdentity(planned),
    operation: 'near_provisioning',
    signerPlanKind: planned.signerPlanKind,
    phase: 'execution_prepared',
    admissionRequest: planned.admissionRequest,
    baseCustodyCommit: planned.baseCustodyCommit,
    admissionReceipt,
    checkpointJson,
    updatedAtMs: Math.max(Date.now(), planned.updatedAtMs),
  };
}

export type PendingWalletRegistrationCommitStorageRow = {
  readonly registration_ceremony_id: string;
  readonly operation: PendingWalletRegistrationCommitV1['operation'];
  readonly wallet_id: WalletId;
  readonly wallet_auth_method_id: WalletAuthMethodId;
  readonly updated_at_ms: number;
  readonly record: PendingWalletRegistrationCommitV1;
};

const PENDING_WALLET_REGISTRATION_COMMIT_APP_STATE_PREFIX =
  'pending_wallet_registration_commit_v1:';

export function pendingWalletRegistrationCommitAppStateKey(input: {
  readonly registrationCeremonyId: string;
  readonly operation: PendingWalletRegistrationCommitV1['operation'];
}): string {
  return `${PENDING_WALLET_REGISTRATION_COMMIT_APP_STATE_PREFIX}${input.registrationCeremonyId}:${input.operation}`;
}

export function toPendingWalletRegistrationCommitAppStateRow(
  record: PendingWalletRegistrationCommitV1,
): { readonly key: string; readonly value: PendingWalletRegistrationCommitStorageRow } {
  const storageRow = toPendingWalletRegistrationCommitStorageRow(record);
  return {
    key: pendingWalletRegistrationCommitAppStateKey({
      registrationCeremonyId: storageRow.registration_ceremony_id,
      operation: storageRow.operation,
    }),
    value: storageRow,
  };
}

export function parsePendingWalletRegistrationCommitAppStateRow(
  raw: unknown,
): PendingWalletRegistrationCommitStorageRow | null {
  const fields = decodeJournalObject(raw, ['key', 'value']);
  if (!fields) return null;
  const key = fields.get('key');
  if (
    typeof key !== 'string' ||
    !key.startsWith(PENDING_WALLET_REGISTRATION_COMMIT_APP_STATE_PREFIX)
  ) {
    return null;
  }
  const parsed = parsePendingWalletRegistrationCommitStorageRow(fields.get('value'));
  if (!parsed) return null;
  return pendingWalletRegistrationCommitAppStateKey({
    registrationCeremonyId: parsed.registration_ceremony_id,
    operation: parsed.operation,
  }) === key
    ? parsed
    : null;
}

/** Split the retired mixed row at the persistence boundary before exposing core state. */
export async function splitPersistedMixedRegistrationRow(raw: unknown): Promise<{
  readonly original: unknown;
  readonly activation: PendingWalletRegistrationCommitV1;
  readonly near: Extract<
    PendingWalletRegistrationCommitV1,
    { readonly operation: 'near_provisioning'; readonly phase: 'joined' }
  >;
} | null> {
  const storage = readJournalField(raw, 'value');
  const record = readJournalField(storage, 'record');
  const fields = decodeJournalObject(record, [
    'kind',
    'operation',
    'signerPlanKind',
    'registrationCeremonyId',
    'idempotencyKey',
    'walletId',
    'walletAuthMethodId',
    'signedSetup',
    'auth',
    'createdAtMs',
    'updatedAtMs',
    'localMaterial',
  ]);
  if (
    !fields ||
    fields.get('operation') !== 'registration_activate' ||
    fields.get('signerPlanKind') !== 'near_ed25519_and_evm_family_ecdsa'
  )
    return null;
  const material = parsePendingLocalMaterial(fields.get('localMaterial'));
  if (!material || !isMixedLocalMaterial(material)) return null;
  const activation = parsePendingWalletRegistrationCommitV1({
    ...Object.fromEntries(fields),
    localMaterial: {
      keyFamilies: ['ecdsa_secp256k1'],
      custodyCommit: material.custodyCommit,
      ecdsa: material.ecdsa,
    },
  });
  if (!activation || activation.operation !== 'registration_activate') return null;
  if (
    readJournalField(raw, 'key') !== pendingWalletRegistrationCommitAppStateKey(activation) ||
    readJournalField(storage, 'wallet_id') !== activation.walletId ||
    readJournalField(storage, 'wallet_auth_method_id') !== activation.walletAuthMethodId ||
    readJournalField(storage, 'registration_ceremony_id') !== activation.registrationCeremonyId ||
    readJournalField(storage, 'operation') !== activation.operation ||
    readJournalField(storage, 'updated_at_ms') !== activation.updatedAtMs
  )
    return null;
  const reference = material.ed25519.activationReference;
  const digest = await sha256HexUtf8(
    [
      'wallet-registration-near-provisioning',
      activation.registrationCeremonyId,
      reference.lifecycle_id,
      reference.session_id.map(byteToHex).join(''),
    ].join(':'),
  );
  const near = parsePendingWalletRegistrationCommitV1({
    ...pendingRegistrationIdentity(activation),
    operation: 'near_provisioning',
    phase: 'joined',
    signerPlanKind: activation.signerPlanKind,
    idempotencyKey: `wallet-registration-near-provisioning:${digest}`,
    localMaterial: {
      keyFamilies: ['ed25519'],
      custodyCommit: material.ed25519.custodyCommit,
      ed25519: {
        activationReference: reference,
        localMaterial: material.ed25519.localMaterial,
        metadata: material.ed25519.metadata,
      },
    },
  });
  if (!near || near.operation !== 'near_provisioning' || near.phase !== 'joined') return null;
  return { original: raw, activation, near };
}

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

export function buildPendingWalletRegistrationCommitV1(
  input: PendingWalletRegistrationCommitV1,
): PendingWalletRegistrationCommitV1 {
  return input;
}

export function toPendingWalletRegistrationCommitStorageRow(
  record: PendingWalletRegistrationCommitV1,
): PendingWalletRegistrationCommitStorageRow {
  const parsed = buildPendingWalletRegistrationCommitV1(record);
  return {
    registration_ceremony_id: parsed.registrationCeremonyId,
    operation: parsed.operation,
    wallet_id: parsed.walletId,
    wallet_auth_method_id: parsed.walletAuthMethodId,
    updated_at_ms: parsed.updatedAtMs,
    record: parsed,
  };
}

export function parsePendingWalletRegistrationCommitStorageRow(
  raw: unknown,
): PendingWalletRegistrationCommitStorageRow | null {
  const fields = decodeJournalObject(raw, [
    'registration_ceremony_id',
    'operation',
    'wallet_id',
    'wallet_auth_method_id',
    'updated_at_ms',
    'record',
  ]);
  if (!fields) return null;
  const record = parsePendingWalletRegistrationCommitV1(fields.get('record'));
  if (!record) return null;
  if (
    fields.get('registration_ceremony_id') !== record.registrationCeremonyId ||
    fields.get('operation') !== record.operation ||
    fields.get('wallet_id') !== record.walletId ||
    fields.get('wallet_auth_method_id') !== record.walletAuthMethodId ||
    fields.get('updated_at_ms') !== record.updatedAtMs
  ) {
    return null;
  }
  return {
    registration_ceremony_id: record.registrationCeremonyId,
    operation: record.operation,
    wallet_id: record.walletId,
    wallet_auth_method_id: record.walletAuthMethodId,
    updated_at_ms: record.updatedAtMs,
    record,
  };
}

/** Parse raw IndexedDB data into the one supported pending-registration state. */
export function parsePendingWalletRegistrationCommitV1(
  raw: unknown,
): PendingWalletRegistrationCommitV1 | null {
  const fields = decodeJournalObjectWithAllowedKeys(raw, [
    'kind',
    'operation',
    'signerPlanKind',
    'registrationCeremonyId',
    'idempotencyKey',
    'walletId',
    'walletAuthMethodId',
    'signedSetup',
    'auth',
    'localMaterial',
    'phase',
    'admissionRequest',
    'admissionReceipt',
    'baseCustodyCommit',
    'checkpointJson',
    'completion',
    'createdAtMs',
    'updatedAtMs',
  ]);
  if (!fields || fields.get('kind') !== 'pending_wallet_registration_commit_v1') return null;
  if (fields.has('completion') && fields.get('phase') !== 'joined') return null;
  const operation = parsePendingOperation(fields.get('operation'));
  const signerPlanKind = parsePendingSignerPlanKind(fields.get('signerPlanKind'));
  const registrationCeremonyId = parseCanonicalString(fields.get('registrationCeremonyId'));
  const idempotencyKey = parseCanonicalString(fields.get('idempotencyKey'));
  const signedSetup = parseCanonicalString(fields.get('signedSetup'));
  const walletId = parseWalletId(fields.get('walletId'));
  const walletAuthMethodId = parseWalletAuthMethodId(fields.get('walletAuthMethodId'));
  const auth = readJournalRecord(pendingAuthV1(), fields.get('auth'));
  const localMaterial = parsePendingLocalMaterial(fields.get('localMaterial'));
  const createdAtMs = parsePositiveSafeInteger(fields.get('createdAtMs'));
  const updatedAtMs = parsePositiveSafeInteger(fields.get('updatedAtMs'));
  if (
    (operation !== 'registration_activate' && operation !== 'near_provisioning') ||
    signerPlanKind === null ||
    registrationCeremonyId === null ||
    idempotencyKey === null ||
    signedSetup === null ||
    !walletId.ok ||
    !walletAuthMethodId.ok ||
    !auth ||
    createdAtMs === null ||
    updatedAtMs === null ||
    updatedAtMs < createdAtMs
  ) {
    return null;
  }
  const common: PendingWalletRegistrationCommitCommonV1 = {
    kind: 'pending_wallet_registration_commit_v1',
    registrationCeremonyId,
    idempotencyKey,
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    signedSetup,
    auth,
    createdAtMs,
    updatedAtMs,
  };
  const phase = fields.get('phase');
  if (
    operation === 'near_provisioning' &&
    (phase === 'planned' || phase === 'execution_prepared')
  ) {
    const admission = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
      fields.get('admissionRequest'),
    );
    const base = parseCustodyCommit(fields.get('baseCustodyCommit'));
    if (
      signerPlanKind !== 'near_ed25519_and_evm_family_ecdsa' ||
      fields.has('localMaterial') ||
      !admission.ok ||
      admission.value.application_binding.wallet_id !== walletId.value ||
      !base ||
      base.keySet !== 'evm_family_ecdsa_v1' ||
      base.walletId !== walletId.value ||
      !base.establishedCustody
    )
      return null;
    if (phase === 'planned') {
      if (fields.has('admissionReceipt') || fields.has('checkpointJson')) return null;
      return {
        ...common,
        operation,
        signerPlanKind,
        phase,
        admissionRequest: admission.value,
        baseCustodyCommit: { ...base, keySet: 'evm_family_ecdsa_v1' },
      };
    }
    const receipt = parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1(
      fields.get('admissionReceipt'),
    );
    const checkpointJson = parseCanonicalString(fields.get('checkpointJson'));
    if (
      !receipt.ok ||
      !checkpointJson ||
      !validNearRegistrationCheckpoint(checkpointJson, receipt.value, admission.value)
    )
      return null;
    return {
      ...common,
      operation,
      signerPlanKind,
      phase,
      admissionRequest: admission.value,
      baseCustodyCommit: { ...base, keySet: 'evm_family_ecdsa_v1' },
      admissionReceipt: receipt.value,
      checkpointJson,
    };
  }
  if (!localMaterial || localMaterial.custodyCommit.walletId !== walletId.value) return null;
  if (
    fields.has('admissionRequest') ||
    fields.has('admissionReceipt') ||
    fields.has('baseCustodyCommit') ||
    fields.has('checkpointJson')
  )
    return null;
  if (
    isMixedLocalMaterial(localMaterial) &&
    localMaterial.ed25519.custodyCommit.walletId !== walletId.value
  ) {
    return null;
  }
  if (operation === 'registration_activate') {
    if (phase !== undefined) return null;
    if (signerPlanKind === 'near_ed25519') {
      return isEd25519LocalMaterial(localMaterial)
        ? {
            kind: 'pending_wallet_registration_commit_v1',
            operation,
            signerPlanKind,
            registrationCeremonyId,
            idempotencyKey,
            walletId: walletId.value,
            walletAuthMethodId: walletAuthMethodId.value,
            signedSetup,
            auth,
            localMaterial,
            createdAtMs,
            updatedAtMs,
          }
        : null;
    }
    if (signerPlanKind === 'evm_family_ecdsa') {
      return isEcdsaOnlyLocalMaterial(localMaterial)
        ? {
            kind: 'pending_wallet_registration_commit_v1',
            operation,
            signerPlanKind,
            registrationCeremonyId,
            idempotencyKey,
            walletId: walletId.value,
            walletAuthMethodId: walletAuthMethodId.value,
            signedSetup,
            auth,
            localMaterial,
            createdAtMs,
            updatedAtMs,
          }
        : null;
    }
    if (isEcdsaOnlyLocalMaterial(localMaterial)) {
      return {
        kind: 'pending_wallet_registration_commit_v1',
        operation,
        signerPlanKind,
        registrationCeremonyId,
        idempotencyKey,
        walletId: walletId.value,
        walletAuthMethodId: walletAuthMethodId.value,
        signedSetup,
        auth,
        localMaterial,
        createdAtMs,
        updatedAtMs,
      };
    }
    return null;
  }
  if (operation === 'near_provisioning') {
    if (phase !== undefined && phase !== 'joined') return null;
    if (
      signerPlanKind !== 'near_ed25519' &&
      signerPlanKind !== 'near_ed25519_and_evm_family_ecdsa'
    ) {
      return null;
    }
    if (!isEd25519LocalMaterial(localMaterial)) return null;
    let completion: NearRegistrationCompletion = { kind: 'sealed_material' };
    const completionRaw = fields.get('completion');
    if (completionRaw !== undefined) {
      const completionFields = decodeJournalObjectWithAllowedKeys(completionRaw, [
        'kind',
        'prepared',
      ]);
      if (!completionFields) return null;
      switch (completionFields.get('kind')) {
        case 'sealed_material':
          if (completionFields.has('prepared')) return null;
          break;
        case 'encrypted_checkpoint': {
          const preparedRaw = completionFields.get('prepared');
          // Check the leaf phase before parsing, so persisted input cannot recurse.
          if (readJournalField(preparedRaw, 'phase') !== 'execution_prepared') return null;
          const prepared = parsePendingWalletRegistrationCommitV1(preparedRaw);
          if (
            !prepared ||
            prepared.phase !== 'execution_prepared' ||
            prepared.registrationCeremonyId !== registrationCeremonyId ||
            prepared.walletId !== walletId.value ||
            prepared.walletAuthMethodId !== walletAuthMethodId.value ||
            prepared.signedSetup !== signedSetup ||
            signerPlanKind !== prepared.signerPlanKind
          )
            return null;
          completion = { kind: 'encrypted_checkpoint', prepared };
          break;
        }
        default:
          return null;
      }
    }
    return {
      kind: 'pending_wallet_registration_commit_v1',
      operation,
      phase: 'joined',
      completion,
      signerPlanKind,
      registrationCeremonyId,
      idempotencyKey,
      walletId: walletId.value,
      walletAuthMethodId: walletAuthMethodId.value,
      signedSetup,
      auth,
      localMaterial,
      createdAtMs,
      updatedAtMs,
    };
  }
  return null;
}

/**
 * A terminal projection may be used only with the exact pending operation and
 * founding method. This is intentionally independent of bearer issuance.
 */
export function assertPendingWalletRegistrationIdentity(
  pending: PendingWalletRegistrationCommitV1,
  projection: {
    readonly operation: PendingWalletRegistrationCommitV1['operation'];
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly authority: WalletAuthAuthority;
  },
): void {
  if (
    pending.operation !== projection.operation ||
    pending.walletId !== projection.walletId ||
    pending.walletAuthMethodId !== projection.walletAuthMethodId ||
    projection.authority.walletId !== pending.walletId ||
    projection.authority.bindingId !== pending.walletAuthMethodId
  ) {
    throw new Error('pending wallet registration commit identity does not match projection');
  }
  if (pending.auth.kind === 'passkey') {
    if (
      !isPasskeyWalletAuthAuthority(projection.authority) ||
      projection.authority.factor.credentialIdB64u !== pending.auth.credentialIdB64u ||
      projection.authority.verifier.rpId !== pending.auth.rpId
    ) {
      throw new Error('pending passkey registration authority does not match projection');
    }
    return;
  }
  if (!isEmailOtpWalletAuthAuthority(projection.authority)) {
    throw new Error('pending Email OTP registration authority does not match projection');
  }
  if (
    projection.authority.factor.providerUserId !== pending.auth.providerSubject ||
    projection.authority.verifier.emailHashHex.length === 0
  ) {
    throw new Error('pending Email OTP registration factor does not match projection');
  }
}

function parsePendingOperation(
  value: unknown,
): PendingWalletRegistrationCommitV1['operation'] | null {
  return value === 'registration_activate' || value === 'near_provisioning' ? value : null;
}

function parsePendingSignerPlanKind(
  value: unknown,
): PendingWalletRegistrationSignerPlanKind | null {
  return value === 'near_ed25519' ||
    value === 'evm_family_ecdsa' ||
    value === 'near_ed25519_and_evm_family_ecdsa'
    ? value
    : null;
}

function pendingAuthV1() {
  return wireUnion('kind', [
    wireObject({
      kind: wireLiteral('passkey'),
      rpId: wireResult(parseWebAuthnRpId),
      credentialIdB64u: wireResult(parseWebAuthnCredentialIdB64u),
      transports: journalField(parseCanonicalStringArray),
    }),
    wireObject({
      kind: wireLiteral('email_otp'),
      email: wireResult(parseVerifiedEmailAddress),
      registrationAuthorityId: wireResult(parseEmailOtpChallengeId),
      providerSubject: wireResult(parseEmailOtpProviderUserId),
      enrollment: emailOtpEnrollmentMaterialV1(),
    }),
  ]);
}

function parseCanonicalStringArray(raw: unknown): readonly string[] | null {
  const valuesRaw = decodeJournalArray(raw);
  if (!valuesRaw) return null;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of valuesRaw) {
    const parsed = parseCanonicalString(value);
    if (parsed === null || seen.has(parsed)) return null;
    seen.add(parsed);
    values.push(parsed);
  }
  return values;
}

function emailOtpEnrollmentMaterialV1() {
  const text = journalField(parseCanonicalString);
  return wireObject({
    enrollmentSealKeyVersion: text,
    serverSealedFactorCiphertextB64u: text,
    clientUnlockPublicKeyB64u: text,
    unlockKeyVersion: text,
  });
}

function parsePendingLocalMaterial(
  raw: unknown,
): PendingWalletRegistrationLocalMaterialV1 | PersistedMixedRegistrationMaterialV1 | null {
  const keyFamilies = decodeJournalArray(readJournalField(raw, 'keyFamilies'));
  if (!keyFamilies) return null;
  if (keyFamilies.length === 1 && keyFamilies[0] === 'ecdsa_secp256k1') {
    const fields = decodeJournalObject(raw, ['keyFamilies', 'custodyCommit', 'ecdsa']);
    if (!fields) return null;
    const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
    const ecdsa = readJournalRecord(ecdsaReplayV1(), fields.get('ecdsa'));
    return custodyCommit && isCustodyCommitForKeySet(custodyCommit, 'evm_family_ecdsa_v1') && ecdsa
      ? { keyFamilies: ['ecdsa_secp256k1'], custodyCommit, ecdsa }
      : null;
  }
  if (keyFamilies.length === 1 && keyFamilies[0] === 'ed25519') {
    const fields = decodeJournalObject(raw, ['keyFamilies', 'custodyCommit', 'ed25519']);
    if (!fields) return null;
    const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
    const ed25519 = readJournalRecord(ed25519LocalMaterialV1(), fields.get('ed25519'));
    return custodyCommit && isCustodyCommitForKeySet(custodyCommit, 'near_ed25519_v1') && ed25519
      ? { keyFamilies: ['ed25519'], custodyCommit, ed25519 }
      : null;
  }
  if (
    keyFamilies.length === 2 &&
    keyFamilies[0] === 'ed25519' &&
    keyFamilies[1] === 'ecdsa_secp256k1'
  ) {
    const fields = decodeJournalObject(raw, ['keyFamilies', 'custodyCommit', 'ed25519', 'ecdsa']);
    if (!fields) return null;
    const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
    const ed25519 = readJournalRecord(mixedEd25519LocalMaterialV1(), fields.get('ed25519'));
    const ecdsa = readJournalRecord(ecdsaReplayV1(), fields.get('ecdsa'));
    return custodyCommit &&
      isCustodyCommitForKeySet(custodyCommit, 'evm_family_ecdsa_v1') &&
      ed25519 &&
      ecdsa
      ? { keyFamilies: ['ed25519', 'ecdsa_secp256k1'], custodyCommit, ed25519, ecdsa }
      : null;
  }
  return null;
}

function isEd25519LocalMaterial(
  localMaterial: PendingWalletRegistrationLocalMaterialV1 | PersistedMixedRegistrationMaterialV1,
): localMaterial is Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ed25519'] }
> {
  return localMaterial.keyFamilies.length === 1 && localMaterial.keyFamilies[0] === 'ed25519';
}

function isEcdsaOnlyLocalMaterial(
  localMaterial: PendingWalletRegistrationLocalMaterialV1 | PersistedMixedRegistrationMaterialV1,
): localMaterial is Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
> {
  return (
    localMaterial.keyFamilies.length === 1 && localMaterial.keyFamilies[0] === 'ecdsa_secp256k1'
  );
}

function isMixedLocalMaterial(
  localMaterial: PendingWalletRegistrationLocalMaterialV1 | PersistedMixedRegistrationMaterialV1,
): localMaterial is PersistedMixedRegistrationMaterialV1 {
  return (
    localMaterial.keyFamilies.length === 2 &&
    localMaterial.keyFamilies[0] === 'ed25519' &&
    localMaterial.keyFamilies[1] === 'ecdsa_secp256k1'
  );
}

function ed25519LocalMaterialFields() {
  const text = journalField(parseCanonicalString);
  return {
    activationReference: activationReferenceV1(),
    localMaterial: wireObject({ b64u: text, nonceB64u: text, applicationBindingDigestB64u: text }),
    metadata: ed25519MetadataV1(),
  };
}

function ed25519LocalMaterialV1() {
  return wireObject(ed25519LocalMaterialFields());
}

function mixedEd25519LocalMaterialV1() {
  return wireObject({
    ...ed25519LocalMaterialFields(),
    custodyCommit: journalField((raw) => {
      const custodyCommit = parseCustodyCommit(raw);
      return custodyCommit && isCustodyCommitForKeySet(custodyCommit, 'near_ed25519_v1')
        ? custodyCommit
        : null;
    }),
  });
}

function ed25519MetadataV1() {
  const text = journalField(parseCanonicalString);
  return wireObject({
    materialActivation: wireResult(parseMpcMaterialActivationRef),
    registeredPublicKeyB64u: text,
    signingWorkerVerifyingShareB64u: text,
    stateEpoch: journalField(parseCanonicalStateEpoch),
    signingWorkerId: text,
    participantIds: (raw, label): readonly [number, number] => {
      const ids = decodeJournalArray(raw);
      if (!ids || ids.length !== 2 || ids.some((id) => parsePositiveSafeInteger(id) === null)) {
        throw new Error(`${label} is invalid`);
      }
      return [Number(ids[0]), Number(ids[1])];
    },
    nearEd25519SigningKeyId: text,
    signerSlot: journalField(parsePositiveSafeInteger),
  });
}

function ecdsaReplayV1() {
  return wireObject({
    activationJournalId: parseCorrelationId,
    clientActivation: parseRouterAbEcdsaVerifiedClientActivationFactsV1,
    activationRequestDigestB64u: parseDigestB64u,
  });
}

function ecdsaPublicFactsV1() {
  const text = journalField(parseCanonicalString);
  const retryCounter = (raw: unknown, label: string): number => {
    if (!Number.isSafeInteger(raw) || Number(raw) < 0) throw new Error(`${label} is invalid`);
    return Number(raw);
  };
  return wireObject({
    contextBinding32B64u: text,
    derivationClientSharePublicKey33B64u: text,
    clientVerifyingShare33B64u: text,
    relayerPublicKey33B64u: text,
    groupPublicKey33B64u: text,
    ethereumAddress: text,
    clientShareRetryCounter: retryCounter,
    relayerShareRetryCounter: retryCounter,
  });
}

function activationReferenceV1() {
  return wireObject({
    kind: wireLiteral('router_ab_ed25519_yao_activation_reference_v1'),
    lifecycle_id: journalField(parseCanonicalString),
    session_id: (raw, label): RouterAbEd25519YaoBytes32V1 => {
      const values = decodeJournalArray(raw);
      if (!values || values.length !== 32) throw new Error(`${label} is invalid`);
      const sessionId: number[] = [];
      for (const value of values) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
          throw new Error(`${label} is invalid`);
        }
        sessionId.push(value);
      }
      return sessionId;
    },
  });
}

function parseCustodyCommit(raw: unknown): WalletCustodyCeremonyCommitPayload | null {
  const allowed = [
    'walletId',
    'keySet',
    'keyManifestDigestB64u',
    'establishedCustody',
    'recoveryBackupAcknowledged',
    'recoveryReplacementEnvelope',
    'registeredPublicKeyB64u',
    'clientRootPublicKey33B64u',
    'ecdsaPublicFacts',
  ] as const;
  const fields = decodeJournalObjectWithAllowedKeys(raw, allowed);
  if (
    !fields ||
    !fields.has('walletId') ||
    !fields.has('keySet') ||
    !fields.has('keyManifestDigestB64u')
  ) {
    return null;
  }
  const walletId = parseCanonicalString(fields.get('walletId'));
  const keySet = parseCanonicalString(fields.get('keySet'));
  const keyManifestDigestB64u = parseCanonicalString(fields.get('keyManifestDigestB64u'));
  if (
    !walletId ||
    !keySet ||
    !keyManifestDigestB64u ||
    (keySet !== 'near_ed25519_v1' && keySet !== 'evm_family_ecdsa_v1')
  ) {
    return null;
  }
  const recoveryBackupAcknowledged = fields.get('recoveryBackupAcknowledged');
  if (recoveryBackupAcknowledged !== undefined && recoveryBackupAcknowledged !== true) {
    return null;
  }
  const establishedCustodyRaw = fields.get('establishedCustody');
  const establishedCustody =
    establishedCustodyRaw === undefined
      ? undefined
      : parseEstablishedCustody(establishedCustodyRaw);
  if (establishedCustodyRaw !== undefined && !establishedCustody) return null;
  const recoveryReplacementEnvelopeRaw = fields.get('recoveryReplacementEnvelope');
  const recoveryReplacementEnvelope =
    recoveryReplacementEnvelopeRaw === undefined
      ? undefined
      : readJournalRecord(recoveryReplacementEnvelopeV1(), recoveryReplacementEnvelopeRaw);
  if (recoveryReplacementEnvelopeRaw !== undefined && !recoveryReplacementEnvelope) return null;
  const registeredPublicKeyB64uRaw = fields.get('registeredPublicKeyB64u');
  const registeredPublicKeyB64u =
    registeredPublicKeyB64uRaw === undefined
      ? undefined
      : parseCanonicalString(registeredPublicKeyB64uRaw);
  if (registeredPublicKeyB64uRaw !== undefined && !registeredPublicKeyB64u) return null;
  const clientRootPublicKey33B64uRaw = fields.get('clientRootPublicKey33B64u');
  const clientRootPublicKey33B64u =
    clientRootPublicKey33B64uRaw === undefined
      ? undefined
      : parseCanonicalString(clientRootPublicKey33B64uRaw);
  if (clientRootPublicKey33B64uRaw !== undefined && !clientRootPublicKey33B64u) return null;
  const ecdsaPublicFactsRaw = fields.get('ecdsaPublicFacts');
  const ecdsaPublicFacts =
    ecdsaPublicFactsRaw === undefined
      ? undefined
      : readJournalRecord(ecdsaPublicFactsV1(), ecdsaPublicFactsRaw);
  if (ecdsaPublicFactsRaw !== undefined && !ecdsaPublicFacts) return null;
  return {
    walletId,
    keySet,
    keyManifestDigestB64u,
    ...(establishedCustody ? { establishedCustody } : {}),
    ...(recoveryBackupAcknowledged === true ? { recoveryBackupAcknowledged: true as const } : {}),
    ...(recoveryReplacementEnvelope ? { recoveryReplacementEnvelope } : {}),
    ...(registeredPublicKeyB64u ? { registeredPublicKeyB64u } : {}),
    ...(clientRootPublicKey33B64u ? { clientRootPublicKey33B64u } : {}),
    ...(ecdsaPublicFacts ? { ecdsaPublicFacts } : {}),
  };
}

function isCustodyCommitForKeySet<K extends 'near_ed25519_v1' | 'evm_family_ecdsa_v1'>(
  custodyCommit: WalletCustodyCeremonyCommitPayload,
  keySet: K,
): custodyCommit is Extract<PendingWalletRegistrationCustodyCommitV1, { readonly keySet: K }> {
  return custodyCommit.keySet === keySet;
}

function parseEstablishedCustody(raw: unknown): EstablishedCustodyRecordsPayload | null {
  const keys = [
    'envelopeId',
    'envelopeBindingJson',
    'envelopeNonceB64u',
    'sealedCustodySecretB64u',
    'envelopeAadHashB64u',
    'envelopeCiphertextDigestB64u',
    'recoveryManifestKekWraps',
    'recoveryCodeLocators',
    'recoveryEntryNonceB64u',
    'recoveryEntryCiphertextB64u',
    'recoveryEntryAadHashB64u',
  ] as const;
  const fields = decodeJournalObjectWithAllowedKeys(raw, keys);
  if (!fields || keys.some((key) => key !== 'recoveryCodeLocators' && !fields.has(key)))
    return null;
  const strings = [
    parseCanonicalString(fields.get('envelopeId')),
    parseCanonicalString(fields.get('envelopeBindingJson')),
    parseCanonicalString(fields.get('envelopeNonceB64u')),
    parseCanonicalString(fields.get('sealedCustodySecretB64u')),
    parseCanonicalString(fields.get('envelopeAadHashB64u')),
    parseCanonicalString(fields.get('envelopeCiphertextDigestB64u')),
    parseCanonicalString(fields.get('recoveryEntryNonceB64u')),
    parseCanonicalString(fields.get('recoveryEntryCiphertextB64u')),
    parseCanonicalString(fields.get('recoveryEntryAadHashB64u')),
  ];
  if (strings.some((value) => value === null)) return null;
  const recoveryManifestKekWrapValues = decodeJournalArray(fields.get('recoveryManifestKekWraps'));
  if (!recoveryManifestKekWrapValues) return null;
  const parsedRecoveryManifestKekWraps = recoveryManifestKekWrapValues.map((value) =>
    readJournalRecord(recoveryWrapV1(), value),
  );
  if (parsedRecoveryManifestKekWraps.some((value) => value === null)) return null;
  const recoveryManifestKekWraps = parsedRecoveryManifestKekWraps.filter(isPresent);
  let recoveryCodeLocators: WalletCustodyRecoveryCodeLocatorPayload[] | undefined;
  if (fields.has('recoveryCodeLocators')) {
    const recoveryCodeLocatorValues = decodeJournalArray(fields.get('recoveryCodeLocators'));
    if (!recoveryCodeLocatorValues) return null;
    const parsedRecoveryCodeLocators = recoveryCodeLocatorValues.map((value) =>
      readJournalRecord(recoveryCodeLocatorV1(), value),
    );
    if (parsedRecoveryCodeLocators.some((value) => value === null)) return null;
    recoveryCodeLocators = parsedRecoveryCodeLocators.filter(isPresent);
  }
  return {
    envelopeId: strings[0]!,
    envelopeBindingJson: strings[1]!,
    envelopeNonceB64u: strings[2]!,
    sealedCustodySecretB64u: strings[3]!,
    envelopeAadHashB64u: strings[4]!,
    envelopeCiphertextDigestB64u: strings[5]!,
    recoveryManifestKekWraps,
    ...(recoveryCodeLocators ? { recoveryCodeLocators } : {}),
    recoveryEntryNonceB64u: strings[6]!,
    recoveryEntryCiphertextB64u: strings[7]!,
    recoveryEntryAadHashB64u: strings[8]!,
  };
}

function recoveryWrapV1() {
  const text = journalField(parseCanonicalString);
  return wireObject({
    recoveryKeyId: text,
    nonceB64u: text,
    ciphertextB64u: text,
    aadHashB64u: text,
  });
}

function recoveryCodeLocatorV1() {
  const text = journalField(parseCanonicalString);
  return wireObject({ locatorB64u: text, recoveryKeyId: text });
}

function recoveryReplacementEnvelopeV1() {
  const text = journalField(parseCanonicalString);
  return wireObject({
    envelopeId: text,
    envelopeBindingJson: text,
    envelopeNonceB64u: text,
    sealedCustodySecretB64u: text,
    envelopeAadHashB64u: text,
    envelopeCiphertextDigestB64u: text,
  });
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function parseCanonicalString(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    !hasWhitespaceOrControlCharacters(value)
    ? value
    : null;
}

function parseCanonicalStateEpoch(value: unknown): string | null {
  const parsed = parseCanonicalString(value);
  return parsed && /^[1-9][0-9]*$/u.test(parsed) ? parsed : null;
}

function parsePositiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

// A journal record that fails its schema is unreadable, which every caller treats as absent.
function readJournalRecord<T>(schema: WireParser<T>, raw: unknown): T | null {
  try {
    return schema(raw, 'journal');
  } catch {
    return null;
  }
}

// Adapts a journal parser, which returns null for a bad value, to a schema field.
function journalField<T>(parse: (raw: unknown) => T | null): WireParser<T> {
  return (raw, label) => {
    const value = parse(raw);
    if (value === null) throw new Error(`${label} is invalid`);
    return value;
  };
}

type JournalObjectFields = ReadonlyMap<string, unknown>;

function decodeJournalObject(
  value: unknown,
  expectedKeys: readonly string[],
): JournalObjectFields | null {
  const fields = decodeJournalObjectWithAllowedKeys(value, expectedKeys);
  return fields && fields.size === expectedKeys.length ? fields : null;
}

function decodeJournalObjectWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
): JournalObjectFields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const actualKeys = Object.keys(value);
  if (actualKeys.some((key) => !allowedKeys.includes(key))) return null;
  const fields = new Map<string, unknown>();
  for (const key of actualKeys) fields.set(key, Reflect.get(value, key));
  return fields;
}

function readJournalField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Reflect.get(value, key);
}

function decodeJournalArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof pendingAuthV1, PendingWalletRegistrationCommitAuthV1>,
    ParsesExactly<typeof emailOtpEnrollmentMaterialV1, WalletEmailOtpEnrollmentMaterialV1>,
    ParsesExactly<typeof ed25519LocalMaterialV1, PendingWalletRegistrationEd25519LocalMaterialV1>,
    ParsesExactly<
      typeof mixedEd25519LocalMaterialV1,
      PendingWalletRegistrationMixedEd25519LocalMaterialV1
    >,
    ParsesExactly<typeof ed25519MetadataV1, PendingWalletRegistrationEd25519MetadataV1>,
    ParsesExactly<typeof ecdsaReplayV1, PendingWalletRegistrationEcdsaReplayV1>,
    ParsesExactly<typeof ecdsaPublicFactsV1, WalletCustodyEvmFamilyPublicFacts>,
    ParsesExactly<typeof activationReferenceV1, PendingWalletRegistrationActivationReferenceV1>,
    ParsesExactly<typeof recoveryWrapV1, WalletCustodyCeremonyRecoveryWrapPayload>,
    ParsesExactly<typeof recoveryCodeLocatorV1, WalletCustodyRecoveryCodeLocatorPayload>,
    ParsesExactly<typeof recoveryReplacementEnvelopeV1, RecoveryReplacementEnvelopePayload>,
  ]
>;
