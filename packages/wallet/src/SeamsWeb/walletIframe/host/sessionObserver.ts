import type { WalletHostRuntime } from './WalletHostRuntime';
import { buildAnonymousWalletSession } from '@/SeamsWeb/publicApi/session';
import type { WalletSession } from '@/core/types/seams';
import type {
  ChildToParentEnvelope,
  PMGetExactWalletSessionStatePayload,
} from '../shared/messages';
import {
  readSelectedWalletIframeExactSessionState,
  type WalletIframeExactSessionReadDependencies,
  type WalletIframeExactSessionStatus,
  type WalletIframeExactSessionState,
  type WalletIframeExactSessionSnapshot,
} from '../shared/exactSessionState';
import {
  reconcileWalletIframeExactSessions,
  type WalletIframeExactSessionReconciliationDependencies,
} from '../shared/exactSessionReconciliation';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { IndexedDBManager } from '@/core/indexedDB';
import { seamsWalletDB } from '@/core/indexedDB/singletons';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type { SdkLifecycleEvent, WalletSessionId } from '@/core/types/sdkSentEvents';
import type { WalletId } from '@shared/utils/domainIds';
import { nextSessionObservationRevision } from './sessionObservationRevision';

async function readWalletIframeExactSessionStatus(
  relayUrl: string,
  reads: WalletSessionStatusReadScope,
  input: Parameters<WalletIframeExactSessionReadDependencies['readStatus']>[0],
): Promise<WalletIframeExactSessionStatus> {
  const normalizedRelayUrl = String(relayUrl || '').trim();
  if (!normalizedRelayUrl) throw new Error('Wallet iframe relayer URL is required');
  return await reads.read(
    {
      relayerUrl: normalizedRelayUrl,
      operationCredential: input.operationCredential,
    },
    {
      walletSessionId: input.operationCredential.walletSessionId,
      quotaId: input.authorization.quotaId,
    },
  );
}

function exactSessionReadDependenciesForRelay(
  relayUrl: string,
  reads: WalletSessionStatusReadScope,
): WalletIframeExactSessionReadDependencies & WalletIframeExactSessionReconciliationDependencies {
  return {
    resolveSelectedWalletAuthority:
      IndexedDBManager.resolveSelectedWalletAuthority.bind(IndexedDBManager),
    listWalletAuthMethodsV2ForWallet:
      IndexedDBManager.listWalletAuthMethodsV2ForWallet.bind(IndexedDBManager),
    resolveWalletAuthorityForMethod:
      IndexedDBManager.resolveWalletAuthorityForMethod.bind(IndexedDBManager),
    readExactActiveForWallet: walletSessionAuthorizations.readExactActiveForWallet.bind(
      walletSessionAuthorizations,
    ),
    readStatus: readWalletIframeExactSessionStatus.bind(null, relayUrl, reads),
    refreshExactWithOperationCredential:
      walletSessionAuthorizations.refreshExactWithOperationCredential.bind(
        walletSessionAuthorizations,
      ),
    nowMs: Date.now,
  };
}

function markWalletSelectionChanged(selection: { changed: boolean }): void {
  selection.changed = true;
}

async function resolvePersistedCurrentWalletId(pm: WalletHostRuntime): Promise<string | undefined> {
  const currentWalletId = String(pm.preferences.getCurrentWalletId() || '').trim();
  if (currentWalletId) return currentWalletId;
  const selection = { changed: false };
  const unsubscribe = pm.preferences.onCurrentWalletChange(
    markWalletSelectionChanged.bind(null, selection),
  );
  try {
    const recentUnlocks = await pm.auth.getRecentUnlocks();
    if (selection.changed) return pm.preferences.getCurrentWalletId() ?? undefined;
    const lastUsedWalletId = String(recentUnlocks.lastUsedAccount?.walletId || '').trim();
    const walletIds = recentUnlocks.walletIds
      .map((walletId) => String(walletId).trim())
      .filter(Boolean);
    const walletId = lastUsedWalletId || (walletIds.length === 1 ? walletIds[0] : undefined);
    if (walletId) pm.preferences.setCurrentWallet(toWalletId(walletId));
    return walletId;
  } finally {
    unsubscribe();
  }
}

export async function resolveExactWalletSessionState(
  pm: WalletHostRuntime,
  payload: PMGetExactWalletSessionStatePayload,
  statusReads: WalletSessionStatusReadScope,
): Promise<WalletIframeExactSessionState> {
  let walletId: string | undefined;
  switch (payload.wallet.kind) {
    case 'current': {
      walletId =
        payload.authenticationRead === 'restore'
          ? await resolvePersistedCurrentWalletId(pm)
          : (pm.preferences.getCurrentWalletId() ?? undefined);
      break;
    }
    case 'exact':
      walletId = payload.wallet.walletId.trim();
      if (!walletId) throw new Error('Wallet iframe exact session walletId is invalid');
      break;
  }
  if (!walletId) return { kind: 'wallet_locked' };
  const dependencies = exactSessionReadDependenciesForRelay(
    pm.configs.network.relayer.url,
    statusReads,
  );
  const reconciliation = await reconcileWalletIframeExactSessions(
    { walletId: toWalletId(walletId) },
    dependencies,
  );
  if (reconciliation.kind === 'failed') {
    return {
      kind: 'wallet_unlocked_without_signing_session',
      walletId: toWalletId(walletId),
      reason: reconciliation.reason,
    };
  }
  return await readSelectedWalletIframeExactSessionState(
    { walletId: toWalletId(walletId) },
    dependencies,
  );
}

type RefreshState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'running'; pending: boolean };

type SessionObservation = {
  readonly revision: number;
  readonly state: WalletIframeExactSessionState;
  readonly session: WalletSession;
};

export class WalletHostSessionObserver {
  private lifecycle: 'active' | 'disposed' = 'active';
  private refresh: RefreshState = { kind: 'idle' };
  private invalidationRevision = 0;
  private activeOperations = 0;
  private externalExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingObservations = new Map<string, Promise<SessionObservation>>();
  private readonly unsubscribeAuthority: () => void;
  private readonly unsubscribeSelection: () => void;

  constructor(
    private readonly runtime: WalletHostRuntime,
    private readonly post: (message: ChildToParentEnvelope) => void,
    private readonly expiredSessions: ReadonlyMap<WalletId, ReadonlySet<WalletSessionId>>,
    private readonly readSession: (
      walletId: WalletId,
      statusReads: WalletSessionStatusReadScope,
    ) => Promise<WalletSession>,
  ) {
    this.unsubscribeAuthority = seamsWalletDB.onWalletAuthorityChange(this.invalidate.bind(this));
    this.unsubscribeSelection = runtime.preferences.onCurrentWalletChange(
      this.invalidate.bind(this),
    );
  }

  dispose(): void {
    if (this.externalExpiryTimer !== null) clearTimeout(this.externalExpiryTimer);
    this.lifecycle = 'disposed';
    this.unsubscribeAuthority();
    this.unsubscribeSelection();
  }

  beginOperation(): void {
    this.assertActive();
    this.activeOperations += 1;
  }

  endOperation(): void {
    this.activeOperations -= 1;
    if (
      this.lifecycle === 'active' &&
      this.activeOperations === 0 &&
      this.refresh.kind === 'pending'
    ) {
      this.requestRefresh();
    }
  }

  onLifecycleEvent(event: SdkLifecycleEvent): void {
    if (this.lifecycle === 'disposed') return;
    const revision = nextSessionObservationRevision();
    if (event.event === 'signing_session.expired') this.invalidationRevision += 1;
    this.post({ type: 'SDK_LIFECYCLE_EVENT', payload: { revision, event } });
    if (event.event === 'signing_session.expired') this.requestRefresh();
  }

  publishCurrentSession(): Promise<void> {
    return this.observe(
      { authenticationRead: 'current', wallet: { kind: 'current' } },
      this.publishSnapshot.bind(this),
    );
  }

  async observe(
    payload: PMGetExactWalletSessionStatePayload,
    publish: (snapshot: WalletIframeExactSessionSnapshot) => void,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.assertActive();
      const invalidationRevision = this.invalidationRevision;
      const authorityRevision = seamsWalletDB.getWalletAuthorityRevision();
      const selection = { changed: false };
      const unsubscribe = this.runtime.preferences.onCurrentWalletChange(
        markWalletSelectionChanged.bind(null, selection),
      );
      try {
        const { revision, state, session } = await this.readObservation(payload, authorityRevision);
        this.assertActive();
        if (selection.changed && this.runtime.preferences.getCurrentWalletId() === null) {
          publish({
            revision: nextSessionObservationRevision(),
            walletId: null,
            state: { kind: 'wallet_locked' },
            session: buildAnonymousWalletSession(),
          });
          return;
        }
        if (
          selection.changed ||
          invalidationRevision !== this.invalidationRevision ||
          authorityRevision !== seamsWalletDB.getWalletAuthorityRevision()
        )
          continue;
        const walletId =
          session.authentication.kind === 'external_authenticated'
            ? session.authentication.walletId
            : payload.wallet.kind === 'exact'
              ? toWalletId(payload.wallet.walletId)
              : this.runtime.preferences.getCurrentWalletId();
        publish({ revision, walletId, state: this.projectExpiry(state), session });
        return;
      } finally {
        unsubscribe();
      }
    }
    throw new Error('Wallet authority changed repeatedly during session observation');
  }

  private readObservation(
    payload: PMGetExactWalletSessionStatePayload,
    authorityRevision: number,
  ): Promise<SessionObservation> {
    const selectedWalletId = this.runtime.preferences.getCurrentWalletId();
    const walletId = payload.wallet.kind === 'exact' ? payload.wallet.walletId : selectedWalletId;
    const key = JSON.stringify([
      payload.authenticationRead,
      walletId,
      selectedWalletId,
      authorityRevision,
      this.invalidationRevision,
    ]);
    const existing = this.pendingObservations.get(key);
    if (existing) return existing;
    const pending = this.resolveObservation(payload).finally(
      this.finishObservation.bind(this, key),
    );
    this.pendingObservations.set(key, pending);
    return pending;
  }

  private async resolveObservation(
    payload: PMGetExactWalletSessionStatePayload,
  ): Promise<SessionObservation> {
    const revision = nextSessionObservationRevision();
    const statusReads = WalletSessionStatusReadScope.forHostObservation();
    const externalSession = await this.runtime.readExternalSession(
      payload.wallet.kind === 'exact' ? payload.wallet.walletId : undefined,
    );
    if (externalSession?.authentication.kind === 'external_authenticated') {
      return {
        revision,
        state: {
          kind: 'wallet_unlocked_without_signing_session',
          walletId: externalSession.authentication.walletId,
          reason: 'absent',
        },
        session: externalSession,
      };
    }
    const state = await resolveExactWalletSessionState(this.runtime, payload, statusReads);
    const session =
      state.kind === 'wallet_locked'
        ? buildAnonymousWalletSession()
        : await this.readSession(state.walletId, statusReads);
    return { revision, state, session };
  }

  private finishObservation(key: string): void {
    this.pendingObservations.delete(key);
  }

  private projectExpiry(state: WalletIframeExactSessionState): WalletIframeExactSessionState {
    if (
      state.kind !== 'active_session' ||
      !this.expiredSessions.get(state.walletId)?.has(state.walletSessionId)
    )
      return state;
    return {
      kind: 'expired_session',
      walletId: state.walletId,
      authorizationId: state.authorizationId,
      walletSessionId: state.walletSessionId,
      authMethod: state.authMethod,
      expiresAtMs: state.expiresAtMs,
    };
  }

  private assertActive(): void {
    if (this.lifecycle === 'disposed') throw new Error('Wallet session observer is disposed');
  }

  private invalidate(): void {
    if (this.lifecycle === 'disposed') return;
    this.invalidationRevision += 1;
    this.requestRefresh();
  }

  private requestRefresh(): void {
    if (this.refresh.kind === 'running') {
      this.refresh.pending = true;
      return;
    }
    if (this.activeOperations > 0) {
      this.refresh = { kind: 'pending' };
      return;
    }
    this.refresh = { kind: 'running', pending: false };
    void this.refreshSession().catch(this.reportRefreshFailure.bind(this));
  }

  private async refreshSession(): Promise<void> {
    try {
      do {
        if (this.refresh.kind !== 'running') return;
        this.refresh.pending = false;
        try {
          await this.publishCurrentSession();
        } catch (error) {
          this.reportRefreshFailure(error);
        }
      } while (
        this.lifecycle === 'active' &&
        this.refresh.kind === 'running' &&
        this.refresh.pending
      );
    } finally {
      this.refresh = { kind: 'idle' };
    }
  }

  private publishSnapshot(snapshot: WalletIframeExactSessionSnapshot): void {
    this.assertActive();
    if (this.externalExpiryTimer !== null) clearTimeout(this.externalExpiryTimer);
    this.externalExpiryTimer = null;
    if (snapshot.session.authentication.kind === 'external_authenticated') {
      this.externalExpiryTimer = setTimeout(
        this.requestRefresh.bind(this),
        Math.max(1, snapshot.session.authentication.expiresAtMs - Date.now()),
      );
    }
    if (this.refresh.kind === 'running') this.refresh.pending = false;
    else if (this.refresh.kind === 'pending') this.refresh = { kind: 'idle' };
    this.post({ type: 'SESSION_CHANGED', payload: snapshot });
  }

  private reportRefreshFailure(error: unknown): void {
    if (this.lifecycle === 'active')
      console.warn('[WalletIframeHost] Session refresh failed:', error);
  }
}
