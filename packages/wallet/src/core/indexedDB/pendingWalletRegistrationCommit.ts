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
import type { WalletEmailOtpEnrollmentMaterialV1 } from '@shared/utils/registrationIntent';
import type { RouterAbEd25519YaoBytes32V1 } from '@shared/utils/routerAbEd25519Yao';
import {
  parseRouterAbEcdsaVerifiedClientActivationFactsV1,
  type RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';

export type PendingWalletRegistrationEcdsaReplayV1 = {
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
    }
  | {
      readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'];
      readonly custodyCommit: PendingWalletRegistrationEcdsaCustodyCommitV1;
      readonly ed25519: PendingWalletRegistrationMixedEd25519LocalMaterialV1;
      readonly ecdsa: PendingWalletRegistrationEcdsaReplayV1;
      readonly activationReference?: never;
    };

export type PendingWalletRegistrationSignerPlanKind =
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
      readonly signerPlanKind: 'near_ed25519';
      readonly localMaterial: PendingWalletRegistrationEd25519LocalMaterialBranchV1;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'registration_activate';
      readonly signerPlanKind: 'evm_family_ecdsa';
      readonly localMaterial: Extract<
        PendingWalletRegistrationLocalMaterialV1,
        { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
      >;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'registration_activate';
      readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
      readonly localMaterial: Extract<
        PendingWalletRegistrationLocalMaterialV1,
        { readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'] }
      >;
    })
  | (PendingWalletRegistrationCommitCommonV1 & {
      readonly operation: 'near_provisioning';
      readonly signerPlanKind: 'near_ed25519' | 'near_ed25519_and_evm_family_ecdsa';
      readonly localMaterial: PendingWalletRegistrationEd25519LocalMaterialBranchV1;
    });

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
  if (typeof key !== 'string' || !key.startsWith(PENDING_WALLET_REGISTRATION_COMMIT_APP_STATE_PREFIX)) {
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
  const fields = decodeJournalObject(raw, [
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
    'createdAtMs',
    'updatedAtMs',
  ]);
  if (!fields || fields.get('kind') !== 'pending_wallet_registration_commit_v1') return null;
  const operation = parsePendingOperation(fields.get('operation'));
  const signerPlanKind = parsePendingSignerPlanKind(fields.get('signerPlanKind'));
  const registrationCeremonyId = parseCanonicalString(fields.get('registrationCeremonyId'));
  const idempotencyKey = parseCanonicalString(fields.get('idempotencyKey'));
  const signedSetup = parseCanonicalString(fields.get('signedSetup'));
  const walletId = parseWalletId(fields.get('walletId'));
  const walletAuthMethodId = parseWalletAuthMethodId(fields.get('walletAuthMethodId'));
  const auth = parsePendingAuth(fields.get('auth'));
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
    !localMaterial ||
    localMaterial.custodyCommit.walletId !== walletId.value ||
    createdAtMs === null ||
    updatedAtMs === null ||
    updatedAtMs < createdAtMs
  ) {
    return null;
  }
  if (
    isMixedLocalMaterial(localMaterial) &&
    localMaterial.ed25519.custodyCommit.walletId !== walletId.value
  ) {
    return null;
  }
  if (operation === 'registration_activate') {
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
    if (isMixedLocalMaterial(localMaterial)) {
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
    if (
      signerPlanKind !== 'near_ed25519' &&
      signerPlanKind !== 'near_ed25519_and_evm_family_ecdsa'
    ) {
      return null;
    }
    if (!isEd25519LocalMaterial(localMaterial)) return null;
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

function parsePendingAuth(raw: unknown): PendingWalletRegistrationCommitAuthV1 | null {
  const kind = readJournalField(raw, 'kind');
  if (kind === 'passkey') {
    const fields = decodeJournalObject(raw, ['kind', 'rpId', 'credentialIdB64u', 'transports']);
    if (!fields) return null;
    const rpId = parseWebAuthnRpId(fields.get('rpId'));
    const credentialIdB64u = parseWebAuthnCredentialIdB64u(fields.get('credentialIdB64u'));
    const transports = parseCanonicalStringArray(fields.get('transports'));
    return rpId.ok && credentialIdB64u.ok && transports
      ? {
          kind: 'passkey',
          rpId: rpId.value,
          credentialIdB64u: credentialIdB64u.value,
          transports,
        }
      : null;
  }
  if (kind !== 'email_otp') return null;
  const fields = decodeJournalObject(raw, [
    'kind',
    'email',
    'registrationAuthorityId',
    'providerSubject',
    'enrollment',
  ]);
  if (!fields) return null;
  const email = parseVerifiedEmailAddress(fields.get('email'));
  const registrationAuthorityId = parseEmailOtpChallengeId(fields.get('registrationAuthorityId'));
  const providerSubject = parseEmailOtpProviderUserId(fields.get('providerSubject'));
  const enrollment = parseEmailOtpEnrollmentMaterial(fields.get('enrollment'));
  if (!email.ok || !registrationAuthorityId.ok || !providerSubject.ok || !enrollment) {
    return null;
  }
  return {
    kind: 'email_otp',
    email: email.value,
    registrationAuthorityId: registrationAuthorityId.value,
    providerSubject: providerSubject.value,
    enrollment,
  };
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

function parseEmailOtpEnrollmentMaterial(raw: unknown): WalletEmailOtpEnrollmentMaterialV1 | null {
  const keys = [
    'enrollmentSealKeyVersion',
    'serverSealedFactorCiphertextB64u',
    'clientUnlockPublicKeyB64u',
    'unlockKeyVersion',
  ] as const;
  const fields = decodeJournalObject(raw, keys);
  if (!fields) return null;
  const enrollmentSealKeyVersion = parseCanonicalString(fields.get('enrollmentSealKeyVersion'));
  const serverSealedFactorCiphertextB64u = parseCanonicalString(
    fields.get('serverSealedFactorCiphertextB64u'),
  );
  const clientUnlockPublicKeyB64u = parseCanonicalString(fields.get('clientUnlockPublicKeyB64u'));
  const unlockKeyVersion = parseCanonicalString(fields.get('unlockKeyVersion'));
  if (
    !enrollmentSealKeyVersion ||
    !serverSealedFactorCiphertextB64u ||
    !clientUnlockPublicKeyB64u ||
    !unlockKeyVersion
  ) {
    return null;
  }
  return {
    enrollmentSealKeyVersion,
    serverSealedFactorCiphertextB64u,
    clientUnlockPublicKeyB64u,
    unlockKeyVersion,
  };
}

function parsePendingLocalMaterial(raw: unknown): PendingWalletRegistrationLocalMaterialV1 | null {
  const keyFamilies = decodeJournalArray(readJournalField(raw, 'keyFamilies'));
  if (!keyFamilies) return null;
  if (keyFamilies.length === 1 && keyFamilies[0] === 'ecdsa_secp256k1') {
    const fields = decodeJournalObject(raw, ['keyFamilies', 'custodyCommit', 'ecdsa']);
    if (!fields) return null;
    const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
    const ecdsa = parseEcdsaLocalMaterial(fields.get('ecdsa'));
    return custodyCommit && isCustodyCommitForKeySet(custodyCommit, 'evm_family_ecdsa_v1') && ecdsa
      ? { keyFamilies: ['ecdsa_secp256k1'], custodyCommit, ecdsa }
      : null;
  }
  if (
    keyFamilies.length === 1 &&
    keyFamilies[0] === 'ed25519'
  ) {
    const fields = decodeJournalObject(raw, ['keyFamilies', 'custodyCommit', 'ed25519']);
    if (!fields) return null;
    const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
    const ed25519 = parseEd25519LocalMaterial(fields.get('ed25519'));
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
    const ed25519 = parseMixedEd25519LocalMaterial(fields.get('ed25519'));
    const ecdsa = parseEcdsaLocalMaterial(fields.get('ecdsa'));
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
  localMaterial: PendingWalletRegistrationLocalMaterialV1,
): localMaterial is Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ed25519'] }
> {
  return localMaterial.keyFamilies.length === 1 && localMaterial.keyFamilies[0] === 'ed25519';
}

function isEcdsaOnlyLocalMaterial(
  localMaterial: PendingWalletRegistrationLocalMaterialV1,
): localMaterial is Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
> {
  return (
    localMaterial.keyFamilies.length === 1 && localMaterial.keyFamilies[0] === 'ecdsa_secp256k1'
  );
}

function isMixedLocalMaterial(
  localMaterial: PendingWalletRegistrationLocalMaterialV1,
): localMaterial is Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ed25519', 'ecdsa_secp256k1'] }
> {
  return (
    localMaterial.keyFamilies.length === 2 &&
    localMaterial.keyFamilies[0] === 'ed25519' &&
    localMaterial.keyFamilies[1] === 'ecdsa_secp256k1'
  );
}

function parseEd25519LocalMaterial(
  raw: unknown,
): PendingWalletRegistrationEd25519LocalMaterialV1 | null {
  const fields = decodeJournalObject(raw, ['activationReference', 'localMaterial', 'metadata']);
  return fields ? parseEd25519LocalMaterialValues(fields) : null;
}

function parseMixedEd25519LocalMaterial(
  raw: unknown,
): PendingWalletRegistrationMixedEd25519LocalMaterialV1 | null {
  const fields = decodeJournalObject(raw, [
    'custodyCommit',
    'activationReference',
    'localMaterial',
    'metadata',
  ]);
  if (!fields) return null;
  const custodyCommit = parseCustodyCommit(fields.get('custodyCommit'));
  if (!custodyCommit || !isCustodyCommitForKeySet(custodyCommit, 'near_ed25519_v1')) return null;
  const ed25519 = parseEd25519LocalMaterialValues(fields);
  return ed25519
    ? {
        activationReference: ed25519.activationReference,
        localMaterial: ed25519.localMaterial,
        metadata: ed25519.metadata,
        custodyCommit,
      }
    : null;
}

function parseEd25519LocalMaterialValues(
  fields: ReadonlyMap<string, unknown>,
): PendingWalletRegistrationEd25519LocalMaterialV1 | null {
  const activationReference = parseActivationReference(fields.get('activationReference'));
  const localMaterialFields = decodeJournalObject(fields.get('localMaterial'), [
    'b64u',
    'nonceB64u',
    'applicationBindingDigestB64u',
  ]);
  if (!localMaterialFields) return null;
  const b64u = parseCanonicalString(localMaterialFields.get('b64u'));
  const nonceB64u = parseCanonicalString(localMaterialFields.get('nonceB64u'));
  const applicationBindingDigestB64u = parseCanonicalString(
    localMaterialFields.get('applicationBindingDigestB64u'),
  );
  const metadata = parseEd25519Metadata(fields.get('metadata'));
  return activationReference && b64u && nonceB64u && applicationBindingDigestB64u && metadata
    ? {
        activationReference,
        localMaterial: { b64u, nonceB64u, applicationBindingDigestB64u },
        metadata,
      }
    : null;
}

function parseEd25519Metadata(raw: unknown): PendingWalletRegistrationEd25519MetadataV1 | null {
  const fields = decodeJournalObject(raw, [
    'materialActivation',
    'registeredPublicKeyB64u',
    'signingWorkerVerifyingShareB64u',
    'stateEpoch',
    'signingWorkerId',
    'participantIds',
    'nearEd25519SigningKeyId',
    'signerSlot',
  ]);
  if (!fields) return null;
  const materialActivation = parseMpcMaterialActivationRef(fields.get('materialActivation'));
  const registeredPublicKeyB64u = parseCanonicalString(fields.get('registeredPublicKeyB64u'));
  const signingWorkerVerifyingShareB64u = parseCanonicalString(
    fields.get('signingWorkerVerifyingShareB64u'),
  );
  const stateEpoch = parseCanonicalStateEpoch(fields.get('stateEpoch'));
  const signingWorkerId = parseCanonicalString(fields.get('signingWorkerId'));
  const nearEd25519SigningKeyId = parseCanonicalString(fields.get('nearEd25519SigningKeyId'));
  const participantIds = decodeJournalArray(fields.get('participantIds'));
  const signerSlot = fields.get('signerSlot');
  if (
    !materialActivation.ok ||
    !registeredPublicKeyB64u ||
    !signingWorkerVerifyingShareB64u ||
    !stateEpoch ||
    !signingWorkerId ||
    !nearEd25519SigningKeyId ||
    !participantIds ||
    participantIds.length !== 2 ||
    participantIds.some(
      (participantId) =>
        typeof participantId !== 'number' ||
        !Number.isSafeInteger(participantId) ||
        Number(participantId) < 1,
    ) ||
    !Number.isSafeInteger(signerSlot) ||
    Number(signerSlot) < 1
  ) {
    return null;
  }
  return {
    materialActivation: materialActivation.value,
    registeredPublicKeyB64u,
    signingWorkerVerifyingShareB64u,
    stateEpoch,
    signingWorkerId,
    participantIds: [Number(participantIds[0]), Number(participantIds[1])],
    nearEd25519SigningKeyId,
    signerSlot: Number(signerSlot),
  };
}

function parseEcdsaLocalMaterial(raw: unknown): {
  readonly activationJournalId: CorrelationId;
  readonly clientActivation: RouterAbEcdsaVerifiedClientActivationFactsV1;
  readonly activationRequestDigestB64u: DigestB64u;
} | null {
  const fields = decodeJournalObject(raw, [
    'activationJournalId',
    'clientActivation',
    'activationRequestDigestB64u',
  ]);
  if (!fields) return null;
  const activationJournalId = parseCorrelationIdSafely(fields.get('activationJournalId'));
  const activationRequestDigestB64u = parseDigestB64uSafely(
    fields.get('activationRequestDigestB64u'),
  );
  if (!activationJournalId || !activationRequestDigestB64u) return null;
  try {
    return {
      activationJournalId,
      clientActivation: parseRouterAbEcdsaVerifiedClientActivationFactsV1(
        fields.get('clientActivation'),
      ),
      activationRequestDigestB64u,
    };
  } catch {
    return null;
  }
}

function parseEcdsaPublicFacts(raw: unknown): WalletCustodyEvmFamilyPublicFacts | null {
  const keys = [
    'contextBinding32B64u',
    'derivationClientSharePublicKey33B64u',
    'clientVerifyingShare33B64u',
    'relayerPublicKey33B64u',
    'groupPublicKey33B64u',
    'ethereumAddress',
    'clientShareRetryCounter',
    'relayerShareRetryCounter',
  ] as const;
  const fields = decodeJournalObject(raw, keys);
  if (!fields) return null;
  const contextBinding32B64u = parseCanonicalString(fields.get('contextBinding32B64u'));
  const derivationClientSharePublicKey33B64u = parseCanonicalString(
    fields.get('derivationClientSharePublicKey33B64u'),
  );
  const clientVerifyingShare33B64u = parseCanonicalString(
    fields.get('clientVerifyingShare33B64u'),
  );
  const relayerPublicKey33B64u = parseCanonicalString(fields.get('relayerPublicKey33B64u'));
  const groupPublicKey33B64u = parseCanonicalString(fields.get('groupPublicKey33B64u'));
  const ethereumAddress = parseCanonicalString(fields.get('ethereumAddress'));
  const clientShareRetryCounter = fields.get('clientShareRetryCounter');
  const relayerShareRetryCounter = fields.get('relayerShareRetryCounter');
  if (
    !contextBinding32B64u ||
    !derivationClientSharePublicKey33B64u ||
    !clientVerifyingShare33B64u ||
    !relayerPublicKey33B64u ||
    !groupPublicKey33B64u ||
    !ethereumAddress ||
    !Number.isSafeInteger(clientShareRetryCounter) ||
    Number(clientShareRetryCounter) < 0 ||
    !Number.isSafeInteger(relayerShareRetryCounter) ||
    Number(relayerShareRetryCounter) < 0
  ) {
    return null;
  }
  return {
    contextBinding32B64u,
    derivationClientSharePublicKey33B64u,
    clientVerifyingShare33B64u,
    relayerPublicKey33B64u,
    groupPublicKey33B64u,
    ethereumAddress,
    clientShareRetryCounter: Number(clientShareRetryCounter),
    relayerShareRetryCounter: Number(relayerShareRetryCounter),
  };
}

function parseActivationReference(
  raw: unknown,
): PendingWalletRegistrationActivationReferenceV1 | null {
  const fields = decodeJournalObject(raw, ['kind', 'lifecycle_id', 'session_id']);
  if (!fields || fields.get('kind') !== 'router_ab_ed25519_yao_activation_reference_v1') {
    return null;
  }
  const lifecycleId = parseCanonicalString(fields.get('lifecycle_id'));
  const sessionIdValues = decodeJournalArray(fields.get('session_id'));
  if (!lifecycleId || !sessionIdValues || sessionIdValues.length !== 32) return null;
  const sessionId: number[] = [];
  for (const value of sessionIdValues) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    sessionId.push(value);
  }
  return {
    kind: 'router_ab_ed25519_yao_activation_reference_v1',
    lifecycle_id: lifecycleId,
    session_id: sessionId,
  };
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
      : parseRecoveryReplacementEnvelope(recoveryReplacementEnvelopeRaw);
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
    ecdsaPublicFactsRaw === undefined ? undefined : parseEcdsaPublicFacts(ecdsaPublicFactsRaw);
  if (ecdsaPublicFactsRaw !== undefined && !ecdsaPublicFacts) return null;
  return {
    walletId,
    keySet,
    keyManifestDigestB64u,
    ...(establishedCustody ? { establishedCustody } : {}),
    ...(recoveryBackupAcknowledged === true
      ? { recoveryBackupAcknowledged: true as const }
      : {}),
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
  if (!fields || keys.some((key) => key !== 'recoveryCodeLocators' && !fields.has(key))) return null;
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
  const parsedRecoveryManifestKekWraps = recoveryManifestKekWrapValues.map(parseRecoveryWrap);
  if (parsedRecoveryManifestKekWraps.some((value) => value === null)) return null;
  const recoveryManifestKekWraps = parsedRecoveryManifestKekWraps.filter(isPresent);
  let recoveryCodeLocators: WalletCustodyRecoveryCodeLocatorPayload[] | undefined;
  if (fields.has('recoveryCodeLocators')) {
    const recoveryCodeLocatorValues = decodeJournalArray(fields.get('recoveryCodeLocators'));
    if (!recoveryCodeLocatorValues) return null;
    const parsedRecoveryCodeLocators = recoveryCodeLocatorValues.map(parseRecoveryCodeLocator);
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

function parseRecoveryWrap(raw: unknown): WalletCustodyCeremonyRecoveryWrapPayload | null {
  const fields = decodeJournalObject(raw, [
    'recoveryKeyId',
    'nonceB64u',
    'ciphertextB64u',
    'aadHashB64u',
  ]);
  if (!fields) return null;
  const recoveryKeyId = parseCanonicalString(fields.get('recoveryKeyId'));
  const nonceB64u = parseCanonicalString(fields.get('nonceB64u'));
  const ciphertextB64u = parseCanonicalString(fields.get('ciphertextB64u'));
  const aadHashB64u = parseCanonicalString(fields.get('aadHashB64u'));
  return recoveryKeyId && nonceB64u && ciphertextB64u && aadHashB64u
    ? { recoveryKeyId, nonceB64u, ciphertextB64u, aadHashB64u }
    : null;
}

function parseRecoveryCodeLocator(raw: unknown): WalletCustodyRecoveryCodeLocatorPayload | null {
  const fields = decodeJournalObject(raw, ['locatorB64u', 'recoveryKeyId']);
  if (!fields) return null;
  const locatorB64u = parseCanonicalString(fields.get('locatorB64u'));
  const recoveryKeyId = parseCanonicalString(fields.get('recoveryKeyId'));
  return locatorB64u && recoveryKeyId ? { locatorB64u, recoveryKeyId } : null;
}

function parseRecoveryReplacementEnvelope(raw: unknown): RecoveryReplacementEnvelopePayload | null {
  const keys = [
    'envelopeId',
    'envelopeBindingJson',
    'envelopeNonceB64u',
    'sealedCustodySecretB64u',
    'envelopeAadHashB64u',
    'envelopeCiphertextDigestB64u',
  ] as const;
  const fields = decodeJournalObject(raw, keys);
  if (!fields) return null;
  const values = keys.map((key) => parseCanonicalString(fields.get(key)));
  if (values.some((value) => value === null)) return null;
  return {
    envelopeId: values[0]!,
    envelopeBindingJson: values[1]!,
    envelopeNonceB64u: values[2]!,
    sealedCustodySecretB64u: values[3]!,
    envelopeAadHashB64u: values[4]!,
    envelopeCiphertextDigestB64u: values[5]!,
  };
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

function parseCorrelationIdSafely(value: unknown): CorrelationId | null {
  try {
    return parseCorrelationId(value);
  } catch {
    return null;
  }
}

function parseDigestB64uSafely(value: unknown): DigestB64u | null {
  try {
    return parseDigestB64u(value);
  } catch {
    return null;
  }
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
