import type { NearProvisioningState } from '@/core/types/seams';
import type { WalletId } from '@shared/utils/registrationIntent';

/**
 * Refactor 94 Phase 6. Page-owned NEAR provisioning state for wallets that
 * registered ECDSA-ready.
 *
 * Registration returns before the Ed25519/NEAR branch settles, so the outcome
 * of that deferred work has nowhere to go on the already-returned
 * `RegistrationResult` — it has crossed the postMessage boundary and must not
 * be mutated. This registry is where the outcome is published instead:
 * subscribers observe it live, and the durable local wallet record carries it
 * across reloads.
 *
 * The in-flight promise doubles as the same-tab single-flight. Concurrent
 * first-NEAR requests join one attempt rather than racing two commits against
 * the same registration ceremony.
 */

export type NearProvisioningListener = (walletId: WalletId, state: NearProvisioningState) => void;

type WalletEntry = {
  state: NearProvisioningState;
  inFlight: Promise<NearProvisioningState> | null;
};

const entries = new Map<string, WalletEntry>();
const listeners = new Set<NearProvisioningListener>();

function notify(walletId: WalletId, state: NearProvisioningState): void {
  for (const listener of listeners) {
    try {
      listener(walletId, state);
    } catch {
      /* A failing subscriber must not stall provisioning or the subscribers
         registered after it. */
    }
  }
}

function entryFor(walletId: WalletId, nowMs: number): WalletEntry {
  const key = String(walletId);
  const existing = entries.get(key);
  if (existing) return existing;
  const created: WalletEntry = {
    state: { status: 'near_pending', updatedAtMs: nowMs },
    inFlight: null,
  };
  entries.set(key, created);
  return created;
}

export function readNearProvisioningState(walletId: WalletId): NearProvisioningState | null {
  return entries.get(String(walletId))?.state ?? null;
}

export async function awaitNearProvisioningInFlight(
  walletId: WalletId,
): Promise<NearProvisioningState | null> {
  const entry = entries.get(String(walletId));
  if (!entry) return null;
  return entry.inFlight ? await entry.inFlight : entry.state;
}

export function publishNearProvisioningState(
  walletId: WalletId,
  state: NearProvisioningState,
): void {
  const entry = entryFor(walletId, state.updatedAtMs);
  if (entry.state.status === 'near_ready' && state.status !== 'near_ready') return;
  entry.state = state;
  notify(walletId, state);
}

export function subscribeToNearProvisioning(listener: NearProvisioningListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs `attempt` as the wallet's single provisioning attempt, or joins the one
 * already in flight. The returned promise never rejects: a thrown attempt
 * becomes a published `near_failed_retryable`, because the ECDSA wallet is
 * already durable and must not be faulted by this.
 */
export function runSingleFlightNearProvisioning(args: {
  walletId: WalletId;
  nowMs: () => number;
  attempt: () => Promise<NearProvisioningState>;
}): Promise<NearProvisioningState> {
  const entry = entryFor(args.walletId, args.nowMs());
  if (entry.inFlight) return entry.inFlight;
  if (entry.state.status === 'near_ready') return Promise.resolve(entry.state);

  publishNearProvisioningState(args.walletId, {
    status: 'near_provisioning',
    updatedAtMs: args.nowMs(),
  });

  const inFlight = (async (): Promise<NearProvisioningState> => {
    try {
      return await args.attempt();
    } catch (error: unknown) {
      return {
        status: 'near_failed_retryable',
        updatedAtMs: args.nowMs(),
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'near_provisioning_failed',
      };
    }
  })().then((state) => {
    entry.inFlight = null;
    publishNearProvisioningState(args.walletId, state);
    return state;
  });

  entry.inFlight = inFlight;
  return inFlight;
}
