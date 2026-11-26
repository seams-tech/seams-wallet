import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { withThresholdCommitQueue, type ThresholdCommitQueueByKey } from '../commitQueueShared';

export {
  clearThresholdCommitQueue as clearThresholdEcdsaSigningQueue,
  resolveThresholdCommitQueueKey as resolveThresholdEcdsaSigningQueueKey,
} from '../commitQueueShared';

export type ThresholdEcdsaSigningQueueByKey = ThresholdCommitQueueByKey;

export async function withThresholdEcdsaSigningQueue<T>(args: {
  queueByKey: ThresholdEcdsaSigningQueueByKey;
  queueKey: string;
  walletId: WalletId;
  enabled: boolean;
  shouldAbort?: () => boolean;
  maxQueueLength?: number;
  queueTimeoutMs?: number;
  task: () => Promise<T>;
}): Promise<T> {
  return await withThresholdCommitQueue({
    ...args,
    labels: {
      queue: 'threshold ECDSA signing queue',
      queuedOperation: 'threshold ECDSA queued signing operation',
    },
    owner: String(args.walletId).trim(),
  });
}
