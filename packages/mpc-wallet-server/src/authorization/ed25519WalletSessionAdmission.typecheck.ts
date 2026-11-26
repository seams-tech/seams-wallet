import type { AuthorizedOperationInput } from './domain';
import type { WalletId } from '@shared/utils/domainIds';
import type {
  Ed25519WalletSessionAdmissionInput,
  Ed25519WalletSessionAdmissionResult,
  Ed25519WalletSessionResolutionResult,
} from './ed25519WalletSessionAdmission';

declare const generalInput: AuthorizedOperationInput;
declare const walletId: WalletId;
declare const sessionInput: Ed25519WalletSessionAdmissionInput['operation'];
declare const admitted: Ed25519WalletSessionAdmissionResult;
declare const resolved: Ed25519WalletSessionResolutionResult;

// @ts-expect-error Generic operations include step-up, export and ECDSA inputs that this entry point rejects.
const broadInput: Ed25519WalletSessionAdmissionInput = { operation: generalInput, walletId };
// @ts-expect-error The admission pins the scope for one wallet; it cannot be left out.
const unpinnedInput: Ed25519WalletSessionAdmissionInput = { operation: sessionInput };
// @ts-expect-error A finalize request cannot claim an operation its prepare never admitted.
const claimedResolution: Ed25519WalletSessionResolutionResult = admitted;

if (admitted.kind === 'claimed' || admitted.kind === 'operation_in_progress') {
  void admitted.ownerScope.ownershipGeneration;
}
if (resolved.kind === 'replayed') {
  // @ts-expect-error A completed operation replays its response and carries no owner scope.
  void resolved.ownerScope.ownershipGeneration;
}

void [broadInput, unpinnedInput, claimedResolution];
