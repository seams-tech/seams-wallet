import type { SigningSessionStatus } from '@/core/types/seams';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  createSigningSessionExpiredEvent,
  type SdkLifecycleEvent,
  type SdkLifecycleEventListener,
  type SigningSessionExpiredEvent,
  type SigningSessionExpiryDetectionSource,
} from '@/core/types/sdkSentEvents';
import {
  createSigningPlannerDecisionTraceEvent,
  planSigningSession,
  type SigningPlannerDecisionTraceEvent,
  type EcdsaSigningSessionReadiness,
  type Ed25519SigningSessionReadiness,
  type SigningSessionPlannerInput,
  type SigningSessionReadiness,
} from './planning/planner';
import {
  type SigningSessionStatusCheck,
  type SigningSessionStatusReader,
} from './lifecycle/walletSessionStatus';
import type { SigningAdmissionQueueKey } from './operationState/authorizationAdmission';
import { SigningOperationIdBindingRegistry } from './planning/operationIdBinding';
import {
  clearWalletSession,
  discoverLanesForWallet,
  normalizeNonEmpty,
  readDirectSigningSessionStatusForTargets,
  readClaimsForLanes,
  readWalletScopedLaneClaimsForWallet,
  statusFromClaim,
  walletScopedClaimsForLanes,
  type WalletSessionReadinessDeps,
  type WalletSessionStatusOverride,
} from './availability/readiness';
import {
  ClientWalletSessionExpiryInvalidator,
  type ClientWalletSessionExpiryInvalidationResult,
  type ClientWalletSessionInvalidationReadinessDeps,
  type WalletSessionExpiredEvent,
} from './availability/clientSessionExpiryInvalidator';
import type { ExpiredWalletSessionAuthorizationState } from './identity/clientSessionPersistenceState';
import type {
  SelectedEcdsaSigningSessionPlanningLane,
  SelectedEd25519SigningSessionPlanningLane,
  SigningOperationFingerprint,
  SigningOperationId,
  SigningSessionPlan,
} from './operationState/types';
import type { WarmSessionPrfClaim } from './warmCapabilities/types';
import { toWalletId, type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  requiredSigningSubjectForExactSigningLane,
  resolveExactWalletSessionOperationCredential,
  type ExactWalletSessionReadPorts,
} from './identity/exactWalletSessionCredential';
import {
  resolveActiveAuthorizedRouterAbEd25519WalletSessionState,
  type AuthorizedRouterAbEd25519WalletSessionState,
  type ResolvedRouterAbEd25519WalletSessionState,
} from './warmCapabilities/routerAbEd25519WalletSessionState';

export type { WalletSessionStatusIdentity } from './lifecycle/walletSessionStatus';

export type { SigningSessionReadiness };

type ResolveSigningSessionAuthPlanFromReadinessOptions = {
  expiresAtMs?: number;
  remainingUses?: number;
  forceFreshAuth?: boolean;
  sensitiveOperationPolicy?: SigningSessionPlannerInput['sensitiveOperationPolicy'];
};

type ResolveEd25519SigningSessionAuthPlanFromReadinessInput =
  ResolveSigningSessionAuthPlanFromReadinessOptions & {
    lane: SelectedEd25519SigningSessionPlanningLane;
    readiness: Ed25519SigningSessionReadiness;
  };

type ResolveEcdsaSigningSessionAuthPlanFromReadinessInput =
  ResolveSigningSessionAuthPlanFromReadinessOptions & {
    lane: SelectedEcdsaSigningSessionPlanningLane;
    readiness: EcdsaSigningSessionReadiness;
  };

type ResolveSigningSessionAuthPlanFromReadinessInput =
  | ResolveEd25519SigningSessionAuthPlanFromReadinessInput
  | ResolveEcdsaSigningSessionAuthPlanFromReadinessInput;

function isEd25519SigningSessionAuthPlanInput(
  input: ResolveSigningSessionAuthPlanFromReadinessInput,
): input is ResolveEd25519SigningSessionAuthPlanFromReadinessInput {
  return input.lane.curve === 'ed25519' && input.readiness.curve === 'ed25519';
}

function isEcdsaSigningSessionAuthPlanInput(
  input: ResolveSigningSessionAuthPlanFromReadinessInput,
): input is ResolveEcdsaSigningSessionAuthPlanFromReadinessInput {
  return input.lane.curve === 'ecdsa' && input.readiness.curve === 'ecdsa';
}

export type ResolveSigningSessionAuthPlanFromReadinessResult =
  | {
      signingSessionPlan: SigningSessionPlan;
      readiness: Ed25519SigningSessionReadiness;
      expiresAtMs: number;
      remainingUses: number;
    }
  | {
      signingSessionPlan: SigningSessionPlan;
      readiness: EcdsaSigningSessionReadiness;
      expiresAtMs: number;
      remainingUses: number;
    };

type SigningSessionStatusPort = {
  getStatus(args: {
    walletId: WalletId | string;
    walletSessionId: WalletSessionId;
    quotaId: MpcWalletSigningQuotaId;
    targetThresholdSessionIds?: string[];
    sessionStatusCheck?: SigningSessionStatusCheck;
  }): Promise<SigningSessionStatus | null>;
  getLaneClaimsForWallet(
    walletId: WalletId | string,
  ): Promise<Map<string, WarmSessionPrfClaim | null>>;
  clear(args: {
    walletId: WalletId | string;
    walletSessionId: WalletSessionId;
    quotaId: MpcWalletSigningQuotaId;
  }): Promise<void>;
};

type SigningSessionStatusState = {
  statusOverrides: Map<string, WalletSessionStatusOverride>;
};

type SigningSessionCoordinatorDeps = WalletSessionReadinessDeps &
  ClientWalletSessionInvalidationReadinessDeps & {
    exactWalletSessionReadPorts: ExactWalletSessionReadPorts;
    getStatus?: SigningSessionStatusReader;
    onPlannerTrace?: (event: SigningPlannerDecisionTraceEvent) => void;
  };

export interface SigningSessionLifecycleSubscription {
  unsubscribe(): void;
}

type SigningSessionExpiryInvalidationResult =
  | {
      readonly kind: 'invalidated';
      readonly event: SigningSessionExpiredEvent;
    }
  | Extract<
      ClientWalletSessionExpiryInvalidationResult,
      { readonly kind: 'already_invalidated' | 'unavailable' }
    >;

class SigningSessionLifecycleSubscriptionHandle implements SigningSessionLifecycleSubscription {
  readonly #listeners: Set<SdkLifecycleEventListener>;
  readonly #listener: SdkLifecycleEventListener;
  #active = true;

  constructor(args: {
    readonly listeners: Set<SdkLifecycleEventListener>;
    readonly listener: SdkLifecycleEventListener;
  }) {
    this.#listeners = args.listeners;
    this.#listener = args.listener;
  }

  unsubscribe(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#listeners.delete(this.#listener);
  }
}

function mapWalletSessionExpiredEvent(args: {
  readonly event: WalletSessionExpiredEvent;
  readonly source: SigningSessionExpiryDetectionSource;
}): SigningSessionExpiredEvent {
  return createSigningSessionExpiredEvent({
    walletId: args.event.walletId,
    walletSessionId: args.event.walletSessionId,
    authMethod: args.event.authMethod,
    expiresAtMs: args.event.expiresAtMs,
    detectedAtMs: args.event.detectedAtMs,
    source: args.source,
  });
}

export class SigningSessionCoordinator implements SigningSessionStatusPort {
  private readonly onPlannerTrace?: (event: SigningPlannerDecisionTraceEvent) => void;
  private readonly walletSessionStatusReader?: SigningSessionStatusReader;
  private readonly walletSessionDeps: WalletSessionReadinessDeps;
  private readonly walletSessionState: SigningSessionStatusState;
  private readonly operationIdBindings: SigningOperationIdBindingRegistry;
  private readonly walletSessionExpiryInvalidator: ClientWalletSessionExpiryInvalidator;
  private readonly lifecycleListeners = new Set<SdkLifecycleEventListener>();
  private readonly walletSessionQuotaAdmissionRefreshQueues = new Map<string, Promise<unknown>>();
  private readonly exactWalletSessionReadPorts: ExactWalletSessionReadPorts;

  constructor(deps: SigningSessionCoordinatorDeps) {
    this.exactWalletSessionReadPorts = deps.exactWalletSessionReadPorts;
    this.onPlannerTrace = deps.onPlannerTrace;
    this.walletSessionDeps = deps;
    this.walletSessionState = {
      statusOverrides: new Map(),
    };
    this.walletSessionExpiryInvalidator = new ClientWalletSessionExpiryInvalidator({
      readiness: {
        touchConfirm: deps.touchConfirm,
        clearEmailOtpWarmSessionMaterial: deps.clearEmailOtpWarmSessionMaterial,
      },
      statusOverrides: this.walletSessionState.statusOverrides,
    });
    this.operationIdBindings = new SigningOperationIdBindingRegistry();
    this.walletSessionStatusReader = deps.getStatus;
  }

  async resolveActiveAuthorizedRouterAbEd25519WalletSessionState(args: {
    readonly state: ResolvedRouterAbEd25519WalletSessionState;
    readonly nowMs: number;
  }): Promise<AuthorizedRouterAbEd25519WalletSessionState | null> {
    return await resolveActiveAuthorizedRouterAbEd25519WalletSessionState({
      state: args.state,
      nowMs: args.nowMs,
      ports: this.exactWalletSessionReadPorts,
    });
  }

  subscribeLifecycle(listener: SdkLifecycleEventListener): SigningSessionLifecycleSubscription {
    this.lifecycleListeners.add(listener);
    return new SigningSessionLifecycleSubscriptionHandle({
      listeners: this.lifecycleListeners,
      listener,
    });
  }

  async invalidateExpiredWalletSession(args: {
    readonly state: ExpiredWalletSessionAuthorizationState;
    readonly source: SigningSessionExpiryDetectionSource;
  }): Promise<SigningSessionExpiryInvalidationResult> {
    // Clearing warm material and announcing expiry are owner-visible acts, so
    // the expired state must name the exact session installed for the selected
    // authority and auth method. A sibling method's session cannot stand in.
    const credential = await resolveExactWalletSessionOperationCredential({
      ports: this.exactWalletSessionReadPorts,
      input: {
        walletId: args.state.walletId,
        authMethod: args.state.authMethod,
        walletSessionId: args.state.walletSessionId,
        quotaId: args.state.quotaId,
        requiredSigningSubject: requiredSigningSubjectForExactSigningLane(args.state.laneIdentity),
        expiry: { kind: 'expired', nowMs: args.state.detectedAtMs },
      },
    });
    if (credential.kind !== 'resolved') {
      return {
        kind: 'unavailable',
        failures: ['wallet_session_authorization'],
        event: null,
      };
    }
    const invalidation = await this.walletSessionExpiryInvalidator.invalidate({
      state: args.state,
      walletSessionId: credential.resolved.walletSessionId,
    });
    if (invalidation.kind !== 'invalidated') return invalidation;
    const event = mapWalletSessionExpiredEvent({
      event: invalidation.event,
      source: args.source,
    });
    this.emitLifecycleEvent(event);
    return { kind: 'invalidated', event };
  }

  private emitLifecycleEvent(event: SdkLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        console.error('[SigningSessionCoordinator] lifecycle listener failed', error);
      }
    }
  }

  resolveAuthPlan(
    input: SigningSessionPlannerInput,
    onTrace?: (event: SigningPlannerDecisionTraceEvent) => void,
  ): SigningSessionPlan {
    const plan = planSigningSession(input);
    const traceEvent = createSigningPlannerDecisionTraceEvent(input, plan);
    onTrace?.(traceEvent);
    if (!onTrace) this.onPlannerTrace?.(traceEvent);
    return plan;
  }

  async resolveAuthPlanFromReadiness(
    input: ResolveSigningSessionAuthPlanFromReadinessInput,
    onTrace?: (event: SigningPlannerDecisionTraceEvent) => void,
  ): Promise<ResolveSigningSessionAuthPlanFromReadinessResult> {
    if (isEd25519SigningSessionAuthPlanInput(input)) {
      const expiresAtMs =
        input.readiness.status === 'ready' ||
        input.readiness.status === 'exhausted' ||
        input.readiness.status === 'expired'
          ? input.readiness.expiresAtMs
          : 0;
      const remainingUses =
        input.readiness.status === 'ready' || input.readiness.status === 'exhausted'
          ? input.readiness.remainingUses
          : 0;
      return {
        readiness: input.readiness,
        expiresAtMs,
        remainingUses,
        signingSessionPlan: this.resolveAuthPlan(
          {
            lane: input.lane,
            readiness: input.readiness,
            forceFreshAuth: input.forceFreshAuth,
            sensitiveOperationPolicy: input.sensitiveOperationPolicy,
          },
          onTrace,
        ),
      };
    }
    if (isEcdsaSigningSessionAuthPlanInput(input)) {
      const expiresAtMs =
        input.readiness.status === 'ready' ||
        input.readiness.status === 'exhausted' ||
        input.readiness.status === 'expired'
          ? input.readiness.expiresAtMs
          : Math.floor(Number(input.expiresAtMs) || 0);
      const remainingUses =
        input.readiness.status === 'ready' || input.readiness.status === 'exhausted'
          ? input.readiness.remainingUses
          : 0;
      return {
        readiness: input.readiness,
        expiresAtMs,
        remainingUses,
        signingSessionPlan: this.resolveAuthPlan(
          {
            lane: input.lane,
            readiness: input.readiness,
            forceFreshAuth: input.forceFreshAuth,
            sensitiveOperationPolicy: input.sensitiveOperationPolicy,
          },
          onTrace,
        ),
      };
    }
    throw new Error('[SigningSessionCoordinator] lane and readiness curves do not match');
  }

  async getStatus(
    args: Parameters<SigningSessionStatusPort['getStatus']>[0],
  ): ReturnType<SigningSessionStatusPort['getStatus']> {
    const walletId = toWalletId(args.walletId);
    const walletSessionId = args.walletSessionId;
    const targetThreshold = new Set(
      (args.targetThresholdSessionIds || []).map(normalizeNonEmpty).filter(Boolean),
    );
    const hasExplicitTarget = targetThreshold.size > 0;
    const readDirectTargetStatus = async (): Promise<SigningSessionStatus | null> => {
      if (!hasExplicitTarget) return null;
      // The status query carries the exact selected threshold-session ids. Use
      // those ids directly so a missing volatile lane projection cannot hide a
      // restored, usable session.
      return await readDirectSigningSessionStatusForTargets({
        deps: this.walletSessionDeps,
        walletSessionId,
        targetThresholdSessionIds: targetThreshold,
      });
    };
    const lanes = (await discoverLanesForWallet(this.walletSessionDeps, walletId)).filter(
      (lane) => lane.walletSessionId === walletSessionId && lane.quotaId === args.quotaId,
    );
    if (!lanes.length) return await readDirectTargetStatus();
    const statusLanes = hasExplicitTarget
      ? lanes.filter((lane) => targetThreshold.has(lane.thresholdSessionId))
      : lanes;
    if (hasExplicitTarget && !statusLanes.length) {
      return (
        (await readDirectTargetStatus()) || {
          sessionId: walletSessionId,
          status: 'not_found',
        }
      );
    }
    const rawClaims = await readClaimsForLanes({
      deps: this.walletSessionDeps,
      lanes: statusLanes,
    });
    const scopedClaims = walletScopedClaimsForLanes({
      lanes: statusLanes,
      claimsByThresholdSessionId: rawClaims,
      statusOverrides: this.walletSessionState.statusOverrides,
    });
    const claims = statusLanes
      .map((lane) => scopedClaims.get(lane.thresholdSessionId) || null)
      .filter(Boolean);
    const claim =
      claims.find((candidate) => candidate?.state === 'expired') ||
      claims.find((candidate) => candidate?.state === 'exhausted') ||
      claims.find((candidate) => candidate?.state === 'unavailable') ||
      claims.find((candidate) => candidate?.state === 'warm') ||
      null;
    return statusFromClaim({ walletSessionId, lanes: statusLanes, claim });
  }

  async getLaneClaimsForWallet(
    walletId: Parameters<SigningSessionStatusPort['getLaneClaimsForWallet']>[0],
  ): ReturnType<SigningSessionStatusPort['getLaneClaimsForWallet']> {
    return await readWalletScopedLaneClaimsForWallet({
      deps: this.walletSessionDeps,
      walletId: toWalletId(walletId),
      statusOverrides: this.walletSessionState.statusOverrides,
    });
  }

  async clear(
    args: Parameters<SigningSessionStatusPort['clear']>[0],
  ): ReturnType<SigningSessionStatusPort['clear']> {
    await clearWalletSession({
      deps: this.walletSessionDeps,
      statusOverrides: this.walletSessionState.statusOverrides,
      walletId: toWalletId(args.walletId),
      walletSessionId: args.walletSessionId,
      quotaId: args.quotaId,
    });
  }

  async getAvailableStatus(input: SigningSessionStatusCheck): Promise<SigningSessionStatus | null> {
    if (!this.walletSessionStatusReader) return null;
    return await this.walletSessionStatusReader(input);
  }

  bindCallerProvidedOperationIdToFingerprint(args: {
    operationId: SigningOperationId;
    operationFingerprint: SigningOperationFingerprint;
  }): void {
    this.operationIdBindings.bindCallerProvidedOperationIdToFingerprint(args);
  }

  async runWalletSessionQuotaAdmissionRetry<TValue>(args: {
    queueKey: SigningAdmissionQueueKey;
    refresh: () => Promise<TValue>;
    retryAfterRefresh: () => Promise<TValue>;
  }): Promise<TValue> {
    const queueKey = String(args.queueKey);
    const existing = this.walletSessionQuotaAdmissionRefreshQueues.get(queueKey);
    if (existing) {
      await existing.catch(() => undefined);
      return await args.retryAfterRefresh();
    }
    const refreshPromise = args.refresh();
    const queueEntry = refreshPromise
      .catch(() => undefined)
      .then(() => {
        if (this.walletSessionQuotaAdmissionRefreshQueues.get(queueKey) === queueEntry) {
          this.walletSessionQuotaAdmissionRefreshQueues.delete(queueKey);
        }
      });
    this.walletSessionQuotaAdmissionRefreshQueues.set(queueKey, queueEntry);
    return await refreshPromise;
  }
}
