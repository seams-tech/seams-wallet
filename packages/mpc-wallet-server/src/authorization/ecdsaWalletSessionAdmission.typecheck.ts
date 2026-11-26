import type { AuthorizedOperation, AuthorizedOperationInput } from './domain';
import type { Variant } from '@shared/utils/variant';
import type {
  AuthorizedOperationWireInput,
  OperationStepUpBinding,
} from '../router/domains/signingOperations/authorizedOperationWire';
import type {
  EcdsaWalletSessionAdmissionInput,
  EcdsaWalletSessionAdmissionResult,
  PinnedOwnerWalletScope,
} from './ecdsaWalletSessionAdmission';

declare const operation: AuthorizedOperation;
declare const ownerScope: PinnedOwnerWalletScope;
declare const material: EcdsaWalletSessionAdmissionInput['material'];
declare const generalInput: AuthorizedOperationInput;
declare const raw: unknown;

type OwnerBinding = Variant<
  AuthorizedOperationWireInput['binding'],
  'kind',
  'gateway_owner_wallet_session'
>;
declare const unpinnedOwnerBinding: Omit<OwnerBinding, 'ownershipGeneration'>;
declare const unpinnedStepUpBinding: Omit<OperationStepUpBinding, 'ownershipGeneration'>;
// @ts-expect-error Gateway owner admission must carry its persisted generation.
const ownerWithoutGeneration: OwnerBinding = unpinnedOwnerBinding;
// @ts-expect-error A spread cannot turn unpinned step-up data into a dispatch binding.
const stepUpWithoutGeneration: OperationStepUpBinding = { ...unpinnedStepUpBinding };
void [ownerWithoutGeneration, stepUpWithoutGeneration];

// @ts-expect-error Dispatch requires the generation pinned with the operation.
const unpinnedScope: PinnedOwnerWalletScope = {
  orgId: 'org',
  projectId: 'project',
  projectEnvironmentId: 'environment',
};

const claimed = { kind: 'claimed', operation, ownerScope } satisfies EcdsaWalletSessionAdmissionResult;
const replayed = { kind: 'replayed', operation } satisfies EcdsaWalletSessionAdmissionResult;

// @ts-expect-error A claim must carry its verified persisted scope.
const missingScope: EcdsaWalletSessionAdmissionResult = { kind: 'claimed', operation };
// @ts-expect-error A replay cannot acquire an owner scope through a broad spread.
const replayWithScope: EcdsaWalletSessionAdmissionResult = { ...claimed, kind: 'replayed' };
// @ts-expect-error A rejection cannot retain a successful operation or scope.
const rejectedClaim: EcdsaWalletSessionAdmissionResult = { ...claimed, kind: 'material_mismatch' };
// @ts-expect-error A replay spread cannot become an in-progress receipt without scope.
const unscopedProgress: EcdsaWalletSessionAdmissionResult = { ...replayed, kind: 'operation_in_progress' };
// @ts-expect-error Generic operations include step-up and export inputs that this entry point rejects.
const broadInput: EcdsaWalletSessionAdmissionInput = { operation: generalInput, material };
// @ts-expect-error Raw storage values must be parsed before becoming admission results.
const rawResult: EcdsaWalletSessionAdmissionResult = raw;

void [
  claimed,
  replayed,
  missingScope,
  replayWithScope,
  rejectedClaim,
  unscopedProgress,
  broadInput,
  rawResult,
  unpinnedScope,
];
