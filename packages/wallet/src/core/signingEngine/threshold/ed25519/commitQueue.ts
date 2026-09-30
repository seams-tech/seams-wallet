import { type AccountId } from '@/core/types/accountIds';
import { withThresholdCommitQueue, type ThresholdCommitQueueByKey } from '../commitQueueShared';

export { resolveThresholdCommitQueueKey as resolveThresholdEd25519CommitQueueKey } from '../commitQueueShared';

export type ThresholdEd25519CommitQueueByKey = ThresholdCommitQueueByKey;

export async function withThresholdEd25519CommitQueue<T>(args: {
  queueByKey: ThresholdEd25519CommitQueueByKey;
  queueKey: string;
  nearAccountId: AccountId;
  enabled: boolean;
  shouldAbort?: () => boolean;
  maxQueueLength?: number;
  queueTimeoutMs?: number;
  task: () => Promise<T>;
}): Promise<T> {
  return await withThresholdCommitQueue({
    ...args,
    labels: {
      queue: 'threshold Ed25519 commit queue',
      queuedOperation: 'threshold Ed25519 queued commit',
    },
    owner: String(args.nearAccountId),
  });
}
