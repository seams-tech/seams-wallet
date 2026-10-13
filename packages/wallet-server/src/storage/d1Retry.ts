/**
 * The faults Cloudflare documents as safe to retry for D1: the connection to
 * the database dropped, or the database restarted under the query. The request
 * itself was sound. D1 retries read-only queries on its own; writes reach the
 * caller.
 */
const TRANSIENT_D1_ERROR_FRAGMENTS = [
  'Network connection lost',
  'storage caused object to be reset',
  'reset because its code was updated',
] as const;

/** One wait before each retry, so an operation runs three times at most. */
const TRANSIENT_D1_RETRY_DELAYS_MS = [25, 100] as const;

export function isTransientD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_D1_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/**
 * Runs `operation` again after a transient D1 fault. Such a fault does not say
 * whether a write committed, so `operation` must give the same result when it
 * runs after its own earlier commit: reads, `INSERT OR IGNORE`, and conditional
 * writes that accept their own outcome. It must build its statements on each
 * run. Every other error, and the last transient one, reaches the caller.
 */
export async function retryTransientD1<T>(operation: () => Promise<T>): Promise<T> {
  for (const delayMs of TRANSIENT_D1_RETRY_DELAYS_MS) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isTransientD1Error(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return await operation();
}
