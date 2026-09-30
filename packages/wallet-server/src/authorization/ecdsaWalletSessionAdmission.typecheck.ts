import type { AuthorizedOperation, AuthorizedOperationInput } from './domain';
import type { EcdsaMaterialActivationScope } from './service';
import type {
  EcdsaWalletSessionAdmissionInput,
  EcdsaWalletSessionAdmissionResult,
  PinnedOwnerWalletScope,
} from './ecdsaWalletSessionAdmission';

declare const operation: AuthorizedOperation;
declare const ownerScope: PinnedOwnerWalletScope;
declare const material: EcdsaMaterialActivationScope;
declare const generalInput: AuthorizedOperationInput;
declare const raw: unknown;

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

void [claimed, replayed, missingScope, replayWithScope, rejectedClaim, unscopedProgress, broadInput, rawResult];
