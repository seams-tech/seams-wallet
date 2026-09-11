import type {
  SignerWorkerOperationRequest,
  SignerWorkerOperationResult,
  WalletCustodyCeremonyWorkerOperationMap,
} from '../workerManager/workerTypes';
import type { WalletCustodyCeremonyStepRunner } from './ceremonyDriver';
import type { WorkerOperationContext } from '../workerManager/executeWorkerOperation';

/**
 * Turns the worker transport into the ceremony driver's step runner.
 *
 * The driver deliberately takes a runner rather than a transport, so it can be
 * exercised without a worker at all. This adapter is the one place that knows
 * both shapes, and it is where the ceremony's channel name is spelled — one
 * spelling, so a run cannot be dispatched to a worker that does not hold its
 * state.
 *
 * The transport is typed structurally rather than by importing the concrete
 * class: this module is on the registration path, and depending on the whole
 * worker manager to send three messages would drag its graph along with it.
 */

export type WalletCustodyCeremonyTransportPort = {
  requestOperation<T extends WalletCustodyCeremonyOperationType>(
    operation: WalletCustodyCeremonyOperation<T>,
  ): Promise<WalletCustodyCeremonyOperationResult<T>>;
};

export type WalletCustodyCeremonyOperationType =
  keyof WalletCustodyCeremonyWorkerOperationMap;

export type WalletCustodyCeremonyOperation<T extends WalletCustodyCeremonyOperationType> = {
  kind: 'walletCustodyCeremony';
  request: SignerWorkerOperationRequest<'walletCustodyCeremony', T>;
};

export type WalletCustodyCeremonyOperationResult<
  T extends WalletCustodyCeremonyOperationType,
> = SignerWorkerOperationResult<'walletCustodyCeremony', T>;

export function requestWalletCustodyCeremonyOperation<T extends WalletCustodyCeremonyOperationType>(
  workerContext: WorkerOperationContext,
  operation: WalletCustodyCeremonyOperation<T>,
): Promise<WalletCustodyCeremonyOperationResult<T>> {
  return workerContext.requestWorkerOperation(operation);
}

/* One worker, keyed by ceremony id, across all three steps: the seed and the
   owner roots live in its wasm state between them, so a step routed elsewhere
   would find no run to continue. */
function runWalletCustodyCeremonyStep<T extends WalletCustodyCeremonyOperationType>(
  transport: WalletCustodyCeremonyTransportPort,
  type: T,
  payload: WalletCustodyCeremonyWorkerOperationMap[T]['payload'],
): Promise<WalletCustodyCeremonyOperationResult<T>> {
  return transport.requestOperation({
    kind: 'walletCustodyCeremony',
    request: { type, payload },
  });
}

export function walletCustodyCeremonyStepRunner(
  transport: WalletCustodyCeremonyTransportPort,
): WalletCustodyCeremonyStepRunner {
  return runWalletCustodyCeremonyStep.bind(undefined, transport);
}
