import {
  parseCommittedAuthorityPackagesV1,
  type CommittedAuthorityPackagesV1,
} from '@shared/device-linking/committedSignerPackages';
import type {
  OrdinarySignerMaterialRecipientRequestV1,
  OrdinarySignerMaterialRecipientRequirementV1,
  OrdinarySignerMaterialReservationPreparationV1,
  VerifiedTargetFactorV1,
} from '@shared/device-linking/contracts';
import { parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationV1 } from '@shared/device-linking/sourceContribution';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletKeyId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletKeyId,
} from '@shared/utils/domainIds';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { requireCanonicalString } from '@shared/utils/validation';
import type {
  WalletAuthorityExportRootRecordV1,
  WalletAuthoritySignerMaterialRecordV1,
} from '@/core/indexedDB';
import type { WalletAuthorityLinkedMaterialTargetFactorV1 } from '@/core/indexedDB/passkeyClientDB.types';
import { parseWalletAuthorityLinkedSignerMaterialRecordV1 } from '@/core/indexedDB/linkedAuthoritySignerMaterial';

type WorkerKeyMaterialHandleV1 = {
  readonly handleId: string;
};

type OrdinaryMaterialResealedExportRootV1 = {
  readonly envelope: PasskeyCustodyEnvelopeRecord;
};

export type DeviceLinkingOrdinarySignerMaterialReservationPreparationV1 =
  OrdinarySignerMaterialReservationPreparationV1;

export type DeviceLinkingOrdinarySignerMaterialRecipientInputV1 =
  | {
      readonly kind: 'ordinary_ed25519_signer_material_recipient_input_v1';
      readonly keyFamily: 'ed25519';
      readonly walletKeyId: WalletKeyId;
      readonly recipientPrivateKey: ArrayBuffer;
    }
  | {
      readonly kind: 'ordinary_ecdsa_signer_material_recipient_input_v1';
      readonly keyFamily: 'ecdsa_secp256k1';
      readonly walletKeyId: WalletKeyId;
      readonly clientEphemeralPrivateKey: ArrayBuffer;
    };

export type DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 = {
  readonly recipientRequests: readonly [
    OrdinarySignerMaterialRecipientRequestV1,
    ...OrdinarySignerMaterialRecipientRequestV1[],
  ];
  /** Browser-only private inputs. Never put this value in a route DTO. */
  readonly recipientInputs: readonly [
    DeviceLinkingOrdinarySignerMaterialRecipientInputV1,
    ...DeviceLinkingOrdinarySignerMaterialRecipientInputV1[],
  ];
};

export type DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1 =
  DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1['recipientInputs'];

export type DeviceLinkingOrdinaryTargetFactorBindingV1 =
  WalletAuthorityLinkedMaterialTargetFactorV1;

type DeviceLinkingOrdinarySignerMaterialPreparationResultV1 = {
  readonly kind: 'device_linking_ordinary_signer_material_preparation_v1';
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
  readonly preparations: readonly [
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
  ];
};

export type SealedLocalAuthorityMaterialSetV1 = {
  readonly signerMaterials: readonly [
    WalletAuthoritySignerMaterialRecordV1,
    ...WalletAuthoritySignerMaterialRecordV1[],
  ];
  readonly exportRoot: WalletAuthorityExportRootRecordV1 | null;
  readonly installedRecordSetDigestB64u: DigestB64u;
};

export type DeviceLinkingOrdinaryMaterialWorkerRequestV1 =
  | {
      readonly kind: 'device_linking_ordinary_signer_material_recipient_prepare_v1';
      readonly handleId: string;
      readonly requirements: readonly [
        OrdinarySignerMaterialRecipientRequirementV1,
        ...OrdinarySignerMaterialRecipientRequirementV1[],
      ];
    }
  | {
      readonly kind: 'device_linking_ordinary_signer_material_seal_v1';
      readonly handleId: string;
      readonly committed: CommittedAuthorityPackagesV1;
      readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
      /** Result produced by the custody worker's root open-and-reseal boundary. */
      readonly resealedExportRoot: OrdinaryMaterialResealedExportRootV1 | null;
    };

/** Internal worker-only request. Private inputs never cross the route parser. */
export type DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1 = {
  readonly kind: 'device_linking_ordinary_signer_material_prepare_private_v1';
  readonly handleId: string;
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
  readonly preparations: readonly [
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
  ];
  readonly recipientRequests: readonly [
    OrdinarySignerMaterialRecipientRequestV1,
    ...OrdinarySignerMaterialRecipientRequestV1[],
  ];
  readonly recipientInputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1;
  readonly factorSecret: ArrayBuffer;
};

type DeviceLinkingOrdinaryMaterialWorkerRequestSenderV1 = (
  request:
    | DeviceLinkingOrdinaryMaterialWorkerRequestV1
    | DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
  transfer?: Transferable[],
) => Promise<unknown>;

export type DeviceLinkingOrdinaryMaterialWorkerPortV1 = {
  createOrdinarySignerMaterialRecipientRequestsV1(input: {
    readonly keyMaterial: WorkerKeyMaterialHandleV1;
    readonly requirements: readonly [
      OrdinarySignerMaterialRecipientRequirementV1,
      ...OrdinarySignerMaterialRecipientRequirementV1[],
    ];
  }): Promise<DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1>;
  prepareOrdinarySignerMaterialV1(input: {
    readonly keyMaterial: WorkerKeyMaterialHandleV1;
    readonly targetFactor: VerifiedTargetFactorV1;
    readonly preparations: readonly [
      DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
      ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
    ];
    readonly recipientRequests: readonly [
      OrdinarySignerMaterialRecipientRequestV1,
      ...OrdinarySignerMaterialRecipientRequestV1[],
    ];
    readonly recipientInputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1;
    readonly factorSecret: ArrayBuffer;
  }): Promise<DeviceLinkingOrdinarySignerMaterialPreparationResultV1>;
  sealCommittedAuthorityPackagesV1(input: {
    readonly committed: CommittedAuthorityPackagesV1;
    readonly targetFactor: VerifiedTargetFactorV1;
    readonly keyMaterial: WorkerKeyMaterialHandleV1;
    /** Produced by DeviceLinkingEd25519ExportRootPortV1.acceptTransferV1. */
    readonly resealedExportRoot: OrdinaryMaterialResealedExportRootV1 | null;
  }): Promise<SealedLocalAuthorityMaterialSetV1>;
};

export type DeviceLinkingOrdinaryMaterialSealerV1 = {
  sealCommittedAuthorityPackagesV1(input: {
    readonly committed: CommittedAuthorityPackagesV1;
    readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
    readonly resealedExportRoot: OrdinaryMaterialResealedExportRootV1 | null;
    readonly preparations: readonly [
      DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
      ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
    ];
    readonly recipientInputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1;
    readonly factorSecret: Uint8Array;
  }): Promise<SealedLocalAuthorityMaterialSetV1>;
};

function targetFactorBindingV1(
  targetFactor: VerifiedTargetFactorV1,
): DeviceLinkingOrdinaryTargetFactorBindingV1 {
  const authMethod = parseWalletAuthMethodId(targetFactor.authMethod.walletAuthMethodId);
  if (!authMethod.ok) throw new Error(authMethod.error.message);
  const verificationDigestB64u = parseDigestB64u(targetFactor.verificationDigestB64u);
  if (targetFactor.kind === 'verified_passkey_target_v1') {
    return {
      kind: 'passkey',
      walletAuthMethodId: authMethod.value,
      verificationDigestB64u,
      rpId: targetFactor.authMethod.rpId,
      credentialIdB64u: targetFactor.authMethod.credentialIdB64u,
    };
  }
  return {
    kind: 'email_otp',
    walletAuthMethodId: authMethod.value,
    verificationDigestB64u,
    emailHashHex: targetFactor.authMethod.emailHashHex,
    registrationAuthorityId: targetFactor.authMethod.registrationAuthorityId,
  };
}

export function createDeviceLinkingOrdinaryMaterialWorkerPortV1(
  send: DeviceLinkingOrdinaryMaterialWorkerRequestSenderV1,
): DeviceLinkingOrdinaryMaterialWorkerPortV1 {
  return {
    async prepareOrdinarySignerMaterialV1(input) {
      if (!(input.factorSecret instanceof ArrayBuffer) || input.factorSecret.byteLength !== 32) {
        throw new Error('ordinary signer material factorSecret must be 32 bytes');
      }
      const preparations = parsePreparationTuple(input.preparations);
      const recipientRequests = parseRecipientRequestTuple(input.recipientRequests);
      const recipientInputs = parseRecipientInputTuple(input.recipientInputs);
      assertRecipientInputsMatchRequests(recipientInputs, recipientRequests);
      const transfer = [input.factorSecret, ...recipientInputTransferables(recipientInputs)];
      const result = await send(
        {
          kind: 'device_linking_ordinary_signer_material_prepare_private_v1',
          handleId: requireCanonicalString(
            input.keyMaterial.handleId,
            'keyMaterial.handleId',
            'is required',
          ),
          targetFactor: targetFactorBindingV1(input.targetFactor),
          preparations,
          recipientRequests,
          recipientInputs,
          factorSecret: input.factorSecret,
        },
        transfer,
      );
      return parsePreparationResult(result);
    },
    async createOrdinarySignerMaterialRecipientRequestsV1(input) {
      const result = await send({
        kind: 'device_linking_ordinary_signer_material_recipient_prepare_v1',
        handleId: requireCanonicalString(
          input.keyMaterial.handleId,
          'keyMaterial.handleId',
          'is required',
        ),
        requirements: parseRecipientRequirementTuple(input.requirements),
      });
      return parseRecipientPreparationResult(result);
    },
    async sealCommittedAuthorityPackagesV1(input) {
      const committed = parseCommittedAuthorityPackagesV1(input.committed);
      const result = await send({
        kind: 'device_linking_ordinary_signer_material_seal_v1',
        handleId: requireCanonicalString(
          input.keyMaterial.handleId,
          'keyMaterial.handleId',
          'is required',
        ),
        committed,
        targetFactor: targetFactorBindingV1(input.targetFactor),
        resealedExportRoot: parseOrdinaryResealedExportRootRecordV1(input.resealedExportRoot),
      });
      return parseSealedLocalAuthorityMaterialSetV1(result);
    },
  };
}

export function parseOrdinaryMaterialWorkerRequestV1(
  value: unknown,
): DeviceLinkingOrdinaryMaterialWorkerRequestV1 {
  if (hasExactKeys(value, ['kind', 'handleId', 'requirements'])) {
    if (value.kind !== 'device_linking_ordinary_signer_material_recipient_prepare_v1') {
      throw new Error('ordinary material worker request kind is unsupported');
    }
    return {
      kind: 'device_linking_ordinary_signer_material_recipient_prepare_v1',
      handleId: requireCanonicalString(value.handleId, 'ordinary material handleId', 'is required'),
      requirements: parseRecipientRequirementTuple(value.requirements),
    };
  }
  if (
    hasExactKeys(value, ['kind', 'handleId', 'committed', 'targetFactor', 'resealedExportRoot'])
  ) {
    if (value.kind !== 'device_linking_ordinary_signer_material_seal_v1') {
      throw new Error('ordinary material worker request kind is unsupported');
    }
    return {
      kind: 'device_linking_ordinary_signer_material_seal_v1',
      handleId: requireCanonicalString(value.handleId, 'ordinary material handleId', 'is required'),
      committed: parseCommittedAuthorityPackagesV1(value.committed),
      targetFactor: parseTargetFactorBindingV1(value.targetFactor),
      resealedExportRoot: parseOrdinaryResealedExportRootRecordV1(value.resealedExportRoot),
    };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ordinary material worker request must be an object');
  }
  if (
    'kind' in value &&
    value.kind === 'device_linking_ordinary_signer_material_recipient_prepare_v1'
  ) {
    const unexpected = Object.keys(value).find(
      (field) => field !== 'kind' && field !== 'handleId' && field !== 'requirements',
    );
    if (unexpected) throw new Error(`ordinary material field ${unexpected} is unsupported`);
  }
  throw new Error('ordinary material worker request kind is unsupported');
}

export function parseOrdinaryMaterialWorkerPrivateRequestV1(
  value: unknown,
): DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1 {
  if (
    !hasExactKeys(value, [
      'kind',
      'handleId',
      'targetFactor',
      'preparations',
      'recipientRequests',
      'recipientInputs',
      'factorSecret',
    ])
  ) {
    throw new Error('ordinary material private worker request has invalid fields');
  }
  if (value.kind !== 'device_linking_ordinary_signer_material_prepare_private_v1') {
    throw new Error('ordinary material private worker request kind is unsupported');
  }
  if (!(value.factorSecret instanceof ArrayBuffer) || value.factorSecret.byteLength !== 32) {
    throw new Error('ordinary signer material factorSecret must be 32 bytes');
  }
  const preparations = parsePreparationTuple(value.preparations);
  const recipientRequests = parseRecipientRequestTuple(value.recipientRequests);
  const recipientInputs = parseRecipientInputTuple(value.recipientInputs);
  assertRecipientInputsMatchRequests(recipientInputs, recipientRequests);
  return {
    kind: 'device_linking_ordinary_signer_material_prepare_private_v1',
    handleId: requireCanonicalString(value.handleId, 'ordinary material handleId', 'is required'),
    targetFactor: parseTargetFactorBindingV1(value.targetFactor),
    preparations,
    recipientRequests,
    recipientInputs,
    factorSecret: value.factorSecret,
  };
}

export function assertOrdinaryExportRootResealingMatchesCommittedV1(input: {
  readonly committed: CommittedAuthorityPackagesV1;
  readonly resealedExportRoot: OrdinaryMaterialResealedExportRootV1 | null;
}): WalletAuthorityExportRootRecordV1 | null {
  const transportPackage = input.committed.ed25519ExportRootPackage;
  return assertOrdinaryExportRootResealingMatchesIdentityV1({
    authorityId: input.committed.authority.authorityId,
    walletAuthMethodId: input.committed.authMethod.walletAuthMethodId,
    walletKeyId: transportPackage?.walletKeyId ?? null,
    resealedExportRoot: input.resealedExportRoot,
  });
}

function assertOrdinaryExportRootResealingMatchesIdentityV1(input: {
  readonly authorityId: WalletAuthorityId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletKeyId: WalletKeyId | null;
  readonly resealedExportRoot: OrdinaryMaterialResealedExportRootV1 | null;
}): WalletAuthorityExportRootRecordV1 | null {
  if (input.walletKeyId === null) {
    if (input.resealedExportRoot !== null) {
      throw new Error('ordinary material received an export-root result without a package');
    }
    return null;
  }
  const resealed = input.resealedExportRoot;
  if (resealed === null) {
    throw new Error(
      'ordinary material requires an Ed25519 export-root result from the custody worker',
    );
  }
  if (
    resealed.envelope.binding.kind !== 'ed25519_yao_client_root_v1' ||
    resealed.envelope.binding.walletKeyId !== input.walletKeyId
  ) {
    throw new Error('ordinary material export-root envelope names another Ed25519 key');
  }
  return {
    kind: 'wallet_authority_export_root_v1',
    authorityId: input.authorityId,
    walletAuthMethodId: input.walletAuthMethodId,
    walletKeyId: input.walletKeyId,
    envelope: resealed.envelope,
  };
}

function parseOrdinaryResealedExportRootRecordV1(
  value: unknown,
): OrdinaryMaterialResealedExportRootV1 | null {
  if (value === null) return null;
  if (!hasExactKeys(value, ['envelope'])) {
    throw new Error('ordinary material resealed export root has unsupported fields');
  }
  return {
    envelope: parsePasskeyCustodyEnvelopeRecord(value.envelope),
  };
}

function parsePreparationResult(
  value: unknown,
): DeviceLinkingOrdinarySignerMaterialPreparationResultV1 {
  if (!hasExactKeys(value, ['kind', 'targetFactor', 'preparations'])) {
    throw new Error('ordinary material preparation result has invalid fields');
  }
  if (value.kind !== 'device_linking_ordinary_signer_material_preparation_v1') {
    throw new Error('ordinary material preparation result kind is invalid');
  }
  return {
    kind: 'device_linking_ordinary_signer_material_preparation_v1',
    targetFactor: parseTargetFactorBindingV1(value.targetFactor),
    preparations: parsePreparationTuple(value.preparations),
  };
}

function parsePreparationTuple(
  value: unknown,
): DeviceLinkingOrdinarySignerMaterialPreparationResultV1['preparations'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error('ordinary signer material preparations must contain one or two entries');
  }
  const preparations = value.map(parsePreparation);
  const families = preparations.map((entry) => ('kind' in entry ? 'ed25519' : 'ecdsa_secp256k1'));
  if (new Set(families).size !== preparations.length) {
    throw new Error('ordinary signer material preparations repeat a key family');
  }
  const activations = preparations.map((entry) =>
    'kind' in entry ? entry.targetMaterialActivation : entry.target.activation,
  );
  if (activations.length === 2 && activations[0]!.activationId === activations[1]!.activationId) {
    throw new Error('ordinary signer material preparations repeat an activation reference');
  }
  const first = preparations[0];
  if (!first) throw new Error('ordinary signer material preparations are empty');
  return [first, ...preparations.slice(1)];
}

function parseRecipientRequirementTuple(
  value: unknown,
): readonly [
  OrdinarySignerMaterialRecipientRequirementV1,
  ...OrdinarySignerMaterialRecipientRequirementV1[],
] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error(
      'ordinary signer material recipient requirements must contain one or two entries',
    );
  }
  const requirements = value.map((entry, index): OrdinarySignerMaterialRecipientRequirementV1 => {
    if (!hasExactKeys(entry, ['kind', 'keyFamily', 'walletKeyId'])) {
      throw new Error(`ordinary recipient requirement ${index} has invalid fields`);
    }
    if (entry.kind !== 'ordinary_signer_material_recipient_requirement_v1') {
      throw new Error('ordinary recipient requirement kind is invalid');
    }
    if (entry.keyFamily !== 'ed25519' && entry.keyFamily !== 'ecdsa_secp256k1') {
      throw new Error('ordinary recipient requirement key family is invalid');
    }
    const walletKeyId = parseWalletKey(entry.walletKeyId);
    return { kind: entry.kind, keyFamily: entry.keyFamily, walletKeyId };
  });
  assertUniqueRecipientFamilies(requirements);
  const first = requirements[0];
  if (!first) throw new Error('ordinary recipient requirements are empty');
  return [first, ...requirements.slice(1)];
}

function parseRecipientRequestTuple(
  value: unknown,
): readonly [
  OrdinarySignerMaterialRecipientRequestV1,
  ...OrdinarySignerMaterialRecipientRequestV1[],
] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error('ordinary signer material recipient requests must contain one or two entries');
  }
  const requests = value.map((entry): OrdinarySignerMaterialRecipientRequestV1 => {
    if (hasExactKeys(entry, ['kind', 'keyFamily', 'walletKeyId', 'recipientPublicKeyB64u'])) {
      if (
        entry.kind !== 'ordinary_ed25519_signer_material_recipient_request_v1' ||
        entry.keyFamily !== 'ed25519'
      ) {
        throw new Error('ordinary Ed25519 recipient request kind is invalid');
      }
      return {
        kind: 'ordinary_ed25519_signer_material_recipient_request_v1',
        keyFamily: 'ed25519',
        walletKeyId: parseWalletKey(entry.walletKeyId),
        recipientPublicKeyB64u: parseB64u(
          entry.recipientPublicKeyB64u,
          'Ed25519 recipient public key',
        ),
      };
    }
    if (hasExactKeys(entry, ['kind', 'keyFamily', 'walletKeyId', 'clientEphemeralPublicKey'])) {
      if (
        entry.kind !== 'ordinary_ecdsa_signer_material_recipient_request_v1' ||
        entry.keyFamily !== 'ecdsa_secp256k1'
      ) {
        throw new Error('ordinary ECDSA recipient request kind is invalid');
      }
      return {
        kind: 'ordinary_ecdsa_signer_material_recipient_request_v1',
        keyFamily: 'ecdsa_secp256k1',
        walletKeyId: parseWalletKey(entry.walletKeyId),
        clientEphemeralPublicKey: requireCanonicalString(
          entry.clientEphemeralPublicKey,
          'ECDSA client ephemeral public key',
          'is required',
        ),
      };
    }
    throw new Error('ordinary recipient request key family is invalid');
  });
  assertUniqueRecipientFamilies(requests);
  const first = requests[0];
  if (!first) throw new Error('ordinary recipient requests are empty');
  return [first, ...requests.slice(1)];
}

function parseRecipientPreparationResult(
  value: unknown,
): DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 {
  if (!hasExactKeys(value, ['kind', 'recipientRequests', 'recipientInputs'])) {
    throw new Error('ordinary recipient preparation result has invalid fields');
  }
  if (value.kind !== 'device_linking_ordinary_signer_material_recipient_preparation_v1') {
    throw new Error('ordinary recipient preparation result kind is invalid');
  }
  const recipientRequests = parseRecipientRequestTuple(value.recipientRequests);
  const recipientInputs = parseRecipientInputTuple(value.recipientInputs);
  assertRecipientInputsMatchRequests(recipientInputs, recipientRequests);
  return { recipientRequests, recipientInputs };
}

function parseRecipientInputTuple(
  value: unknown,
): DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1 {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    throw new Error('ordinary signer material recipient inputs must contain one or two entries');
  }
  const inputs = value.map((entry): DeviceLinkingOrdinarySignerMaterialRecipientInputV1 => {
    if (hasExactKeys(entry, ['kind', 'keyFamily', 'walletKeyId', 'recipientPrivateKey'])) {
      if (
        entry.kind !== 'ordinary_ed25519_signer_material_recipient_input_v1' ||
        entry.keyFamily !== 'ed25519'
      ) {
        throw new Error('ordinary Ed25519 recipient input kind is invalid');
      }
      return {
        kind: 'ordinary_ed25519_signer_material_recipient_input_v1',
        keyFamily: 'ed25519',
        walletKeyId: parseWalletKey(entry.walletKeyId),
        recipientPrivateKey: parsePrivateKeyBuffer(
          entry.recipientPrivateKey,
          'Ed25519 recipient private key',
        ),
      };
    }
    if (hasExactKeys(entry, ['kind', 'keyFamily', 'walletKeyId', 'clientEphemeralPrivateKey'])) {
      if (
        entry.kind !== 'ordinary_ecdsa_signer_material_recipient_input_v1' ||
        entry.keyFamily !== 'ecdsa_secp256k1'
      ) {
        throw new Error('ordinary ECDSA recipient input kind is invalid');
      }
      return {
        kind: 'ordinary_ecdsa_signer_material_recipient_input_v1',
        keyFamily: 'ecdsa_secp256k1',
        walletKeyId: parseWalletKey(entry.walletKeyId),
        clientEphemeralPrivateKey: parsePrivateKeyBuffer(
          entry.clientEphemeralPrivateKey,
          'ECDSA client ephemeral private key',
        ),
      };
    }
    throw new Error('ordinary recipient input key family is invalid');
  });
  assertUniqueRecipientFamilies(inputs);
  const first = inputs[0];
  if (!first) throw new Error('ordinary recipient inputs are empty');
  return [first, ...inputs.slice(1)];
}

function parsePrivateKeyBuffer(value: unknown, label: string): ArrayBuffer {
  if (!(value instanceof ArrayBuffer) || value.byteLength !== 32) {
    throw new Error(`${label} must be a 32-byte ArrayBuffer`);
  }
  return value;
}

function recipientInputTransferables(
  inputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1,
): ArrayBuffer[] {
  return inputs.map((input) =>
    input.kind === 'ordinary_ed25519_signer_material_recipient_input_v1'
      ? input.recipientPrivateKey
      : input.clientEphemeralPrivateKey,
  );
}

function assertRecipientInputsMatchRequests(
  inputs: DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1,
  requests: readonly [
    OrdinarySignerMaterialRecipientRequestV1,
    ...OrdinarySignerMaterialRecipientRequestV1[],
  ],
): void {
  if (inputs.length !== requests.length) {
    throw new Error('ordinary recipient inputs and requests have different lengths');
  }
  for (const request of requests) {
    const matches = inputs.filter(
      (input) => input.walletKeyId === request.walletKeyId && input.keyFamily === request.keyFamily,
    );
    if (matches.length !== 1) {
      throw new Error(
        `ordinary recipient input for ${String(request.walletKeyId)} is missing or duplicated`,
      );
    }
  }
}

function assertUniqueRecipientFamilies(
  values: readonly { readonly keyFamily: string; readonly walletKeyId: WalletKeyId }[],
): void {
  const families = new Set<string>();
  const keys = new Set<string>();
  for (const value of values) {
    if (families.has(value.keyFamily)) throw new Error('ordinary recipient family repeats');
    if (keys.has(String(value.walletKeyId)))
      throw new Error('ordinary recipient wallet key repeats');
    families.add(value.keyFamily);
    keys.add(String(value.walletKeyId));
  }
  const first = values[0];
  if (values.length === 2 && first?.keyFamily !== 'ed25519') {
    throw new Error('ordinary recipient requests must be ordered Ed25519 then ECDSA');
  }
}

function parseWalletKey(value: unknown): WalletKeyId {
  const parsed = parseWalletKeyId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parsePreparation(
  value: unknown,
): DeviceLinkingOrdinarySignerMaterialReservationPreparationV1 {
  return parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationV1(value);
}

function parseTargetFactorBindingV1(value: unknown): DeviceLinkingOrdinaryTargetFactorBindingV1 {
  if (
    hasExactKeys(value, [
      'kind',
      'walletAuthMethodId',
      'verificationDigestB64u',
      'rpId',
      'credentialIdB64u',
    ])
  ) {
    if (value.kind !== 'passkey') {
      throw new Error('ordinary material target factor kind is unsupported');
    }
    const authMethod = parseWalletAuthMethodId(value.walletAuthMethodId);
    if (!authMethod.ok) throw new Error(authMethod.error.message);
    const verificationDigestB64u = parseDigestB64u(value.verificationDigestB64u);
    return {
      kind: 'passkey',
      walletAuthMethodId: authMethod.value,
      verificationDigestB64u,
      rpId: requireCanonicalString(value.rpId, 'ordinary target factor rpId', 'is required'),
      credentialIdB64u: parseB64u(
        value.credentialIdB64u,
        'ordinary target factor credentialIdB64u',
      ),
    };
  }
  if (
    hasExactKeys(value, [
      'kind',
      'walletAuthMethodId',
      'verificationDigestB64u',
      'emailHashHex',
      'registrationAuthorityId',
    ])
  ) {
    if (value.kind !== 'email_otp') {
      throw new Error('ordinary material target factor kind is unsupported');
    }
    const authMethod = parseWalletAuthMethodId(value.walletAuthMethodId);
    if (!authMethod.ok) throw new Error(authMethod.error.message);
    const verificationDigestB64u = parseDigestB64u(value.verificationDigestB64u);
    const emailHashHex = requireCanonicalString(
      value.emailHashHex,
      'ordinary target factor emailHashHex',
      'is required',
    );
    if (!/^[0-9a-f]{64}$/.test(emailHashHex)) {
      throw new Error('ordinary target factor emailHashHex is invalid');
    }
    return {
      kind: 'email_otp',
      walletAuthMethodId: authMethod.value,
      verificationDigestB64u,
      emailHashHex,
      registrationAuthorityId: requireCanonicalString(
        value.registrationAuthorityId,
        'ordinary target factor registrationAuthorityId',
        'is required',
      ),
    };
  }
  throw new Error('ordinary material target factor kind is unsupported');
}

function parseWalletAuthorityExportRootRecordV1(value: unknown): WalletAuthorityExportRootRecordV1 {
  if (
    !hasExactKeys(value, ['kind', 'authorityId', 'walletAuthMethodId', 'walletKeyId', 'envelope'])
  ) {
    throw new Error('ordinary material export-root record has invalid fields');
  }
  if (value.kind !== 'wallet_authority_export_root_v1') {
    throw new Error('ordinary material export-root record kind is invalid');
  }
  const authorityId = parseWalletAuthorityId(value.authorityId);
  if (!authorityId.ok) throw new Error(authorityId.error.message);
  const walletAuthMethodId = parseWalletAuthMethodId(value.walletAuthMethodId);
  if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
  const walletKeyId = parseWalletKeyId(value.walletKeyId);
  if (!walletKeyId.ok) throw new Error(walletKeyId.error.message);
  return {
    kind: 'wallet_authority_export_root_v1',
    authorityId: authorityId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    walletKeyId: walletKeyId.value,
    envelope: parsePasskeyCustodyEnvelopeRecord(value.envelope),
  };
}

function parseSealedLocalAuthorityMaterialSetV1(value: unknown): SealedLocalAuthorityMaterialSetV1 {
  if (!hasExactKeys(value, ['signerMaterials', 'exportRoot', 'installedRecordSetDigestB64u'])) {
    throw new Error('ordinary material worker returned an invalid sealed record set');
  }
  if (!Array.isArray(value.signerMaterials) || value.signerMaterials.length === 0) {
    throw new Error('ordinary material worker returned an invalid sealed record set');
  }
  const signerMaterials = value.signerMaterials.map((entry) =>
    parseWalletAuthorityLinkedSignerMaterialRecordV1(entry),
  );
  const firstSignerMaterial = signerMaterials[0];
  if (!firstSignerMaterial) {
    throw new Error('ordinary material worker returned an invalid sealed record set');
  }
  return {
    signerMaterials: [firstSignerMaterial, ...signerMaterials.slice(1)],
    exportRoot:
      value.exportRoot === null ? null : parseWalletAuthorityExportRootRecordV1(value.exportRoot),
    installedRecordSetDigestB64u: parseDigestB64u(value.installedRecordSetDigestB64u),
  };
}

function parseB64u(value: unknown, label: string): string {
  const encoded = requireCanonicalString(value, label, 'is required');
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(encoded);
  } catch {
    throw new Error(`${label} is invalid base64url`);
  }
  if (decoded.length === 0 || base64UrlEncode(decoded) !== encoded) {
    decoded.fill(0);
    throw new Error(`${label} must be canonical non-empty base64url`);
  }
  decoded.fill(0);
  return encoded;
}
