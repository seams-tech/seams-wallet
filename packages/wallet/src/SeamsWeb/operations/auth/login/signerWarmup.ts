import { scheduleEcdsaSessionPresignaturePrefill } from '../scheduleEcdsaSessionPresignaturePrefill';
import { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type {
  ThresholdWarmLoginAndCreateSessionResult,
  WalletAuthMethod,
} from '@/core/types/seams';
import type {
  LoginUnlockSigningSurface,
  LoginWebContext,
  LoginWarmSigningSurface,
} from '@/SeamsWeb/signingSurface/types';
import { toError } from '@shared/utils/errors';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import {
  type MpcWalletSigningQuotaId,
  type WalletSessionAuthorizationId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import { walletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import {
  exactPasskeyWalletAuthAuthorityRefForCredential,
  resolveActivePasskeyWalletSessionAuthority,
  reconcilePasskeyWalletSessionAfterRecovery,
} from '@/SeamsWeb/operations/authMethods/passkey/exactPasskeyAuthority';
import { resolveBrowserActiveEcdsaCapabilityRuntime } from '@/SeamsWeb/assembly/browserSigningSurfaceAssembly';
import type { ThresholdEd25519KeyMaterial } from '@/core/accountData/near/nearAccountData.types';
import { type PasskeyWalletUnlockEd25519Session } from '@/core/rpcClients/near/rpcCalls';
import type { EcdsaBootstrapRequest } from '@/core/signingEngine/session/passkey/ecdsaBootstrap';
import { type ExactWalletSessionAuthorization } from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import { type ThresholdEcdsaSessionBootstrapResult } from '@/core/signingEngine/threshold/ecdsa/activation';
import { type ThresholdRuntimePolicyScope } from '@/core/signingEngine/threshold/sessionPolicy';
import { createRouterAbNormalSigningPolicy } from '@/SeamsWeb/operations/session/thresholdWarmSessionBootstrap';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import {
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
  type WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  RouterAbEcdsaDerivationPublicCapabilityV1,
  RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  buildEvmFamilyEcdsaSessionLanePolicy,
  toEvmFamilyEcdsaKeyHandle,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import {
  buildConfiguredTargetKeyCompletion,
  requireCompleteConfiguredTargetKeyContext,
  type CanonicalThresholdEcdsaWarmSessionContext,
  type ConfiguredTargetThresholdEcdsaWarmKey,
  type ConfiguredTargetKeyCompletion,
  type WalletUnlockSelection,
} from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import {
  passkeyCredentialIdB64uFromAuthentication,
  passkeyPrfFirstB64uFromCredential,
} from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import type { MintedEd25519WalletSessionAuthority } from '@/core/signingEngine/session/warmCapabilities/types';
import type {
  LoginWarmEd25519Session,
  LoginWarmupCredentialState,
  LoginWarmupRouteAuthorization,
  LoginWarmupRuntimeScopeBootstrapState,
  LoginWarmupEd25519MintPlan,
  LoginWarmupEd25519SessionAuthority,
  PasskeyUnlockEd25519Connection,
} from './unlockPlanning';
import {
  requireThresholdLoginEcdsaSessionId,
  createThresholdEcdsaDeviceLinkRequiredError,
  thresholdSessionIdFromPasskeyEcdsaActivation,
  createThresholdLoginWarmSessionId,
} from './signerState';
import { assertNeverLoginState, requireNearLoginWalletBinding } from './identity';
import type { ResolvedLoginWalletIdentity } from './identity';
import type {
  CompletedPasskeyExchangeEcdsaActivation,
  LoginPreauthorizedEcdsaActivation,
  ConfiguredThresholdEcdsaPublicationTarget,
} from './passkeyExchange';
import type { PasskeyEd25519CustodyLoginOutcome } from './custodyActivation';
import {
  bindLoginEd25519SessionAuthorityToAuthenticatedCredential,
  requireRequestedLoginEd25519SessionAuthority,
  resolveLoginWarmEd25519ProvisioningIdentity,
  resolveLoginEd25519ProvisionScope,
  passkeyUnlockEd25519Connection,
  resolveLoginPasskeyMaterialActivation,
} from './unlockPlanning';
import { openAndActivatePasskeyEd25519CustodyLogin } from './custodyActivation';

export type ThresholdLoginWarmupPlan = {
  kind: 'threshold_login_warmup_plan_ready';
  storedCanonicalEcdsaContext: CanonicalThresholdEcdsaWarmSessionContext;
  configuredTargetKeyCompletion: ConfiguredTargetKeyCompletion;
  ecdsaContext: CanonicalThresholdEcdsaWarmSessionContext;
  signersToWarm: ThresholdLoginWarmSigner[];
  ed25519DependsOnEcdsa: boolean;
  ecdsaDependsOnEd25519: boolean;
};

export type ThresholdLoginWarmupPhaseResult =
  | {
      kind: 'threshold_login_warmup_ready';
      signingSession: ThresholdWarmLoginAndCreateSessionResult['signingSession'];
      signersWarmed: readonly ThresholdLoginWarmSigner[];
    }
  | {
      kind: 'threshold_login_ecdsa_only_warmup_ready';
      signingSession?: never;
      signersWarmed: readonly ['ecdsa'];
    };

type ThresholdLoginWarmSigner = 'ed25519' | 'ecdsa';

type ThresholdLoginWarmupTask = {
  signer: ThresholdLoginWarmSigner;
  dependencies: ThresholdLoginWarmSigner[];
  onFailure: ((error: unknown) => void) | null;
  run: () => Promise<void>;
};

type ThresholdLoginWarmupTaskOutcome =
  | { kind: 'succeeded'; task: ThresholdLoginWarmupTask }
  | { kind: 'failed'; task: ThresholdLoginWarmupTask; error: Error };

type ThresholdLoginWarmEd25519State = {
  thresholdSessionId: string;
  authorizationId: WalletSessionAuthorizationId | null;
  walletSessionId: WalletSessionId | null;
  quotaId: MpcWalletSigningQuotaId | null;
  operationCredential: WalletSessionOperationCredentialV1 | null;
  expiresAtMs: number;
  remainingUses: number;
  runtimePolicyScope: ThresholdRuntimePolicyScope | null;
};

type ThresholdLoginWarmSharedState = {
  ed25519: ThresholdLoginWarmEd25519State;
  activeCanonicalEcdsaContext: CanonicalThresholdEcdsaWarmSessionContext;
};

type ThresholdLoginWarmEcdsaDependency =
  | { kind: 'none' }
  | { kind: 'ed25519_wallet_session_authority' };

class LoginWarmupDeferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise!: (value: Value) => void;
  private rejectPromise!: (error: Error) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise(this.capturePromise.bind(this));
  }

  resolve(value: Value): void {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise(value);
  }

  reject(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(toError(error));
  }

  async wait(): Promise<Value> {
    return await this.promise;
  }

  private capturePromise(resolve: (value: Value) => void, reject: (error: Error) => void): void {
    this.resolvePromise = resolve;
    this.rejectPromise = reject;
  }
}

async function stageMintedLoginEd25519WalletSessionAuthority(
  context: {
    sharedState: ThresholdLoginWarmSharedState;
    authorityDeferred: LoginWarmupDeferred<MintedEd25519WalletSessionAuthority> | null;
  },
  minted: MintedEd25519WalletSessionAuthority,
): Promise<void> {
  context.sharedState.ed25519.thresholdSessionId = String(minted.thresholdSessionId);
  context.sharedState.ed25519.authorizationId = minted.authorizationId;
  context.sharedState.ed25519.walletSessionId = minted.walletSessionId;
  context.sharedState.ed25519.quotaId = minted.quotaId;
  context.sharedState.ed25519.operationCredential = minted.operationCredential;
  context.sharedState.ed25519.expiresAtMs = minted.expiresAtMs;
  context.sharedState.ed25519.remainingUses = minted.remainingUses;
  context.sharedState.ed25519.runtimePolicyScope = minted.runtimePolicyScope;
  context.authorityDeferred?.resolve(minted);
}

function rejectLoginWarmupEd25519Deferreds(
  authorityDeferred: LoginWarmupDeferred<MintedEd25519WalletSessionAuthority> | null,
  error: unknown,
): void {
  authorityDeferred?.reject(error);
}

export function createActiveLoginSigningSessionStatus(args: {
  session: Pick<LoginWarmEd25519Session, 'thresholdSessionId' | 'remainingUses' | 'expiresAtMs'>;
  authMethod: WalletAuthMethod;
}): ThresholdWarmLoginAndCreateSessionResult['signingSession'] {
  return {
    sessionId: String(args.session.thresholdSessionId),
    status: 'active',
    authMethod: args.authMethod,
    ...(args.authMethod === SIGNER_AUTH_METHODS.emailOtp ? { retention: 'session' as const } : {}),
    remainingUses: args.session.remainingUses,
    expiresAtMs: args.session.expiresAtMs,
  };
}

type ThresholdLoginWarmEcdsaBootstrapIdentity = {
  routeAuth?: WalletSessionOperationCredentialV1;
};

function isWalletSessionReconnectEcdsaRouteAuth(
  auth: WalletSessionOperationCredentialV1 | undefined,
): auth is WalletSessionOperationCredentialV1 {
  return auth?.kind === 'opaque_wallet_session_operation_credential_v1';
}

type ThresholdLoginWarmupResult = {
  ecdsaBootstraps: ThresholdEcdsaSessionBootstrapResult[];
  ed25519Session: LoginWarmEd25519Session | null;
};

export type ThresholdEcdsaAuthorizedEd25519Mint = {
  operationCredential: WalletSessionOperationCredentialV1;
  passkeyPrfFirstB64u: string;
  passkeyCredentialIdB64u: string;
  quotaId: MpcWalletSigningQuotaId;
};

function publicCapabilityFromThresholdEcdsaBootstrap(
  bootstrap: ThresholdEcdsaSessionBootstrapResult,
): RouterAbEcdsaDerivationPublicCapabilityV1 | undefined {
  const backendBinding = bootstrap.thresholdEcdsaKeyRef.backendBinding;
  if (!backendBinding) return undefined;
  switch (backendBinding.materialKind) {
    case 'role_local_worker_handle':
    case 'role_local_durable_sealed_ref':
    case 'role_local_durable_public_anchor':
      return backendBinding.publicFacts.publicCapability;
    case 'role_local_ready_state_blob':
      return backendBinding.ecdsaRoleLocalReadyRecord.publicFacts.publicCapability;
    case 'metadata_only':
      return undefined;
  }
}

function sharedEcdsaActivationKey(capability: RouterAbEcdsaDerivationPublicCapabilityV1): string {
  return JSON.stringify(capability);
}

function preauthorizedEcdsaActivationFromBootstrap(
  bootstrap: ThresholdEcdsaSessionBootstrapResult,
): RouterAbEcdsaPostRegistrationSessionActivationResponseV1 {
  const publicCapability = publicCapabilityFromThresholdEcdsaBootstrap(bootstrap);
  if (!publicCapability) {
    throw new Error('[login] ECDSA bootstrap is missing its public capability');
  }
  const session = bootstrap.session;
  const normalSigning = bootstrap.thresholdEcdsaKeyRef.routerAbEcdsaDerivationNormalSigning;
  if (!normalSigning) {
    throw new Error('[login] ECDSA bootstrap is missing normal-signing state');
  }
  return {
    kind: 'router_ab_ecdsa_post_registration_session_activated_v1',
    public_capability: publicCapability,
    session: {
      authorization_session_id: session.authorizationSessionId,
      authorization_id: session.authorizationId,
      threshold_session_id: requireThresholdLoginEcdsaSessionId(session.thresholdSessionId),
      wallet_session_id: session.walletSessionId,
      quota_id: session.quotaId,
      expires_at_ms: session.expiresAtMs,
      remaining_uses: session.remainingUses,
      wallet_session: session.walletSession,
      operation_credential: session.operationCredential,
    },
    normal_signing: normalSigning,
  };
}

/** Public capability and authority are the manifest's half of the capability
 * split; the sealed record is only correlated runtime evidence. A persisted
 * capability on the configured target is used directly; otherwise the exact
 * manifest is resolved. There is deliberately no composite-record fallback --
 * absent canonical state is device-link-required, not a silent miss. */
async function resolvePersistedEcdsaPublicCapabilityForLogin(args: {
  walletId: WalletId;
  chainTarget: ThresholdEcdsaChainTarget;
  targetEcdsaKey: ConfiguredTargetThresholdEcdsaWarmKey;
}): Promise<RouterAbEcdsaDerivationPublicCapabilityV1> {
  if (args.targetEcdsaKey.publicCapability.kind === 'persisted_public_capability') {
    const publicCapability = args.targetEcdsaKey.publicCapability.value;
    if (String(publicCapability.client_id) !== String(args.walletId)) {
      throw new Error(
        `[login] threshold ECDSA persisted public capability wallet mismatch for ${thresholdEcdsaChainTargetKey(args.chainTarget)}`,
      );
    }
    return publicCapability;
  }
  const resolved = await resolveBrowserActiveEcdsaCapabilityRuntime({
    walletId: args.walletId,
    chainTarget: args.chainTarget,
  });
  if (resolved.kind !== 'resolved') {
    throw createThresholdEcdsaDeviceLinkRequiredError(
      thresholdEcdsaChainTargetKey(args.chainTarget),
    );
  }
  // Validated against what the manifest itself binds: wallet and key handle.
  // client_id is only checked on the persisted branch above, where it was
  // already the contract; manifest-sourced capabilities are not assumed to
  // carry the wallet id in that field.
  const publicFacts = resolved.manifest.durableMaterial.roleLocalPublicFacts;
  if (
    String(publicFacts.keyHandle) !== String(args.targetEcdsaKey.keyHandle) ||
    String(publicFacts.walletId) !== String(args.walletId)
  ) {
    throw createThresholdEcdsaDeviceLinkRequiredError(
      thresholdEcdsaChainTargetKey(args.chainTarget),
    );
  }
  return publicFacts.publicCapability;
}

function buildThresholdLoginWarmSignerSelection(
  signersToWarm: readonly ThresholdLoginWarmSigner[],
): ThresholdLoginWarmSigner[] {
  const normalized: ThresholdLoginWarmSigner[] = [];
  for (const signer of signersToWarm) {
    if (signer !== 'ed25519' && signer !== 'ecdsa') continue;
    if (normalized.includes(signer)) continue;
    normalized.push(signer);
  }
  return normalized;
}

async function runThresholdLoginWarmupTask(
  task: ThresholdLoginWarmupTask,
): Promise<ThresholdLoginWarmupTaskOutcome> {
  try {
    await task.run();
    return { kind: 'succeeded', task };
  } catch (error: unknown) {
    task.onFailure?.(error);
    return { kind: 'failed', task, error: toError(error) };
  }
}

async function runThresholdLoginWarmupTasks(tasks: ThresholdLoginWarmupTask[]): Promise<void> {
  const pendingBySigner = new Map<ThresholdLoginWarmSigner, ThresholdLoginWarmupTask>();
  for (const task of tasks) {
    pendingBySigner.set(task.signer, task);
  }
  const completed = new Set<ThresholdLoginWarmSigner>();

  while (pendingBySigner.size > 0) {
    const ready: ThresholdLoginWarmupTask[] = [];
    for (const task of pendingBySigner.values()) {
      if (task.dependencies.every((dep) => completed.has(dep))) {
        ready.push(task);
      }
    }
    if (ready.length === 0) {
      throw new Error('[login] threshold warm-up task dependency graph is unsatisfied');
    }
    const outcomes = await Promise.all(ready.map(runThresholdLoginWarmupTask));
    let firstFailure: Error | null = null;
    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case 'succeeded':
          completed.add(outcome.task.signer);
          pendingBySigner.delete(outcome.task.signer);
          break;
        case 'failed':
          firstFailure ??= outcome.error;
          break;
        default:
          return assertNeverLoginState(outcome);
      }
    }
    if (firstFailure) throw firstFailure;
  }
}

function resolveThresholdLoginWarmEcdsaBootstrapIdentity(args: {
  credentialState: LoginWarmupCredentialState;
  routeAuthorization: LoginWarmupRouteAuthorization;
}): ThresholdLoginWarmEcdsaBootstrapIdentity {
  args.routeAuthorization.kind satisfies 'none';
  if (args.credentialState.kind === 'available') {
    return {};
  }
  throw new Error('[login] threshold ECDSA warm-up requires route authorization');
}

function thresholdLoginWarmupErrorMessage(error: unknown): string {
  return String(
    (error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : error) || '',
  );
}

type WithoutLoginRuntimeScope<Request extends EcdsaBootstrapRequest> =
  Request extends EcdsaBootstrapRequest
    ? Omit<Request, 'runtimeScopeBootstrap'> & { runtimeScopeBootstrap?: never }
    : never;

type LoginEcdsaBootstrapRequestWithoutRuntimeScope =
  WithoutLoginRuntimeScope<EcdsaBootstrapRequest>;

async function bootstrapLoginEcdsaSession(args: {
  signingEngine: Pick<LoginWarmSigningSurface, 'bootstrapEcdsaSession'>;
  runtimeScopeBootstrapState: LoginWarmupRuntimeScopeBootstrapState;
  request: LoginEcdsaBootstrapRequestWithoutRuntimeScope;
}): Promise<ThresholdEcdsaSessionBootstrapResult> {
  switch (args.runtimeScopeBootstrapState.kind) {
    case 'available':
      return await args.signingEngine.bootstrapEcdsaSession({
        ...args.request,
        runtimeScopeBootstrap: args.runtimeScopeBootstrapState.runtimeScopeBootstrap,
      } satisfies EcdsaBootstrapRequest);
    case 'unavailable':
      return await args.signingEngine.bootstrapEcdsaSession(args.request);
    default:
      return assertNeverLoginState(args.runtimeScopeBootstrapState);
  }
}

export async function primeThresholdLoginWarmSigners(args: {
  statusReads: WalletSessionStatusReadScope;
  context: LoginWebContext;
  signingEngine: LoginUnlockSigningSurface;
  walletIdentity: ResolvedLoginWalletIdentity;
  signerSlot: number;
  thresholdKeyMaterial: ThresholdEd25519KeyMaterial | null;
  relayerUrl: string;
  relayerKeyId: string;
  participantIds: number[];
  ttlMs: number;
  unlockRemainingUses: number;
  ecdsaContext: CanonicalThresholdEcdsaWarmSessionContext;
  credentialState: LoginWarmupCredentialState;
  runtimeScopeBootstrapState: LoginWarmupRuntimeScopeBootstrapState;
  signersToWarm: readonly ThresholdLoginWarmSigner[];
  ed25519DependsOnEcdsa: boolean;
  ecdsaDependency: ThresholdLoginWarmEcdsaDependency;
  ed25519MintPlan: LoginWarmupEd25519MintPlan;
  ed25519SessionAuthority: LoginWarmupEd25519SessionAuthority;
  routeAuthorization: LoginWarmupRouteAuthorization;
  passkeyExchangeEcdsaActivation: CompletedPasskeyExchangeEcdsaActivation | null;
  passkeyUnlockEd25519Session: PasskeyWalletUnlockEd25519Session | null;
  passkeyUnlockWalletSessionAuthorization: ExactWalletSessionAuthorization | null;
}): Promise<ThresholdLoginWarmupResult> {
  const signersToWarm = buildThresholdLoginWarmSignerSelection(args.signersToWarm);
  const credential =
    args.credentialState.kind === 'available' ? args.credentialState.credential : undefined;
  const localPasskeyCredentialIdB64u = args.credentialState.localPasskeyCredentialIdB64u;
  const runtimeScopeBootstrap =
    args.runtimeScopeBootstrapState.kind === 'available'
      ? args.runtimeScopeBootstrapState.runtimeScopeBootstrap
      : null;
  const initialCanonicalEcdsaContext = args.ecdsaContext;
  const sharedState: ThresholdLoginWarmSharedState = {
    activeCanonicalEcdsaContext: initialCanonicalEcdsaContext,
    ed25519: {
      thresholdSessionId: '',
      authorizationId: null,
      walletSessionId: null,
      quotaId: null,
      operationCredential: null,
      expiresAtMs: 0,
      remainingUses: 0,
      runtimePolicyScope: null,
    },
  };
  const authorityDeferred =
    args.ecdsaDependency.kind === 'ed25519_wallet_session_authority'
      ? new LoginWarmupDeferred<MintedEd25519WalletSessionAuthority>()
      : null;
  const ecdsaThresholdSessionState: ThresholdLoginWarmEcdsaThresholdSessionState = {
    generatedThresholdSessionId:
      args.passkeyExchangeEcdsaActivation?.policy.session_policy.threshold_session_id || '',
  };
  const unlockRemainingUses = args.unlockRemainingUses;
  const ecdsaBootstraps: ThresholdEcdsaSessionBootstrapResult[] = [];
  let ed25519Session: LoginWarmEd25519Session | null = null;
  const custodyRecovery: { outcome: PasskeyEd25519CustodyLoginOutcome } = {
    outcome: { kind: 'unchanged' },
  };
  let ecdsaAuthorizedEd25519Mint: ThresholdEcdsaAuthorizedEd25519Mint | null = null;

  const tasks: ThresholdLoginWarmupTask[] = [];
  if (signersToWarm.includes('ed25519')) {
    tasks.push({
      signer: 'ed25519',
      dependencies: args.ed25519DependsOnEcdsa ? ['ecdsa'] : [],
      onFailure: authorityDeferred
        ? rejectLoginWarmupEd25519Deferreds.bind(undefined, authorityDeferred)
        : null,
      run: async () => {
        const walletBinding = requireNearLoginWalletBinding(args.walletIdentity);
        const ecdsaMint = ecdsaAuthorizedEd25519Mint;
        const ed25519SessionAuthority = bindLoginEd25519SessionAuthorityToAuthenticatedCredential({
          authority: requireRequestedLoginEd25519SessionAuthority(args.ed25519SessionAuthority),
          walletId: walletBinding.walletId,
          rpId: args.context.signingEngine.getRpId(),
          credentialIdB64u: localPasskeyCredentialIdB64u,
        });
        const ed25519ProvisioningIdentity = resolveLoginWarmEd25519ProvisioningIdentity({
          mintPlan: args.ed25519MintPlan,
          ecdsaMint,
          walletBinding,
          signerSlot: args.signerSlot,
          authority: ed25519SessionAuthority,
        });
        const provisionScope = resolveLoginEd25519ProvisionScope({
          mintPlan: args.ed25519MintPlan,
          fallback: {
            relayerKeyId: args.relayerKeyId,
            participantIds: args.participantIds,
            runtimePolicyScope: initialCanonicalEcdsaContext.runtimePolicyScope ?? null,
            routerAbNormalSigning: createRouterAbNormalSigningPolicy(args.context.configs),
          },
        });
        const sharedEd25519ConnectArgs = {
          relayerUrl: args.relayerUrl,
          relayerKeyId: provisionScope.relayerKeyId,
          runtimePolicyScope: provisionScope.runtimePolicyScope || undefined,
          routerAbNormalSigning: provisionScope.routerAbNormalSigning,
          runtimeScopeBootstrap: runtimeScopeBootstrap || undefined,
          participantIds: provisionScope.participantIds,
          ttlMs: args.ttlMs,
          remainingUses: unlockRemainingUses,
          onWalletSessionAuthorityReady: stageMintedLoginEd25519WalletSessionAuthority.bind(
            undefined,
            {
              sharedState,
              authorityDeferred,
            },
          ),
        };
        const commonEd25519ConnectArgs =
          ed25519ProvisioningIdentity.kind === 'fresh_ed25519_provisioning'
            ? {
                ...ed25519ProvisioningIdentity,
                walletId: String(walletBinding.walletId),
                nearAccountId: walletBinding.nearAccountId,
                nearEd25519SigningKeyId: walletBinding.nearEd25519SigningKeyId,
                signerSlot: args.signerSlot,
                ...sharedEd25519ConnectArgs,
              }
            : {
                ...ed25519ProvisioningIdentity,
                ...sharedEd25519ConnectArgs,
              };
        let connected:
          | Awaited<ReturnType<typeof args.signingEngine.connectEd25519Session>>
          | PasskeyUnlockEd25519Connection;
        switch (ed25519SessionAuthority.kind) {
          case 'email_otp':
            connected = await args.signingEngine.connectEd25519Session({
              ...commonEd25519ConnectArgs,
              source: 'email_otp',
              authority: ed25519SessionAuthority.authority,
              emailOtpAuthContext: ed25519SessionAuthority.emailOtpAuthContext,
              materialActivation: undefined,
            });
            break;
          case 'passkey':
            if (!args.passkeyUnlockEd25519Session) {
              throw new Error('[login] verified wallet unlock omitted its Ed25519 Wallet Session');
            }
            if (args.ed25519MintPlan.kind !== 'wallet_custody') {
              throw new Error('[login] verified unlock Ed25519 session requires wallet custody');
            }
            connected = passkeyUnlockEd25519Connection({
              session: args.passkeyUnlockEd25519Session,
              walletBinding,
              signerSlot: args.signerSlot,
              custody: args.ed25519MintPlan.custody,
              provisionScope,
              credential,
              remainingUses: unlockRemainingUses,
              unlockAuthorization: args.passkeyUnlockWalletSessionAuthorization,
            });
            break;
          default:
            return assertNeverLoginState(ed25519SessionAuthority);
        }
        if (!connected.ok) {
          const details = String(
            connected.message || connected.code || 'Failed to connect threshold Ed25519 session',
          );
          throw new Error(`[login] threshold Ed25519 warm-up failed: ${details}`);
        }
        ed25519Session = connected;

        if (!connected.thresholdSessionId) {
          throw new Error('[login] threshold Ed25519 warm-up did not return a thresholdSessionId');
        }

        const connectedAuthority =
          ed25519SessionAuthority.kind === 'passkey'
            ? await exactPasskeyWalletAuthAuthorityRefForCredential({
                walletId: walletBinding.walletId,
                rpId: args.context.signingEngine.getRpId(),
                credentialIdB64u:
                  passkeyCredentialIdB64uFromAuthentication(credential || undefined) ||
                  localPasskeyCredentialIdB64u,
              })
            : await walletAuthAuthorityRef({
                authority: ed25519SessionAuthority.authority.authority,
              });

        if (args.ed25519MintPlan.kind === 'wallet_custody') {
          if (ed25519SessionAuthority.kind !== 'passkey') {
            throw new Error('[login] wallet custody requires passkey authority');
          }
          const expectedMaterialActivation = resolveLoginPasskeyMaterialActivation(
            ed25519ProvisioningIdentity,
            args.ed25519MintPlan,
          );
          const passkeyPrfFirstB64u = credential
            ? passkeyPrfFirstB64uFromCredential(credential)
            : '';
          if (!passkeyPrfFirstB64u) {
            throw new Error('[login] wallet custody requires WebAuthn PRF.first');
          }
          custodyRecovery.outcome = await args.signingEngine.withExactEd25519MaterialOwner({
            materialActivation: expectedMaterialActivation,
            nearAccountId: walletBinding.nearAccountId,
            task: openAndActivatePasskeyEd25519CustodyLogin.bind(undefined, {
              signingEngine: args.signingEngine,
              custody: args.ed25519MintPlan.custody,
              walletBinding,
              signerSlot: args.signerSlot,
              passkeyPrfFirstB64u,
              walletSession: connected,
              authority: connectedAuthority,
              routerAbNormalSigning: provisionScope.routerAbNormalSigning,
              relayerUrl: args.relayerUrl,
            }),
          });
        }
      },
    });
  }
  if (signersToWarm.includes('ecdsa')) {
    tasks.push({
      signer: 'ecdsa',
      dependencies: [],
      onFailure: null,
      run: async () => {
        await authorityDeferred?.promise;
        let bootstrapIdentity: ThresholdLoginWarmEcdsaBootstrapIdentity | null = null;
        let consumedPasskeyExchangeActivation = false;
        const activationByMaterial = new Map<string, LoginPreauthorizedEcdsaActivation>();
        const configuredEcdsaTargets = listConfiguredThresholdEcdsaPublicationTargets(
          args.context.configs.network.chains,
        );
        const completeActiveContextFromConfiguredTargets = (source: string): void => {
          const completion = buildConfiguredTargetKeyCompletion({
            context: sharedState.activeCanonicalEcdsaContext,
            configuredTargets: configuredEcdsaTargets,
          });
          if (completion.kind === 'complete_configured_target_keys') {
            sharedState.activeCanonicalEcdsaContext = completion.context;
            return;
          }
          if (completion.kind === 'missing_configured_target_keys') {
            return;
          }
          requireCompleteConfiguredTargetKeyContext({ completion, source });
        };
        const rememberEcdsaAuthorizedEd25519Mint = (
          bootstrap: ThresholdEcdsaSessionBootstrapResult,
        ): void => {
          if (ecdsaAuthorizedEd25519Mint) return;
          const operationCredential = bootstrap.session.operationCredential;
          const passkeyPrfFirstB64u = credential
            ? passkeyPrfFirstB64uFromCredential(credential)
            : '';
          const passkeyCredentialIdB64u =
            passkeyCredentialIdB64uFromAuthentication(credential || undefined) ||
            localPasskeyCredentialIdB64u;
          if (!operationCredential.token || !passkeyPrfFirstB64u || !passkeyCredentialIdB64u) {
            return;
          }
          ecdsaAuthorizedEd25519Mint = {
            operationCredential,
            passkeyPrfFirstB64u,
            passkeyCredentialIdB64u,
            quotaId: bootstrap.session.quotaId,
          };
        };
        const resolveCurrentBootstrapIdentity = (): ThresholdLoginWarmEcdsaBootstrapIdentity => {
          if (sharedState.ed25519.operationCredential) {
            return {
              routeAuth: sharedState.ed25519.operationCredential,
            };
          }
          const operationCredential = ecdsaAuthorizedEd25519Mint?.operationCredential;
          if (operationCredential) {
            return {
              routeAuth: operationCredential,
            };
          }
          if (bootstrapIdentity) return bootstrapIdentity;
          bootstrapIdentity = resolveThresholdLoginWarmEcdsaBootstrapIdentity({
            credentialState: args.credentialState,
            routeAuthorization: args.routeAuthorization,
          });
          return bootstrapIdentity;
        };
        const bootstrapTarget = async (
          target: (typeof configuredEcdsaTargets)[number],
          targetEcdsaKey: ConfiguredTargetThresholdEcdsaWarmKey,
        ) => {
          if (!targetEcdsaKey.key) {
            throw new Error(
              '[login] threshold ECDSA warm-up requires configured target key identity',
            );
          }
          const publicCapability = await resolvePersistedEcdsaPublicCapabilityForLogin({
            walletId: args.walletIdentity.walletId,
            chainTarget: target.chainTarget,
            targetEcdsaKey,
          });
          const reusedMaterialActivation = activationByMaterial.get(
            sharedEcdsaActivationKey(publicCapability),
          );
          const exchangeActivation = args.passkeyExchangeEcdsaActivation;
          const matchingExchangeActivation =
            exchangeActivation &&
            !consumedPasskeyExchangeActivation &&
            exchangeActivation.targetKey === thresholdEcdsaChainTargetKey(target.chainTarget)
              ? exchangeActivation
              : null;
          const preauthorized = matchingExchangeActivation
            ? {
                sessionActivation: matchingExchangeActivation.sessionActivation,
                authorizationIdentity: matchingExchangeActivation.authorizationIdentity,
              }
            : (reusedMaterialActivation ?? null);
          const thresholdSessionId = preauthorized
            ? thresholdSessionIdFromPasskeyEcdsaActivation(preauthorized.sessionActivation)
            : resolveThresholdLoginWarmEcdsaThresholdSessionId({
                sharedState: ecdsaThresholdSessionState,
              });
          const runtimePolicyScope = sharedState.activeCanonicalEcdsaContext.runtimePolicyScope;
          if (!runtimePolicyScope) {
            throw new Error('[login] ECDSA session lane requires runtimePolicyScope');
          }
          const lanePolicy = buildEvmFamilyEcdsaSessionLanePolicy({
            chainTarget: target.chainTarget,
            thresholdSessionId,
            ttlMs: args.ttlMs,
            remainingUses: unlockRemainingUses,
            runtimePolicyScope,
          });
          const existingRoleLocalMaterial = targetEcdsaKey.existingRoleLocalMaterial;
          if (!existingRoleLocalMaterial) {
            throw createThresholdEcdsaDeviceLinkRequiredError(
              thresholdEcdsaChainTargetKey(target.chainTarget),
            );
          }
          if (!localPasskeyCredentialIdB64u) {
            throw new Error('[login] ECDSA role-local activation requires passkey identity');
          }
          const authorizationAuthority = existingRoleLocalMaterial.authority;
          if (preauthorized) {
            if (matchingExchangeActivation) consumedPasskeyExchangeActivation = true;
            return await bootstrapLoginEcdsaSession({
              signingEngine: args.signingEngine,
              runtimeScopeBootstrapState: args.runtimeScopeBootstrapState,
              request: {
                kind: 'passkey_preauthorized_ecdsa_bootstrap',
                source: 'login',
                relayerUrl: args.relayerUrl,
                keyHandle: toEvmFamilyEcdsaKeyHandle(targetEcdsaKey.keyHandle),
                key: targetEcdsaKey.key,
                lanePolicy,
                publicCapability,
                existingRoleLocalMaterial,
                authorizationAuthority,
                authorizationIdentity: preauthorized.authorizationIdentity,
                passkeyCredentialIdB64u: localPasskeyCredentialIdB64u,
                sessionActivation: preauthorized.sessionActivation,
              },
            });
          }
          const currentBootstrapIdentity = resolveCurrentBootstrapIdentity();
          const reconnectRouteAuth = currentBootstrapIdentity.routeAuth;
          if (!isWalletSessionReconnectEcdsaRouteAuth(reconnectRouteAuth)) {
            throw new Error(
              '[login] ECDSA role-local activation requires a verified Wallet Session',
            );
          }
          return await bootstrapLoginEcdsaSession({
            signingEngine: args.signingEngine,
            runtimeScopeBootstrapState: args.runtimeScopeBootstrapState,
            request: {
              kind: 'wallet_session_reconnect_ecdsa_bootstrap',
              source: 'login',
              relayerUrl: args.relayerUrl,
              keyHandle: toEvmFamilyEcdsaKeyHandle(targetEcdsaKey.keyHandle),
              key: targetEcdsaKey.key,
              lanePolicy,
              publicCapability,
              existingRoleLocalMaterial,
              authorizationAuthority,
              passkeyCredentialIdB64u: localPasskeyCredentialIdB64u,
              routeAuth: reconnectRouteAuth,
            },
          });
        };
        const bootstrapConfiguredTargets = async () => {
          completeActiveContextFromConfiguredTargets('login ECDSA warm-up preflight');
          const orderedConfiguredEcdsaTargets: typeof configuredEcdsaTargets = [];
          const preauthorizedTargetKey = args.passkeyExchangeEcdsaActivation?.targetKey || null;
          if (preauthorizedTargetKey) {
            for (const target of configuredEcdsaTargets) {
              if (thresholdEcdsaChainTargetKey(target.chainTarget) === preauthorizedTargetKey) {
                orderedConfiguredEcdsaTargets.push(target);
              }
            }
          }
          for (const target of configuredEcdsaTargets) {
            if (thresholdEcdsaChainTargetKey(target.chainTarget) !== preauthorizedTargetKey) {
              orderedConfiguredEcdsaTargets.push(target);
            }
          }
          for (const target of orderedConfiguredEcdsaTargets) {
            const targetKey = thresholdEcdsaChainTargetKey(target.chainTarget);
            const targetEcdsaKey = sharedState.activeCanonicalEcdsaContext.ecdsaKeys.find(
              (key) => key.targetKey === targetKey,
            );
            const keyHandle = String(targetEcdsaKey?.keyHandle || '').trim();
            if (!targetEcdsaKey?.key || !keyHandle) {
              throw createThresholdEcdsaDeviceLinkRequiredError(targetKey);
            }
            const bootstrap: ThresholdEcdsaSessionBootstrapResult = await bootstrapTarget(
              target,
              targetEcdsaKey,
            );
            ecdsaBootstraps.push(bootstrap);
            void scheduleEcdsaSessionPresignaturePrefill({
              statusReads: args.statusReads,
              trigger: 'unlock',
              signingEngine: args.signingEngine,
              walletId: args.walletIdentity.walletId,
              chainTarget: target.chainTarget,
            });
            rememberEcdsaAuthorizedEd25519Mint(bootstrap);
            const activation = preauthorizedEcdsaActivationFromBootstrap(bootstrap);
            const activationKey = sharedEcdsaActivationKey(activation.public_capability);
            if (!activationByMaterial.has(activationKey)) {
              const activationAuthority = await resolveActivePasskeyWalletSessionAuthority({
                walletId: args.walletIdentity.walletId,
                authorization: {
                  record: bootstrap.session.walletSession,
                  operationCredential: bootstrap.session.operationCredential,
                },
              });
              activationByMaterial.set(activationKey, {
                sessionActivation: activation,
                authorizationIdentity: activationAuthority.identity,
              });
            }
            const returnedKeyHandle = String(
              bootstrap.thresholdEcdsaKeyRef?.keyHandle || '',
            ).trim();
            if (returnedKeyHandle !== targetEcdsaKey.keyHandle) {
              throw new Error(
                `[login] threshold ECDSA warm-up returned a different keyHandle for ${targetKey}`,
              );
            }
          }
          if (args.passkeyExchangeEcdsaActivation && !consumedPasskeyExchangeActivation) {
            throw new Error(
              '[login] passkey exchange ECDSA activation did not match a configured target',
            );
          }
        };
        try {
          await bootstrapConfiguredTargets();
        } catch (error: unknown) {
          const details =
            thresholdLoginWarmupErrorMessage(error) ||
            'Failed to bootstrap threshold ECDSA session';
          throw new Error(`[login] threshold ECDSA warm-up failed: ${details}`);
        }
      },
    });
  }

  await runThresholdLoginWarmupTasks(tasks);
  if (custodyRecovery.outcome.kind === 'recovered') {
    if (!args.passkeyUnlockWalletSessionAuthorization) {
      throw new Error('Recovered passkey material requires its exact Wallet Session');
    }
    await reconcilePasskeyWalletSessionAfterRecovery({
      authorization: args.passkeyUnlockWalletSessionAuthorization,
      materialActivation: custodyRecovery.outcome.materialActivation,
      relayerUrl: args.relayerUrl,
      statusReads: args.statusReads,
      previousAuthority: custodyRecovery.outcome.previousAuthority,
    });
  }
  return { ecdsaBootstraps, ed25519Session };
}

function resolveThresholdLoginWarmSigners(args: {
  selection: WalletUnlockSelection;
  configuredEcdsaTargets: readonly ConfiguredThresholdEcdsaPublicationTarget[];
  canonicalEcdsaContext?: CanonicalThresholdEcdsaWarmSessionContext | null;
}): ThresholdLoginWarmSigner[] {
  if (args.selection.mode === 'ed25519_only') return ['ed25519'];
  if (!args.configuredEcdsaTargets.length) {
    return args.selection.mode === 'ecdsa_only' ? [] : ['ed25519'];
  }
  const keyIdsByTarget = new Set(
    (args.canonicalEcdsaContext?.ecdsaKeys || []).map((key) => key.targetKey),
  );
  if (keyIdsByTarget.size === 0) {
    throw new Error('[login] threshold ECDSA warm-up missing canonical key identity');
  }
  const missingTargets = args.configuredEcdsaTargets
    .map((target) => thresholdEcdsaChainTargetKey(target.chainTarget))
    .filter((targetKey) => !keyIdsByTarget.has(targetKey));
  if (missingTargets.length) {
    throw new Error(
      `[login] threshold ECDSA warm-up missing configured-target key ids for ${missingTargets.join(
        ', ',
      )}`,
    );
  }
  return args.selection.mode === 'ecdsa_only' ? ['ecdsa'] : ['ed25519', 'ecdsa'];
}

export function resolveThresholdLoginWarmupPlan(args: {
  selection: WalletUnlockSelection;
  selectedEcdsaTargets: readonly ConfiguredThresholdEcdsaPublicationTarget[];
  storedCanonicalEcdsaContext: CanonicalThresholdEcdsaWarmSessionContext;
  wantsEd25519Warmup: boolean;
}): ThresholdLoginWarmupPlan {
  const configuredTargetKeyCompletion = buildConfiguredTargetKeyCompletion({
    context: args.storedCanonicalEcdsaContext,
    configuredTargets: args.selectedEcdsaTargets,
  });
  const ecdsaContext = requireCompleteConfiguredTargetKeyContext({
    completion: configuredTargetKeyCompletion,
    source: 'stored ECDSA key facts',
  });
  let signersToWarm = resolveThresholdLoginWarmSigners({
    selection: args.selection,
    configuredEcdsaTargets: args.selectedEcdsaTargets,
    canonicalEcdsaContext: ecdsaContext,
  });
  if (args.wantsEd25519Warmup && !signersToWarm.includes('ed25519')) {
    signersToWarm = ['ed25519', ...signersToWarm];
  }
  const ed25519DependsOnEcdsa = false;
  const ecdsaDependsOnEd25519 =
    signersToWarm.includes('ed25519') && signersToWarm.includes('ecdsa');
  if (!signersToWarm.length) {
    throw new Error('[login] ECDSA unlock requested with no configured ECDSA targets');
  }
  return {
    kind: 'threshold_login_warmup_plan_ready',
    storedCanonicalEcdsaContext: args.storedCanonicalEcdsaContext,
    configuredTargetKeyCompletion,
    ecdsaContext,
    signersToWarm,
    ed25519DependsOnEcdsa,
    ecdsaDependsOnEd25519,
  };
}

type ThresholdLoginWarmEcdsaThresholdSessionState = {
  generatedThresholdSessionId: string;
};

function resolveThresholdLoginWarmEcdsaThresholdSessionId(input: {
  sharedState: ThresholdLoginWarmEcdsaThresholdSessionState;
}): string {
  const current = String(input.sharedState.generatedThresholdSessionId || '').trim();
  if (current) return current;
  const generated = createThresholdLoginWarmSessionId('threshold-ecdsa-login');
  input.sharedState.generatedThresholdSessionId = generated;
  return generated;
}
