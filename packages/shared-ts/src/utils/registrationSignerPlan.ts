// Signer plans for registration and add-signer selections: the signers a wallet asks for,
// normalized from untrusted input and checked for duplicates.
import { alphabetizeStringify } from './digests';
import {
  type ImplicitNearAccountId,
  type NamedNearAccountId,
  parseNamedNearAccountId,
} from './near';
import { inspectRawObject, trimString } from './registrationAuthMethodInput';
import type { NearEd25519SigningKeyId } from './registrationIds';

export type RegistrationNearAccountProvisioning =
  | {
      kind: 'implicit_account';
      accountIdSource: 'ed25519_public_key';
      requestedAccountId?: never;
      sponsor?: never;
    }
  | {
      kind: 'sponsored_named_account';
      requestedAccountId: NamedNearAccountId;
      sponsor: 'relayer';
      accountIdSource?: never;
    };

export type ResolvedRegistrationNearAccount =
  | {
      kind: 'implicit_account';
      nearAccountId: ImplicitNearAccountId;
      nearEd25519SigningKeyId: NearEd25519SigningKeyId;
      transactionHash?: never;
    }
  | {
      kind: 'sponsored_named_account';
      nearAccountId: NamedNearAccountId;
      nearEd25519SigningKeyId: NearEd25519SigningKeyId;
      transactionHash: string;
    };

export type ThresholdEd25519RegistrationSpec = {
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

type ThresholdEcdsaRegistrationSpec = {
  chainTargets: unknown[];
  participantIds: number[];
};

export type ThresholdEd25519AddSignerSpec = {
  mode: 'create_implicit_near_account';
  signerSlot: number;
  participantIds: number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

export type ThresholdEcdsaAddSignerChainTarget =
  | {
      readonly kind: 'evm';
      readonly namespace: 'eip155';
      readonly chainId: number;
      readonly networkSlug?: string;
    }
  | {
      readonly kind: 'tempo';
      readonly chainId: number;
      readonly networkSlug?: string;
    };

export type ThresholdEcdsaAddSignerSpec = {
  chainTargets: readonly ThresholdEcdsaAddSignerChainTarget[];
  participantIds: number[];
};

export type RegistrationSignerBranchKey = string & {
  readonly __registrationSignerBranchKeyBrand: unique symbol;
};

export type RegistrationNearEd25519SignerRequest = {
  kind: 'near_ed25519';
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: readonly number[];
  derivationVersion: number;
  keyPurpose?: never;
  keyVersion?: never;
  chainTargets?: never;
};

export type RegistrationEvmFamilyEcdsaSignerRequest = {
  kind: 'evm_family_ecdsa';
  participantIds: readonly number[];
  chainTargets: readonly unknown[];
  accountProvisioning?: never;
  signerSlot?: never;
  keyPurpose?: never;
  keyVersion?: never;
  derivationVersion?: never;
};

export type RegistrationSignerRequest =
  | RegistrationNearEd25519SignerRequest
  | RegistrationEvmFamilyEcdsaSignerRequest;

export type RegistrationSignerSetSelection = {
  kind: 'signer_set';
  signers: readonly RegistrationSignerRequest[];
  mode?: never;
  ed25519?: never;
  ecdsa?: never;
};

export type RegistrationNearEd25519SignerPlan = {
  kind: 'near_ed25519';
  branchKey: RegistrationSignerBranchKey;
  accountProvisioning: RegistrationNearAccountProvisioning;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
  chainTargets?: never;
};

export type RegistrationEvmFamilyEcdsaSignerPlan = RegistrationEvmFamilyEcdsaSignerRequest & {
  branchKey: RegistrationSignerBranchKey;
};

export type RegistrationSignerPlanBranch =
  | RegistrationNearEd25519SignerPlan
  | RegistrationEvmFamilyEcdsaSignerPlan;

export type RegistrationSignerPlan = {
  kind: 'signer_set';
  branches: readonly RegistrationSignerPlanBranch[];
};

export type AddSignerSelection =
  | {
      mode: 'ed25519';
      ed25519: ThresholdEd25519AddSignerSpec;
      ecdsa?: never;
    }
  | {
      mode: 'ecdsa';
      ecdsa: ThresholdEcdsaAddSignerSpec;
      ed25519?: never;
    };

export function implicitNearAccountProvisioning(): RegistrationNearAccountProvisioning {
  return {
    kind: 'implicit_account',
    accountIdSource: 'ed25519_public_key',
  };
}

export function sponsoredNamedNearAccountProvisioning(
  requestedAccountId: NamedNearAccountId,
): RegistrationNearAccountProvisioning {
  return {
    kind: 'sponsored_named_account',
    requestedAccountId,
    sponsor: 'relayer',
  };
}

function normalizePositiveInteger(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function collectPositiveParticipantIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const participantIds: number[] = [];
  for (const id of raw) {
    const numericId = Number(id);
    if (Number.isInteger(numericId) && numericId > 0) participantIds.push(numericId);
  }
  return participantIds;
}

function normalizeUnknownArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function normalizeRegistrationNearAccountProvisioning(
  raw: unknown,
): RegistrationNearAccountProvisioning | null {
  const record = inspectRawObject(raw);
  if (!record || !('kind' in record)) return null;
  const kind = trimString(record.kind);
  switch (kind) {
    case 'implicit_account':
      if (
        Object.prototype.hasOwnProperty.call(record, 'requestedAccountId') ||
        Object.prototype.hasOwnProperty.call(record, 'sponsor')
      ) {
        return null;
      }
      return {
        kind: 'implicit_account',
        accountIdSource: 'ed25519_public_key',
      };
    case 'sponsored_named_account': {
      if (
        Object.prototype.hasOwnProperty.call(record, 'accountIdSource') ||
        !('requestedAccountId' in record)
      ) {
        return null;
      }
      const parsed = parseNamedNearAccountId(record.requestedAccountId);
      if (!parsed.ok) return null;
      return {
        kind: 'sponsored_named_account',
        requestedAccountId: parsed.value,
        sponsor: 'relayer',
      };
    }
    default:
      return null;
  }
}

function normalizeRegistrationEcdsaSpec(
  value: object | null,
): ThresholdEcdsaRegistrationSpec | null {
  if (!value) return null;
  if (!('participantIds' in value) || !('chainTargets' in value)) return null;
  const participantIds = collectPositiveParticipantIds(value.participantIds);
  const chainTargets = normalizeUnknownArray(value.chainTargets);
  if (participantIds.length === 0 || chainTargets.length === 0) return null;
  return { participantIds, chainTargets };
}

type NormalizeSignerSelectionResult<TSelection> =
  | { ok: true; value: TSelection }
  | { ok: false; code: string; message: string };

type NormalizeAddSignerSelectionOptions = {
  readonly normalizeEcdsaChainTarget: (
    target: unknown,
  ) => ThresholdEcdsaAddSignerChainTarget | null;
};

type RegistrationSignerSetSelectionFromPlanOptions = {
  readonly normalizeEcdsaChainTarget?: (target: unknown) => unknown | null;
};

const REGISTRATION_NEAR_ED25519_KEY_PURPOSE = 'near_tx';
export const NEAR_ED25519_YAO_KEY_VERSION_V1 = 'router-ab-ed25519-yao-v1';
export const REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION = 1;

export function registrationSignerBranchKeyFromString(value: string): RegistrationSignerBranchKey {
  const normalized = trimString(value);
  if (!normalized) {
    throw new Error('registration signer branch key is required');
  }
  return normalized as RegistrationSignerBranchKey;
}

export function registrationNearEd25519BranchKey(signerSlot: number): RegistrationSignerBranchKey {
  return registrationSignerBranchKeyFromString(`near_ed25519:slot:${signerSlot}`);
}

function registrationEvmFamilyEcdsaTargetKey(target: unknown): string {
  return alphabetizeStringify(target);
}

export function registrationEvmFamilyEcdsaBranchKey(
  chainTargets: readonly unknown[],
): RegistrationSignerBranchKey {
  return registrationSignerBranchKeyFromString(
    `evm_family_ecdsa:${chainTargets.map(registrationEvmFamilyEcdsaTargetKey).join('|')}`,
  );
}

function registrationSignerPlanFromRequests(
  signers: readonly RegistrationSignerRequest[],
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  return registrationSignerPlanFromBranches(signers.map(registrationSignerPlanBranchFromRequest));
}

function registrationSignerPlanFromBranches(
  branches: readonly RegistrationSignerPlanBranch[],
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  if (branches.length === 0) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'signer set must include at least one signer',
    };
  }
  const nearSlots = new Set<number>();
  const ecdsaTargetKeys = new Set<string>();
  const branchKeys = new Set<string>();
  for (const branch of branches) {
    const duplicate = findRegistrationSignerPlanDuplicate({
      branch,
      nearSlots,
      ecdsaTargetKeys,
      branchKeys,
    });
    if (duplicate) return duplicate;
  }
  return {
    ok: true,
    value: {
      kind: 'signer_set',
      branches,
    },
  };
}

function registrationSignerPlanBranchFromRequest(
  signer: RegistrationSignerRequest,
): RegistrationSignerPlanBranch {
  switch (signer.kind) {
    case 'near_ed25519':
      return {
        kind: 'near_ed25519',
        branchKey: registrationNearEd25519BranchKey(signer.signerSlot),
        accountProvisioning: signer.accountProvisioning,
        signerSlot: signer.signerSlot,
        participantIds: signer.participantIds,
        keyPurpose: REGISTRATION_NEAR_ED25519_KEY_PURPOSE,
        keyVersion: NEAR_ED25519_YAO_KEY_VERSION_V1,
        derivationVersion: signer.derivationVersion,
      };
    case 'evm_family_ecdsa':
      return {
        kind: 'evm_family_ecdsa',
        branchKey: registrationEvmFamilyEcdsaBranchKey(signer.chainTargets),
        participantIds: signer.participantIds,
        chainTargets: signer.chainTargets,
      };
    default:
      return assertNeverRegistrationSignerRequest(signer);
  }
}

function findRegistrationSignerPlanDuplicate(input: {
  readonly branch: RegistrationSignerPlanBranch;
  readonly nearSlots: Set<number>;
  readonly ecdsaTargetKeys: Set<string>;
  readonly branchKeys: Set<string>;
}): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  switch (input.branch.kind) {
    case 'near_ed25519':
      if (input.nearSlots.has(input.branch.signerSlot)) {
        return {
          ok: false,
          code: 'invalid_body',
          message: 'duplicate near_ed25519 signer slot is invalid',
        };
      }
      input.nearSlots.add(input.branch.signerSlot);
      break;
    case 'evm_family_ecdsa':
      {
        const duplicateTarget = findDuplicateRegistrationEcdsaTarget(
          input.branch,
          input.ecdsaTargetKeys,
        );
        if (duplicateTarget) return duplicateTarget;
      }
      break;
    default:
      return assertNeverRegistrationSignerPlanBranch(input.branch);
  }
  return findDuplicateRegistrationSignerBranch(input.branch, input.branchKeys);
}

function findDuplicateRegistrationSignerBranch(
  branch: RegistrationSignerPlanBranch,
  branchKeys: Set<string>,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  const branchKey = String(branch.branchKey);
  if (branchKeys.has(branchKey)) {
    return { ok: false, code: 'invalid_body', message: 'duplicate signer branch is invalid' };
  }
  branchKeys.add(branchKey);
  return null;
}

function findDuplicateRegistrationEcdsaTarget(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  ecdsaTargetKeys: Set<string>,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> | null {
  for (const target of branch.chainTargets) {
    const targetKey = registrationEvmFamilyEcdsaTargetKey(target);
    if (ecdsaTargetKeys.has(targetKey)) {
      return {
        ok: false,
        code: 'invalid_body',
        message: 'duplicate evm_family_ecdsa chain target is invalid',
      };
    }
    ecdsaTargetKeys.add(targetKey);
  }
  return null;
}

function normalizeRegistrationSignerRequest(
  raw: unknown,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signer set entry must be an object' };
  }
  if (!('kind' in record)) {
    return { ok: false, code: 'invalid_body', message: 'unsupported registration signer kind' };
  }
  const kind = trimString(record.kind);
  switch (kind) {
    case 'near_ed25519':
      return normalizeRegistrationNearEd25519SignerRequest(record);
    case 'evm_family_ecdsa':
      return normalizeRegistrationEvmFamilyEcdsaSignerRequest(record);
    default:
      return { ok: false, code: 'invalid_body', message: 'unsupported registration signer kind' };
  }
}

function normalizeRegistrationNearEd25519SignerRequest(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  if (
    Object.prototype.hasOwnProperty.call(raw, 'keyPurpose') ||
    Object.prototype.hasOwnProperty.call(raw, 'keyVersion')
  ) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'near_ed25519 signer spec cannot include protocol key fields',
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(raw, 'nearAccountId') ||
    Object.prototype.hasOwnProperty.call(raw, 'createNearAccount')
  ) {
    return { ok: false, code: 'invalid_body', message: 'near_ed25519 signer spec is invalid' };
  }
  const accountProvisioning = normalizeRegistrationNearAccountProvisioning(
    'accountProvisioning' in raw ? raw.accountProvisioning : undefined,
  );
  const signerSlot = normalizePositiveInteger('signerSlot' in raw ? raw.signerSlot : undefined, 0);
  const derivationVersion = Number('derivationVersion' in raw ? raw.derivationVersion : undefined);
  const participantIds = collectPositiveParticipantIds(
    'participantIds' in raw ? raw.participantIds : undefined,
  );
  if (
    !accountProvisioning ||
    signerSlot < 1 ||
    participantIds.length === 0 ||
    derivationVersion !== REGISTRATION_NEAR_ED25519_YAO_DERIVATION_VERSION
  ) {
    return { ok: false, code: 'invalid_body', message: 'near_ed25519 signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      kind: 'near_ed25519',
      accountProvisioning,
      signerSlot,
      participantIds,
      derivationVersion,
    },
  };
}

function normalizeRegistrationEvmFamilyEcdsaSignerRequest(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  const ecdsa = normalizeRegistrationEcdsaSpec(raw);
  if (!ecdsa) {
    return { ok: false, code: 'invalid_body', message: 'evm_family_ecdsa signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      kind: 'evm_family_ecdsa',
      participantIds: ecdsa.participantIds,
      chainTargets: ecdsa.chainTargets,
    },
  };
}

function normalizeRegistrationSignerSetPlan(
  raw: object,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  if (!('signers' in raw) || !Array.isArray(raw.signers)) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection.signers must be an array' };
  }
  const signers: RegistrationSignerRequest[] = [];
  for (const rawSigner of raw.signers) {
    const signer = normalizeRegistrationSignerRequest(rawSigner);
    if (!signer.ok) return signer;
    signers.push(signer.value);
  }
  return registrationSignerPlanFromRequests(signers);
}

export function normalizeRegistrationSignerPlan(
  raw: unknown,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection must be an object' };
  }
  if (!('kind' in record)) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection.kind must be signer_set' };
  }
  if (trimString(record.kind) === 'signer_set') {
    return normalizeRegistrationSignerSetPlan(record);
  }
  return { ok: false, code: 'invalid_body', message: 'signerSelection.kind must be signer_set' };
}

export function registrationSignerPlanFromSelection(
  selection: RegistrationSignerSetSelection,
): NormalizeSignerSelectionResult<RegistrationSignerPlan> {
  return registrationSignerPlanFromRequests(selection.signers);
}

export function findRegistrationSignerPlanNearEd25519Branch(
  plan: RegistrationSignerPlan,
): RegistrationNearEd25519SignerPlan | null {
  for (const branch of plan.branches) {
    if (branch.kind === 'near_ed25519') return branch;
  }
  return null;
}

export function findRegistrationSignerPlanEvmFamilyEcdsaBranch(
  plan: RegistrationSignerPlan,
): RegistrationEvmFamilyEcdsaSignerPlan | null {
  for (const branch of plan.branches) {
    if (branch.kind === 'evm_family_ecdsa') return branch;
  }
  return null;
}

export function registrationSignerSetSelectionFromPlan(
  plan: RegistrationSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions = {},
): NormalizeSignerSelectionResult<RegistrationSignerSetSelection> {
  const signers: RegistrationSignerRequest[] = [];
  for (const branch of plan.branches) {
    const signer = registrationSignerRequestFromPlanBranchForSelection(branch, options);
    if (!signer.ok) return signer;
    signers.push(signer.value);
  }
  return {
    ok: true,
    value: {
      kind: 'signer_set',
      signers,
    },
  };
}

function registrationSignerRequestFromPlanBranchForSelection(
  branch: RegistrationSignerPlanBranch,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): NormalizeSignerSelectionResult<RegistrationSignerRequest> {
  switch (branch.kind) {
    case 'near_ed25519':
      return {
        ok: true,
        value: registrationNearEd25519RequestFromPlanBranch(branch),
      };
    case 'evm_family_ecdsa':
      return registrationEvmFamilyEcdsaRequestFromPlanBranch(branch, options);
    default:
      return assertNeverRegistrationSignerPlanBranch(branch);
  }
}

function registrationNearEd25519RequestFromPlanBranch(
  branch: RegistrationNearEd25519SignerPlan,
): RegistrationNearEd25519SignerRequest {
  return {
    kind: 'near_ed25519',
    accountProvisioning: branch.accountProvisioning,
    signerSlot: branch.signerSlot,
    participantIds: [...branch.participantIds],
    derivationVersion: branch.derivationVersion,
  };
}

function registrationEvmFamilyEcdsaRequestFromPlanBranch(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): NormalizeSignerSelectionResult<RegistrationEvmFamilyEcdsaSignerRequest> {
  const chainTargets = registrationEcdsaChainTargetsFromPlanBranch(branch, options);
  if (!chainTargets) {
    return {
      ok: false,
      code: 'invalid_body',
      message: 'registration ECDSA chainTargets are invalid',
    };
  }
  return {
    ok: true,
    value: {
      kind: 'evm_family_ecdsa',
      participantIds: [...branch.participantIds],
      chainTargets,
    },
  };
}

function registrationEcdsaChainTargetsFromPlanBranch(
  branch: RegistrationEvmFamilyEcdsaSignerPlan,
  options: RegistrationSignerSetSelectionFromPlanOptions,
): unknown[] | null {
  if (!options.normalizeEcdsaChainTarget) return [...branch.chainTargets];
  const chainTargets: unknown[] = [];
  for (const target of branch.chainTargets) {
    const normalized = options.normalizeEcdsaChainTarget(target);
    if (!normalized) return null;
    chainTargets.push(normalized);
  }
  return chainTargets;
}

function assertNeverRegistrationSignerRequest(value: never): never {
  throw new Error(`Unsupported registration signer request: ${String(value)}`);
}

function assertNeverRegistrationSignerPlanBranch(value: never): never {
  throw new Error(`Unsupported registration signer plan branch: ${String(value)}`);
}

export function normalizeAddSignerSelection(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const record = inspectRawObject(raw);
  if (!record) {
    return { ok: false, code: 'invalid_body', message: 'signerSelection must be an object' };
  }
  if (!('mode' in record)) {
    return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
  }
  const mode = trimString(record.mode);
  if (mode === 'ecdsa') {
    return normalizeAddSignerEcdsaSelection('ecdsa' in record ? record.ecdsa : undefined, options);
  }
  if (mode === 'ed25519') {
    return normalizeAddSignerEd25519Selection(
      'ed25519' in record ? record.ed25519 : undefined,
    );
  }
  return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
}

function normalizeAddSignerEcdsaSelection(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const ecdsaRecord = inspectRawObject(raw);
  const participantIds = collectPositiveParticipantIds(
    ecdsaRecord && 'participantIds' in ecdsaRecord ? ecdsaRecord.participantIds : undefined,
  );
  const chainTargets = normalizeAddSignerEcdsaChainTargets(
    ecdsaRecord && 'chainTargets' in ecdsaRecord ? ecdsaRecord.chainTargets : undefined,
    options,
  );
  if (participantIds.length === 0 || chainTargets.length === 0) {
    return { ok: false, code: 'invalid_body', message: 'ecdsa add-signer spec is invalid' };
  }
  return {
    ok: true,
    value: {
      mode: 'ecdsa',
      ecdsa: {
        chainTargets,
        participantIds,
      },
    },
  };
}

function normalizeAddSignerEcdsaChainTargets(
  raw: unknown,
  options: NormalizeAddSignerSelectionOptions,
): ThresholdEcdsaAddSignerChainTarget[] {
  if (!Array.isArray(raw)) return [];
  const chainTargets: ThresholdEcdsaAddSignerChainTarget[] = [];
  for (const target of raw) {
    const normalized = options.normalizeEcdsaChainTarget(target);
    if (!normalized) return [];
    chainTargets.push(normalized);
  }
  return chainTargets;
}

function normalizeAddSignerEd25519Selection(
  raw: unknown,
): NormalizeSignerSelectionResult<AddSignerSelection> {
  const ed25519Record = inspectRawObject(raw);
  const ed25519Mode = trimString(
    ed25519Record && 'mode' in ed25519Record ? ed25519Record.mode : undefined,
  );
  const signerSlot = normalizePositiveInteger(
    ed25519Record && 'signerSlot' in ed25519Record ? ed25519Record.signerSlot : undefined,
    1,
  );
  const keyPurpose = trimString(
    ed25519Record && 'keyPurpose' in ed25519Record ? ed25519Record.keyPurpose : undefined,
  );
  const keyVersion = trimString(
    ed25519Record && 'keyVersion' in ed25519Record ? ed25519Record.keyVersion : undefined,
  );
  const derivationVersion = normalizePositiveInteger(
    ed25519Record && 'derivationVersion' in ed25519Record
      ? ed25519Record.derivationVersion
      : undefined,
    0,
  );
  const participantIds = collectPositiveParticipantIds(
    ed25519Record && 'participantIds' in ed25519Record ? ed25519Record.participantIds : undefined,
  );
  if (!keyPurpose || !keyVersion || !derivationVersion || participantIds.length === 0) {
    return { ok: false, code: 'invalid_body', message: 'ed25519 add-signer spec is invalid' };
  }
  if (ed25519Mode === 'create_implicit_near_account') {
    return {
      ok: true,
      value: {
        mode: 'ed25519',
        ed25519: {
          mode: ed25519Mode,
          signerSlot,
          participantIds,
          keyPurpose,
          keyVersion,
          derivationVersion,
        },
      },
    };
  }
  return { ok: false, code: 'invalid_body', message: 'unsupported add-signer mode' };
}
