import { secureRandomId } from '@shared/utils/secureRandomId';
import type { Stage } from './stageHost';

type ExpectedSender = {
  readonly origin: string;
  readonly source: MessageEventSource | null;
};

/** A window message counts only from the expected window at the expected origin. */
export function isMessageFrom(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  expected: ExpectedSender,
): boolean {
  return (
    expected.source !== null &&
    event.source === expected.source &&
    event.origin !== 'null' &&
    event.origin === expected.origin
  );
}

export type RequestLedger = {
  /** Opens a request and returns its new random ID. */
  open(): string;
  isOpen(requestId: unknown): boolean;
  /** True once for each open request: the first reply settles it, and a repeat is refused. */
  settle(requestId: unknown): boolean;
};

export function createRequestLedger(prefix = 'request'): RequestLedger {
  const open = new Set<string>();
  return {
    open() {
      const requestId = secureRandomId(prefix, 16);
      open.add(requestId);
      return requestId;
    },
    isOpen(requestId) {
      return typeof requestId === 'string' && open.has(requestId);
    },
    settle(requestId) {
      return typeof requestId === 'string' && open.delete(requestId);
    },
  };
}

/** A message that acts on a stage, such as a size, counts only for the current stage. */
export function isCurrentStageMessage(stage: Stage, instance: unknown): boolean {
  return typeof instance === 'string' && instance === stage.instance && stage.isCurrent();
}
