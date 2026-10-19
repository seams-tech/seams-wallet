import type { RegistrationCommitExecution } from './walletRegistrationSessionCommitReceipt';
import type { RouterAbEd25519YaoPreparedWriteV1 } from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';

/** Custody, home activation and the replay receipt share one durable transaction. */
export function registrationCommitCompletionWrite<T>(
  execution: RegistrationCommitExecution<T>,
): RouterAbEd25519YaoPreparedWriteV1 | null {
  switch (execution.kind) {
    case 'unissued':
    case 'replayed':
      return null;
    case 'session_issued':
    case 'session_issued_with_installation_projection':
      if (!execution.custodyWrite) return execution.activation;
      return {
        statements: [
          ...execution.custodyWrite.statements,
          ...(execution.activation?.statements ?? []),
        ],
      };
    default:
      return assertNever(execution);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown registration completion state: ${String(value)}`);
}
