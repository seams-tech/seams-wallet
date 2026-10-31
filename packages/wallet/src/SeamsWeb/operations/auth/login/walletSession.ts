import { buildAnonymousWalletSession } from '@/SeamsWeb/publicApi/session';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type {
  WalletSession,
  WalletSessionAppIdentity,
  WalletSessionCapabilityLaneReadiness,
  WalletSessionCapabilityProjection,
  WalletSessionCapabilityReadiness,
  WalletSessionIdentityResolveFailure,
  WalletAuthenticationState,
} from '@/core/types/seams';
import type { WalletSessionWebContext } from '@/SeamsWeb/signingSurface/types';
import { type AccountId } from '@/core/types/accountIds';
import { parseWalletId, type WalletAuthMethodId } from '@shared/utils/domainIds';
import { IndexedDBManager } from '@/core/indexedDB';
import { WalletSessionAuthorizationUpgradeRequiredError } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { getNearAccountProjection } from '@/core/accountData/near/accountProjection';
import type { ClientUserData } from '@/core/accountData/near/nearAccountData.types';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import type {
  AvailableSigningLanes,
  ConcreteAvailableEcdsaSigningLane,
  ConcreteAvailableEd25519SigningLane,
} from '@/core/signingEngine/session/availability/availableSigningLanes';
import {
  ecdsaAvailableLaneForTarget,
  isConcreteAvailableSigningLane,
} from '@/core/signingEngine/session/availability/availableSigningLanes';
import {
  readExactWalletSessionAuthentication,
  type ExactWalletSessionAuthenticationReadResult,
} from '@/core/signingEngine/session/identity/exactWalletSessionReader';
import { browserExactWalletSessionReadPorts } from '@/core/signingEngine/assembly/ports/emailOtp';
import {
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
  type WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { base64UrlDecode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import {
  resolveWalletCapabilitySubjectResolution,
  type WalletCapabilitySubjectResolution,
  type WalletUnlockSubject,
  type WalletUnlockSubjectSet,
} from '../walletUnlockSubject';
import { resolveEcdsaActivationJournalSelectors } from '../walletUnlockEcdsaSubject';
import {
  resolveLinkedDeviceUnlockSubjectSet,
  linkedDeviceUnlockIdentityMismatchLabels,
  resolveLinkedDeviceNearUnlockSubject,
  readWalletAuthMethodBindingsForSession,
} from './authority';
import {
  reconcileCanonicalEcdsaActivationSelectors,
  ecdsaActivationSelectorsFromSubjectSet,
  reportNonSettledEcdsaActivationReconciliation,
  assertNeverLoginState,
  selectNearEd25519WalletSubject,
} from './identity';
import { resolveThresholdEcdsaLoginMetadata } from './ecdsaInventory';

export async function getWalletSession(
  context: WalletSessionWebContext,
  walletId: WalletId | string | undefined,
  statusReads: WalletSessionStatusReadScope,
): Promise<WalletSession> {
  let currentAuthentication = context.signingEngine.readWalletAuthenticationState();
  const requestedWalletId =
    walletId ??
    (currentAuthentication.kind !== 'signed_out' ? currentAuthentication.walletId : undefined);
  let requestedWalletIdValue: WalletId | null = null;
  let requestedAuthenticationRead: ExactWalletSessionAuthenticationReadResult | null = null;
  if (requestedWalletId !== undefined) {
    const parsedRequestedWalletId = parseWalletId(String(requestedWalletId));
    if (parsedRequestedWalletId.ok) {
      requestedWalletIdValue = parsedRequestedWalletId.value;
      requestedAuthenticationRead = await readExactWalletSessionAuthentication({
        walletId: parsedRequestedWalletId.value,
        ports: browserExactWalletSessionReadPorts,
      });
      if (requestedAuthenticationRead.kind === 'upgrade_required') {
        throw new WalletSessionAuthorizationUpgradeRequiredError(
          '[WalletSession] Wallet Session authorization requires a newer client',
        );
      }
      if (requestedAuthenticationRead.kind === 'missing') {
        currentAuthentication = { kind: 'signed_out' };
      }
    }
  }
  let readResolution = await resolveWalletCapabilitySubjectResolution(requestedWalletId);
  if (readResolution.kind === 'no_session_for_wallet') {
    const linkedSubjectSet = await resolveLinkedDeviceUnlockSubjectSet(
      String(readResolution.walletId),
    );
    if (linkedSubjectSet) {
      readResolution = {
        kind: 'resolved',
        walletId: readResolution.walletId,
        subjectSet: linkedSubjectSet,
        source: 'local_wallet_authority',
      };
    }
  }
  let didReconcileEcdsaActivation = false;
  if (readResolution.kind === 'no_session_request') return buildAnonymousWalletSession();
  if (readResolution.kind === 'no_session_for_wallet') {
    const journalSelectors = await resolveEcdsaActivationJournalSelectors(readResolution.walletId);
    if (journalSelectors.kind !== 'resolved') {
      return await buildCapabilityUnresolvableWalletSession({
        context,
        walletId: readResolution.walletId,
        reason: 'activation_reconciliation_failed',
      });
    }
    if (journalSelectors.selectors.length > 0) {
      didReconcileEcdsaActivation = true;
      const reconciliation = await reconcileCanonicalEcdsaActivationSelectors({
        workerCtx: context.signingEngine.getSignerWorkerContext(),
        selectors: journalSelectors.selectors,
      });
      if (reconciliation.didFinalize) {
        readResolution = await resolveWalletCapabilitySubjectResolution(readResolution.walletId);
      }
      if (readResolution.kind === 'no_session_for_wallet' && reconciliation.kind !== 'settled') {
        return await buildCapabilityUnresolvableWalletSession({
          context,
          walletId: readResolution.walletId,
          reason:
            reconciliation.kind === 'pending'
              ? 'activation_reconciliation_pending'
              : 'activation_reconciliation_failed',
        });
      }
    }
  }
  if (readResolution.kind === 'no_session_for_wallet') {
    return await buildCapabilityUnresolvableWalletSession({
      context,
      walletId: readResolution.walletId,
      reason: readResolution.reason,
    });
  }
  if (readResolution.kind === 'no_session_request') return buildAnonymousWalletSession();
  if (readResolution.kind === 'unresolvable_profile') {
    console.warn('[WalletSession] wallet session profile is unresolvable', {
      profileId: readResolution.profileId,
      reason: readResolution.reason,
    });
    return buildAnonymousWalletSession();
  }
  if (readResolution.kind === 'unresolvable') {
    console.warn('[WalletSession] wallet session identity is unresolvable', {
      walletId: String(readResolution.walletId),
      reason: readResolution.reason,
    });
    return await buildCapabilityUnresolvableWalletSession({
      context,
      walletId: readResolution.walletId,
      reason: readResolution.reason,
    });
  }

  const activeEcdsaSelectors = ecdsaActivationSelectorsFromSubjectSet(readResolution.subjectSet);
  if (!didReconcileEcdsaActivation && activeEcdsaSelectors.length > 0) {
    const reconciliation = await reconcileCanonicalEcdsaActivationSelectors({
      workerCtx: context.signingEngine.getSignerWorkerContext(),
      selectors: activeEcdsaSelectors,
    });
    reportNonSettledEcdsaActivationReconciliation(reconciliation);
  }
  // Session observation reports existing authority. The startup diagnostic must
  // not delay it; operations that require parity await their own check.
  void context.signingEngine.assertSealedRefreshStartupParity().catch((error: unknown) => {
    console.warn(
      '[WalletSession] sealed refresh startup parity check failed during session read; continuing with cached login state',
      error instanceof Error ? error.message : String(error || 'unknown error'),
    );
  });
  const [appIdentity, availableLanes] = await Promise.all([
    resolveWalletSessionAppIdentity(context, readResolution),
    readExactWalletSessionAvailableLanes(context, readResolution.walletId, statusReads),
  ]);
  const restoredAuthenticationRead =
    requestedAuthenticationRead &&
    requestedWalletIdValue &&
    String(requestedWalletIdValue) === String(readResolution.walletId)
      ? requestedAuthenticationRead
      : await readExactWalletSessionAuthentication({
          walletId: readResolution.walletId,
          ports: browserExactWalletSessionReadPorts,
        });
  let authentication: WalletAuthenticationState = { kind: 'signed_out' };
  switch (restoredAuthenticationRead.kind) {
    case 'authenticated':
      if (
        await setRestoredWalletAuthenticationIfUnlocked(context, restoredAuthenticationRead.state)
      ) {
        authentication = restoredAuthenticationRead.state;
      }
      break;
    case 'missing':
      break;
    case 'upgrade_required':
      throw new WalletSessionAuthorizationUpgradeRequiredError(
        '[WalletSession] Wallet Session authorization requires a newer client',
      );
  }
  /* The session's capabilities belong to the method that opened it.
     Sibling methods on one authority keep their own ECDSA continuity rows for
     their own unlocks - a wallet that recovered and then added a method holds
     one capability under each - so an authenticated read scopes the ECDSA
     subjects to the authenticated method instead of projecting both. */
  const capabilityProjection = buildWalletSessionCapabilityProjection({
    subjectSet:
      authentication.kind === 'authenticated' && restoredAuthenticationRead.kind === 'authenticated'
        ? scopeSubjectSetToWalletAuthMethod(
            readResolution.subjectSet,
            restoredAuthenticationRead.walletAuthMethodId,
          )
        : readResolution.subjectSet,
    availableLanes,
    configuredEcdsaTargets: listConfiguredThresholdEcdsaPublicationTargets(
      context.configs.network.chains,
    ).map((target) => target.chainTarget),
  });
  return {
    appIdentity,
    authentication,
    capabilityProjection,
    nonceDiagnostics: readWalletSessionNonceDiagnostics(context, appIdentity.nearAccountId),
  };
}

function scopeSubjectSetToWalletAuthMethod(
  subjectSet: WalletUnlockSubjectSet,
  walletAuthMethodId: WalletAuthMethodId,
): WalletUnlockSubjectSet {
  const subjects = subjectSet.subjects.filter(
    (subject) =>
      subject.kind !== 'evm_family_ecdsa_wallet' ||
      String(subject.authority.walletAuthMethodId) === String(walletAuthMethodId),
  );
  const [first, ...rest] = subjects;
  /* Fail open to the unscoped set: an authenticated method with no ECDSA
     subject of its own (an Ed25519-only unlock) must not blank the projection. */
  if (!first) return subjectSet;
  return { ...subjectSet, subjects: [first, ...rest] };
}

/**
 * A restore read races the user's lock: the read observes an unlocked
 * selection, the lock lands while its network validation runs, and the stale
 * result would re-authenticate a wallet the user just locked. Re-checking the
 * durable lock right before the runtime write keeps the lock decisive over
 * any in-flight restore.
 */
async function setRestoredWalletAuthenticationIfUnlocked(
  context: {
    readonly signingEngine: Pick<
      WalletSessionWebContext['signingEngine'],
      'setWalletAuthenticated' | 'readWalletAuthenticationState'
    >;
  },
  state: Extract<WalletAuthenticationState, { readonly kind: 'authenticated' }>,
): Promise<boolean> {
  if (state.authMethod === 'voiceid') {
    const current = context.signingEngine.readWalletAuthenticationState();
    if (
      current.kind !== 'authenticated' ||
      current.walletId !== state.walletId ||
      current.authMethod !== 'voiceid'
    )
      return false;
  }
  let lockedOut = false;
  try {
    const selected = await IndexedDBManager.resolveSelectedWalletAuthority(String(state.walletId));
    lockedOut = selected.kind !== 'resolved' || selected.selection.lockState !== 'unlocked';
  } catch {
    lockedOut = true;
  }
  if (lockedOut) return false;
  context.signingEngine.setWalletAuthenticated(state);
  return true;
}

async function buildCapabilityUnresolvableWalletSession(args: {
  readonly context: WalletSessionWebContext;
  readonly walletId: WalletId;
  readonly reason: WalletSessionIdentityResolveFailure;
}): Promise<WalletSession> {
  const [appIdentity, exactAuthenticationRead] = await Promise.all([
    resolveWalletSessionAppIdentityForWallet(args.context, args.walletId),
    readExactWalletSessionAuthentication({
      walletId: args.walletId,
      ports: browserExactWalletSessionReadPorts,
    }),
  ]);
  let authentication: WalletAuthenticationState = { kind: 'signed_out' };
  switch (exactAuthenticationRead.kind) {
    case 'authenticated':
      if (
        await setRestoredWalletAuthenticationIfUnlocked(args.context, exactAuthenticationRead.state)
      ) {
        authentication = exactAuthenticationRead.state;
      }
      break;
    case 'missing':
      break;
    case 'upgrade_required':
      throw new WalletSessionAuthorizationUpgradeRequiredError(
        '[WalletSession] Wallet Session authorization requires a newer client',
      );
  }
  return {
    appIdentity,
    authentication,
    capabilityProjection: {
      kind: 'unresolvable',
      reason: args.reason,
    },
    nonceDiagnostics: readWalletSessionNonceDiagnostics(args.context, appIdentity.nearAccountId),
  };
}

function readExactWalletSessionAvailableLanes(
  context: WalletSessionWebContext,
  walletId: WalletId,
  statusReads: WalletSessionStatusReadScope,
): Promise<
  | { readonly kind: 'available'; readonly lanes: AvailableSigningLanes }
  | { readonly kind: 'unavailable' }
> {
  return context.signingEngine
    .readPersistedAvailableSigningLanes({ walletId }, statusReads)
    .then((lanes) => ({ kind: 'available' as const, lanes }))
    .catch(() => ({ kind: 'unavailable' as const }));
}

function readWalletSessionNonceDiagnostics(
  context: WalletSessionWebContext,
  nearAccountId?: AccountId | string | null,
): WalletSession['nonceDiagnostics'] {
  const accountId = String(nearAccountId || '').trim();
  if (!accountId) return null;
  try {
    return context.signingEngine.getNonceCoordinator().getDiagnostics({
      accountId,
      emitMetrics: true,
    });
  } catch {
    return null;
  }
}

type ExactWalletSessionAvailableLanesRead = Awaited<
  ReturnType<typeof readExactWalletSessionAvailableLanes>
>;

type ExactAvailableSigningLane =
  | ConcreteAvailableEd25519SigningLane
  | ConcreteAvailableEcdsaSigningLane;

function failedCapabilityLane(
  reason: Extract<WalletSessionCapabilityLaneReadiness, { kind: 'failed' }>['reason'],
): Extract<WalletSessionCapabilityLaneReadiness, { kind: 'failed' }> {
  return {
    kind: 'failed',
    reason,
  };
}

function persistenceUnavailableCapabilityLane(): Extract<
  WalletSessionCapabilityLaneReadiness,
  { kind: 'failed' }
> {
  return {
    kind: 'failed',
    reason: 'persistence_unavailable',
  };
}

function parseExactAvailableLaneReadiness(
  lane: ExactAvailableSigningLane,
): WalletSessionCapabilityLaneReadiness {
  switch (lane.state) {
    case 'ready':
      return { kind: 'ready' };
    case 'restorable':
      return { kind: 'pending', resume: 'restore_material' };
    case 'deferred':
      return { kind: 'pending', resume: 'resolve_deferred_state' };
    case 'expired':
      return { kind: 'authorization_required', requirement: 'wallet_session_expired' };
    case 'exhausted':
      return { kind: 'authorization_required', requirement: 'wallet_session_exhausted' };
  }
  throw new Error('[SeamsWeb] unsupported capability lane readiness');
}

function invalidLaneReasonForCurve(
  snapshot: AvailableSigningLanes,
  curve: 'ed25519' | 'ecdsa',
): Extract<WalletSessionCapabilityLaneReadiness, { kind: 'failed' }>['reason'] | null {
  const diagnostic = snapshot.diagnostics?.invalidLanes.find(
    (candidate) => candidate.curve === curve,
  );
  if (!diagnostic) return null;
  return diagnostic.reason === 'ambiguous_material' ||
    diagnostic.reason === 'conflicting_key_material'
    ? 'ambiguous_lane'
    : 'malformed';
}

function invalidEcdsaLaneReasonForTarget(
  snapshot: AvailableSigningLanes,
  chainTarget: ThresholdEcdsaChainTarget,
): Extract<WalletSessionCapabilityLaneReadiness, { kind: 'failed' }>['reason'] | null {
  const targetKey = thresholdEcdsaChainTargetKey(chainTarget);
  const diagnostic = snapshot.diagnostics?.invalidLanes.find(
    (candidate) =>
      candidate.curve === 'ecdsa' &&
      (candidate.targetKey === undefined || candidate.targetKey === targetKey),
  );
  if (!diagnostic) return null;
  return diagnostic.reason === 'ambiguous_material' ||
    diagnostic.reason === 'conflicting_key_material'
    ? 'ambiguous_lane'
    : 'malformed';
}

function nearSubjectMatchesLane(
  subject: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
  lane: ConcreteAvailableEd25519SigningLane,
): boolean {
  return (
    String(lane.walletId) === String(subject.walletId) &&
    String(lane.nearAccountId) === String(subject.nearAccountId) &&
    String(lane.nearEd25519SigningKeyId) === String(subject.nearEd25519SigningKeyId) &&
    lane.signerSlot === subject.signerSlot
  );
}

function ecdsaSubjectMatchesLane(
  subject: Extract<WalletUnlockSubject, { kind: 'evm_family_ecdsa_wallet' }>,
  lane: ConcreteAvailableEcdsaSigningLane,
): boolean {
  return (
    String(lane.key.walletId) === String(subject.walletId) &&
    String(lane.key.ecdsaThresholdKeyId) === String(subject.ecdsaThresholdKeyId)
  );
}

function nearCapabilityReadiness(args: {
  readonly subject: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>;
  readonly availableLanes: ExactWalletSessionAvailableLanesRead;
}): WalletSessionCapabilityReadiness {
  if (args.availableLanes.kind === 'unavailable') {
    return {
      kind: 'near_ed25519',
      subject: args.subject,
      lane: persistenceUnavailableCapabilityLane(),
    };
  }
  const snapshot = args.availableLanes.lanes;
  if (String(snapshot.walletId) !== String(args.subject.walletId)) {
    return {
      kind: 'near_ed25519',
      subject: args.subject,
      lane: failedCapabilityLane('identity_mismatch'),
    };
  }
  const invalidReason = invalidLaneReasonForCurve(snapshot, 'ed25519');
  if (invalidReason) {
    return {
      kind: 'near_ed25519',
      subject: args.subject,
      lane: failedCapabilityLane(invalidReason),
    };
  }
  const lane = snapshot.lanes.ed25519.near;
  if (!isConcreteAvailableSigningLane(lane)) {
    return {
      kind: 'near_ed25519',
      subject: args.subject,
      lane: failedCapabilityLane('missing'),
    };
  }
  return {
    kind: 'near_ed25519',
    subject: args.subject,
    lane: nearSubjectMatchesLane(args.subject, lane)
      ? parseExactAvailableLaneReadiness(lane)
      : failedCapabilityLane('identity_mismatch'),
  };
}

function ecdsaCapabilityLaneReadinessForTarget(args: {
  readonly subject: Extract<WalletUnlockSubject, { kind: 'evm_family_ecdsa_wallet' }>;
  readonly availableLanes: ExactWalletSessionAvailableLanesRead;
  readonly chainTarget: ThresholdEcdsaChainTarget;
}): WalletSessionCapabilityLaneReadiness {
  if (args.availableLanes.kind === 'unavailable') return persistenceUnavailableCapabilityLane();
  const snapshot = args.availableLanes.lanes;
  if (String(snapshot.walletId) !== String(args.subject.walletId)) {
    return failedCapabilityLane('identity_mismatch');
  }
  const invalidReason = invalidEcdsaLaneReasonForTarget(snapshot, args.chainTarget);
  if (invalidReason) return failedCapabilityLane(invalidReason);
  const lane = ecdsaAvailableLaneForTarget(snapshot, args.chainTarget);
  if (!isConcreteAvailableSigningLane(lane)) return failedCapabilityLane('missing');
  if (!ecdsaSubjectMatchesLane(args.subject, lane)) {
    return failedCapabilityLane('identity_mismatch');
  }
  // A canonical-capability lane with no authorization is auth-neutral: exact
  // material, nothing authorizing it. It carries `state: 'deferred'` because
  // no authorization has scheduled it, and reporting that verbatim told the UI
  // nothing had been attempted -- when in fact the material is ready and only
  // needs a same-method step-up.
  if (lane.source === 'canonical_capability' && !lane.authorization) {
    return { kind: 'authorization_required', requirement: 'same_method_step_up' };
  }
  return parseExactAvailableLaneReadiness(lane);
}

function ecdsaCapabilityReadiness(args: {
  readonly subject: Extract<WalletUnlockSubject, { kind: 'evm_family_ecdsa_wallet' }>;
  readonly availableLanes: ExactWalletSessionAvailableLanesRead;
  readonly configuredTargets: readonly ThresholdEcdsaChainTarget[];
}): WalletSessionCapabilityReadiness {
  const [firstTarget, ...remainingTargets] = args.configuredTargets;
  if (!firstTarget) {
    return {
      kind: 'evm_family_ecdsa',
      subject: args.subject,
      targets: { kind: 'no_configured_target' },
    };
  }
  return {
    kind: 'evm_family_ecdsa',
    subject: args.subject,
    targets: {
      kind: 'configured_targets',
      lanes: [
        {
          chainTarget: firstTarget,
          readiness: ecdsaCapabilityLaneReadinessForTarget({
            subject: args.subject,
            availableLanes: args.availableLanes,
            chainTarget: firstTarget,
          }),
        },
        ...remainingTargets.map((chainTarget) => ({
          chainTarget,
          readiness: ecdsaCapabilityLaneReadinessForTarget({
            subject: args.subject,
            availableLanes: args.availableLanes,
            chainTarget,
          }),
        })),
      ],
    },
  };
}

function buildWalletSessionCapabilityProjection(args: {
  readonly subjectSet: WalletUnlockSubjectSet;
  readonly availableLanes: ExactWalletSessionAvailableLanesRead;
  readonly configuredEcdsaTargets: readonly ThresholdEcdsaChainTarget[];
}): Extract<WalletSessionCapabilityProjection, { kind: 'resolved' }> {
  const capabilities = args.subjectSet.subjects.map((subject) => {
    switch (subject.kind) {
      case 'near_ed25519_wallet':
        return nearCapabilityReadiness({
          subject,
          availableLanes: args.availableLanes,
        });
      case 'evm_family_ecdsa_wallet':
        return ecdsaCapabilityReadiness({
          subject,
          availableLanes: args.availableLanes,
          configuredTargets: args.configuredEcdsaTargets,
        });
    }
    return assertNeverLoginState(subject);
  });
  const firstCapability = capabilities[0];
  if (!firstCapability) {
    throw new Error('[WalletSession] resolved capability subjects must be non-empty');
  }
  return {
    kind: 'resolved',
    subjectSet: args.subjectSet,
    capabilities: [firstCapability, ...capabilities.slice(1)],
  };
}

function selectNearOperationalPublicKeyForLogin(
  userData: Pick<ClientUserData, 'operationalPublicKey'> | null,
): string | null {
  return userData ? userData.operationalPublicKey : null;
}

function userMatchesNearWalletSubject(
  user: ClientUserData | null,
  subject: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
): user is ClientUserData {
  return Boolean(
    user &&
    String(user.walletId) === String(subject.walletId) &&
    String(user.nearAccountId) === String(subject.nearAccountId) &&
    user.signerSlot === subject.signerSlot,
  );
}

async function resolveExactNearWalletUser(
  signingEngine: WalletSessionWebContext['signingEngine'],
  subject: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
): Promise<ClientUserData | null> {
  const lastUser = await signingEngine.getLastUser().catch(() => null);
  if (userMatchesNearWalletSubject(lastUser, subject)) return lastUser;
  const projected = await getNearAccountProjection(
    IndexedDBManager,
    subject.nearAccountId,
    subject.signerSlot,
  ).catch(() => null);
  if (userMatchesNearWalletSubject(projected, subject)) return projected;
  const stored = await signingEngine
    .getUserBySignerSlot(subject.nearAccountId, subject.signerSlot)
    .catch(() => null);
  return userMatchesNearWalletSubject(stored, subject) ? stored : null;
}

function nearWalletSubjectsEqual(
  left: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
  right: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
): boolean {
  return (
    left.walletId === right.walletId &&
    left.nearAccountId === right.nearAccountId &&
    left.nearEd25519SigningKeyId === right.nearEd25519SigningKeyId &&
    left.signerSlot === right.signerSlot
  );
}

async function resolveLinkedNearOperationalPublicKey(
  subject: Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>,
): Promise<string | null> {
  /* Factor-agnostic on purpose: both supported factors install linked devices,
     and the checks below already require an active device-link authority whose
     resolved NEAR subject equals the one asked about. */
  const parsedWalletId = parseWalletId(String(subject.walletId));
  if (!parsedWalletId.ok) return null;
  const walletId = parsedWalletId.value;
  let resolved: Awaited<ReturnType<typeof IndexedDBManager.resolveSelectedWalletAuthority>>;
  try {
    resolved = await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
  } catch {
    return null;
  }
  if (resolved.kind !== 'resolved') return null;
  const { selection, authMethod, authority } = resolved;
  if (
    linkedDeviceUnlockIdentityMismatchLabels({ walletId, selection, authMethod, authority })
      .length > 0 ||
    authMethod.status !== 'active' ||
    authority.state !== 'active' ||
    authority.provenance.kind !== 'device_link'
  ) {
    return null;
  }
  const resolvedSubject = await resolveLinkedDeviceNearUnlockSubject({
    walletId,
    authMethod,
    authority,
    signerMaterials: resolved.signerMaterials,
  });
  if (
    resolvedSubject.kind !== 'resolved' ||
    !nearWalletSubjectsEqual(resolvedSubject.subject, subject)
  ) {
    return null;
  }
  const activation = authority.signerActivations.ed25519;
  if (!activation) return null;
  return `ed25519:${base58Encode(base64UrlDecode(activation.signer.registeredPublicKeyB64u))}`;
}

async function resolveWalletSessionAppIdentityForWallet(
  context: WalletSessionWebContext,
  walletId: WalletId,
): Promise<Extract<WalletSessionAppIdentity, { kind: 'resolved' }>> {
  const [authMethods, thresholdMetadata] = await Promise.all([
    readWalletAuthMethodBindingsForSession(walletId),
    resolveThresholdEcdsaLoginMetadata(context, walletId).catch(() => ({
      ethereumAddress: null,
      thresholdEcdsaPublicKeyB64u: null,
    })),
  ]);
  return {
    kind: 'resolved',
    walletId,
    nearAccountId: null,
    nearOperationalPublicKey: null,
    userData: null,
    authMethods,
    thresholdEcdsaEthereumAddress: thresholdMetadata.ethereumAddress,
    thresholdEcdsaPublicKeyB64u: thresholdMetadata.thresholdEcdsaPublicKeyB64u,
  };
}

async function resolveWalletSessionAppIdentity(
  context: WalletSessionWebContext,
  readResolution: Extract<WalletCapabilitySubjectResolution, { kind: 'resolved' }>,
): Promise<Extract<WalletSessionAppIdentity, { kind: 'resolved' }>> {
  const resolvedWalletId = readResolution.walletId;
  const nearSubject = selectNearEd25519WalletSubject(readResolution.subjectSet);
  const resolvedNearAccountId = nearSubject?.nearAccountId || null;
  const [userData, base] = await Promise.all([
    nearSubject ? resolveExactNearWalletUser(context.signingEngine, nearSubject) : null,
    resolveWalletSessionAppIdentityForWallet(context, resolvedWalletId),
  ]);
  const persistedOperationalPublicKey = selectNearOperationalPublicKeyForLogin(userData);
  /* A linked device has no local registration profile to carry the operational
     public key, whichever source resolved its subjects, so fall back to its
     exact device-link authority whenever a NEAR subject is present. */
  const nearOperationalPublicKey =
    persistedOperationalPublicKey ||
    (nearSubject ? await resolveLinkedNearOperationalPublicKey(nearSubject) : null);
  return {
    ...base,
    nearAccountId: resolvedNearAccountId,
    nearOperationalPublicKey,
    userData,
  };
}
